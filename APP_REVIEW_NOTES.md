# App Review Information — paste-ready Notes

Replace every bracketed value before pasting this into App Store Connect. The
text under **Notes field** is intentionally below Apple's 4,000-byte limit.

## Notes field

Livinai 1.0 — build [BUILD NUMBER]

ATT CORRECTION
This build presents Apple's App Tracking Transparency prompt from a root-level
startup privacy gate. On a fresh installation, Livinai waits for the app to be
active and visible, then presents ATT before navigation, AdMob initialization,
or any ad request. Google Mobile Ads app measurement is delayed in the native
configuration. If tracking is declined, every app feature remains available and
ad requests use limited, non-personalized signals. The attached uninterrupted
physical-device recording shows a fresh install, launch, the native ATT prompt,
the selected response, and the following sign-in/Create flow.

ACCESS
An account is required to save designs. Livinai has no password login and no
developer-created credentials. Tap Sign in with Apple on the first screen and
use the reviewer's Apple ID; this creates a normal account with 2 free designs.
Google Sign-In is the only other login method. Designs are private: there is no
public feed, user-to-user contact, reporting, or blocking flow.

MAIN FEATURES
- Interior: Create > Interior > choose/take a room photo > select room, style,
  and colour > Generate.
- Exterior: Create > Exterior > choose/take a photo > select options > Generate.
- 3D Walkthrough: Create > 3D Walkthrough > draw rooms > assign room details >
  Render.
- Saved designs: Collection.
- Account deletion: Profile > Account > Delete Account > Delete Forever.
No sample file is required.

PURCHASES
All purchases use Apple In-App Purchase through RevenueCat and are located at
Profile > Upgrade. Livinai Pro Monthly and Yearly are auto-renewable
subscriptions providing up to 40 renders per day, 3D walkthroughs, and no ads.
The screen displays each product's StoreKit-localized price, duration,
auto-renewal notice, Terms of Use, Privacy Policy, and Restore Purchases.
Consumables are 10, 30, and 100-coin packs; 1 coin creates 1 design or
walkthrough and coins do not expire. Users may alternatively earn 1 coin from a
rewarded ad. Manage/cancel: Profile > Manage Subscription.

SERVICES AND REGIONS
Authentication: Apple and Google. Purchases: Apple/RevenueCat. Advertising:
Google AdMob. AI: Modal and RunPod using open-weight models. Media: Cloudinary.
Database: MongoDB Atlas. Hosting: Render. There are no regional feature
differences; only App Store price/currency localization varies. Livinai is a
design-visualization tool, not architectural or engineering advice.

TESTING AND SUPPORT
Tested on [EXACT DEVICE MODEL], [EXACT IOS VERSION], using TestFlight build
[BUILD NUMBER]. Support: https://livinai2025.github.io/support/
Privacy: https://livinai2025.github.io/privacy/

## App Store Connect checklist

- Set **Support URL** to `https://livinai2025.github.io/support/` for every
  localization.
- Set **Privacy Policy URL** to `https://livinai2025.github.io/privacy/`.
- Select the new build, not build 20.
- Replace all three bracketed values above.
- Attach the new uninterrupted ATT recording to App Review Information and the
  reply to Apple.
- Submit the three coin products, subscription group, monthly subscription,
  yearly subscription, and app version in the same review submission.
- App Privacy must say that data is collected and that tracking is used because
  AdMob can use IDFA for personalized advertising after ATT permission. Do not
  select "Data Not Collected."
- Review these App Privacy data types before publishing: name and email address;
  user ID and device ID; purchase history; photos/videos and other user content;
  coarse location derived from IP; product interaction and advertising data;
  crash data and performance data. Account, purchase, and user-content data are
  linked to the account for app functionality. AdMob device/advertising/usage
  data supports third-party advertising and analytics; mark the types AdMob uses
  across apps as tracking. Payment-card information is handled by Apple and is
  not collected by Livinai.
- Set the optional User Privacy Choices URL to
  `https://livinai2025.github.io/privacy/`.
- In AdMob Privacy & messaging, publish the GDPR message for the EEA, UK, and
  Switzerland before testing rewarded ads.
