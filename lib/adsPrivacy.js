import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import {
  getTrackingPermissionsAsync,
  PermissionStatus,
  requestTrackingPermissionsAsync,
} from "expo-tracking-transparency";
import mobileAds, { AdsConsent } from "react-native-google-mobile-ads";

let advertisingReady = false;
let trackingStatus = Platform.OS === "ios"
  ? PermissionStatus.UNDETERMINED
  : PermissionStatus.GRANTED;
let initialization;
const readinessSubscribers = new Set();
const CONSENT_TIMEOUT_MS = 8_000;

const subscribeToAdvertisingReadiness = (subscriber) => {
  readinessSubscribers.add(subscriber);
  return () => readinessSubscribers.delete(subscriber);
};

const markAdvertisingReady = () => {
  advertisingReady = true;
  readinessSubscribers.forEach((subscriber) => subscriber());
};

const waitForActiveApp = () => {
  if (AppState.currentState === "active") return Promise.resolve();

  return new Promise((resolve) => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      subscription.remove();
      resolve();
    });
  });
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestTrackingWhileVisible() {
  if (Platform.OS !== "ios") return PermissionStatus.GRANTED;

  // ATT does not present reliably while the native launch screen is being
  // dismissed or while the app is inactive. RootLayout renders Livinai's own
  // branded loading view before calling this function, then this short pause
  // lets the first React frame become visible before iOS presents its sheet.
  await waitForActiveApp();
  await wait(650);
  await waitForActiveApp();

  let permission = await getTrackingPermissionsAsync();
  if (permission.status === PermissionStatus.UNDETERMINED) {
    permission = await requestTrackingPermissionsAsync();
  }

  return permission.status;
}

/**
 * Resolve every advertising privacy choice before the ad SDK is initialized.
 *
 * This is intentionally owned by RootLayout rather than the index route. A
 * route can redirect, restore, or deep-link while an async effect is running;
 * the root layout cannot be bypassed, so no ad screen can mount early.
 */
export function initializeAdvertisingPrivacy() {
  if (initialization) return initialization;

  initialization = (async () => {
    trackingStatus = await requestTrackingWhileVisible();

    // UMP is independent of ATT. It gathers the regional consent Google needs
    // before serving ads in the EEA/UK/Switzerland. A published AdMob Privacy &
    // messaging form controls whether anything is shown here.
    try {
      const consentResult = await Promise.race([
        AdsConsent.gatherConsent(),
        wait(CONSENT_TIMEOUT_MS).then(() => null),
      ]);

      // Consent services should never prevent the core app from opening. If
      // the request times out, keep ads disabled and allow the user to proceed.
      if (!consentResult) return false;

      const consent = await AdsConsent.getConsentInfo();
      if (!consent.canRequestAds) return false;
    } catch (error) {
      // Google recommends continuing after a UMP refresh error because the SDK
      // can use a valid choice from a previous session. Only initialize when
      // that cached status can be read and explicitly allows ad requests.
      try {
        const consent = await AdsConsent.getConsentInfo();
        if (consent.canRequestAds !== true) return false;
      } catch {
        return false;
      }

      if (__DEV__) console.info("Ad consent refresh failed:", error?.message);
    }

    // AdMob initialization can take up to 30 seconds on a poor network. The
    // user's core app must never wait for an advertising service, so start it
    // after privacy is resolved and notify ad components when it is actually
    // ready. Until then those components render nothing and make no requests.
    mobileAds().initialize().then(markAdvertisingReady).catch((error) => {
      if (__DEV__) console.info("Advertising initialization failed:", error?.message);
    });
    return true;
  })().catch((error) => {
    if (__DEV__) console.info("Advertising initialization failed:", error?.message);
    return false;
  });

  return initialization;
}

export const isAdvertisingReady = () => advertisingReady;

export const useAdvertisingReady = () =>
  useSyncExternalStore(
    subscribeToAdvertisingReadiness,
    isAdvertisingReady,
    isAdvertisingReady,
  );

// A denied ATT choice never blocks the app or advertising. It only removes the
// cross-app identifier and forces this additional non-personalized signal on
// every request Livinai creates itself.
export const shouldRequestNonPersonalizedAds = () =>
  Platform.OS === "ios" && trackingStatus !== PermissionStatus.GRANTED;
