// styles/create.styles.js
import { StyleSheet } from "react-native";
import COLORS from "../../../constants/colors";

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: COLORS.background,
    padding: 24,
    paddingTop:16
  },
  scrollViewStyle: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  card: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 16,
    padding: 16,
    //paddingTop:16,
    marginVertical: 16,
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
    // marginBottom: 8,
  },
  // title: {
  //   fontSize: 24,
  //   fontWeight: "500",
  //   color: COLORS.primaryDark,
  //   //marginBottom: 8,
  // },

 title: {
  fontSize: 26,                     // prominent but not oversized
  fontWeight: '400',                // regular/light, for elegance
  color: COLORS.primaryDark,        // keep brand color subtle
  letterSpacing: 2,                 // modern airy feel
  textTransform: 'uppercase',       // sleek, minimalist
  fontFamily: 'Poppins_400Regular', // geometric, premium sans-serif
  textAlign: 'center',

},
title: {
  fontSize: 26,
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
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  form: {
    marginBottom: 16,
  },
  formGroup: {
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
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
    marginTop: 8,
  },
  buttonWrapper: {
    marginTop: 8,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },

  buttonGradient: {
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  buttonText: {
    color:COLORS.background,
    fontWeight: '600',
    fontSize: 16,
  },
  buttonIcon: {
    marginRight: 8,
  },
  removeButton: {
  position: 'absolute',
  top: 8,
  right: 8,
  //backgroundColor: 'rgba(0,0,0,0.4)', // subtle translucent background
  borderRadius: 12,
  width: 24,
  height: 24,
  justifyContent: 'center',
  alignItems: 'center',
  },
  textGroup: {
    marginBottom: 8,
    padding:8
  },
  textArea:{
    marginTop: 8,
    backgroundColor: '#f9f9f9',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderColor: '#ccc',
    borderWidth: 1,
  },

    imagePicker: {
    width: "100%",
    height:160,
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },

imagePickerModern: {
  height: 160,
  borderRadius: 16,
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
  marginTop: 8,
},

imagePickerSelected: {
  borderColor: COLORS.primary,
  shadowOpacity: 0.2,
},

previewImageModern: {
  width: '100%',
  height: '100%',
  resizeMode: 'cover',
  borderRadius: 16,
},

placeholderContainerModern: {
  justifyContent: 'center',
  alignItems: 'center',
},

placeholderTextModern: {
  marginTop: 8,
  fontSize: 14,
  color: COLORS.textSecondary,
  fontWeight: '500',
},

removeButtonModern: {
  position: 'absolute',
  top: 8,
  right: 8,
  backgroundColor: '#fff',
  borderRadius: 20,
  padding: 2,
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
  padding: 24,
  borderRadius: 16,
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 6,
  elevation: 8,
},

loadingText: {
  marginTop: 16,
  fontSize: 16,
  fontWeight: '600',
  color: COLORS.primary,
},

loadingSubtext: {
  marginTop: 6,
  fontSize: 13,
  color: COLORS.textSecondary,
},


});

export default styles;