package com.guance.vehicledemo

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.util.Locale
import kotlinx.coroutines.launch

private val Background = Color(0xFF101820)
private val Panel = Color(0xFF1B2733)
private val Mint = Color(0xFF64E3BB)
private val Muted = Color(0xFF91A3B4)
private val Amber = Color(0xFFFFBF69)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val engine = (application as VehicleApplication).engine
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Mint, background = Background,
                surface = Panel, onPrimary = Background, onSurface = Color.White)) {
                Surface(color = Background, contentColor = Color.White) { VehicleScreen(engine) }
            }
        }
    }
}

@Composable
private fun VehicleScreen(engine: TelemetryEngine) {
    val view by engine.snapshot.collectAsStateWithLifecycle()
    val state = view.vehicle
    var showSettings by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(Background).systemBarsPadding()
        .padding(horizontal = 28.dp, vertical = 18.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("VEHICLE LAB", color = Mint, fontSize = 12.sp, letterSpacing = 3.sp)
                Text("车机遥测", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(state.vehicleId, fontSize = 13.sp, color = Muted)
                Text(if (state.running) "●  持续模拟中" else "Ⅱ  模拟已暂停",
                    color = if (state.running) Mint else Amber, fontSize = 13.sp)
            }
            Spacer(Modifier.width(20.dp))
            OutlinedButton(onClick = { showSettings = true }) { Text("连接配置") }
        }
        Row(Modifier.fillMaxWidth().height(232.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            SpeedGauge(state.speedKph, state.mode, Modifier.weight(1.1f).fillMaxHeight())
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Metric("电池电量", "${number(state.batterySocPct, 1)} %",
                    if (state.mode == "CHARGE") "充电功率 ${number(if (state.running) VehicleProfile.chargePowerKw(state.batterySocPct) else 0.0, 1)} kW"
                    else "SOC", Mint, Modifier.weight(1f))
                Metric("电池温度", "${number(state.batteryTempC, 1)} °C", if (state.highTemperature) "高温模拟" else "电池状态",
                    if (state.batteryTempC >= 60) Amber else Color.White, Modifier.weight(1f))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Metric("累计里程", "${number(state.odometerKm, 2)} km", "ODOMETER", Color.White, Modifier.weight(1f))
                Metric("遥测频率", if (state.running) "1 Hz" else "—", "每秒 1 条 · QoS 1", Color.White, Modifier.weight(1f))
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ModeButton("行驶", state.mode == "DRIVE", Modifier.weight(1f)) { engine.selectMode(DriveMode.DRIVE) }
            ModeButton("停车", state.mode == "PARK", Modifier.weight(1f)) { engine.selectMode(DriveMode.PARK) }
            ModeButton("充电", state.mode == "CHARGE", Modifier.weight(1f)) { engine.selectMode(DriveMode.CHARGE) }
            ModeButton(if (state.highTemperature) "恢复温度" else "模拟高温", state.highTemperature, Modifier.weight(1f), Amber) {
                engine.setHighTemperature(!state.highTemperature)
            }
            ModeButton(if (state.simulatedOffline) "恢复网络" else "模拟断网", state.simulatedOffline, Modifier.weight(1f), Amber) {
                engine.setOffline(!state.simulatedOffline)
            }
            Button(onClick = { engine.setRunning(!state.running) }, Modifier.weight(1.2f).height(50.dp),
                shape = RoundedCornerShape(12.dp)) { Text(if (state.running) "暂停模拟" else "开始模拟") }
        }
        Column(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(20.dp)).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("MQTT", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text("●  ${view.connection}", color = if (view.connection == "已连接") Mint else Amber)
                Text("   WSS / MQTT 5", color = Muted, fontSize = 12.sp)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Counter("已生成", state.generated)
                Counter("Broker 已确认", state.acknowledged)
                Counter("等待发送", view.pending)
                Counter("超限丢弃", state.dropped)
                Counter("事件序号", state.sequence)
            }
            if (view.error.isNotEmpty()) Text(view.error, color = Amber, fontSize = 12.sp)
            else Text(if (!view.configured) "首次使用请配置 MQTT 连接。遥测数据来自当前 Android App。"
                else "本地先落盘，确认后出队。关闭观看页面后，车机继续运行。", color = Muted, fontSize = 12.sp)
        }
        Text("自动循环：电量耗尽后充电，充满后行驶 · 30%–80% 快充约 20 分钟 · 模拟数据 · v${BuildConfig.VERSION_NAME}",
            color = Muted, fontSize = 11.sp)
    }
    if (showSettings) SettingsDialog(engine) { showSettings = false }
}

@Composable
private fun SpeedGauge(speed: Double, mode: String, modifier: Modifier) {
    Box(modifier.background(Panel, RoundedCornerShape(20.dp)), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().padding(20.dp)) {
            val diameter = minOf(size.width, size.height) * 0.92f
            val topLeft = Offset((size.width - diameter) / 2, (size.height - diameter) / 2)
            drawArc(Color(0xFF2C3D4D), 140f, 260f, false, topLeft, Size(diameter, diameter), style = Stroke(9.dp.toPx(), cap = StrokeCap.Round))
            drawArc(Mint, 140f, (speed / VehicleProfile.ROAD_MAX_SPEED_KPH * 260).toFloat().coerceIn(0f, 260f), false,
                topLeft, Size(diameter, diameter), style = Stroke(9.dp.toPx(), cap = StrokeCap.Round))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(number(speed, 0), fontSize = 62.sp, fontWeight = FontWeight.Light)
            Text("km/h", color = Muted, fontSize = 13.sp)
            Spacer(Modifier.height(12.dp))
            Text(when (mode) { "DRIVE" -> "D  行驶"; "CHARGE" -> "⚡ 充电"; else -> "P  停车" }, color = Mint)
        }
    }
}

@Composable
private fun Metric(label: String, value: String, subtitle: String, color: Color, modifier: Modifier) {
    Column(modifier.fillMaxWidth().background(Panel, RoundedCornerShape(20.dp)).padding(18.dp),
        verticalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted, fontSize = 12.sp)
        Text(value, fontSize = 27.sp, color = color, fontWeight = FontWeight.Medium)
        Text(subtitle, color = Muted, fontSize = 10.sp, letterSpacing = 1.sp)
    }
}

@Composable
private fun Counter(label: String, value: Long) {
    Column {
        Text(value.toString(), fontSize = 23.sp, fontWeight = FontWeight.Medium)
        Text(label, color = Muted, fontSize = 11.sp)
    }
}

@Composable
private fun ModeButton(label: String, selected: Boolean, modifier: Modifier, accent: Color = Mint, action: () -> Unit) {
    FilledTonalButton(onClick = action, modifier = modifier.height(50.dp), shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.filledTonalButtonColors(containerColor = if (selected) accent.copy(alpha = .18f) else Panel,
            contentColor = if (selected) accent else Color.White)) { Text(label) }
}

@Composable
private fun SettingsDialog(engine: TelemetryEngine, close: () -> Unit) {
    var endpoint by remember { mutableStateOf(engine.endpoint()) }
    var username by remember { mutableStateOf(engine.username()) }
    var password by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text("MQTT 连接配置") },
        text = {
            Column(Modifier.width(500.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(endpoint, { endpoint = it }, label = { Text("WSS 地址") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(username, { username = it }, label = { Text("用户名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(password, { password = it }, label = { Text("密码（留空保留已存密码）") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth())
                Text("凭据仅保存在本机私有加密存储中。", fontSize = 12.sp, color = Muted)
                if (failure.isNotEmpty()) Text(failure, color = Amber, fontSize = 12.sp)
            }
        }, confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true
                engine.configure(endpoint, username, password) { message ->
                    scope.launchOnMain {
                        busy = false
                        if (message == null) close() else failure = message
                    }
                }
            }) { Text(if (busy) "保存中" else "保存连接") }
        }, dismissButton = { TextButton(enabled = !busy, onClick = close) { Text("取消") } })
}

private fun kotlinx.coroutines.CoroutineScope.launchOnMain(block: () -> Unit) =
    this.launch(kotlinx.coroutines.Dispatchers.Main) { block() }

private fun number(value: Double, decimals: Int) = String.format(Locale.ROOT, "%.${decimals}f", value)
