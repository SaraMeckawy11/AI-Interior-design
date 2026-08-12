import React, { useEffect, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { scale, verticalScale } from "react-native-size-matters";
import { BlurView } from "expo-blur";
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import axios from "axios";
import { useRouter } from "expo-router";
import { fontSizes } from "@/themes/app.constant";
import { useAuthStore } from "../../authStore";
import styles from "../../assets/styles/authModal.styles";
import { apiUrl } from "../../configs/api";

export default function AuthModal({ setModalVisible }) {
  const router = useRouter();
  const loginSocial = useAuthStore((state) => state.loginSocial);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);
  const [signInError, setSignInError] = useState(null);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_EXPO_GOOGLE_API_KEY,
      iosClientId:
        Platform.OS === "ios"
          ? process.env.EXPO_PUBLIC_IOS_GOOGLE_API_KEY
          : undefined,
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
    // `replace`, not `push`: signing in is not a step to go back from. Pushing
    // left onboarding under the tabs, so the first back press after a sign-in
    // dropped the user onto the sign-in screen they had just finished with.
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
    setIsSigningIn(true);
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
      setIsSigningIn(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
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
      setIsSigningIn(false);
    }
  };

  return (
    <BlurView
      intensity={100}
      tint="dark"
      style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
    >
      <Pressable
        style={{
          width: scale(320),
          minHeight: verticalScale(appleSignInAvailable ? 225 : 165),
          backgroundColor: "#fff",
          borderRadius: 24,
          paddingVertical: verticalScale(18),
          alignItems: "center",
          justifyContent: "center",
        }}
        onPress={(event) => event.stopPropagation?.()}
      >
        <Text
          style={{
            fontSize: 24,
            fontFamily: "Poppins_500Medium",
          }}
        >
          Join LIVINAI
        </Text>
        <Text
          style={{
            fontSize: fontSizes.FONT17,
            paddingTop: verticalScale(4),
            fontFamily: "Poppins_300Light",
          }}
        >
          It&apos;s easier than you imagine!
        </Text>

        {appleSignInAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={12}
            style={{
              width: scale(255),
              height: verticalScale(42),
              marginTop: verticalScale(14),
              opacity: isSigningIn ? 0.6 : 1,
            }}
            onPress={handleAppleSignIn}
          />
        )}

        <View style={[styles.googleContainer, appleSignInAvailable && { paddingTop: verticalScale(8) }]}>
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={isSigningIn}
            style={[styles.googleButton, isSigningIn && { opacity: 0.6 }]}
          >
            <Image
              source={require("@/assets/images/onboarding/google.png")}
              style={styles.googleIcon}
            />
            <Text style={styles.googleText}>
              {isSigningIn ? "Signing in…" : "Sign in with Google"}
            </Text>
          </Pressable>
        </View>

        {signInError && (
          <Text
            style={{
              color: "#c0392b",
              fontSize: fontSizes.FONT15,
              fontFamily: "Poppins_300Light",
              paddingHorizontal: scale(20),
              paddingTop: verticalScale(4),
              textAlign: "center",
            }}
          >
            {signInError}
          </Text>
        )}
      </Pressable>
    </BlurView>
  );
}
