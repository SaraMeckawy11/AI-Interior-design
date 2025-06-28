import { StyleSheet, Platform } from 'react-native';
import COLORS from '../../constants/colors';
import { scale, verticalScale } from 'react-native-size-matters';

export default StyleSheet.create({
  container: {
    padding: scale(24),
    backgroundColor: '#fff',
    flexGrow: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
    fontFamily: 'Poppins_600SemiBold',
    marginTop: 16,
    marginBottom: 24,
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    fontFamily: 'Poppins_400Regular',
    marginBottom: 32,
  },
  featureList: {
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 15,
    marginLeft: 8,
    color: '#444',
    fontFamily: 'Poppins_400Regular',
  },
  planLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: COLORS.textPrimary,
    fontFamily: 'Poppins_500Medium',
  },
  planOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  planCard: {
    flex: 1,
    padding: scale(16),
    marginHorizontal: scale(6),
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#f9f9f9',
    alignItems: 'center',
    position: 'relative',
  },
  planCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#eef7ff',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4, // For Android
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    fontFamily: 'Poppins_500Medium',
  },
  planPrice: {
    fontSize: 14,
    marginTop: 4,
    fontFamily: 'Poppins_400Regular',
    color: '#333',
  },
  planSavings: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.secondary,
    fontFamily: 'Poppins_400Regular',
  },
  bestValueBadge: {
    position: 'absolute',
    top: -10,
    right: -10,
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    zIndex: 10,
  },
  bestValueText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'Poppins_500Medium',
  },
  upgradeButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: verticalScale(8),
    borderRadius: 28,
    alignItems: 'center',
  },
  upgradeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Poppins_500Medium',
  },
  trustNote: {
    textAlign: 'center',
    marginTop: 12,
    fontSize: 12,
    color: '#777',
    fontFamily: 'Poppins_400Regular',
    },
    cardInteractive: {
  backgroundColor: '#f9f9f9',
  flexDirection: 'row',
  padding: 16,
  borderRadius: 14,
  alignItems: 'center',
  marginBottom: 16,
  borderWidth: 1,
  borderColor: '#e0e0e0',
},

cardDestructive: {
  backgroundColor: '#fff5f5',
  flexDirection: 'row',
  padding: 16,
  borderRadius: 14,
  alignItems: 'center',
  marginBottom: 16,
  borderWidth: 1,
  borderColor: '#f5c6cb',
},

cardElevated: {
  backgroundColor: '#ffffff',
  padding: 18,
  borderRadius: 16,
  marginBottom: 24,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.05,
  shadowRadius: 6,
  elevation: 2,
},
unsubscribedWrapper: {
  flex: 1,
  justifyContent: 'center',
  alignItems: 'center',
  paddingHorizontal: scale(24),
  backgroundColor: '#fff',
},

   unsubscribedCard: {
    backgroundColor: '#ffffff',
    padding: scale(20),
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },

  unsubscribedTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textPrimary,
    marginBottom: 10,
    textAlign: 'center',
  },

  unsubscribedText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
    paddingHorizontal: 8,
  },

  unsubscribedButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(28),
    borderRadius: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  unsubscribedButtonText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    textAlign: 'center',
  },


});
