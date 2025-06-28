import { StyleSheet } from 'react-native';
import COLORS from '../../constants/colors';

export default StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingTop:64,
    backgroundColor: '#fff',
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
    backgroundColor: COLORS.primary,
    paddingVertical:8,
    paddingHorizontal:16,
    borderRadius: 16,
    justifyContent:'center',
    alignItems: 'center',
    gap: 8,
    width:120
  },
  buttonText: {
    color: '#fff',
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
});
