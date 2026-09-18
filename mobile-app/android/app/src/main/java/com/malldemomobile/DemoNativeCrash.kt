package com.malldemomobile

internal object DemoNativeCrash {
  fun loadLibrary() { System.loadLibrary("demo_native_faults") }
  external fun prepareCheckout()
}
