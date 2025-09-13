import { StyleSheet, Dimensions } from "react-native";
import COLORS from "../../../constants/colors";
const { width, height } = Dimensions.get("window");

// Scaling functions
const scale = (size) => (width / 375) * size; // horizontal scaling (base: iPhone 8 width)
const verticalScale = (size) => (height / 667) * size; // vertical scaling (base: iPhone 8 height)
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;

const styles = StyleSheet.create({
  formGroup: {
    marginBottom: verticalScale(12),
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: verticalScale(12),
    paddingHorizontal: moderateScale(2),
  },
  label: {
    fontSize: moderateScale(13),
    color: COLORS.textPrimary,
    fontWeight: "500",
  },
  seeAllText: {
    fontSize: moderateScale(13),
    color: COLORS.secondary,
  },

  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(2),
  },

  iconButton: {
    alignItems: "center",
    width: moderateScale(72),
  },

  iconCircle: {
    width: verticalScale(40),
    height: verticalScale(40),
    borderRadius: verticalScale(20),
    backgroundColor: COLORS.roomCard,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: moderateScale(2),
    borderColor: "transparent",
  },

  iconCircleSelected: {
    borderColor: COLORS.secondary, // Only border highlights
  },

  iconLabel: {
    fontSize: moderateScale(11.5),
    color: COLORS.textPrimary,
    marginTop: verticalScale(2),
    textAlign: "center",
    marginBottom: verticalScale(6),
  },
  iconLabelSelected: {
    fontWeight: "bold",
    color: COLORS.secondary,
  },

  colorSwatch: {
    width: moderateScale(35),
    height: moderateScale(35),
    borderRadius: moderateScale(20),
    borderWidth: moderateScale(1),
    borderColor: "#ccc",
    marginBottom: 4,
  },
  colorToneSelected: {
    borderWidth: 2,
    borderColor: COLORS.secondary,
  },

  addSwatch: {
    width: moderateScale(35),
    height: moderateScale(35),
    borderRadius: moderateScale(20),
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: moderateScale(1),
    borderColor: "#D1D5DB",
    marginBottom: 4,
  },

  // 🔹 Modal Styles (clean & minimal)
  overlay: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.45)",
  justifyContent: "center",
  alignItems: "center",
  padding: 16,
},

modalContainer: {
  height: "80%",         // fixed height so it doesn’t shrink
  backgroundColor: COLORS.white,
  borderRadius: moderateScale(20),
  padding: moderateScale(20),
  elevation: moderateScale(8),
  shadowColor: "#000",
  shadowOpacity: 0.15,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
},

modalTitle: {
  fontSize: moderateScale(20),
  fontWeight: "600",
  marginBottom: moderateScale(20),
  textAlign: "center",
  color:  COLORS.textPrimary,
},

pickerWrapper: {
  flex: 1,
  minHeight: moderateScale(280),     // ensures picker has enough space
  marginBottom: moderateScale(20),
},

hexRow: {
  flexDirection: "row",
  alignItems: "center",
  marginTop: moderateScale(10),
},

hexLabel: {
  fontSize: moderateScale(15),
  color: COLORS.textPrimary,
  marginRight: moderateScale(10),
},

hexInput: {
  flex: 1,
  borderWidth: 1,
  borderColor: "#ddd",
  borderRadius: moderateScale(10),
  padding: moderateScale(10),
  fontSize: moderateScale(14),
  color: "#333",
},

hexPreview: {
  width: moderateScale(36),
  height: moderateScale(36),
  borderRadius: moderateScale(18),
  marginLeft: moderateScale(12),
  borderWidth: moderateScale(1),
  borderColor: "#ccc",
},

doneButton: {
  backgroundColor: "#3B82F6", // replace with COLORS.primary if needed
  paddingVertical: moderateScale(10),
  borderRadius: moderateScale(14),
  alignItems: "center",
  marginTop: moderateScale(20),
},

doneButtonText: {
  color: "#fff",
  fontSize: moderateScale(14),
  fontWeight: "600",
},

cancelText: {
  marginTop: moderateScale(16),
  textAlign: "center",
  color: "#EF4444",
  fontSize: moderateScale(15),
},
// Reuse modal styling for error & delete
errorModalContainer: {
  width: '80%',
  backgroundColor: COLORS.background,
  borderRadius: moderateScale(20),
  padding: moderateScale(20),
  alignItems: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.2,
  shadowRadius: 6,
  elevation: 8,
},
modalTitle: {
  fontSize: moderateScale(16),
  fontWeight: '600',
  color: COLORS.primaryDark,
  marginBottom: verticalScale(4),
  textAlign: 'center',
},
modalMessage: {
  fontSize: moderateScale(14),
  color: COLORS.textSecondary,
  textAlign: "center",
  marginBottom: moderateScale(16),
},

modalButtonRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  width: '100%',
},

cancelButton: {
  flex: 1,
  paddingVertical: verticalScale(6),
  marginHorizontal: moderateScale(5),
  borderRadius: moderateScale(12),
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: COLORS.roomCard,
  borderWidth: 1,
  borderColor: COLORS.border,
},

deleteButton: {
  flex: 1,
  paddingVertical: verticalScale(6),
  marginHorizontal: moderateScale(5),
  borderRadius: moderateScale(12),
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: 8,
  backgroundColor: COLORS.primaryDark,
  alignItems: "center",
},

deleteText: {
  color: COLORS.white,
  fontWeight: "500",
},
cancelButtonText: {
  color: COLORS.textSecondary,
  fontWeight: "500",
},

});

export default styles;
