package com.guance.vehicledemo

import org.junit.Assert.*
import org.junit.Test

class VehicleModelTest {
    @Test fun clockCorrectionsDoNotChangePhysicalEvolution() {
        val state = VehicleState(running = true, tripId = "trip", lastEventTime = 10_000, speedKph = 40.0)
        val expected = VehicleModel.tick(state, 11_000, 1000)
        for (correctedTime in listOf(7000L, 15_000L)) {
            val actual = VehicleModel.tick(state, correctedTime, 1000)
            assertEquals(expected.copy(lastEventTime = correctedTime), actual)
        }
    }
    @Test fun drivingAdvancesDistanceAndConsumesCharge() {
        var state = VehicleState(running = true, tripId = "trip")
        val initial = state
        repeat(120) { state = VehicleModel.tick(state, 1000L * (it + 1)) }
        assertEquals(120L, state.sequence)
        assertEquals(state.sequence, state.generated)
        assertTrue(state.speedKph > 0)
        assertTrue(state.odometerKm > initial.odometerKm)
        assertTrue(state.batterySocPct < initial.batterySocPct)
        assertEquals("trip", state.tripId)
    }
    @Test fun chargingNeverMovesAndFullChargeStartsOneNewTrip() {
        var state = VehicleState(running = true, mode = "CHARGE", speedKph = 70.0,
            batterySocPct = 99.99, tripId = "previous-trip")
        val distance = state.odometerKm
        var ticks = 0
        while (state.mode == "CHARGE" && ticks < 10) {
            state = VehicleModel.tick(state, 1000L * (++ticks), 1000)
            assertEquals(0.0, state.speedKph, 0.0)
            assertEquals(distance, state.odometerKm, 0.0)
        }
        assertEquals("DRIVE", state.mode)
        assertEquals(0.0, state.speedKph, 0.0)
        assertEquals(100.0, state.batterySocPct, 0.0)
        assertNotEquals("previous-trip", state.tripId)
        val next = VehicleModel.tick(state, 1000L * (++ticks), 1000)
        assertEquals(state.tripId, next.tripId)
        assertTrue(next.speedKph > 0.0)
        assertTrue(next.batterySocPct < 100.0)
    }
    @Test fun depletedBatteryAutomaticallyChargesWithoutInventingDistance() {
        val initial = VehicleState(running = true, batterySocPct = 0.00001,
            speedKph = 60.0, tripId = "old")
        val empty = VehicleModel.tick(initial, 1000, 1000)
        assertEquals("CHARGE", empty.mode)
        assertEquals(0.0, empty.speedKph, 0.0)
        assertEquals(0.0, empty.batterySocPct, 1e-15)
        assertEquals(initial.batterySocPct / VehicleProfile.SOC_PER_KM,
            empty.odometerKm - initial.odometerKm, 1e-10)
        assertEquals("old", empty.tripId)
        val charging = VehicleModel.tick(empty, 2000, 1000)
        assertEquals("CHARGE", charging.mode)
        assertEquals(empty.odometerKm, charging.odometerKm, 0.0)
        assertTrue(charging.batterySocPct > 0.0)
    }
    @Test fun legacyEmptyAndFullStatesRecoverButParkAndPauseRemainExplicit() {
        val empty = VehicleState(running = true, batterySocPct = 0.0)
        assertEquals("CHARGE", VehicleModel.tick(empty, 1000).mode)
        val full = empty.copy(mode = "CHARGE", batterySocPct = 100.0, tripId = "old")
        assertEquals("DRIVE", VehicleModel.tick(full, 1000).mode)
        for (soc in listOf(0.0, 100.0)) {
            val parked = empty.copy(mode = "PARK", batterySocPct = soc)
            assertEquals("PARK", VehicleModel.tick(parked, 1000).mode)
            assertEquals(soc, VehicleModel.tick(parked, 1000).batterySocPct, 0.0)
        }
        for (state in listOf(empty, full)) {
            val paused = state.copy(running = false)
            assertEquals(paused, VehicleModel.tick(paused, 1000))
        }
    }
    @Test fun referenceChargeIntervalTakesTwentyRealMinutes() {
        var state = VehicleState(running = true, mode = "CHARGE", batterySocPct = 30.0)
        repeat(1200) { state = VehicleModel.tick(state, (it + 1) * 1000L, 1000) }
        assertEquals(80.0, state.batterySocPct, 1e-9)
        assertEquals("CHARGE", state.mode)
        assertEquals(90.33, VehicleProfile.chargePowerKw(50.0), 1e-9)
        assertTrue(VehicleProfile.chargePowerKw(85.0) < VehicleProfile.chargePowerKw(50.0))
        assertTrue(VehicleProfile.chargePowerKw(95.0) < VehicleProfile.chargePowerKw(85.0))
        assertEquals(100.0, VehicleProfile.chargeSoc(0.0, 3600.0), 1e-9)
        assertEquals(0.0, VehicleProfile.chargePowerKw(100.0), 0.0)
    }
    @Test fun chargeIntegrationSplitsBandsAndIgnoresWallClockJump() {
        val before = VehicleState(running = true, mode = "CHARGE", batterySocPct = 79.99, tripId = "trip")
        val oneStep = VehicleModel.tick(before, 1000, 2000)
        val half = VehicleModel.tick(before, 4000, 1000)
        val twoSteps = VehicleModel.tick(half, 500, 1000)
        assertEquals(oneStep.batterySocPct, twoSteps.batterySocPct, 1e-10)
        assertEquals(80.0366666667, oneStep.batterySocPct, 1e-9)
    }
    @Test fun fullCycleRepeatsWithCoherentEnergySpeedAndIdentity() {
        var state = VehicleState(running = true, batterySocPct = 100.0, tripId = "first",
            simulatedOffline = true)
        var emptyTransitions = 0
        var fullTransitions = 0
        // Exercise several hours in model time without accelerating the actual producer.
        repeat(100_000) {
            val old = state
            state = VehicleModel.tick(state, (it + 1) * 2000L, 2000)
            assertEquals(old.sequence + 1, state.sequence)
            assertTrue(state.speedKph in 0.0..120.0)
            assertTrue(state.batterySocPct in 0.0..100.0)
            assertTrue(state.odometerKm >= old.odometerKm)
            if (old.mode == "DRIVE") {
                assertEquals((state.odometerKm - old.odometerKm) * 12.1 / 60.22,
                    old.batterySocPct - state.batterySocPct, 1e-9)
                if (state.mode == "CHARGE") {
                    emptyTransitions++
                    assertEquals(0.0, state.speedKph, 0.0)
                } else {
                    assertTrue(kotlin.math.abs(state.speedKph - old.speedKph) <= 10.800001)
                }
            } else {
                assertEquals(0.0, state.speedKph, 0.0)
                assertEquals(old.odometerKm, state.odometerKm, 0.0)
                if (state.mode == "DRIVE") {
                    fullTransitions++
                    assertNotEquals(old.tripId, state.tripId)
                    assertEquals(100.0, state.batterySocPct, 0.0)
                }
            }
        }
        assertTrue(emptyTransitions >= 2)
        assertTrue(fullTransitions >= 2)
        assertTrue(VehicleProfile.ROAD_ACCELERATION_KPH_PER_SECOND < 100.0 / VehicleProfile.ZERO_TO_100_SECONDS)
    }
    @Test fun pausedAndOfflineHaveDifferentSemantics() {
        val paused = VehicleState(running = false)
        assertEquals(paused, VehicleModel.tick(paused, 1000))
        val offline = paused.copy(running = true, simulatedOffline = true)
        assertEquals(1L, VehicleModel.tick(offline, 1000).sequence)
    }
    @Test fun restartDoesNotInventHoursOfTravel() {
        val initial = VehicleState(running = true, speedKph = 60.0, lastEventTime = 1000)
        val next = VehicleModel.tick(initial, 86_400_000)
        assertTrue(next.odometerKm - initial.odometerKm < 0.04)
        assertEquals(1L, next.sequence)
    }
    @Test fun newDriveStartsTripButChargingDoesNot() {
        val state = VehicleState(mode = "PARK", tripId = "old")
        val drive = VehicleModel.selectMode(state, DriveMode.DRIVE)
        assertNotEquals(state.tripId, drive.tripId)
        assertEquals(drive.tripId, VehicleModel.selectMode(drive, DriveMode.CHARGE).tripId)
    }
    @Test fun highTemperatureAndRecoveryAreGradual() {
        var state = VehicleState(running = true, highTemperature = true, mode = "PARK")
        repeat(25) { state = VehicleModel.tick(state, 1000L * (it + 1)) }
        assertEquals(85.0, state.batteryTempC, 0.0)
        val recovered = VehicleModel.tick(state.copy(highTemperature = false), 26000)
        assertTrue(recovered.batteryTempC < state.batteryTempC)
        assertTrue(recovered.batteryTempC > 27.0)
    }
}
