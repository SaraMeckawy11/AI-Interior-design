# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.

# For more details, see:
#   http://developer.android.com/guide/developing/tools/proguard.html

# --- React Native / Reanimated ---
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# --- Google Play Services / Google Sign-In ---
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# --- Google API Client (used internally by sign-in) ---
-keep class com.google.api.client.** { *; }
-dontwarn com.google.api.client.**

# --- Gson (used by Google Play Services internally) ---
-keep class com.google.gson.** { *; }
-dontwarn com.google.gson.**

# --- General JSON / parsing safety ---
-keepattributes Signature
-keepattributes *Annotation*
