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
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.secondary,
  },

  iconGrid: {
  flex:1,
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap:8,
  margin:8,
},

iconButton: {
  alignItems: 'center',
  width: 72,
},

iconCircle: {
  width: 64,
  height: 32,
  borderRadius: 16,
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
  marginTop: 8,
  textAlign: 'center',
  width:80,
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
  backgroundColor: COLORS.white,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  padding: 24,
  maxHeight: '90%',
},

modalOption: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 16,
  paddingHorizontal: 16,
  borderBottomColor: COLORS.roomCard,
  borderBottomWidth: 1,
  marginBottom: 8,
  borderRadius: 8,
},
modalItem: {
    marginRight: 8,
},
modalOptionText: {
  fontSize: 16,
  color: COLORS.textPrimary,
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
  color: 'white',
  fontWeight: 'bold',
},
cancelText: {
    marginTop: 16,
    color: 'red',
    textAlign: 'center',
    fontSize: 16,
},

});

export default styles;