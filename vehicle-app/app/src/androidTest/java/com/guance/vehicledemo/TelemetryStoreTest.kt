package com.guance.vehicledemo

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TelemetryStoreTest {
    @Test fun automaticTransitionsPersistWithMatchingImmutablePayloads() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "energy-cycle-test.db"
        context.deleteDatabase(name)
        var db = TelemetryDatabase.open(context, name)
        try {
            var store = TelemetryStore(db)
            store.initialize()
            store.change { it.copy(running = true, mode = "DRIVE", batterySocPct = 0.0, tripId = "old") }
            store.sample(1000, SampleTiming(5000, "run-1", 1000))
            val empty = requireNotNull(store.dao.oldest())
            assertEquals("CHARGE", JSONObject(empty.payload).getString("mode"))
            assertEquals(0.0, JSONObject(empty.payload).getDouble("speedKph"), 0.0)
            db.close()
            db = TelemetryDatabase.open(context, name)
            store = TelemetryStore(db)
            store.initialize()
            assertEquals("CHARGE", store.dao.state()?.mode)
            assertEquals(empty, store.dao.oldest())
            store.acknowledge(empty, 1100)
            store.change { it.copy(batterySocPct = 99.999) }
            store.sample(2000, SampleTiming(6000, "run-2", 1000))
            val full = requireNotNull(store.dao.oldest())
            val fullState = requireNotNull(store.dao.state())
            val payload = JSONObject(full.payload)
            assertEquals("DRIVE", payload.getString("mode"))
            assertEquals(100.0, payload.getDouble("batterySocPct"), 0.0)
            assertNotEquals("old", payload.getString("tripId"))
            assertEquals(fullState.tripId, payload.getString("tripId"))
            assertEquals(empty.sequence + 1, full.sequence)
            db.close()
            db = TelemetryDatabase.open(context, name)
            store = TelemetryStore(db)
            store.initialize()
            assertEquals(fullState, store.dao.state())
            assertEquals(full, store.dao.oldest())
        } finally {
            db.close()
            context.deleteDatabase(name)
        }
    }

    @Test fun diskDatabaseSyncsBeforePublishAndPreservesIdentityOnReopen() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "durable-telemetry-test.db"
        context.deleteDatabase(name)
        var db = TelemetryDatabase.open(context, name)
        try {
            var store = TelemetryStore(db)
            store.initialize()
            store.change { it.copy(running = true) }
            store.sample(1000, SampleTiming(5000, "before-reopen", 1000))
            val first = requireNotNull(store.dao.oldest())
            db.openHelper.writableDatabase.query("PRAGMA synchronous").use {
                assertTrue(it.moveToFirst()); assertEquals(2, it.getInt(0))
            }
            db.openHelper.writableDatabase.query("PRAGMA journal_mode").use {
                assertTrue(it.moveToFirst()); assertEquals("truncate", it.getString(0))
            }
            db.close()
            db = TelemetryDatabase.open(context, name)
            store = TelemetryStore(db)
            store.initialize()
            assertEquals(first, store.dao.oldest())
            store.acknowledge(first, 1100)
            store.sample(2000, SampleTiming(6000, "after-reopen", 1000))
            assertEquals(first.sequence + 1, store.dao.oldest()?.sequence)
            assertEquals(1L, store.dao.state()?.acknowledged)
            db.openHelper.writableDatabase.query("PRAGMA synchronous").use {
                assertTrue(it.moveToFirst()); assertEquals(2, it.getInt(0))
            }
        } finally {
            db.close()
            context.deleteDatabase(name)
        }
    }

    @Test fun retryUsesSamePayloadAndAcknowledgementIsIdempotent() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,
            TelemetryDatabase::class.java).build()
        try {
            val store = TelemetryStore(db)
            store.initialize()
            store.change { it.copy(running = true) }
            store.sample(1000, SampleTiming(5000, "run-1", 1000))
            val event = requireNotNull(store.dao.oldest())
            assertEquals(event, store.dao.oldest())
            assertEquals(event.eventId, JSONObject(event.payload).getString("eventId"))
            assertEquals(5000L, JSONObject(event.payload).getLong("sampleMonotonicMs"))
            assertEquals("run-1", JSONObject(event.payload).getString("producerRunId"))
            store.acknowledge(event, 1100)
            store.acknowledge(event, 1200)
            assertEquals(0L, store.dao.count())
            assertEquals(1L, store.dao.state()?.acknowledged)
            assertEquals(1L, store.dao.state()?.generated)
        } finally { db.close() }
    }
    @Test fun expirationIsAccountedAndSequenceIsNeverReused() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,
            TelemetryDatabase::class.java).build()
        try {
            val store = TelemetryStore(db)
            store.initialize()
            store.change { it.copy(running = true, simulatedOffline = true) }
            store.sample(1000)
            val first = requireNotNull(store.dao.oldest())
            store.sample(QueuePolicy.MAX_AGE_MS + 2000)
            val second = requireNotNull(store.dao.oldest())
            assertNotEquals(first.eventId, second.eventId)
            assertEquals(2L, second.sequence)
            assertEquals(1L, store.dao.state()?.dropped)
            assertEquals(1L, store.dao.count())
        } finally { db.close() }
    }
}
