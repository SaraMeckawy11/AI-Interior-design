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
    backgroundColor: COLORS.primary,
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

});

export default styles;