# App Review Information — Livinai

Paste the **"Reviewer notes"** section below into the *App Review Information → Notes*
field in App Store Connect, and fill the demo account fields with the credentials
from the checklist at the bottom.

The items marked **[YOU]** are things only you can supply (a recording, the device
list you actually tested on, the demo account you create). Everything else is
written from the shipping code and is accurate as of this build.

---

## Reviewer notes

### 3. What the app does, and who it is for

Livinai is an AI interior and exterior design tool. A user photographs or uploads a
room, a building exterior, or a floor plan, picks a room type, a design style, and a
colour tone, and the app returns a redesigned version of that same space.

**The problem it solves.** Deciding how to decorate or renovate normally means
paying a designer or imagining the result from a mood board. Livinai lets someone
see their own room in a different style in about a minute, before spending anything.

**Target audience.** Homeowners and renters planning a redecoration, and interior
designers, architects, and real-estate agents who want a fast visual to show a
client. General audience, rated 4+. No user-to-user contact and no social feed.

**The three things it makes:**

1. **Interior** — restyles a photo of a room.
2. **Exterior** — restyles a photo of a building or garden.
3. **3D Walkthrough** — the user draws a floor plan on a metric grid, assigns a type
   and style to each room, and the app renders a furnished 3D scene they can walk
   through.

### 4. Setting up and reaching the main features

The app requires an account, because designs are saved to it and sync across devices.
Livinai does not operate its own username-and-password system: the only two ways in
are **Sign in with Apple** and **Continue with Google**, both shown on the first
screen.

**There are therefore no demo credentials to supply, and none are needed.** Please
tap **Sign in with Apple** and use your own Apple ID — you may choose "Hide My Email".
That single tap both creates the account and signs in, and gives you a brand-new free
account with the 2 free designs, so the full first-run experience is visible. To see
registration specifically, use an Apple ID that has not opened Livinai before, or
delete the account from **Profile → Delete Account** and sign in again.

No sample files are needed: any photo of a room works, and the 3D Walkthrough is
drawn inside the app with no input file at all. If you would like a test image, any
photo from the device's photo library is fine.

**To reach each feature after signing in:**

| Feature | Path |
| --- | --- |
| Interior design | **Create** tab → *Interior* → pick or take a photo → choose room type, style, colour → **Generate** |
| Exterior design | **Create** tab → *Exterior* → same flow |
| 3D Walkthrough | **Create** tab → *3D Walkthrough* → draw rooms on the grid → assign type and style → **Render** |
| Saved designs | **Collection** tab |
| Subscriptions and coins | **Profile** tab → *Upgrade*, or the upsell banner on **Create** |
| Manage / cancel subscription | **Profile** tab → *Manage Subscription* |
| Restore purchases | **Profile** → *Upgrade* → **Restore purchases** |
| Delete account | **Profile** tab → *Delete Account* (bottom of the screen) |

An account created this way is a normal free account, so the free tier, the paywall,
and the rewarded-ad flow are all reachable. Tell us if you would prefer an account
pre-set to an active Pro subscription and we will provision one.

### 8. What can be bought, and where

Everything purchasable lives on one screen: **Profile → Upgrade**. The paywall is
also reached from the upsell banner on the **Create** tab, and automatically when a
free user runs out of renders. The screen has two tabs:

**Auto-renewable subscriptions ("Pro membership" tab)** — unlimited designs (fair-use
limit of 40 renders per day), 3D walkthroughs, and no ads:

| Product | Length | Price (USD) |
| --- | --- | --- |
| Livinai Pro Monthly | 1 month, auto-renewing | $9.99 |
| Livinai Pro Yearly | 1 year, auto-renewing | $59.99 |

Title, length, and price are shown on each row; the footer states that the plan
auto-renews until cancelled and links to the Terms of Use and the Privacy Policy.

**Consumable coin packs ("Coin packs" tab)** — one-time purchases, no renewal:

| Product | Coins | Price (USD) |
| --- | --- | --- |
| Coin pack (small) | 10 | $1.99 |
| Coin pack (medium) | 30 | $4.99 |
| Coin pack (large) | 100 | $12.99 |

One coin renders one design or one 3D walkthrough. New accounts get 2 free designs.
Coins do not expire.

**Free alternative.** Users can also earn 1 coin at a time by watching a rewarded
video ad, from the **Earn** button on the Coin packs tab. Nothing in the app is
reachable *only* by paying.

All purchases go through Apple's In-App Purchase via RevenueCat. There is no
external purchase link and no other payment method in the app.

### 5. External services used

| Purpose | Service |
| --- | --- |
| Authentication | Sign in with Apple; Google Sign-In; our own email/password accounts |
| In-app purchases | Apple In-App Purchase, managed through **RevenueCat** |
| Advertising | **Google AdMob** (banner, app-open, and rewarded video) |
| AI image generation | **Modal** (primary) and **RunPod** (fallback) GPU inference, running open-weight models: FLUX.2 [klein] for photo redesigns, and Stable Diffusion 1.5 with depth/segmentation ControlNets for floor-plan renders |
| Image storage / delivery | **Cloudinary** |
| Application database | **MongoDB Atlas** |
| Backend hosting | **Render** |

App Tracking Transparency is requested at first launch, before any ad is served,
because AdMob may use the advertising identifier.

### 6. Regional differences

**The app functions identically in every region.** There is no geo-gating, no
region-specific content, and no feature that is enabled or disabled by country. The
interface is English-only in this version.

The only thing that varies by region is the **price and currency of the in-app
purchases**, which are taken from the App Store's own localised price string for the
reviewer's storefront — the app never displays a hardcoded price.

### 7. Regulated industry and third-party material

Livinai does not operate in a regulated industry. It provides visual design
inspiration only — it is not architectural, structural, or engineering advice, and it
produces no certified plans.

There is no protected third-party material in the app. The images a user redesigns are
the user's own photos. The AI models are open-weight models used under their published
licences, and the 3D furniture assets are licensed for this use. <!-- [YOU] Confirm the
FLUX.2 [klein] licence terms and your furniture-asset licence before submitting, and
attach the licence documents here if you have them. -->

### 2. Devices and operating systems tested

- iPhone 17 — iOS 26 (physical device), via TestFlight

<!-- [YOU] Correct the iOS version to the exact one on the phone (Settings → General →
About → Software Version), and add any other physical device you actually tested on.
Do not list a device you did not test on, and do not list the Simulator as hardware. -->

The app is iPhone-only; `supportsTablet` is false, so it is not submitted for iPad.

### 1. Screen recording

The attached recording was captured on the physical iPhone listed above and shows,
in order:

- **Sign-in** with Google (including iOS's own "Livinai Wants to Use
  accounts.google.com to Sign In" prompt and the Google account chooser) and with
  Sign in with Apple.
- **Permissions.** The app's entry in iOS Settings, showing Photos, Camera and Allow
  Tracking, and the Photo Library Access choice between None, Limited Access and Full
  Access. Livinai works with Limited Access; it never requires the full library.
- **Interior design**, end to end: choosing Take Photo or Choose from Gallery, picking
  a photo, selecting room type, design style and colour tone, generating, and the
  before/after comparison with Download and Share.
- **Exterior design**, the same flow for a building exterior.
- **3D Walkthrough**: drawing a floor plan on the grid, naming and sizing each room,
  walking through the rendered scene, the top-down view, and the AI render.
- **Subscriptions.** The Livinai Pro screen with both billing cycles, their titles,
  lengths and prices, the auto-renew line, Terms of Use and Privacy Policy links, and
  Restore purchases. A subscription is purchased and the account becomes Premium.
- **Manage Subscription**: active plan, renewal date, auto-renewal state, change
  plan, Payment History with the transaction, and Cancel subscription.
- **Coin packs**, the one-time purchase alternative, and the balance they credit.
- **Account deletion**: Profile → Delete Account → the confirmation explaining what is
  removed → Delete Forever → signed out to the welcome screen.
- **Account registration**: signing back in afterwards with Sign in with Apple, which
  creates a new account in one tap and opens on an empty Collection.

---

## [YOU] Checklist before you resubmit

### 1. Set the demo account fields correctly

Livinai has no password of its own, so there is nothing to type into the User name
and Password boxes. Do **not** leave the fields blank with "Sign-in required" ticked
— that reads as a missing credential and is itself a 2.1 rejection.

In **App Store Connect → App Review Information**, keep *Sign-in required* **ticked**,
and put a placeholder such as `Sign in with Apple` in both the User name and Password
fields, then explain in the Notes (the reviewer notes above already do this) that the
app authenticates only through Sign in with Apple and Google and that the reviewer
should use their own Apple ID.

If App Store Connect refuses to accept placeholder text, untick *Sign-in required*
and rely on the Notes — but say plainly in the Notes that an account is required and
that Sign in with Apple creates it in one tap.

### 2. ~~Record the screen capture~~ — done

The recording covers every flow Apple listed: registration, login, account deletion,
the subscription screen with its prices and legal links, a completed purchase, and
the permission settings including tracking.

The only thing not on camera is the *first-run* permission popups themselves, because
the app was already installed when it was recorded and iOS shows each of those once
per install. The recording answers the same question a different way, by opening the
app's page in iOS Settings and showing Photos, Camera and Allow Tracking there. If a
reviewer asks specifically to see the prompts, delete the app, reinstall from
TestFlight and record a short second clip — the tracking prompt fires on first launch,
the camera prompt on Take Photo, and the photo prompt on Choose from Gallery.

There is no user-generated *public* content in Livinai — designs are private to the
account and are never shown to another user — so there is no reporting or blocking
mechanism to demonstrate. This is stated in the reviewer notes above.

### 3. ~~Rename the Google OAuth consent screen~~ — done

The consent screen now reads "to continue to Livinai". Verified on device.

### 4. Check these in App Store Connect

- **Screenshots** must show the app in use — the Create screen mid-flow, a generated
  result, the Collection, the 3D walkthrough. Not the splash screen, not the login
  screen, not title art. Apple called this out under 2.3.3.
- The Pro subscription needs a **Terms of Use (EULA)** link in the app metadata as
  well as in the app. If you use Apple's standard EULA, that is fine; otherwise put
  your own URL in the *License Agreement* field.
- Confirm all five IAP products are **submitted for review alongside the build** —
  a subscription that is still in "Ready to Submit" will not be testable and is a
  common cause of a second 2.1 rejection.
- The RevenueCat iOS key is already set in the `production` profile in `eas.json`,
  and `lib/revenueCat.js` picks the key by platform, so that side is fine. What still
  needs checking is the **RevenueCat dashboard**: the five iOS product identifiers
  from App Store Connect must be attached to the offering the app reads. If the store
  returns no packages, the paywall shows "Store unavailable" and the reviewer cannot
  test any purchase — which on its own would earn another 2.1.
