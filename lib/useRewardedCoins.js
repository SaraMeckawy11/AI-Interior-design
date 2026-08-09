import { useCallback, useEffect, useRef, useState } from "react";
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
const AD_UNIT_ID = __DEV__ ? TestIds.REWARDED : "ca-app-pub-4470538534931449/2411201644";

const newRewardId = () =>
  `ad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * @param {string} token  Bearer token; claims are skipped without one.
 * @returns {{
 *   coins: number,
 *   setCoins: (value: number) => void,
 *   status: 'idle' | 'loading' | 'showing',
 *   message: string,
 *   clearMessage: () => void,
 *   watchAd: () => void,
 * }}
 */
export default function useRewardedCoins(token) {
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

    // One instance per mounted screen, so no two screens can ever be listening
    // to the same ad — which is what made a single reward land twice.
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

    const unsubscribes = [
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
        // Deliberately ignores the reward's own `amount`. What an ad is worth is
        // Livinai's decision, not the ad network's, and reading it from the
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
        wantsShowRef.current = false;
        setStatus("idle");
        setMessage("No ad is available right now. Please try again in a moment.");
      }),
    ];

    try {
      ad.load();
      setStatus("loading");
    } catch {}

    return () => {
      mountedRef.current = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      adRef.current = null;
    };
  }, [claim]);

  const watchAd = useCallback(() => {
    const ad = adRef.current;
    if (!ad || status === "showing") return;

    rewardIdRef.current = newRewardId();
    setMessage("");

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
  }, [status]);

  const clearMessage = useCallback(() => setMessage(""), []);

  return { coins, setCoins, status, message, clearMessage, watchAd };
}
