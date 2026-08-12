// OAuth client IDs are public identifiers, not secrets. Keep the iOS fallback
// here so a development client connected to a local Metro server does not lose
// the value that EAS normally injects while bundling in the cloud.
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
  process.env.EXPO_PUBLIC_IOS_GOOGLE_API_KEY ||
  "365853441307-c1frc7jb4tt7custuqaqn5ua7hnpu7i8.apps.googleusercontent.com";

/**
 * The "Web application" OAuth client — the one Google calls the *server* client.
 *
 * This must not be the iOS client. It is optional for opening the native iOS
 * sign-in sheet, and mandatory everywhere else: on Android the library signs in
 * through Credential Manager, which takes this as its server client id, and
 * without it `signIn()` comes back with no `idToken` at all. Since Google is the
 * only provider Android offers — Apple's button is iOS-only — a missing value
 * here is not a degraded sign-in, it is no sign-in.
 *
 * It falls back to a literal for the same reason the iOS client above does, and
 * that reason turned out to matter: this value used to live only in a local
 * `.env`, which was removed from the repo in 7215928 and never re-added to
 * `eas.json`. Every cloud build since has bundled `undefined` here. Client ids
 * are public — they ship inside the app either way, Google documents them as
 * not secret, and the iOS one has been committed in `eas.json` all along — so
 * there is nothing to protect by leaving this one out, and a working sign-in to
 * lose.
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  process.env.EXPO_PUBLIC_EXPO_GOOGLE_API_KEY ||
  "365853441307-1o7tsq766fvic5b1rh7ib94u39dhlmed.apps.googleusercontent.com";
