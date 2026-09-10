package com.malldemomobile

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.util.Log
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    configureSystemBars()
    handleFrameRefreshIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleFrameRefreshIntent(intent)
  }

  /**
   * Keep both Android system bars visible and draw the white app shell behind them. React Native
   * safe-area insets place storefront controls outside the status and gesture regions.
   */
  private fun configureSystemBars() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }
  }

  /**
   * The WebRTC player asks for this explicit redraw only when the first frame or a post-input
   * frame stalls. It does not navigate, mutate storefront state, or restart React Native.
   */
  private fun handleFrameRefreshIntent(intent: Intent?) {
    if (intent?.action != "${BuildConfig.APPLICATION_ID}.REFRESH_FRAME") return
    val root = window.decorView
    root.post {
      root.requestLayout()
      root.invalidate()
      val pulse = ColorDrawable(Color.argb(8, 0, 0, 0)).apply {
        setBounds(0, 0, root.width.coerceAtLeast(1), root.height.coerceAtLeast(1))
      }
      root.overlay.add(pulse)
      root.postOnAnimation {
        root.overlay.remove(pulse)
        root.postOnAnimation {
          root.overlay.add(pulse)
          root.postOnAnimation {
            root.overlay.remove(pulse)
            root.invalidate()
            Log.i(FRAME_REFRESH_LOG_TAG, "APK frame refresh rendered")
          }
        }
      }
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "MallDemoMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  companion object {
    private const val FRAME_REFRESH_LOG_TAG = "MallDemoFrameRefresh"
  }
}
