// OAuth client IDs are public identifiers, not secrets. Keep the iOS fallback
// here so a development client connected to a local Metro server does not lose
// the value that EAS normally injects while bundling in the cloud.
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
  process.env.EXPO_PUBLIC_IOS_GOOGLE_API_KEY ||
  "365853441307-c1frc7jb4tt7custuqaqn5ua7hnpu7i8.apps.googleusercontent.com";

// This must be an OAuth client whose application type is "Web application".
// Do not substitute the iOS client ID. It is optional for opening the native
// iOS sign-in flow, but is required if the app needs a server-audience ID token.
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  process.env.EXPO_PUBLIC_EXPO_GOOGLE_API_KEY ||
  undefined;
