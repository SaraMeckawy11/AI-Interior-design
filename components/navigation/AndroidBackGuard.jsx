import { useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";
import { router, usePathname } from "expo-router";

/**
 * The last word on Android's back press: leave the app only from home.
 *
 * React Navigation already pops the stack and steps between tabs, and that is
 * the behaviour we want almost everywhere. What it cannot do is handle a screen
 * that is the *only* route in the stack — opened from a notification, a deep
 * link, or landed on after a `replace`. There it reports that it has nothing to
 * pop, and Android takes that as permission to close the app. A screen the user
 * reached by tapping and a screen they reached by deep link then answer the same
 * gesture completely differently.
 *
 * So this fills in only that gap. `BackHandler` runs the most recently added
 * listener first, and effects run child-before-parent, so subscribing once at
 * mount puts this behind React Navigation's own listener and behind any screen
 * that binds back on focus (the walkthrough does, to guard an unsaved plan).
 * It is reached only once nothing else has claimed the press.
 *
 * Subscribing once is the point, so the current path is read through a ref: a
 * dependency on `pathname` would re-subscribe on every navigation and make this
 * the *first* listener instead of the last, which would quietly take back over
 * from the navigators.
 */
export default function AndroidBackGuard({ home }) {
  const pathname = usePathname();
  const latest = useRef({ home, pathname });
  latest.current = { home, pathname };

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const { home: homeHref, pathname: current } = latest.current;

      // Already home. Returning false hands the press back to Android, which
      // sends the task to the background — the app is where the user left it
      // when they come back, rather than cold starting.
      if (toPathname(homeHref) === current) return false;

      if (router.canGoBack()) {
        router.back();
        return true;
      }

      // Nothing to pop and not home: this screen was opened directly. Send the
      // user home rather than out of the app.
      router.replace(homeHref);
      return true;
    });

    return () => subscription.remove();
  }, []);

  return null;
}

/**
 * `usePathname` reports the URL the user sees, which has no group segments in
 * it, so `/(routes)/onboarding` arrives as `/onboarding`. Strip them from the
 * href before comparing, and keep the href itself intact for navigating.
 */
function toPathname(href) {
  return href.replace(/\/\([^)]*\)/g, "") || "/";
}
