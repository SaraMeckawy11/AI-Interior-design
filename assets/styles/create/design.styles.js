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
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent:'center',
    alignItems:'center',
    // marginTop:8,
    // marginBottom:8,
  },
  iconButton: {
    alignItems: 'center',    
  },
  iconAdd: {
    width: 96,
    height: 96,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    margin: 8,
    borderWidth:1,
    borderColor: COLORS.border  
  },
  iconImageWrapper: {
    width: 96,
    height: 96,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
    //marginTop:8,
  },
  iconImageSelected: {
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  iconImage: {
    width: 96,
    height: 96,
    borderRadius: 16,
  },
  iconLabel: {
    fontSize: 12,
    color: COLORS.textPrimary,
    marginTop:8,
    textAlign: 'center',
    marginBottom:16
  },
  iconLabelSelected: {
    fontWeight: 'bold',
    color: COLORS.primary,
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
  searchInput: {
    backgroundColor: '#f1f1f1',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  modalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  modalGridItem: {
    alignItems: 'center',
    margin: 8,
    width: 80,
  },
  modalImage: {
    width: 96,
    height: 96,
    borderRadius: 16,
  },
  modalImageSelected: {
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  modalGridLabel: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  manualCard: {
    marginTop: 8,
    padding: 8,
    // borderWidth: 1,
    // borderColor: '#ccc',
    // borderRadius: 10,
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
  customStyleBackground: {
    backgroundColor: COLORS.roomCard, // Light blue custom style background
  },
  
});

export default styles;
