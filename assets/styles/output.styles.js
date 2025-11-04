import { StyleSheet, Dimensions } from 'react-native';
import COLORS from '../../constants/colors';
const { width, height } = Dimensions.get("window");

// Scaling functions
const scale = (size) => (width / 375) * size; // horizontal scaling (base: iPhone 8 width)
const verticalScale = (size) => (height / 667) * size; // vertical scaling (base: iPhone 8 height)
const moderateScale = (size, factor = 0.5) =>
  size + (scale(size) - size) * factor;

export default StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop:64,
    backgroundColor: COLORS.background,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    marginTop:16,
    fontWeight: '500',
    marginBottom: 24,
  },
  imageContainer: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 24,
    backgroundColor: '#f9f9f9', // optional background for better contrast
  },
  image: {
    width: '100%',
    height: '100%',
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 32,
  },
  button: {
    flexDirection: 'row',
    backgroundColor: COLORS.primaryDark,
    paddingVertical:8,
    paddingHorizontal:16,
    borderRadius: 16,
    justifyContent:'center',
    alignItems: 'center',
    gap: 8,
    width:120
  },
  buttonText: {
    color: COLORS.background,
    fontWeight: '600',
  },
  bookDetails: {
    padding: 8,
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  caption: {
    fontSize: 14,
    color: COLORS.textDark,
    marginBottom: 8,
    lineHeight: 20,
  },
  date: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: moderateScale(20),  
    padding: moderateScale(20),
    width: "80%",
    alignItems: "center",
  },
  modalMessage: {
    fontSize: moderateScale(16),
    textAlign: "center",
    marginBottom: moderateScale(16),
    marginTop: verticalScale(4),
  },
  modalButton: {
    backgroundColor: COLORS.primaryDark,
    paddingVertical: verticalScale(8),
    paddingHorizontal: moderateScale(24),
    borderRadius: moderateScale(20),
    width: '50%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    color: COLORS.cardBackground,
    fontSize: moderateScale(14),
    fontWeight: "600",
  },
  detailsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: verticalScale(16),
  },
  bookDetails: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(8),
  },
  bookTitle: {
    fontSize: moderateScale(15),
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  caption: {
    fontSize: moderateScale(13),
    color: COLORS.textDark,
    marginBottom: verticalScale(6),
    lineHeight: verticalScale(16),
  },
  date: {
    fontSize: moderateScale(11),
    color: COLORS.textSecondary,
  },

  // ===== New styles for slider =====
  sliderContainer: {
    width: '100%',
    marginBottom: verticalScale(24),
    alignItems: 'center',
  },
  slider: {
    width: '100%',
    height: verticalScale(40),
  },
  sliderLabel: {
    marginTop: verticalScale(8),
    fontSize: moderateScale(14),
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
});
