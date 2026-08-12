# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Everything below matters only now that R8 runs on release builds — see
# `android.enableProguardInReleaseBuilds` in gradle.properties. Most libraries
# here ship their own consumer rules inside their AAR and need nothing stated;
# what follows covers what those do not.

# `window.ReactNativeWebView.postMessage` reaches the app through a method
# annotated @JavascriptInterface, called only from JavaScript running inside the
# WebView. R8 sees no caller in the bytecode and strips it, so every message the
# 3D walkthrough sends back to the app is silently dropped — in release builds
# only, where it is hardest to notice.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Add any project specific keep options here:
