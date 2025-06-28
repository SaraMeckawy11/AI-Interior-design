// styles/home.styles.js
import { StyleSheet } from "react-native";
import COLORS from "../../constants/colors";

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
    padding: 16,
    paddingBottom: 72, 
  },
  header: {
    marginBottom: 16,
    alignItems: "center",
  },
  headerTitle: {
    //marginTop:8,
    fontSize: 24,
    fontWeight: "500",
    //fontFamily: "JetBrainsMono-Medium",
    //letterSpacing: 0.5,
    color: COLORS.primary,
    //marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  bookCard: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 16,
    marginBottom: 16,
    padding: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bookHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  username: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  bookImageContainer: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
    backgroundColor: COLORS.border,
  },
  bookImage: {
    width: "100%",
    height: "100%",
  },

  detailsContainer:{
    flex:1,
    flexDirection:'row',
    justifyContent:'space-between'
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
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    marginTop: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  footerLoader: {
    marginVertical: 20,
  },
  deleteButton: {
    padding: 8,
    justifyContent: "flex-end",
  },
});

export default styles;