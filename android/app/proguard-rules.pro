# -----------------------------
# React Native & Expo
# -----------------------------
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class expo.modules.** { *; }
-keep class host.exp.exponent.** { *; }

# -----------------------------
# Google Sign-In
# -----------------------------
-keep class com.google.android.gms.auth.api.signin.** { *; }
-keep class com.google.android.gms.common.api.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-keep class com.google.android.gms.internal.** { *; }
-keepattributes *Annotation*

# Keep SafeParcelable classes for Google SDKs
-keepclassmembers class * {
    @com.google.android.gms.common.internal.safeparcel.SafeParcelable *;
}

# Keep listeners and callbacks
-keepclassmembers class * implements com.google.android.gms.tasks.OnSuccessListener {
    <methods>;
}
-keepclassmembers class * implements com.google.android.gms.tasks.OnFailureListener {
    <methods>;
}

# -----------------------------
# Keep your app code
# -----------------------------
-keep class com.livinai.app.** { *; }

# -----------------------------
# Optional: prevent stripping of serializable classes
# -----------------------------
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object readResolve();
    java.lang.Object writeReplace();
}

# -----------------------------
# Add any other project-specific keep options here
# -----------------------------
