import { StyleSheet } from "react-native";
import COLORS from "../../constants/colors";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 16,
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
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 0.08,
    borderColor: COLORS.border,
  },
  profileImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 16,
  },
  profileInfo: {
    flex: 1,
  },
  username: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    fontWeight: "400",
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  memberSince: {
    fontSize: 12,
    fontWeight: "400",
    color: COLORS.textSecondary,
  },
  logoutButton: {
    backgroundColor: COLORS.primaryDark,
    borderRadius: 16,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  logoutText: {
    color: COLORS.white,
    fontWeight: "600",
    marginLeft: 8,
  },
  itemIcon: {
    marginRight: 12,
  },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
    color: COLORS.textPrimary,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  itemText: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },

familyMessage: {
  backgroundColor: '#E6F0E4', // lighter version of #B5CBB7
  paddingVertical: 16,
  paddingHorizontal: 16,
  borderRadius: 16,
  marginVertical: 12,
  borderWidth: 0.5,
  borderColor: COLORS.primaryDark, // subtle darker green for border
  shadowColor: COLORS.shadow,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
  elevation: 2,
  overflow: 'hidden', // ensures text doesn't get cut
},
familyText: {
  fontSize: 16,
  fontWeight: "500",
  color: COLORS.textPrimary, // dark text for readability
  textAlign: "auto",
  lineHeight: 24,
  paddingLeft:16,
  margin: 0,
},


});

export default styles;
