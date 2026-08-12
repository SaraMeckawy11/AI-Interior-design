import { StyleSheet } from "react-native";
import { scale, verticalScale } from "react-native-size-matters";
import COLORS from "../../constants/colors";

export default StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  modalBox: {
    width: scale(320),
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 20,
  },

  title: {
    fontSize: 24,
    fontFamily: "Poppins_500Medium",
    marginTop: 4,
    marginBottom: 8,
    textAlign: "center",
  },

  subtitle: {
    fontSize: 16,
    marginBottom: 16,
    fontFamily: "Poppins_300Light",
    textAlign: "center",
    color: COLORS.textSecondary,
  },

  formContainer: {
    marginBottom: 20,
  },

  inputGroup: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
    position: "relative",
  },

  inputIcon: {
    marginRight: 8,
    color: COLORS.primaryDark,
  },

  input: {
    flex: 1,
    paddingVertical: 8,
    fontFamily: "Poppins_400Regular",
    fontSize: 14,
    color: COLORS.textPrimary,
  },

  eyeIcon: {
    position: "absolute",
    right: 0,
    padding: 8,
  },

  // 🔹 Unified button styles (used for Login + Signup)
  buttonWrapper: {
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 16,
  },

  buttonGradient: {
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  buttonText: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: "Poppins_500Medium",
  },

  // 🔹 (Legacy Signup styles kept for compatibility)
  signupButton: {
    backgroundColor: COLORS.primaryDark,
    padding: 10,
    borderRadius: 16,
    alignItems: "center",
    marginTop: 16,
  },

  signupButtonText: {
    color: COLORS.white,
    fontSize: 16,
  },

  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 12,
  },

  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },

  dividerText: {
    marginHorizontal: 8,
    color: "#999",
    fontFamily: "Poppins_400Regular",
  },

  // 🔹 Google sign-in styles
  googleContainer: {
    paddingVertical: verticalScale(12),
    flexDirection: "row",
    justifyContent: "center",
  },

  googleButton: {
    width: "100%",
    height: verticalScale(42),
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 12,
  },

  googleIcon: {
    width: scale(18),
    height: scale(18),
    resizeMode: "contain",
    marginRight: 10,
  },

  googleText: {
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
    color: COLORS.textPrimary,
    textAlign: "center",
  },

  socialOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(18, 24, 20, 0.42)",
  },
  backdropDismissArea: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  socialSheet: {
    width: scale(320),
    maxWidth: "90%",
    paddingVertical: verticalScale(18),
    paddingHorizontal: scale(20),
    backgroundColor: COLORS.surface,
    borderRadius: scale(24),
    alignItems: "center",
    shadowColor: COLORS.black,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 16,
  },
  closeButton: {
    position: "absolute",
    top: verticalScale(10),
    right: scale(10),
    width: scale(34),
    height: scale(34),
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceAlt,
  },
  iconButtonPressed: {
    backgroundColor: COLORS.surfaceSunken,
    transform: [{ scale: 0.96 }],
  },
  socialTitle: {
    marginTop: verticalScale(3),
    color: COLORS.textPrimary,
    fontFamily: "Poppins_600SemiBold",
    fontSize: scale(21),
    lineHeight: scale(27),
    letterSpacing: -0.2,
    textAlign: "center",
  },
  socialSubtitle: {
    maxWidth: scale(250),
    marginTop: verticalScale(4),
    color: COLORS.textSecondary,
    fontFamily: "Poppins_300Light",
    fontSize: scale(12),
    lineHeight: scale(18),
    textAlign: "center",
  },
  providerStack: {
    width: scale(255),
    maxWidth: "100%",
    gap: verticalScale(8),
    marginTop: verticalScale(14),
  },
  appleButton: {
    width: "100%",
    height: verticalScale(42),
    minHeight: 44,
  },
  appleLoadingButton: {
    width: "100%",
    height: verticalScale(42),
    minHeight: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(10),
    backgroundColor: COLORS.black,
  },
  appleLoadingText: {
    color: COLORS.white,
    fontFamily: "Poppins_500Medium",
    fontSize: scale(14),
  },
  providerButtonPressed: {
    backgroundColor: COLORS.surfaceAlt,
    transform: [{ scale: 0.988 }],
  },
  providerButtonDisabled: {
    opacity: 0.56,
  },
  errorCallout: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: scale(9),
    marginTop: verticalScale(13),
    paddingHorizontal: scale(13),
    paddingVertical: verticalScale(11),
    borderRadius: scale(13),
    backgroundColor: COLORS.dangerSoft,
  },
  errorText: {
    flex: 1,
    color: COLORS.danger,
    fontFamily: "Poppins_400Regular",
    fontSize: scale(12),
    lineHeight: scale(18),
  },
  legalText: {
    maxWidth: scale(260),
    marginTop: verticalScale(11),
    color: COLORS.textTertiary,
    fontFamily: "Poppins_300Light",
    fontSize: scale(9.5),
    lineHeight: scale(14),
    textAlign: "center",
  },
  legalLink: {
    color: COLORS.primaryDark,
    fontFamily: "Poppins_500Medium",
    textDecorationLine: "underline",
  },
});
