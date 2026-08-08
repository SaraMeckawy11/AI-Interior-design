import React from 'react';
import { ScrollView, View, Text, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import COLORS from '../../constants/colors';
import ScreenHeader from '../../components/ScreenHeader';

const Contact = () => {
  return (
    <LinearGradient
      colors={[COLORS.background, '#ffffff']} // gradient background
      style={styles.gradient}
    >
      <ScreenHeader title="Contact Us" />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        <Text style={styles.text}>
          Have a question, feedback, or need help with LIVINAI?  
          Feel free to reach out — we’d love to hear from you.
        </Text>

        <TouchableOpacity onPress={() => Linking.openURL('mailto:livinai2025@gmail.com')}>
          <Text style={styles.link}>livinai2025@gmail.com</Text>
        </TouchableOpacity>
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    padding: 20,
    flexGrow: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 20,
    textAlign: 'center',
    color: COLORS.textSecondary,
  },
  link: {
    fontSize: 16,
    color: '#007aff',
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
});

export default Contact;
