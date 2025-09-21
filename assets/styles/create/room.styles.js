import { StyleSheet, Dimensions  } from "react-native";
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(6),
    paddingHorizontal: moderateScale(2),
  },
  label: {
    fontSize: moderateScale(13),
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  seeAllText: {
    fontSize:moderateScale(13),
    color: COLORS.secondary,
  },

  iconGrid: {
    flex:1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    gap:moderateScale(2),
    margin:8,
  },

  iconButton: {
    alignItems: 'center',
    width: moderateScale(72),
  },

iconCircle: {
  width: moderateScale(60),
  height: moderateScale(30),
  borderRadius: moderateScale(15),
  backgroundColor:COLORS.roomCard,
  justifyContent: 'center',
  alignItems: 'center',
  borderWidth: moderateScale(2),
  borderColor: 'transparent',
},

iconCircleSelected: {
  borderColor: COLORS.secondary, // Only border highlights
},

iconLabel: {
  fontSize:  moderateScale(11.5),
  color: COLORS.textPrimary,
  marginTop: verticalScale(6),
  textAlign: 'center',
  width:moderateScale(70),
  marginBottom:verticalScale(6)
},
iconLabelSelected: {
  fontWeight: 'bold',
  color: COLORS.secondary,
},

manualInput: {
    fontSize: moderateScale(14),
    marginTop: verticalScale(6),
    backgroundColor: '#f9f9f9',
    paddingVertical: verticalScale(6),
    paddingHorizontal: moderateScale(16),
    borderRadius: moderateScale(16),
    borderColor: '#ccc',
    borderWidth: moderateScale(1),
  },

manualCard: {
    marginTop: verticalScale(6),
    padding: moderateScale(8),
    // borderWidth: 1,
    // borderColor: '#ccc',
    // borderRadius: 10,
  },

addButton: {
    marginTop: verticalScale(6),
    backgroundColor: COLORS.primaryDark,
    paddingVertical: verticalScale(6),
    borderRadius: moderateScale(16),
    alignItems: 'center',
  },

addButtonText: {
  fontSize: moderateScale(14),
  color: 'white',
  fontWeight: 'bold',
},
cancelText: {
    marginTop: verticalScale(12),
    color: 'red',
    textAlign: 'center',
    fontSize: moderateScale(14),
},
overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
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