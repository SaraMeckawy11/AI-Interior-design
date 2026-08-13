import { View, ActivityIndicator, Image, StyleSheet } from 'react-native';
import React from 'react';
import COLORS from '../constants/colors';

/**
 * The full-screen wait, in two forms — because there are two different waits.
 *
 * **Branded** is the launch screen. `app/index.jsx` runs directly under the
 * native splash while the stored session is read, so it carries the Livinai
 * lockup on the splash colour and the handover from the native screen has no
 * seam. That is the app opening, and it should look like it.
 *
 * **Plain** is everything else. Opening the collection is not the app starting;
 * it is one screen fetching a list. Showing the launch screen again there
 * flashed a full sage panel and a logo over a tab the person was already
 * standing in, then swapped to warm paper — which reads as a glitch rather than
 * as loading. So the default is a spinner on the background the list underneath
 * is painted in, and nothing moves when the content arrives.
 */
export const SPLASH_BACKGROUND = '#EDE4DB';

// Match the square native launch artwork exactly so the transition into the
// first React frame does not swap logos or change proportions.
const MARK_SIZE = 200;

export default function Loader({ size = 'large', branded = false, background }) {
  const surface = background || (branded ? SPLASH_BACKGROUND : COLORS.background);

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      {branded && (
        <Image
          source={require('../assets/images/splash-icon.jpg')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Livinai"
        />
      )}
      <ActivityIndicator size={size} color={COLORS.primaryDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  logo: {
    width: MARK_SIZE,
    height: MARK_SIZE,
  },
});
