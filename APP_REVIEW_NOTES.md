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

The app requires an account, because designs are saved to it and sync across
devices. Sign in with **email and password using the demo credentials supplied in
the demo account fields** — Sign in with Apple and Sign in with Google are also
offered on the sign-in sheet, but the email option is the one that works with the
credentials above.

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

The demo account is a normal free account, so you can see the free tier, the paywall,
and the rewarded-ad flow. Tell us if you would prefer it pre-set to an active Pro
subscription instead and we will flip it.

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

<!-- [YOU] Replace this block with the real list. Apple wants physical devices and the
latest OS. Example of the shape they expect:

- iPhone 15 Pro — iOS 18.5 (physical device)
- iPhone 12 — iOS 18.4 (physical device)
- iPad (10th generation) — iPadOS 18.5 (physical device)

If you have only tested on one physical iPhone, list only that one. Do not list
devices you did not test on, and do not list the Simulator as if it were hardware. -->

### 1. Screen recording

<!-- [YOU] Attach the recording. See the shot list in APP_REVIEW_NOTES.md. -->

---

## [YOU] Checklist before you resubmit

### 1. Create the demo account

The sign-in sheet now offers **Continue with email** alongside Apple and Google, so
you can hand Apple a real credential pair. Create one on a device:

1. Open the app → sign-in sheet → **Continue with email** → *New here? Create an
   account*.
2. Use something like `appreview@livinai.app` with a password you are willing to put
   in App Store Connect.
3. Generate one design on it so the Collection tab is not empty when the reviewer
   opens it.
4. Enter those credentials in **App Store Connect → App Review Information → Sign-in
   required → User name / Password**.

### 2. Record the screen capture

Apple asks for one continuous recording, on a **physical device**, on the **latest
iOS**, starting from launching the app. Cover, in this order:

1. Launch from the home screen (do not start mid-session).
2. The App Tracking Transparency prompt at first launch.
3. **Account registration** with email — show creating a fresh account.
4. Sign out, then **log in** again with the demo credentials.
5. **Create** tab → Interior → the photo-library permission prompt → pick a photo →
   choose room type, style, colour → Generate → the result.
6. Show the **camera** permission prompt too (Interior → take a photo).
7. Save a design to Photos — shows the save-to-library permission prompt.
8. **Collection** tab — show a saved design and deleting one.
9. **3D Walkthrough** — draw a small plan, assign a room, render, walk through it.
10. **Profile → Upgrade** — show both tabs, the subscription titles/lengths/prices,
    the auto-renew line, the Terms of Use and Privacy Policy links, and
    **Restore purchases**. Start a purchase and show the App Store sheet.
11. The **rewarded ad** flow — Earn button → ad → coin added.
12. **Profile → Manage Subscription** → show Cancel.
13. **Account deletion** — Profile → Delete Account → confirm → show it signs out.

There is no user-generated *public* content in Livinai — designs are private to the
account — so no reporting or blocking mechanism is needed or shown. Say this
explicitly to the reviewer if they ask.

### 3. Check these in App Store Connect

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
