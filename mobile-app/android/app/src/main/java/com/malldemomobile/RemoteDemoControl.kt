package com.malldemomobile

import android.content.Intent
import android.util.Base64
import android.util.Log
import java.util.ArrayDeque
import org.json.JSONObject

/** Fixed demo commands only; never evaluates code, URLs or shell arguments. */
object RemoteDemoControl {
  private val queue = ArrayDeque<String>()
  private val seen = LinkedHashSet<String>()
  private var snapshot = "{}"
  @Synchronized fun accept(intent: Intent?) {
    if (!BuildConfig.REMOTE_CONTROL_ENABLED) return
    if (intent?.action != "${BuildConfig.APPLICATION_ID}.DEMO_CONTROL") return
    val id = intent.getStringExtra("requestId") ?: return
    val action = intent.getStringExtra("command") ?: return
    val fault = intent.getStringExtra("faultId") ?: ""
    if (!id.matches(Regex("[a-f0-9]{32}")) || action !in setOf("refresh", "inject", "recover")) return
    if (action == "inject" && !fault.matches(Regex("[a-z0-9_-]{1,100}"))) return
    if (!seen.add(id)) return
    if (seen.size > 128) seen.remove(seen.first())
    if (queue.size >= 4) { finish(id, "busy"); return }
    queue.add(JSONObject().put("id", id).put("action", action).put("faultId", fault).toString())
  }
  @Synchronized fun take(): String? = queue.poll()
  @Synchronized fun update(value: String) {
    if (value.length > 24000) return
    snapshot = value
    emit(JSONObject().put("version", 1).put("state", JSONObject(snapshot)))
  }
  @Synchronized fun finish(id: String, status: String) {
    if (!id.matches(Regex("[a-f0-9]{32}"))) return
    emit(JSONObject().put("version", 1).put("requestId", id).put("status", status.take(160)).put("state", JSONObject(snapshot)))
  }
  private fun emit(payload: JSONObject) {
    val encoded = Base64.encodeToString(payload.toString().toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    val parts = encoded.chunked(2000)
    val batch = java.util.UUID.randomUUID().toString()
    parts.forEachIndexed { index, part ->
      Log.i("MallDemoControl", "MALL_DEMO_CONTROL $batch $index ${parts.size} $part")
    }
  }
}
