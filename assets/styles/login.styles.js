import { StyleSheet, Dimensions } from 'react-native';
import COLORS from '../../constants/colors';

 const { width } = Dimensions.get("window");


export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    shadowColor: COLORS.black,
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    marginBottom:64
  },
  scrollViewStyle: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  topIllustration: {
    alignItems: "center",
    width: "100%",
    overflow: 'hidden',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    backgroundColor: COLORS.background,
    //paddingTop:64
  },
  illustrationImage: {
    //width: width * 0.75,
    height: width * 0.75,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    backgroundColor: COLORS.background
  },
  header: {
    marginBottom: 30,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom:8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign:"center",
    marginBottom:8,
  },
  formContainer: {
    marginBottom:10,
  },
   inputGroup: {
    marginBottom: 16,
  },

  label: {
    fontSize: 14,
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingHorizontal: 10,
    backgroundColor: COLORS.inputBackground,
  },
  inputIcon: {
    marginRight: 10,
  },
  eyeIcon: {
    padding:8,
  },
  input: {
    flex: 1,
    height: 48,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  buttonWrapper: {
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },

  buttonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  buttonText: {
    color:COLORS.white,
    fontWeight: '600',
    fontSize: 16,
  },
  footer: {
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  footerText: {
    color: COLORS.textSecondary,
  },
  link: {
    color: COLORS.primary,
    fontWeight: 'bold',
    marginLeft: 6,
  },
});
