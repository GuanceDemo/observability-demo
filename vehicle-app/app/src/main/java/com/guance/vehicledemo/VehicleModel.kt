package com.guance.vehicledemo

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID
import kotlin.math.abs

enum class DriveMode { DRIVE, PARK, CHARGE }

data class SampleTiming(val monotonicMs: Long, val producerRunId: String, val elapsedMs: Long)

@Entity(tableName = "vehicle_state")
data class VehicleState(
    @PrimaryKey val id: Int = 1,
    val vehicleId: String = "demo-vehicle-001",
    val tripId: String = "",
    val sequence: Long = 0,
    val lastEventTime: Long = 0,
    val speedKph: Double = 0.0,
    val odometerKm: Double = 12840.0,
    val batterySocPct: Double = 76.0,
    val batteryTempC: Double = 28.0,
    val mode: String = DriveMode.DRIVE.name,
    val running: Boolean = false,
    val simulatedOffline: Boolean = false,
    val highTemperature: Boolean = false,
    val generated: Long = 0,
    val acknowledged: Long = 0,
    val dropped: Long = 0,
    val lastAckSequence: Long = 0,
    val lastAckTime: Long = 0,
)

object VehicleModel {
    fun tick(state: VehicleState, now: Long, elapsedMs: Long? = null): VehicleState {
        require(now > 0)
        if (!state.running) return state
        // A stopped process must not invent travel for the time it was absent.
        val dt = if (elapsedMs != null) (elapsedMs / 1000.0).coerceIn(0.0, 2.0)
            else if (state.lastEventTime == 0L) 1.0
            else ((now - state.lastEventTime) / 1000.0).coerceIn(0.0, 2.0)
        val driving = state.mode == DriveMode.DRIVE.name && state.batterySocPct > 0.0
        val targetSpeed = if (driving) VehicleProfile.targetSpeedKph(state.odometerKm) else 0.0
        val speed = if (driving) approach(state.speedKph, targetSpeed,
            VehicleProfile.ROAD_ACCELERATION_KPH_PER_SECOND * dt) else 0.0
        // Integrate mean speed, and never travel farther than the remaining energy permits.
        val distance = if (driving) minOf((state.speedKph + speed) / 2.0 * dt / 3600.0,
            state.batterySocPct / VehicleProfile.SOC_PER_KM) else 0.0
        val charging = state.mode == DriveMode.CHARGE.name
        val soc = if (charging) VehicleProfile.chargeSoc(state.batterySocPct, dt)
            else (state.batterySocPct - distance * VehicleProfile.SOC_PER_KM).coerceIn(0.0, 100.0)
        val targetTemp = when {
            state.highTemperature -> 85.0
            charging -> 36.0
            driving -> 29.0 + speed * 0.12
            else -> 27.0
        }
        val next = state.copy(
            tripId = state.tripId.ifEmpty { UUID.randomUUID().toString() },
            sequence = state.sequence + 1,
            lastEventTime = now,
            speedKph = speed,
            odometerKm = state.odometerKm + distance,
            batterySocPct = soc,
            batteryTempC = approach(state.batteryTempC, targetTemp,
                (if (state.highTemperature) 3.0 else 0.10) * dt),
            generated = state.generated + 1,
        )
        // Transitions share the sample transaction. PARK/pause remain explicit overrides.
        // The boundary sample has zero speed; the next sample begins charging/driving.
        return when {
            state.mode == DriveMode.DRIVE.name && soc <= 0.0 -> selectMode(next, DriveMode.CHARGE)
            charging && soc >= 100.0 -> selectMode(next, DriveMode.DRIVE)
            else -> next
        }
    }

    fun selectMode(state: VehicleState, mode: DriveMode): VehicleState = state.copy(
        mode = mode.name,
        speedKph = if (mode == DriveMode.DRIVE) state.speedKph else 0.0,
        tripId = if (mode == DriveMode.DRIVE && state.mode != mode.name)
            UUID.randomUUID().toString() else state.tripId,
    )

    private fun approach(value: Double, target: Double, step: Double): Double =
        if (abs(target - value) <= step) target else value + if (target > value) step else -step
}

object QueuePolicy {
    const val MAX_AGE_MS = 24 * 60 * 60 * 1000L
    const val MAX_BYTES = 100 * 1024 * 1024L
    fun expired(createdAt: Long, now: Long): Boolean = createdAt < now - MAX_AGE_MS
}
