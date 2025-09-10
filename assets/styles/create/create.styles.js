// styles/create.styles.js
import { StyleSheet, Dimensions } from "react-native";
import COLORS from "../../../constants/colors";

const { width, height } = Dimensions.get("window");

// Scaling functions
const scale = (size) => (width / 375) * size; // horizontal scaling (base: iPhone 8 width)
const verticalScale = (size) => (height / 667) * size; // vertical scaling (base: iPhone 8 height)
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: COLORS.background,
    padding: moderateScale(24),
    paddingTop:verticalScale(12)
  },
  scrollViewStyle: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  card: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: moderateScale(16),
    padding: moderateScale(16),
    marginVertical: verticalScale(16),
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    alignItems: "center",
    //marginBottom: verticalScale(1),
  },

  title: {
    fontSize: moderateScale(25),
    fontWeight: '400',
    color: COLORS.primaryDark,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    fontFamily: 'Poppins_400Regular',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.03)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },

  subtitle: {
    fontSize: moderateScale(14),
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  form: {
    marginBottom: verticalScale(16),
  },
  formGroup: {
    marginBottom: verticalScale(24),
  },
  label: {
    fontSize: moderateScale(13),
    marginBottom: verticalScale(6),
    color: COLORS.textPrimary,
    fontWeight: "500",
  },
  placeholderContainer: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    color: COLORS.textSecondary,
    marginTop: verticalScale(8),
  },
  buttonWrapper: {
    marginTop: verticalScale(6),
    borderRadius: moderateScale(24),
    overflow: 'hidden',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },

  buttonGradient: {
    paddingVertical:verticalScale(9),
    flexDirection: "row",
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: moderateScale(24),
  },
  buttonText: {
    color:COLORS.background,
    fontWeight: '600',
    fontSize: moderateScale(15),
  },
  buttonIcon: {
    marginRight: moderateScale(8),
  },
  removeButton: {
    position: 'absolute',
    top:verticalScale(8),
    right: moderateScale(8),
    borderRadius: moderateScale(12),
    width: moderateScale(24),
    height: moderateScale(24),
    justifyContent: 'center',
    alignItems: 'center',
    },
  textGroup: {
    marginBottom: verticalScale(8),
    padding: moderateScale(8),
  },
  textArea:{
    marginTop: verticalScale(8),
    backgroundColor: '#f9f9f9',
    paddingVertical: verticalScale(8),
    paddingHorizontal: moderateScale(16),
    borderRadius: moderateScale(16),
    borderColor: '#ccc',
    borderWidth: 1,
  },

  imagePicker: {
    width: "100%",
    height:verticalScale(160),
    backgroundColor: COLORS.inputBackground,
    borderRadius: moderateScale(12),
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },

imagePickerModern: {
  height: verticalScale(120),
  borderRadius: moderateScale(16),
  borderWidth: 1,
  borderColor: '#e0e0e0', // lighter, more modern than #ccc
  backgroundColor: COLORS.roomCard, // closer to neutral light
  justifyContent: 'center',
  alignItems: 'center',
  position: 'relative',
  overflow: 'hidden',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,   // very subtle shadow
  shadowRadius: 2,
  elevation: 0.5,        // minimal elevation on Android
  marginTop: verticalScale(6),
},

imagePickerSelected: {
  borderColor: COLORS.primary,
  shadowOpacity: 0.2,
},

previewImageModern: {
  width: '100%',
  height: '100%',
  resizeMode: 'cover',
  borderRadius: moderateScale(16),
},

placeholderContainerModern: {
  justifyContent: 'center',
  alignItems: 'center',
},

placeholderTextModern: {
  marginTop: verticalScale(6),
  fontSize: moderateScale(13),
  color: COLORS.textSecondary,
  fontWeight: '500',
},

removeButtonModern: {
  position: 'absolute',
  top: verticalScale(6),
  right:  moderateScale(8),
  backgroundColor: '#fff',
  borderRadius: moderateScale(20),
  padding: moderateScale(2),
  elevation: 4,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.15,
  shadowRadius: 2,
},
loadingOverlay: {
  flex: 1,
  justifyContent: 'center',
  alignItems: 'center',
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 999,
},

loadingContainer: {
  backgroundColor: 'white',
  padding: moderateScale(24),
  borderRadius: moderateScale(16),
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 6,
  elevation: 8,
},

loadingText: {
  marginTop: verticalScale(14),
  fontSize: moderateScale(14),
  fontWeight: '600',
  color: COLORS.primary,
},

loadingSubtext: {
  marginTop: verticalScale(4),
  fontSize: moderateScale(12),
  color: COLORS.textSecondary,
},


});

export default styles;