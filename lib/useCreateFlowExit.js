import { useCallback, useRef } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

/**
 * Leaving a create flow, in one press.
 *
 * Interior, Exterior and the other create screens all used a bare
 * `router.back()`, and it did not reliably take anyone home. Two things went
 * wrong, and both of them look identical from the outside — you press back, the
 * screen slides, and you are still looking at the screen you were trying to
 * leave:
 *
 *  1. **The stack held more than one copy of the screen.** Every tap on a card
 *     on the Create hub pushes a new instance, and that hub is the screen that
 *     loads an app-open ad on mount — so a tap that lands while the JS thread
 *     is busy appears to do nothing and gets repeated. Three taps, three copies,
 *     three presses of back before the hub reappears. `POP_TO` collapses all of
 *     them at once regardless of how many there are, so the count stops
 *     mattering.
 *  2. **`back()` was fired more than once.** The pop is queued and dispatched
 *     asynchronously, so a second press inside that window queued a second pop
 *     against a stack that had already moved. `leaving` closes that window.
 *
 * `dismissTo` is also the honest description of what this button means: it does
 * not mean "one step back through whatever happened to bring me here", it means
 * "take me to Create". Android's back key is wired to the same function so the
 * hardware and the on-screen control cannot disagree — but only while this
 * screen is the one on top. `BackHandler` subscriptions are global and the last
 * one registered wins, so a handler left running behind a pushed result or
 * paywall screen would hijack *its* back press too.
 *
 * @param {string} [target] Where the flow returns to. Defaults to the hub.
 * @returns {() => void} The exit handler, safe to call from any press handler.
 */
export default function useCreateFlowExit(target = "/create") {
  const router = useRouter();
  const leaving = useRef(false);

  const exit = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      // Pops every screen sitting above the hub. If the hub is somehow not in
      // this stack — opened from a deep link or a notification — `dismissTo`
      // puts it there instead of leaving the person with nowhere to go.
      router.dismissTo(target);
    } catch {
      router.replace(target);
    }
  }, [router, target]);

  useFocusEffect(
    useCallback(() => {
      // Coming back onto this screen — from the result screen, or from the
      // paywall — means the last exit did not happen. Re-arm it.
      leaving.current = false;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        exit();
        return true;
      });
      return () => subscription.remove();
    }, [exit]),
  );

  return exit;
}
