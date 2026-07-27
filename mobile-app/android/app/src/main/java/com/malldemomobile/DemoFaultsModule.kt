package com.malldemomobile

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class DemoFaultsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> =
    mapOf(
      "dangerousFaultsEnabled" to BuildConfig.DEMO_FAULTS_ENABLED,
      "gatewayUrl" to BuildConfig.GATEWAY_URL,
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
  }
}
