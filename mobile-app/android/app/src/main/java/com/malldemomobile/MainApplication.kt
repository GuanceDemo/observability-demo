package com.malldemomobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.ft.sdk.FTSDKConfig
import com.ft.sdk.FTSdk

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(DemoFaultsPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    installBuildTimeRumCore()
    loadReactNative(this)
  }

  private fun installBuildTimeRumCore() {
    if (!BuildConfig.RUM_DIRECT_ENABLED) return
    val config =
      FTSDKConfig.builder(BuildConfig.RUM_DATAWAY_URL, BuildConfig.RUM_CLIENT_TOKEN)
        .setEnv(BuildConfig.RUM_ENV)
        .setServiceName(BuildConfig.RUM_SERVICE)
        .setDebug(BuildConfig.DEBUG)
        .setCompressIntakeRequests(true)
        .setEnableOkhttpRequestTag(true)
        .addGlobalContext("project", "mall-demo")
        .addGlobalContext("app_version", BuildConfig.VERSION_NAME)
    FTSdk.install(config)
  }
}
