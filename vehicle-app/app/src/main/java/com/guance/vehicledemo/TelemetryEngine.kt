package com.guance.vehicledemo

import android.app.Application
import android.os.SystemClock
import android.util.Log
import com.hivemq.client.mqtt.MqttClient
import com.hivemq.client.mqtt.datatypes.MqttQos
import com.hivemq.client.mqtt.mqtt5.Mqtt5AsyncClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.future.await
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.util.UUID

data class EngineSnapshot(
    val vehicle: VehicleState = VehicleState(),
    val connection: String = "未配置",
    val pending: Long = 0,
    val pendingBytes: Long = 0,
    val configured: Boolean = false,
    val error: String = "",
)

class VehicleApplication : Application() {
    lateinit var engine: TelemetryEngine
        private set
    override fun onCreate() {
        super.onCreate()
        val database = TelemetryDatabase.open(this)
        engine = TelemetryEngine(TelemetryStore(database), SettingsVault(this))
    }
}

class TelemetryEngine(private val store: TelemetryStore, private val vault: SettingsVault) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutable = MutableStateFlow(EngineSnapshot())
    val snapshot = mutable.asStateFlow()
    @Volatile private var settings: BrokerSettings? = null
    @Volatile private var connection = "未配置"
    @Volatile private var error = ""
    @Volatile private var samplingFailed = false

    init {
        scope.launch {
            store.initialize()
            try { settings = vault.read() } catch (_: Exception) { error = "配置无法解密，请重新配置" }
            launch { publishLoop() }
            var observations = 0
            val producerRunId = UUID.randomUUID().toString()
            var previousElapsed = SystemClock.elapsedRealtime() - 1000
            while (isActive) {
                val started = SystemClock.elapsedRealtime()
                val eventTime = System.currentTimeMillis()
                val timing = SampleTiming(started, producerRunId, started - previousElapsed)
                previousElapsed = started
                try {
                    store.sample(eventTime, timing)
                    val state = requireNotNull(store.dao.state())
                    mutable.value = EngineSnapshot(state, connection, store.dao.count(), store.dao.bytes(),
                        settings != null, error)
                    samplingFailed = false
                    if (++observations % 10 == 0) {
                        Log.i("VehicleTelemetry", JSONObject().put("version", 1)
                            .put("event", "state").put("at", eventTime).put("sequence", state.sequence)
                            .put("generated", state.generated).put("acknowledged", state.acknowledged)
                            .put("dropped", state.dropped).put("pending", mutable.value.pending)
                            .put("running", state.running).put("offline", state.simulatedOffline)
                            .put("connection", connection).toString())
                    }
                } catch (e: CancellationException) { throw e
                } catch (_: Exception) {
                    samplingFailed = true
                    error = "本地存储异常，采样已暂停"
                    mutable.value = mutable.value.copy(error = error)
                }
                delay(maxOf(50, 1000 - (SystemClock.elapsedRealtime() - started)))
            }
        }
    }

    fun setRunning(running: Boolean) = change {
        it.copy(running = running, lastEventTime = System.currentTimeMillis())
    }
    fun selectMode(mode: DriveMode) = change { VehicleModel.selectMode(it, mode) }
    fun setHighTemperature(active: Boolean) = change { it.copy(highTemperature = active) }
    fun setOffline(offline: Boolean) = change { it.copy(simulatedOffline = offline) }
    private fun change(transform: (VehicleState) -> VehicleState) {
        scope.launch {
            try { store.change(transform) }
            catch (_: Exception) { error = "状态保存失败，请稍后重试" }
        }
    }

    fun endpoint(): String = settings?.endpoint ?: BrokerSettings.DEFAULT_ENDPOINT
    fun username(): String = settings?.username ?: "vehicle-publisher"
    fun configure(endpoint: String, username: String, password: String, done: (String?) -> Unit) {
        scope.launch {
            try {
                val value = BrokerSettings.resolve(endpoint, username, password, settings)
                vault.save(value)
                settings = value
                error = ""
                done(null)
            } catch (_: Exception) { done("配置未保存，请检查地址与账号；首次配置或修改地址、用户名时需输入至少 12 位密码") }
        }
    }

    private fun statusPayload(state: VehicleState, online: Boolean): ByteArray = JSONObject()
        .put("schemaVersion", 1).put("vehicleId", state.vehicleId).put("online", online)
        .put("running", state.running).put("eventTime", System.currentTimeMillis())
        .toString().toByteArray(Charsets.UTF_8)

    private fun client(config: BrokerSettings, vehicle: String): Mqtt5AsyncClient = MqttClient.builder()
        .useMqttVersion5().identifier("vehicle-$vehicle").serverHost(config.uri.host)
        .serverPort(if (config.uri.port == -1) 443 else config.uri.port).sslWithDefaultConfig()
        .webSocketConfig().serverPath(config.uri.rawPath.ifEmpty { "/mqtt" }).applyWebSocketConfig()
        .buildAsync()

    private suspend fun publishLoop() {
        var backoff = 1000L
        while (scope.isActive) {
            var mqtt: Mqtt5AsyncClient? = null
            try {
                val config = settings
                var state = requireNotNull(store.dao.state())
                if (config == null || state.simulatedOffline || samplingFailed) {
                    connection = if (config == null) "未配置" else if (state.simulatedOffline) "模拟断网" else "存储异常"
                    delay(250)
                    continue
                }
                connection = "连接中"
                mqtt = client(config, state.vehicleId)
                val statusTopic = "vehicle/v1/${state.vehicleId}/status"
                val connack = withTimeout(15_000) {
                    mqtt.connectWith().keepAlive(30).cleanStart(false).sessionExpiryInterval(86400)
                        .simpleAuth().username(config.username).password(config.password.toByteArray(Charsets.UTF_8))
                        .applySimpleAuth().willPublish().topic(statusTopic).qos(MqttQos.AT_LEAST_ONCE).retain(true)
                        .payload(statusPayload(state, false)).applyWillPublish().send().await()
                }
                check(!connack.reasonCode.isError)
                connection = "已连接"
                error = ""
                backoff = 1000
                var statusAt = 0L
                while (scope.isActive && settings === config && mqtt.state.isConnected && !samplingFailed) {
                    state = requireNotNull(store.dao.state())
                    if (state.simulatedOffline) break
                    val now = System.currentTimeMillis()
                    if (now - statusAt >= 10_000) {
                        val status = withTimeout(5000) { mqtt.publishWith().topic(statusTopic).qos(MqttQos.AT_LEAST_ONCE)
                            .retain(true).payload(statusPayload(state, true)).send().await() }
                        status.error.ifPresent { throw it }
                        statusAt = now
                    }
                    val event = store.dao.oldest()
                    if (event == null) { delay(100); continue }
                    val result = withTimeout(10_000) {
                        mqtt.publishWith().topic("vehicle/v1/${state.vehicleId}/telemetry")
                            .qos(MqttQos.AT_LEAST_ONCE).retain(false)
                            .payload(event.payload.toByteArray(Charsets.UTF_8)).send().await()
                    }
                    result.error.ifPresent { throw it }
                    store.acknowledge(event, System.currentTimeMillis())
                }
                // An intentional disconnect must update retained online status as well.
                if (mqtt.state.isConnected) {
                    withTimeout(2000) { mqtt.publishWith().topic(statusTopic).qos(MqttQos.AT_LEAST_ONCE)
                        .retain(true).payload(statusPayload(state, false)).send().await() }
                }
            } catch (e: CancellationException) {
                if (!scope.isActive) throw e
                connection = "重连等待"
                error = "MQTT 响应超时，队列保留待重试"
            } catch (failure: Exception) {
                connection = "重连等待"
                error = "MQTT 连接或发布失败，队列保留待重试"
                // Class names aid transport diagnosis without logging endpoints,
                // credentials, payloads, or exception messages.
                Log.w("VehicleTelemetry", JSONObject().put("event", "transport-error")
                    .put("type", failure.javaClass.name)
                    .put("cause", failure.cause?.javaClass?.name ?: "").toString())
            } finally {
                try { if (mqtt?.state?.isConnected == true) withTimeout(2000) { mqtt.disconnect().await() } }
                catch (_: Exception) { /* Connection may already be closed; outbox remains durable. */ }
            }
            delay(backoff)
            backoff = (backoff * 2).coerceAtMost(30_000)
        }
    }
}
