import { useCallback, useEffect, useRef, useState } from "react";
import { InteractionManager, Platform } from "react-native";
import { AdEventType, RewardedAd, RewardedAdEventType, TestIds } from "react-native-google-mobile-ads";

import { apiUrl } from "../configs/api";

/**
 * Watch an ad, get a coin.
 *
 * This was written out by hand five times — in Interior, Exterior, Prompt, Plan
 * and Upgrade — and every copy carried the same three bugs:
 *
 *  1. **One ad could pay twice.** The listeners were registered inside an effect
 *     whose dependency list included the very state its own handler set, and
 *     they were attached to a *module-level* `RewardedAd` singleton. Any moment
 *     where two subscriptions overlapped — a re-run, a screen mounted twice,
 *     Strict Mode — meant `EARNED_REWARD` firing into two handlers and two
 *     `/watch-ad` calls for one ad. Here the listeners are attached exactly once,
 *     to an instance owned by the hook, and everything mutable is read through a
 *     ref so the effect never needs to re-run.
 *
 *  2. **"Loading ad…" could hang forever.** `handleWatchAd` always called
 *     `load()`, but `load()` returns immediately when an ad is already loaded or
 *     already loading — so `LOADED` never fired again and the label stuck. The
 *     loaded ad is now shown directly.
 *
 *  3. **The ad was never reloaded.** The reload was registered under
 *     `RewardedAdEventType.CLOSED`, which does not exist — that enum has only
 *     `LOADED` and `EARNED_REWARD`. The `if` guarding it was therefore always
 *     false and the listener was never attached, so the second "Watch ad" of a
 *     session had nothing to play. Closing belongs to `AdEventType`.
 *
 * The server is still the thing that decides a coin was earned: every claim
 * carries a `rewardId` and the ledger there refuses to pay for the same id
 * twice. This hook makes the double-claim unlikely; the ledger makes it
 * impossible.
 */

/**
 * Google's test unit in development, the real one in a release build.
 *
 * The live unit was hardcoded for both, with the `__DEV__` line commented out
 * above it. Every debug run, every hot reload and every emulator session was
 * therefore a real impression against the real unit — which is the definition of
 * invalid traffic, and it is accounts that get suspended for it, not builds.
 */
const AD_UNIT_ID = __DEV__
  ? TestIds.REWARDED
  : Platform.select({
      android: "ca-app-pub-4470538534931449/2411201644",
      ios: "ca-app-pub-4470538534931449/5960285522",
    });

const newRewardId = () =>
  `ad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * @param {string} token  Bearer token; claims are skipped without one.
 * @param {{ enabled?: boolean }} [options]
 *   `enabled` is whether this account can be asked to watch an ad at all. Pass
 *   false for a subscriber, and false while the account is still unknown: an
 *   ad request that goes out before the answer arrives is one a subscriber
 *   never needed. Every screen here gates its own watch-ad button on the same
 *   two flags, so a disabled hook has no button to serve.
 * @returns {{
 *   coins: number,
 *   setCoins: (value: number) => void,
 *   status: 'idle' | 'loading' | 'showing',
 *   message: string,
 *   clearMessage: () => void,
 *   watchAd: () => void,
 * }}
 */
export default function useRewardedCoins(token, { enabled = true } = {}) {
  const [coins, setCoins] = useState(0);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  const adRef = useRef(null);
  const tokenRef = useRef(token);
  const mountedRef = useRef(true);
  // The id of the ad currently being shown, and the last id actually claimed.
  // Keeping both is what makes a second `EARNED_REWARD` for one ad a no-op even
  // before the request leaves the phone.
  const rewardIdRef = useRef(null);
  const claimedRef = useRef(null);
  // Whether the person is waiting to watch, or the ad is merely being kept warm.
  const wantsShowRef = useRef(false);

  tokenRef.current = token;

  const claim = useCallback(async () => {
    const reference = rewardIdRef.current;
    if (!reference || claimedRef.current === reference) return;
    claimedRef.current = reference;

    if (!tokenRef.current) {
      if (mountedRef.current) setMessage("Sign in to keep the coins you earn.");
      return;
    }

    try {
      const response = await fetch(apiUrl("/api/users/watch-ad"), {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenRef.current}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId: reference }),
      });
      const data = await response.json().catch(() => ({}));
      if (!mountedRef.current) return;

      // The balance comes back from the side that changed it. Adding one
      // locally is how two devices drift apart, and how a capped or duplicate
      // claim still looked like it had paid.
      if (typeof data.adCoins === "number") setCoins(data.adCoins);
      if (data.message) setMessage(data.message);
    } catch {
      if (mountedRef.current) {
        setMessage("Your coin could not be added. Check your connection and try again.");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let unsubscribes = [];

    // A subscriber is never shown a watch-ad button, so building an ad for one
    // bought nothing and cost something: a request against the unit that can
    // never become an impression, and — before the guard in the ERROR handler
    // below — a failure message on a screen where ads are not part of the deal.
    // Re-runs when the account resolves, and warms up then.
    if (!enabled) return () => { mountedRef.current = false; };

    /**
     * Build and warm the ad only once the screen has settled.
     *
     * `createForAdRequest` and `load()` both cross into the Google Mobile Ads
     * SDK, and doing that during mount put them on the JS thread at the exact
     * moment the navigator was animating a push — so opening Interior or
     * Exterior from the hub stuttered for most of the transition, on every
     * screen that uses this hook. Nothing here is needed until the person has
     * arrived, so it waits for the animation to finish.
     */
    const task = InteractionManager.runAfterInteractions(() => {
      if (!mountedRef.current) return;

      // One instance per mounted screen, so no two screens can ever be
      // listening to the same ad — which is what made a single reward land
      // twice.
      const ad = RewardedAd.createForAdRequest(AD_UNIT_ID, {
        requestNonPersonalizedAdsOnly: false,
      });
      adRef.current = ad;

      const show = () => {
        try {
          ad.show();
          setStatus("showing");
        } catch {
          setStatus("idle");
          setMessage("That ad could not be played. Please try again.");
        }
      };

      unsubscribes = [
        ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          if (!mountedRef.current) return;
          if (wantsShowRef.current) {
            wantsShowRef.current = false;
            show();
          } else {
            setStatus("idle");
          }
        }),

        ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          // Deliberately ignores the reward's own `amount`. What an ad is worth
          // is Livinai's decision, not the ad network's, and reading it from the
          // payload is the other way one ad ends up paying more than one coin.
          claim();
        }),

        ad.addAdEventListener(AdEventType.CLOSED, () => {
          if (!mountedRef.current) return;
          setStatus("idle");
          rewardIdRef.current = null;
          // Warm the next one so the following tap plays immediately.
          try {
            ad.load();
          } catch {}
        }),

        ad.addAdEventListener(AdEventType.ERROR, () => {
          if (!mountedRef.current) return;
          setStatus("idle");

          // Only somebody waiting on a tap gets told.
          //
          // This fired for every failure, and most failures are not the
          // person's: the warm-up above runs on arrival and the CLOSED handler
          // reloads in the background, so an empty ad response — no fill, no
          // network, a throttled unit — put "No ad is available" on screen for
          // someone who had not asked for an ad and, on the screens that route
          // this into their notice, had no idea what it was answering.
          if (!wantsShowRef.current) return;
          wantsShowRef.current = false;
          setMessage("No ad is available right now. Please try again in a moment.");
        }),
      ];

      try {
        ad.load();
        // Only report loading if nobody is waiting on it; a tap that arrived
        // first has already set its own state and must not be overwritten.
        if (!wantsShowRef.current) setStatus("loading");
      } catch {}
    });

    return () => {
      mountedRef.current = false;
      task.cancel();
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      adRef.current = null;
    };
  }, [claim, enabled]);

  const watchAd = useCallback(() => {
    const ad = adRef.current;
    // Without this a disabled hook would take the tap, set "loading" and wait
    // on a warm-up that is never coming.
    if (!enabled) return;
    if (status === "showing") return;

    rewardIdRef.current = newRewardId();
    setMessage("");

    // Tapped inside the window where the ad has not been built yet. Remember
    // that someone is waiting: the deferred setup loads immediately and its
    // LOADED handler shows it. Returning silently here — which is what a plain
    // `if (!ad) return` did — made the first tap after arriving do nothing.
    if (!ad) {
      wantsShowRef.current = true;
      setStatus("loading");
      return;
    }

    if (ad.loaded) {
      wantsShowRef.current = false;
      try {
        ad.show();
        setStatus("showing");
      } catch {
        setStatus("idle");
        setMessage("That ad could not be played. Please try again.");
      }
      return;
    }

    wantsShowRef.current = true;
    setStatus("loading");
    try {
      ad.load();
    } catch {
      wantsShowRef.current = false;
      setStatus("idle");
      setMessage("No ad is available right now. Please try again in a moment.");
    }
  }, [enabled, status]);

  const clearMessage = useCallback(() => setMessage(""), []);

  return { coins, setCoins, status, message, clearMessage, watchAd };
}
