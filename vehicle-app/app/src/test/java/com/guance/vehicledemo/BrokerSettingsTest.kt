package com.guance.vehicledemo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BrokerSettingsTest {
    private val stored = BrokerSettings(BrokerSettings.DEFAULT_ENDPOINT, "vehicle-publisher", "test-password-12345")

    @Test fun blankPasswordOnlyReusesTheSameDestination() {
        assertEquals(stored.password, BrokerSettings.resolve(stored.endpoint, stored.username, "", stored).password)
        assertThrows(IllegalArgumentException::class.java) {
            BrokerSettings.resolve("wss://other.example/mqtt", stored.username, "", stored)
        }
        assertThrows(IllegalArgumentException::class.java) {
            BrokerSettings.resolve(stored.endpoint, "another-user", "", stored)
        }
    }

    @Test fun rejectsNonTlsAndCredentialsInUrl() {
        for (endpoint in listOf("ws://example.test/mqtt", "wss://user:password@example.test/mqtt")) {
            assertThrows(IllegalArgumentException::class.java) {
                BrokerSettings.validate(endpoint, stored.username, stored.password)
            }
        }
    }
}
