import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../authStore";
import styles from "../../assets/styles/authModal.styles";
import { apiUrl } from "../../configs/api";
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from "../../configs/googleAuth";
import LoginForm from "./login";
import SignupForm from "./signup";

export default function AuthModal({ setModalVisible }) {
  const router = useRouter();
  const loginSocial = useAuthStore((state) => state.loginSocial);
  const [signingInProvider, setSigningInProvider] = useState(null);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);
  const [signInError, setSignInError] = useState(null);
  // `null` while the sheet is offering providers; "login" or "signup" once the
  // person has chosen to use an email address instead. Apple's reviewers cannot
  // be handed a Google account, and an account made with Sign in with Apple is
  // tied to their own Apple ID — an email and password is the only credential
  // pair that can go in App Store Connect's demo account fields.
  const [emailMode, setEmailMode] = useState(null);
  const isSigningIn = signingInProvider !== null;

  useEffect(() => {
    // `webClientId` unconditionally. It used to be spread in only when it
    // happened to be defined, which meant a missing value configured a client
    // that could open Google's sheet and never return an identity token —
    // failing at the end of the flow, with a message about a client id, rather
    // than at the point the client id was wrong.
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      ...(Platform.OS === "ios" ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
      scopes: ["profile", "email"],
    });

    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleSignInAvailable);
    }
  }, []);

  const completeProviderLogin = async ({ provider, identityToken, fullName }) => {
    const response = await axios.post(apiUrl("/api/auth/social"), {
      provider,
      identityToken,
      fullName,
    });

    const { user, accessToken } = response.data;
    const result = await loginSocial(user, accessToken);
    if (!result?.success) throw new Error(result?.error || "Could not save your login.");

    setModalVisible(false);
    router.replace("/create");
  };

  const describeGoogleError = (error) => {
    switch (error?.code) {
      case statusCodes.SIGN_IN_CANCELLED:
      case statusCodes.IN_PROGRESS:
        return null;
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return "Google Play services isn't available on this device.";
      case statusCodes.DEVELOPER_ERROR:
        return "This build isn't registered for Google Sign-In. Check its OAuth client settings.";
      default:
        return error?.response?.data?.message || error?.message || "Sign-in failed. Please try again.";
    }
  };

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    setSigningInProvider("google");
    setSignInError(null);

    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      if (result.type !== "success") return;

      const identityToken = result.data.idToken;
      if (!identityToken) {
        throw new Error("Google did not return an identity token. Check the Web client ID.");
      }

      await completeProviderLogin({ provider: "google", identityToken });
    } catch (error) {
      console.log("Google sign-in error:", error.message || error);
      setSignInError(describeGoogleError(error));
    } finally {
      setSigningInProvider(null);
    }
  };

  const handleAppleSignIn = async () => {
    if (isSigningIn) return;
    setSigningInProvider("apple");
    setSignInError(null);

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      await completeProviderLogin({
        provider: "apple",
        identityToken: credential.identityToken,
        fullName: credential.fullName,
      });
    } catch (error) {
      if (error?.code !== "ERR_REQUEST_CANCELED") {
        console.log("Apple sign-in error:", error.message || error);
        setSignInError(
          error?.response?.data?.message || error?.message || "Apple sign-in failed. Please try again."
        );
      }
    } finally {
      setSigningInProvider(null);
    }
  };

  return (
    <BlurView intensity={40} tint="dark" style={styles.socialOverlay}>
      <Pressable
        accessible={false}
        style={styles.backdropDismissArea}
        onPress={() => setModalVisible(false)}
      />

      <Pressable
        accessibilityViewIsModal
        style={styles.socialSheet}
        onPress={(event) => event.stopPropagation?.()}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sign in"
          hitSlop={8}
          onPress={() => setModalVisible(false)}
          style={({ pressed }) => [styles.closeButton, pressed && styles.iconButtonPressed]}
        >
          <Ionicons name="close" size={20} color="#334039" />
        </Pressable>

        {/* No mark. The heading carries the name, which is how most sign-in
            sheets identify themselves — and it is the shorter sheet: a logo
            here pushes the two buttons, the terms and the whole decision
            further down a card that is already the only thing on screen. */}
        <Text style={styles.socialTitle} accessibilityRole="header">
          {emailMode === "login"
            ? "Sign in to Livinai"
            : emailMode === "signup"
              ? "Create your account"
              : "Join Livinai"}
        </Text>
        <Text style={styles.socialSubtitle}>
          Save your designs to your account and pick them up on any device.
        </Text>

        {emailMode ? (
          <View style={styles.emailLoginSection}>
            {emailMode === "login" ? (
              <LoginForm setModalVisible={setModalVisible} />
            ) : (
              <SignupForm setModalVisible={setModalVisible} />
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                emailMode === "login"
                  ? "Create an account with an email address instead"
                  : "Sign in with an existing email address instead"
              }
              hitSlop={6}
              style={styles.emailBackButton}
              onPress={() => {
                setSignInError(null);
                setEmailMode(emailMode === "login" ? "signup" : "login");
              }}
            >
              <Text style={styles.emailBackText}>
                {emailMode === "login"
                  ? "New here? Create an account"
                  : "Already have an account? Sign in"}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to all sign-in options"
              hitSlop={6}
              style={styles.emailBackButton}
              onPress={() => {
                setSignInError(null);
                setEmailMode(null);
              }}
            >
              <Text style={styles.emailBackText}>All sign-in options</Text>
            </Pressable>
          </View>
        ) : (
        <View style={styles.providerStack}>
            {appleSignInAvailable &&
              (signingInProvider === "apple" ? (
                <View style={styles.appleLoadingButton}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.appleLoadingText}>Signing in with Apple…</Text>
                </View>
              ) : (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={14}
                  style={[styles.appleButton, isSigningIn && styles.providerButtonDisabled]}
                  onPress={handleAppleSignIn}
                />
              ))}

            <Pressable
              onPress={handleGoogleSignIn}
              disabled={isSigningIn}
              accessibilityRole="button"
              accessibilityLabel="Sign in with Google"
              style={({ pressed }) => [
                styles.googleButton,
                pressed && !isSigningIn && styles.providerButtonPressed,
                isSigningIn && styles.providerButtonDisabled,
              ]}
            >
              {signingInProvider === "google" ? (
                <ActivityIndicator color="#33604A" size="small" />
              ) : (
                <Image
                  source={require("@/assets/images/onboarding/google.png")}
                  style={styles.googleIcon}
                />
              )}
              <Text style={styles.googleText}>
                {signingInProvider === "google"
                  ? "Signing in with Google…"
                  : "Sign in with Google"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setSignInError(null);
                setEmailMode("login");
              }}
              disabled={isSigningIn}
              accessibilityRole="button"
              accessibilityLabel="Continue with an email address"
              style={({ pressed }) => [
                styles.emailButton,
                pressed && !isSigningIn && styles.providerButtonPressed,
                isSigningIn && styles.providerButtonDisabled,
              ]}
            >
              <Ionicons name="mail-outline" size={20} color="#334039" />
              <Text style={styles.emailButtonText}>Continue with email</Text>
            </Pressable>

        </View>
        )}

        {signInError && (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={styles.errorCallout}
          >
            <Ionicons name="alert-circle-outline" size={19} color="#BE3A2F" />
            <Text style={styles.errorText}>{signInError}</Text>
          </View>
        )}

        <Text style={styles.legalText}>
          By continuing, you agree to Livinai&apos;s{" "}
          <Text
            accessibilityRole="link"
            style={styles.legalLink}
            onPress={() => {
              setModalVisible(false);
              router.push("/profile/terms");
            }}
          >
            Terms of Service
          </Text>{" "}
          and{" "}
          <Text
            accessibilityRole="link"
            style={styles.legalLink}
            onPress={() => {
              setModalVisible(false);
              router.push("/profile/privacy");
            }}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </Pressable>
    </BlurView>
  );
}
