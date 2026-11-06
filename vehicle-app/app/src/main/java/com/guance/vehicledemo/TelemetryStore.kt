package com.guance.vehicledemo

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.withTransaction
import androidx.sqlite.db.SupportSQLiteDatabase
import org.json.JSONObject

@Entity(tableName = "outbox", indices = [Index(value = ["sequence"], unique = true), Index("createdAt")])
data class OutboxEvent(
    @PrimaryKey val eventId: String,
    val sequence: Long,
    val createdAt: Long,
    val payload: String,
    val bytes: Long,
)

@Dao
interface TelemetryDao {
    @Query("SELECT * FROM vehicle_state WHERE id=1") suspend fun state(): VehicleState?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putState(state: VehicleState)
    @Insert suspend fun enqueue(event: OutboxEvent)
    @Query("SELECT * FROM outbox ORDER BY sequence LIMIT 1") suspend fun oldest(): OutboxEvent?
    @Query("SELECT COUNT(*) FROM outbox") suspend fun count(): Long
    @Query("SELECT COALESCE(SUM(bytes),0) FROM outbox") suspend fun bytes(): Long
    @Query("DELETE FROM outbox WHERE eventId=:id") suspend fun remove(id: String): Int
    @Query("DELETE FROM outbox WHERE createdAt < :cutoff") suspend fun expire(cutoff: Long): Int
}

@Database(entities = [VehicleState::class, OutboxEvent::class], version = 1, exportSchema = true)
abstract class TelemetryDatabase : RoomDatabase() {
    abstract fun telemetry(): TelemetryDao

    companion object {
        fun open(context: Context, name: String = "telemetry.db"): TelemetryDatabase =
            Room.databaseBuilder(context, TelemetryDatabase::class.java, name)
                // At 1 Hz, a single connection is sufficient. FULL sync must finish
                // before MQTT can see an event; a VM stop must not reuse its sequence.
                .setJournalMode(JournalMode.TRUNCATE)
                .addCallback(object : Callback() {
                    override fun onOpen(db: SupportSQLiteDatabase) {
                        db.execSQL("PRAGMA synchronous=FULL")
                    }
                }).build()
    }
}

class TelemetryStore(private val db: TelemetryDatabase) {
    val dao = db.telemetry()

    suspend fun initialize() = db.withTransaction {
        if (dao.state() == null) dao.putState(VehicleState())
    }

    suspend fun change(transform: (VehicleState) -> VehicleState) = db.withTransaction {
        dao.putState(transform(requireNotNull(dao.state())))
    }

    suspend fun sample(now: Long, timing: SampleTiming? = null) = db.withTransaction {
        val old = requireNotNull(dao.state())
        var next = VehicleModel.tick(old, now, timing?.elapsedMs)
        if (next.sequence != old.sequence) {
            val eventId = "${next.vehicleId}:${next.sequence}"
            val payload = JSONObject().apply {
                put("schemaVersion", 1)
                put("eventId", eventId)
                put("vehicleId", next.vehicleId)
                put("tripId", next.tripId)
                put("sequence", next.sequence)
                put("eventTime", now)
                timing?.let {
                    put("sampleMonotonicMs", it.monotonicMs)
                    put("producerRunId", it.producerRunId)
                }
                put("speedKph", next.speedKph)
                put("odometerKm", next.odometerKm)
                put("batterySocPct", next.batterySocPct)
                put("batteryTempC", next.batteryTempC)
                put("mode", next.mode)
            }.toString()
            dao.enqueue(OutboxEvent(eventId, next.sequence, now, payload, payload.toByteArray(Charsets.UTF_8).size.toLong()))
        }
        var dropped = dao.expire(now - QueuePolicy.MAX_AGE_MS).toLong()
        var bytes = dao.bytes()
        while (bytes > QueuePolicy.MAX_BYTES) {
            val oldest = dao.oldest() ?: break
            dropped += dao.remove(oldest.eventId)
            bytes -= oldest.bytes
        }
        next = next.copy(dropped = next.dropped + dropped)
        dao.putState(next)
    }

    suspend fun acknowledge(event: OutboxEvent, now: Long) = db.withTransaction {
        if (dao.remove(event.eventId) == 1) {
            val state = requireNotNull(dao.state())
            dao.putState(state.copy(acknowledged = state.acknowledged + 1,
                lastAckSequence = maxOf(state.lastAckSequence, event.sequence), lastAckTime = now))
        }
    }
}
