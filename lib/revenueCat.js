import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

// RevenueCat public SDK keys are safe to ship in the app. Keeping platform
// selection here prevents an Android key from being used on iOS, which the SDK
// rejects while the upgrade screen is opening.
const API_KEYS = {
  android:
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
    'goog_uVORiYiVgmggjNiOAHvBLferRyp',
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
};

let configurationQueue = Promise.resolve();

export const revenueCatSupported = Platform.OS === 'android' || Platform.OS === 'ios';

// react-native-purchases keeps the native log listener alive across an app
// reload, while its module-scoped JS callback is reset. Re-registering the
// callback as soon as this module loads prevents native log events from calling
// an undefined `customLogHandler` before React effects run.
if (revenueCatSupported) {
  Purchases.setLogHandler((_level, message) => {
    if (__DEV__) console.info(`[RevenueCat] ${message}`);
  });
}

/**
 * Configure the native SDK once, then identify later users with logIn.
 *
 * Both the root layout and the upgrade screen can request configuration. The
 * queue makes those calls safe when they happen during the same render cycle.
 */
export function ensureRevenueCatConfigured(appUserId) {
  const userId = appUserId ? String(appUserId) : '';

  configurationQueue = configurationQueue.catch(() => undefined).then(async () => {
    if (!revenueCatSupported || !userId) return false;

    const apiKey = API_KEYS[Platform.OS];
    if (!apiKey) return false;

    const configured = await Purchases.isConfigured();
    if (!configured) {
      Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.WARN : LOG_LEVEL.ERROR);
      Purchases.configure({ apiKey, appUserID: userId });
      return true;
    }

    const currentUserId = await Purchases.getAppUserID();
    if (currentUserId !== userId) await Purchases.logIn(userId);
    return true;
  });

  return configurationQueue;
}
