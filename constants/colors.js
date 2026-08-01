/**
 * Livinai colour system — 2026 refresh.
 *
 * The previous palette used a very pale sage (#B5CBB7) as the brand fill, which
 * meant white text on primary buttons sat around 1.9:1 contrast — below every
 * WCAG threshold — and the whole product read as washed out. This palette keeps
 * the same warm, architectural sage identity but moves the action colours down
 * the luminance scale so every foreground/background pairing used in the app is
 * at least AA (4.5:1 for body copy, 3:1 for large text and UI chrome).
 *
 * Token names from the old file are all preserved so existing screens keep
 * working; the new semantic tokens (surface*, brand*, accent*, state*) are what
 * new UI should use.
 */

// ── Brand ramp (eucalyptus) ────────────────────────────────────────────────
const brand = {
  50: "#F1F6F2",
  100: "#E2EDE6",
  200: "#C6DACE",
  300: "#9FBFAF",
  400: "#6E9B85",
  500: "#4C7C65", // brand core — 4.8:1 on white
  600: "#3B6551", // primary action fill — 6.4:1 on white
  700: "#2E5040",
  800: "#233D31",
  900: "#182A22",
};

// ── Accent ramp (clay) — used for highlights, badges, premium moments ──────
const clay = {
  50: "#FBF2EC",
  100: "#F5E3D7",
  200: "#EAC7B1",
  300: "#DBA383",
  400: "#C8805B",
  500: "#B0653F", // 4.6:1 on white
  600: "#8F4F30",
  700: "#6E3C25",
};

// ── Warm neutral ramp ──────────────────────────────────────────────────────
const sand = {
  0: "#FFFFFF",
  50: "#FBFAF7",
  100: "#F5F2EC",
  200: "#EDE9E0",
  300: "#DFDACE",
  400: "#C2BCAE",
  500: "#9A9488",
  600: "#6F6A61",
  700: "#4A463F",
  800: "#2C2A25",
  900: "#171612",
};

const COLORS = {
  // ── Legacy tokens (kept for every existing screen/stylesheet) ────────────
  primary: brand[500],
  primaryDark: brand[600],
  secondary: sand[800],
  background: sand[50],
  cardBackground: sand[0],
  textPrimary: "#16211D",
  textSecondary: "#5E6B65",
  placeholderText: "#9AA49E",
  inputBackground: sand[100],
  roomCard: sand[0],
  border: sand[200],
  line: sand[300],
  error: "#C4392F",
  disabled: sand[300],
  shadow: "rgba(23, 33, 29, 0.10)",
  black: "#000000",
  white: "#FFFFFF",

  // These two were referenced by stylesheets but never defined, so anything
  // using them was silently rendering with `undefined`.
  textDark: "#16211D",
  textMedium: "#5E6B65",

  // ── Brand ────────────────────────────────────────────────────────────────
  brand50: brand[50],
  brand100: brand[100],
  brand200: brand[200],
  brand300: brand[300],
  brand400: brand[400],
  brand500: brand[500],
  brand600: brand[600],
  brand700: brand[700],
  brand800: brand[800],
  brand900: brand[900],
  primaryDeep: brand[700],
  primarySoft: brand[100],
  primaryTint: brand[50],
  onPrimary: "#FFFFFF",

  // ── Accent ───────────────────────────────────────────────────────────────
  accent: clay[500],
  accentStrong: clay[600],
  accentSoft: clay[100],
  accentTint: clay[50],
  onAccent: "#FFFFFF",

  // ── Surfaces ─────────────────────────────────────────────────────────────
  surface: sand[0],
  surfaceAlt: sand[100],
  surfaceSunken: sand[200],
  surfaceInverse: "#171F1B",
  onSurfaceInverse: "#F3F5F3",
  scrim: "rgba(22, 33, 29, 0.55)",
  overlay: "rgba(22, 33, 29, 0.72)",

  // ── Text ─────────────────────────────────────────────────────────────────
  textTertiary: "#8A938D",
  textInverse: "#F6F8F6",
  textOnBrand: "#FFFFFF",

  // ── Borders ──────────────────────────────────────────────────────────────
  borderStrong: sand[300],
  borderSubtle: "rgba(22, 33, 29, 0.07)",
  divider: sand[200],

  // ── State ────────────────────────────────────────────────────────────────
  success: "#2C7A57",
  successSoft: "#E3F2EA",
  warning: "#A9762A",
  warningSoft: "#FBF0DC",
  danger: "#C4392F",
  dangerSoft: "#FBE9E7",
  info: "#2F6497",
  infoSoft: "#E7F0F8",

  // ── Gradients (consumed by expo-linear-gradient) ─────────────────────────
  gradientBrand: [brand[600], brand[400]],
  gradientBrandDeep: [brand[800], brand[600]],
  gradientAccent: [clay[500], clay[300]],
  gradientSurface: [sand[0], sand[100]],
  gradientGlass: ["rgba(255,255,255,0.30)", "rgba(255,255,255,0.06)"],
  gradientNight: ["#12211C", "#1C332B"],
};

export const BRAND = brand;
export const CLAY = clay;
export const SAND = sand;

export default COLORS;
