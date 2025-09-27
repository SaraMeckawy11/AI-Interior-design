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
    borderColor: "#ccc",
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
    backgroundColor: "#ccc",
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(20),
    borderRadius: 12,
    shadowColor: COLORS.black,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
    marginTop: verticalScale(4),
  },

  googleIcon: {
    width: scale(20),
    height: scale(20),
    resizeMode: "contain",
    marginRight: 10,
  },

  googleText: {
    fontSize: 14,
    fontFamily: "Poppins_500Medium",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
});
