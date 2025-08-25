// styles/create.styles.js
import { StyleSheet } from "react-native";
import COLORS from "../../../constants/colors";

const styles = StyleSheet.create({
  formGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
    color: COLORS.textPrimary,
    fontWeight: "500",
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.secondary,
  },

  iconGrid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap:8,
},

iconButton: {
  alignItems: 'center',
  width: 72,
},

iconCircle: {
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor:COLORS.roomCard,
  justifyContent: 'center',
  alignItems: 'center',
  borderWidth: 2,
  borderColor: 'transparent',
},

iconCircleSelected: {
  borderColor: COLORS.secondary, // Only border highlights
},

iconLabel: {
  fontSize: 12,
  color: COLORS.textPrimary,
  marginTop: 4,
  textAlign: 'center',
  marginBottom:8
},
iconLabelSelected: {
  fontWeight: 'bold',
  color: COLORS.secondary,
},

modalBackdrop: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end',
},

modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
},
modalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems:'center'
},
modalGridItem: {
    alignItems: 'center',
    margin: 8,
    width: 74,
},
modalGridLabel: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textPrimary,
    textAlign: 'center',
},

searchInput: {
    backgroundColor: '#f1f1f1',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 16,
},

manualInput: {
    marginTop: 10,
    backgroundColor: '#f9f9f9',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderColor: '#ccc',
    borderWidth: 1,
},
manualCard: {
    marginTop: 8,
    padding: 8,
    // borderWidth: 1,
    // borderColor: '#ccc',
    // borderRadius: 10,
},

addButton: {
    marginTop: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: 'center',
},

addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
},
cancelText: {
    marginTop: 16,
    color: 'red',
    textAlign: 'center',
    fontSize: 16,
},

colorSwatch: {
  width: 40,
  height: 40,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: '#ccc',
  marginBottom: 4,
},

colorToneSelected: {
  borderWidth: 2,
  borderColor: COLORS.secondary,
},
addSwatch: {
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: '#F3F4F6',
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: '#D1D5DB',
},



});

export default styles;