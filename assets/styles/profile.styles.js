import { StyleSheet, Dimensions } from "react-native";
import COLORS from "../../constants/colors";

const { width, height } = Dimensions.get("window");
// Scaling functions
const scale = (size) => (width / 375) * size; // horizontal scaling (base: iPhone 8 width)
const verticalScale = (size) => (height / 667) * size; // vertical scaling (base: iPhone 8 height)
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: moderateScale(16),
    paddingBottom: 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  profileHeader: {
    flexDirection: "column",
    alignItems: "center",
    backgroundColor: COLORS.roomCard,
    borderRadius: moderateScale(16),
    padding: moderateScale(16),
    marginBottom: moderateScale(16),
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: moderateScale(3),
    borderWidth: 0.08,
    borderColor: COLORS.border,
  },

  profileInfo: {
    flex: 1,
  },
  username: {
    fontSize: moderateScale(18),
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: verticalScale(4),
  },
  email: {
    fontSize:  moderateScale(13),
    fontWeight: "400",
    color: COLORS.textSecondary,
    marginBottom: verticalScale(4),
  },
  memberSince: {
    fontSize: verticalScale(12),
    fontWeight: "400",
    color: COLORS.textSecondary,
  },
  logoutButton: {
    backgroundColor: COLORS.primaryDark,
    borderRadius:moderateScale(16),
    padding: moderateScale(8),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: verticalScale(16),
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: moderateScale(4),
    elevation: moderateScale(2),
  },
  logoutText: {
    color: COLORS.white,
    fontWeight: "600",
    marginLeft: moderateScale(8),
  },
  itemIcon: {
    marginRight: moderateScale(12),
  },
  section: {
    marginTop: verticalScale(8),
    paddingHorizontal: moderateScale(16),
    paddingVertical: verticalScale(8),
    backgroundColor: COLORS.background,
  },
  sectionTitle: {
    fontSize: moderateScale(14.5),
    fontWeight: "600",
    marginBottom: verticalScale(6),
    color: COLORS.textPrimary,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingVertical: verticalScale(12),
    paddingHorizontal: moderateScale(8),
    borderBottomWidth: moderateScale(1),
    borderBottomColor: COLORS.line,
  },
  itemText: {
    fontSize: moderateScale(13),
    fontWeight: "500",
    color: COLORS.textSecondary,
  },

familyMessage: {
  backgroundColor: '#E6F0E4', // lighter version of #B5CBB7
  paddingVertical: verticalScale(12),
  paddingHorizontal: moderateScale(16),
  borderRadius: moderateScale(16),
  marginVertical: verticalScale(12),
  borderWidth: moderateScale(0.5),
  borderColor: COLORS.primaryDark, // subtle darker green for border
  shadowColor: COLORS.shadow,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
  elevation: moderateScale(2),
  overflow: 'hidden', // ensures text doesn't get cut
},
familyText: {
  fontSize: moderateScale(13.5),
  fontWeight: "500",
  color: COLORS.textPrimary, // dark text for readability
  textAlign: "auto",
  lineHeight: moderateScale(24),
  paddingLeft: moderateScale(16),
  margin: 0,
},
modalOverlay: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.4)",
  justifyContent: "center",
  alignItems: "center",
},
logoutModalContainer: {
  backgroundColor: COLORS.cardBackground,
  borderRadius: moderateScale(20),
  padding: moderateScale(20),
  width: "80%",
  alignItems: "center",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.2,
  shadowRadius: 6,
  elevation: 6,
},
logoutModalTitle: {
  fontSize: moderateScale(16),
  fontWeight: "600",
  color: COLORS.primaryDark,
  marginBottom: verticalScale(4),
},
logoutModalSubtitle: {
  fontSize: moderateScale(13),
  color: COLORS.textSecondary,
  textAlign: "center",
  marginBottom:  verticalScale(16),
},
logoutModalButtons: {
  flexDirection: "row",
  justifyContent: "space-between",
  width: "100%",
},
logoutModalButton: {
  flex: 1,
  paddingVertical:verticalScale(6),
  borderRadius: moderateScale(12),
  alignItems: "center",
  marginHorizontal:moderateScale(5),
},
cancelButton: {
  backgroundColor: COLORS.roomCard,
  borderWidth: 1,
  borderColor: COLORS.border,
},
confirmButton: {
  backgroundColor: COLORS.primaryDark,
},
cancelButtonText: {
  color: COLORS.textSecondary,
  fontWeight: "500",
},
confirmButtonText: {
  color: COLORS.white,
  fontWeight: "600",
},


});

export default styles;
