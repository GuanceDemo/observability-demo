# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:
# Keep the demo bridge names stable for React Native and preserve crash frames.
-keep class com.malldemomobile.DemoFaultsModule { *; }
-keep class com.malldemomobile.DemoFaultsPackage { *; }

# Guance Session Replay 0.4.2 reads these React Native 0.86 internals by their
# original class and field names. Preserve the two concrete rendering classes
# so R8 cannot remove reflected fields through value propagation; the rest of
# the release build remains minified.
-keep class com.facebook.react.uimanager.drawable.BackgroundDrawable { *; }
-keep class com.facebook.react.views.text.ReactTextView { *; }

-keepattributes SourceFile,LineNumberTable
