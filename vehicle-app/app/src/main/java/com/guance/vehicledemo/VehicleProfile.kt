package com.guance.vehicledemo

import kotlin.math.PI
import kotlin.math.sin

/** Reference and assumptions: docs/vehicle-demo/vehicle-physics.md. No brand in the demo UI. */
object VehicleProfile {
    const val BATTERY_KWH = 60.22
    const val CONSUMPTION_KWH_PER_100_KM = 12.1
    const val VEHICLE_MAX_SPEED_KPH = 180.0
    const val ZERO_TO_100_SECONDS = 6.9
    const val ROAD_MAX_SPEED_KPH = 120.0
    const val ROAD_ACCELERATION_KPH_PER_SECOND = 5.4 // Gentle 1.5 m/s², below full acceleration.
    const val FAST_CHARGE_30_TO_80_MINUTES = 20.0
    const val FAST_CHARGE_KW = BATTERY_KWH * 0.50 / (FAST_CHARGE_30_TO_80_MINUTES / 60.0)
    const val SOC_PER_KM = CONSUMPTION_KWH_PER_100_KM / BATTERY_KWH

    // Synthetic city / suburban / highway route. Distance, not event count, drives its phase.
    fun targetSpeedKph(odometerKm: Double): Double {
        val routeKm = odometerKm % 30.0
        val wave = sin(odometerKm * PI)
        return when {
            routeKm < 10.0 -> 45.0 + 15.0 * wave
            routeKm < 20.0 -> 75.0 + 10.0 * wave
            else -> 105.0 + 10.0 * wave
        }.coerceIn(0.0, minOf(ROAD_MAX_SPEED_KPH, VEHICLE_MAX_SPEED_KPH))
    }

    // Only the 30–80% duration is official. Other bands are explicit demo assumptions.
    fun chargePowerKw(socPct: Double): Double = when {
        socPct >= 100.0 -> 0.0
        socPct >= 90.0 -> FAST_CHARGE_KW * 0.20
        socPct >= 80.0 -> FAST_CHARGE_KW * 0.50
        else -> FAST_CHARGE_KW
    }

    fun chargeSoc(socPct: Double, seconds: Double): Double {
        var soc = socPct.coerceIn(0.0, 100.0)
        var remaining = seconds.coerceAtLeast(0.0)
        // Integrate each band separately so crossing 80/90% never uses the old rate past it.
        while (remaining > 0.0 && soc < 100.0) {
            val end = when { soc < 80.0 -> 80.0; soc < 90.0 -> 90.0; else -> 100.0 }
            val rate = chargePowerKw(soc) / BATTERY_KWH * 100.0 / 3600.0
            val untilEnd = (end - soc) / rate
            if (remaining >= untilEnd) {
                soc = end
                remaining -= untilEnd
            } else {
                soc += rate * remaining
                remaining = 0.0
            }
        }
        return soc.coerceIn(0.0, 100.0)
    }
}
