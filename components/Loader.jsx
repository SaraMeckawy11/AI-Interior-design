import { View, ActivityIndicator, Image, StyleSheet } from 'react-native';
import React from 'react';
import COLORS from '../constants/colors';

export default function Loader({ size = "large" }) {
  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/images/splash-livinai.png')}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Livinai"
      />
      <ActivityIndicator size={size} color={COLORS.primaryDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 18,
    backgroundColor: '#D9E1D6',
  },
  logo: {
    width: 210,
    height: 210,
  },
});
