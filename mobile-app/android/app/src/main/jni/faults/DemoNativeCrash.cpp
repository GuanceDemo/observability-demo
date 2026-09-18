#include <jni.h>
#include <cstdlib>

// A deterministic invariant failure rather than optimizer-dependent null UB.
__attribute__((noinline)) static void prepareNativeCheckout(const char* token) {
#if DEMO_NATIVE_CRASH_ENABLED
  if (token == nullptr) std::abort();
#else
  (void)token;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_com_malldemomobile_DemoNativeCrash_prepareCheckout(JNIEnv*, jobject) {
  prepareNativeCheckout(nullptr);
}
