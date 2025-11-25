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
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  listContainer: {
    padding: moderateScale(16),
    paddingBottom: verticalScale(16), 
  },
  header: {
    marginBottom: verticalScale(10),
    alignItems: "center",
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
  bookCard: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: moderateScale(16),
    marginBottom: verticalScale(12),
    padding: moderateScale(16),
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: moderateScale(8),
    elevation: moderateScale(3),
    borderWidth: moderateScale(1),
    borderColor: COLORS.border,
  },

  bookImageContainer: {
    width: "100%",
    height: moderateScale(190),
    borderRadius: moderateScale(12),
    overflow: "hidden",
    marginBottom: verticalScale(8),
    backgroundColor: COLORS.border,
  },
  bookImage: {
    width: "100%",
    height: "100%",
  },

  detailsContainer:{
    flex:1,
    flexDirection:'row',
    justifyContent:'space-between',
    alignItems:'center',
  },

  bookDetails: {
    padding: moderateScale(8),
    flex: 1,
  },
  bookTitle: {
    fontSize: moderateScale(15),
    fontWeight: "600",
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
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: moderateScale(40),
    marginTop: moderateScale(40),
  },
  emptyText: {
    fontSize: moderateScale(16),
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginTop: verticalScale(8),
    marginBottom: verticalScale(8),
    marginHorizontal: moderateScale(8),
  },
  emptySubtext: {
    fontSize: verticalScale(14),
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  footerLoader: {
    marginVertical: verticalScale(20),
  },
  deleteButton: {
    padding: moderateScale(8),
    justifyContent: "flex-end",
  },
  modalOverlay: {
  flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
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
    fontSize:  moderateScale(16),
    fontWeight: '600',
    color: COLORS.primaryDark,
    marginBottom: verticalScale(4),
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: moderateScale(13),
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: verticalScale(16),
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalButton: {
    flex: 1,
    paddingVertical: verticalScale(6),
    marginHorizontal: moderateScale(5),
    borderRadius: moderateScale(12),
    alignItems: 'center',
    justifyContent: 'center',
  },

  cancelButton: {
    backgroundColor: COLORS.roomCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  deleteConfirmButton: {
    backgroundColor: COLORS.primaryDark,
  },
  modalButtonText: {
    fontSize: moderateScale(13),
    fontWeight: '600',
    color: COLORS.primaryDark,
  },
  cancelButtonText: {
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
});

export default styles;