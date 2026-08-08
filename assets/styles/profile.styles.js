import { StyleSheet, Dimensions } from "react-native";
import COLORS from "../../constants/colors";

const { width, height } = Dimensions.get("window");
// Scaling functions
const scale = (size) => (width / 375) * size; // horizontal scaling (base: iPhone 8 width)
const verticalScale = (size) => (height / 667) * size; // vertical scaling (base: iPhone 8 height)
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;

// One radius/spacing scale for the whole screen so cards, rows and buttons
// visually belong to the same family.
const RADIUS = moderateScale(16);
const ROW_MIN_HEIGHT = 56; // >= the 44pt minimum touch target, with room to spare.

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  // Fills the space under a screen header rather than the whole screen, so a
  // spinner sits in the middle of the content, not behind the title.
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: moderateScale(24),
  },

  // ── Screen title ──────────────────────────────────────────────────────────
  screenTitle: {
    fontSize: moderateScale(28),
    fontFamily: "Poppins_700Bold",
    color: COLORS.textPrimary,
    letterSpacing: -0.4,
    marginBottom: verticalScale(16),
  },

  // ── Identity card ─────────────────────────────────────────────────────────
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.cardBackground,
    borderRadius: RADIUS,
    padding: moderateScale(16),
    marginBottom: verticalScale(20),
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  profileInfo: {
    flex: 1,
  },
  username: {
    fontSize: moderateScale(17),
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.textPrimary,
  },
  email: {
    fontSize: moderateScale(13),
    fontFamily: "Poppins_400Regular",
    color: COLORS.textSecondary,
    marginTop: verticalScale(1),
  },

  // Plan badge — states the user's status instead of burying it in a paragraph.
  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: moderateScale(9),
    paddingVertical: moderateScale(3),
    borderRadius: moderateScale(20),
    marginTop: verticalScale(6),
  },
  planBadgePremium: {
    backgroundColor: COLORS.accentSoft,
  },
  planBadgeFree: {
    backgroundColor: COLORS.surfaceSunken,
  },
  planBadgeText: {
    fontSize: moderateScale(11),
    fontFamily: "Poppins_600SemiBold",
    marginLeft: moderateScale(4),
  },
  planBadgeTextPremium: {
    color: COLORS.accentStrong,
  },
  planBadgeTextFree: {
    color: COLORS.textSecondary,
  },

  // ── Sections ──────────────────────────────────────────────────────────────
  section: {
    marginBottom: verticalScale(20),
  },
  sectionTitle: {
    fontSize: moderateScale(11.5),
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.textSecondary,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: verticalScale(8),
    marginLeft: moderateScale(4),
  },
  card: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },

  // ── Rows ──────────────────────────────────────────────────────────────────
  item: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: verticalScale(10),
    paddingHorizontal: moderateScale(14),
  },
  itemPressed: {
    backgroundColor: COLORS.surfaceAlt,
  },
  // Only drawn between rows, never after the last one.
  itemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  itemIcon: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(10),
    backgroundColor: COLORS.primaryTint,
    alignItems: "center",
    justifyContent: "center",
    marginRight: moderateScale(12),
  },
  itemIconAccent: {
    backgroundColor: COLORS.accentTint,
  },
  itemIconDanger: {
    backgroundColor: COLORS.dangerSoft,
  },
  itemText: {
    flex: 1,
    fontSize: moderateScale(14.5),
    fontFamily: "Poppins_500Medium",
    color: COLORS.textPrimary,
  },
  itemTextDanger: {
    color: COLORS.danger,
  },
  // The right-hand value on a read-only row — a price, a date, a plan name.
  itemValue: {
    maxWidth: "45%",
    fontSize: moderateScale(13),
    fontFamily: "Poppins_400Regular",
    color: COLORS.textSecondary,
    textAlign: "right",
  },
  itemChevron: {
    marginLeft: moderateScale(8),
  },

  // ── Empty / notice states ─────────────────────────────────────────────────
  notice: {
    alignItems: "center",
    padding: moderateScale(24),
    borderRadius: RADIUS,
    backgroundColor: COLORS.cardBackground,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noticeIcon: {
    width: moderateScale(52),
    height: moderateScale(52),
    borderRadius: moderateScale(26),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primaryTint,
    marginBottom: verticalScale(12),
  },
  noticeTitle: {
    fontSize: moderateScale(16),
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  noticeText: {
    fontSize: moderateScale(13),
    fontFamily: "Poppins_400Regular",
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: moderateScale(19),
    marginTop: verticalScale(4),
  },
  noticeButton: {
    alignSelf: "stretch",
    minHeight: ROW_MIN_HEIGHT - 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS,
    backgroundColor: COLORS.primaryDark,
    marginTop: verticalScale(16),
  },
  noticeButtonText: {
    fontSize: moderateScale(14),
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.white,
  },

  // ── Confirm dialog — the same shape the Collection screen uses ────────────
  dialogOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: moderateScale(24),
  },
  dialogContent: {
    width: "86%",
    backgroundColor: COLORS.background,
    borderRadius: moderateScale(20),
    padding: moderateScale(20),
    alignItems: "center",
  },
  dialogTitle: {
    fontSize: moderateScale(16),
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.primaryDark,
    textAlign: "center",
  },
  dialogMessage: {
    fontSize: moderateScale(13),
    fontFamily: "Poppins_400Regular",
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: moderateScale(19),
    marginTop: verticalScale(6),
  },
  dialogActions: {
    flexDirection: "row",
    width: "100%",
    marginTop: verticalScale(18),
  },
  dialogButton: {
    flex: 1,
    minHeight: moderateScale(42),
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: moderateScale(5),
    borderRadius: moderateScale(12),
  },
  dialogCancel: {
    backgroundColor: COLORS.cardBackground,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dialogCancelText: {
    fontSize: moderateScale(13),
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.textSecondary,
  },
  dialogConfirm: {
    backgroundColor: COLORS.primaryDark,
  },
  dialogConfirmText: {
    fontSize: moderateScale(13),
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.white,
  },

  // ── Logout ────────────────────────────────────────────────────────────────
  // Signing out is a last-resort action, so it reads as quiet text rather than
  // the loudest button on the screen.
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: ROW_MIN_HEIGHT - 8,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardBackground,
    marginTop: verticalScale(4),
  },
  logoutButtonPressed: {
    backgroundColor: COLORS.surfaceAlt,
  },
  logoutText: {
    color: COLORS.error,
    fontSize: moderateScale(14.5),
    fontFamily: "Poppins_600SemiBold",
    marginLeft: moderateScale(8),
  },

  // ── Logout confirmation ───────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.scrim,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: moderateScale(28),
  },
  logoutModalContainer: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: moderateScale(20),
    padding: moderateScale(22),
    width: "100%",
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  logoutModalTitle: {
    fontSize: moderateScale(17),
    fontFamily: "Poppins_600SemiBold",
    color: COLORS.textPrimary,
    marginBottom: verticalScale(4),
  },
  logoutModalSubtitle: {
    fontSize: moderateScale(13.5),
    fontFamily: "Poppins_400Regular",
    lineHeight: moderateScale(20),
    color: COLORS.textSecondary,
    marginBottom: verticalScale(20),
  },
  logoutModalButtons: {
    flexDirection: "row",
    gap: moderateScale(10),
  },
  logoutModalButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {
    backgroundColor: COLORS.cardBackground,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  confirmButton: {
    backgroundColor: COLORS.error,
  },
  cancelButtonText: {
    color: COLORS.textPrimary,
    fontFamily: "Poppins_500Medium",
    fontSize: moderateScale(14),
  },
  confirmButtonText: {
    color: COLORS.white,
    fontFamily: "Poppins_600SemiBold",
    fontSize: moderateScale(14),
  },
});

export default styles;
