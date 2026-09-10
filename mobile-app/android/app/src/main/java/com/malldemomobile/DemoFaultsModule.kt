package com.malldemomobile

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

class DemoFaultsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> =
    mapOf(
      "dangerousFaultsEnabled" to BuildConfig.DEMO_FAULTS_ENABLED,
      "replayDisabledForDiagnostics" to BuildConfig.DIAGNOSTIC_DISABLE_REPLAY,
      "gatewayUrl" to BuildConfig.GATEWAY_URL,
      "rumDirectEnabled" to BuildConfig.RUM_DIRECT_ENABLED,
      "rumAndroidAppId" to BuildConfig.RUM_ANDROID_APP_ID,
      "rumService" to BuildConfig.RUM_SERVICE,
      "rumEnv" to BuildConfig.RUM_ENV,
      "appVersion" to BuildConfig.VERSION_NAME,
      "rumNativeCoreInitialized" to BuildConfig.RUM_DIRECT_ENABLED,
    )

  @ReactMethod
  fun crash(message: String, promise: Promise) {
    if (!BuildConfig.DEMO_FAULTS_ENABLED) {
      promise.reject("DEMO_FAULTS_DISABLED", "Native crash is disabled in the Safe build")
      return
    }
    Handler(Looper.getMainLooper()).post {
      throw IllegalStateException(message)
    }
  }

  @ReactMethod
  fun blockMainThread(durationMs: Double, promise: Promise) {
    if (!BuildConfig.DEMO_FAULTS_ENABLED) {
      promise.reject(
        "DEMO_FAULTS_DISABLED",
        "Main-thread blocking is disabled in the Safe build",
      )
      return
    }
    val safeDuration = durationMs.toLong().coerceIn(1000L, 12_000L)
    Handler(Looper.getMainLooper()).post {
      SystemClock.sleep(safeDuration)
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun blockCheckoutPreview(promise: Promise) {
    val now = SystemClock.elapsedRealtime()
    val previous = checkoutBlockAt.get()
    if ((previous > 0L && now - previous < 15_000L) || !checkoutBlockAt.compareAndSet(previous, now)) {
      promise.reject("CHECKOUT_PREVIEW_COOLDOWN", "Wait 15 seconds before demonstrating checkout again")
      return
    }
    // A fixed, bounded native UI stall; the dangerous crash/ANR gates remain separate.
    Handler(Looper.getMainLooper()).post {
      val startedAt = SystemClock.elapsedRealtime()
      SystemClock.sleep(1800L)
      promise.resolve((SystemClock.elapsedRealtime() - startedAt).toDouble())
    }
  }

  @ReactMethod
  fun acknowledgeInteraction(action: String) {
    val normalizedAction =
      action
        .trim()
        .lowercase()
        .replace(INVALID_INTERACTION_ACTION, "_")
        .trim('_')
        .take(80)
    if (normalizedAction.isEmpty()) return

    val payload =
      JSONObject()
        .put("version", 1)
        .put("sequence", interactionSequence.incrementAndGet())
        .put("action", normalizedAction)
        .put("androidElapsedRealtimeMs", SystemClock.elapsedRealtime())
    Log.i(INTERACTION_LOG_TAG, "$INTERACTION_LOG_PREFIX$payload")
  }

  @ReactMethod
  fun openGuanceUrl(url: String, promise: Promise) {
    val uri = Uri.parse(url)
    val scheme = uri.scheme?.lowercase()
    val host = uri.host?.lowercase().orEmpty()
    if (
      (scheme != "http" && scheme != "https") ||
        (!host.endsWith(".guance.com") && !host.endsWith(".guance.one"))
    ) {
      promise.reject("INVALID_GUANCE_URL", "Only Guance HTTP(S) links are allowed")
      return
    }

    try {
      launchUrl(
        Intent(Intent.ACTION_VIEW, uri).apply {
          setPackage(GUANCE_APP_PACKAGE)
        },
      )
      promise.resolve(true)
    } catch (_: ActivityNotFoundException) {
      try {
        launchUrl(Intent(Intent.ACTION_VIEW, uri))
        promise.resolve(false)
      } catch (error: ActivityNotFoundException) {
        promise.reject("NO_URL_HANDLER", "No application can open the Guance link", error)
      }
    }
  }

  private fun launchUrl(intent: Intent) {
    val activity = reactApplicationContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
    }
  }

  companion object {
    const val NAME = "DemoFaults"
    const val GUANCE_APP_PACKAGE = "com.cloudcare.ft.dataflux.mobile"
    const val INTERACTION_LOG_TAG = "MallDemoInteraction"
    const val INTERACTION_LOG_PREFIX = "MALL_DEMO_INTERACTION_ACK "
    val INVALID_INTERACTION_ACTION = Regex("[^a-z0-9_.:-]+")
    val interactionSequence = AtomicLong(0)
    val checkoutBlockAt = AtomicLong(0)
  }
}
