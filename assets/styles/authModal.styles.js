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

  // Same height and radius as the Apple button it stacks under, so the two read
  // as one pair of equals rather than as a control and a near-miss of one.
  googleButton: {
    width: "100%",
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: 14,
  },

  googleIcon: {
    width: scale(20),
    height: scale(20),
    resizeMode: "contain",
    marginRight: 10,
  },

  googleText: {
    // Was a bare 13 while every other value on the sheet was scaled, so this
    // label alone stayed put as the sheet grew.
    fontSize: scale(15),
    fontFamily: "Poppins_500Medium",
    color: COLORS.textPrimary,
    textAlign: "center",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Sign-in sheet
  //
  // What was wrong with it, and what each rule below is answering:
  //
  //  - **Three measures in one card.** The sheet was 320 wide with a 20 gutter,
  //    so its content column is 280 — but the provider buttons were pinned to
  //    255, the error callout to 100%, and the legal line to 260. Four elements,
  //    three left edges, none of them aligned. Everything now sits on the one
  //    content column the card defines.
  //  - **Two corner radii on two stacked buttons.** Apple was drawn at 14 and
  //    Google at 12, and the Apple button changed shape again while it was
  //    loading. One radius token now, so the stack reads as one control group.
  //  - **Type below the legible floor.** The terms line was 9.5pt Light in
  //    `textTertiary` — 3.2:1 on white, which fails WCAG AA outright, at a size
  //    no platform's own guidance allows for body text. It is the only text on
  //    the sheet with legal weight, and it was the hardest thing on it to read.
  //  - **A 34pt close button.** Under the 44pt minimum both platforms specify.
  //
  // Sizes here are deliberately not `verticalScale`d. A button's height is a
  // touch target, not a proportion of the screen: scaling it by device height
  // makes it smaller than the minimum on exactly the small phones where hitting
  // it is hardest.
  socialOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    // The blur above this is iOS-only in practice, so the scrim has to stand on
    // its own on Android — dark enough to separate the sheet from a photographic
    // onboarding slide, light enough not to double up with the blur where it
    // does render.
    backgroundColor: "rgba(18, 24, 20, 0.40)",
    paddingHorizontal: scale(20),
  },
  backdropDismissArea: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  socialSheet: {
    width: "100%",
    maxWidth: scale(360),
    // Deeper at the top than the bottom. The close button occupies the top
    // right, so the heading needs room to sit clear of it rather than level
    // with it; below the last line there is nothing to clear.
    paddingTop: verticalScale(30),
    paddingBottom: verticalScale(20),
    paddingHorizontal: scale(24),
    backgroundColor: COLORS.surface,
    borderRadius: scale(28),
    alignItems: "center",
    shadowColor: COLORS.black,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 16,
  },
  closeButton: {
    position: "absolute",
    top: verticalScale(12),
    right: scale(12),
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceAlt,
  },
  iconButtonPressed: {
    backgroundColor: COLORS.surfaceSunken,
    transform: [{ scale: 0.96 }],
  },
  socialTitle: {
    // Clears the close button, so a longer heading can never run under it. The
    // button intrudes 32pt into the content column (12 inset + 44 wide, less
    // the sheet's own 24 gutter); 36 covers it with room to spare.
    paddingHorizontal: scale(36),
    color: COLORS.textPrimary,
    fontFamily: "Poppins_600SemiBold",
    fontSize: scale(22),
    lineHeight: scale(29),
    letterSpacing: -0.3,
    textAlign: "center",
  },
  socialSubtitle: {
    maxWidth: scale(272),
    marginTop: verticalScale(7),
    color: COLORS.textSecondary,
    // Regular, not Light. A 12pt Light face on a white card is a hairline at
    // arm's length, and this sentence is the sheet's whole explanation.
    fontFamily: "Poppins_400Regular",
    fontSize: scale(13),
    lineHeight: scale(19),
    textAlign: "center",
  },
  providerStack: {
    width: "100%",
    gap: 10,
    // The one large gap on the sheet. Everything above it is the sheet saying
    // what it is; everything below is the person acting on that, and the space
    // is what separates the two rather than a rule across the card.
    marginTop: verticalScale(26),
  },
  appleButton: {
    width: "100%",
    height: 50,
  },
  appleLoadingButton: {
    width: "100%",
    height: 50,
    // Matches `cornerRadius` on the native Apple button, so the control does not
    // change shape when it starts working.
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(10),
    backgroundColor: COLORS.black,
  },
  appleLoadingText: {
    color: COLORS.white,
    fontFamily: "Poppins_500Medium",
    fontSize: scale(15),
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
    marginTop: verticalScale(16),
    paddingHorizontal: scale(13),
    paddingVertical: verticalScale(11),
    borderRadius: scale(14),
    backgroundColor: COLORS.dangerSoft,
  },
  errorText: {
    flex: 1,
    color: COLORS.danger,
    fontFamily: "Poppins_400Regular",
    fontSize: scale(12.5),
    lineHeight: scale(18),
  },
  legalText: {
    maxWidth: scale(280),
    marginTop: verticalScale(18),
    // `textSecondary` at 6.2:1 rather than `textTertiary` at 3.2:1. Terms a
    // person is agreeing to by pressing the button above have to be readable.
    color: COLORS.textSecondary,
    fontFamily: "Poppins_400Regular",
    fontSize: scale(11.5),
    lineHeight: scale(17),
    textAlign: "center",
  },
  legalLink: {
    color: COLORS.primaryDark,
    fontFamily: "Poppins_500Medium",
    textDecorationLine: "underline",
  },
});
