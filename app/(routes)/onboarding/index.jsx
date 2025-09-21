import { View, Text } from 'react-native';
import React from 'react';
import OnboardingScreen from '../../../screens/onboarding/onboarding.screen';

export default function Index() {
  return (
    <View style={{ flex: 1 }}>
      <OnboardingScreen />
    </View>
  );
}