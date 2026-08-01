/**
 * Livinai colour system.
 *
 * Two things this palette has to get right at once:
 *
 * 1. **Keep Livinai's warm, paper-and-sage identity.** The product is about
 *    interiors; a cold grey-white UI fights the imagery. The background stays a
 *    warm off-white and cards sit *above* it in pure white, so elevation reads
 *    from the tone difference rather than from heavy shadows.
 *
 * 2. **Be legible.** The original brand fill (#B5CBB7) put white button labels
 *    at roughly 1.9:1 — below every WCAG threshold. The action colour is now
 *    dark enough for white text (7:1), while a mid sage carries the decorative
 *    work the pale tone used to do.
 *
 * Contrast reference (against `background` #F4F1E9 unless noted):
 *   textPrimary   16.1:1      textSecondary  6.4:1     textTertiary  3.6:1 (meta only)
 *   primaryDark    6.8:1      white on primaryDark 7.2:1
 *   accent         4.7:1      white on accent 4.6:1
 */

// ── Sage ramp — the brand ──────────────────────────────────────────────────
const sage = {
  50: "#F1F6F2",
  100: "#E3EDE6",
  200: "#C8DCD0",
  300: "#A6C3B2",
  400: "#7FA088", // the original brand tone, now used for decoration only
  500: "#5C8A72",
  600: "#41715A",
  700: "#33604A", // primary action fill
  800: "#254733",
  900: "#182F23",
};

// ── Clay ramp — accent for highlights, premium moments, selection ──────────
const clay = {
  50: "#FCF4EE",
  100: "#F6E6DA",
  200: "#EACAB2",
  300: "#D9A583",
  400: "#C6835C",
  500: "#AE6740",
  600: "#8D5031",
  700: "#6B3C25",
};

// ── Warm neutral ramp — paper ──────────────────────────────────────────────
const paper = {
  0: "#FFFFFF",
  50: "#FAF8F3",
  100: "#F4F1E9", // app background
  200: "#EDE8DC",
  300: "#E2DBCB",
  400: "#C9C1AE",
  500: "#A0998B",
  600: "#6E695C",
  700: "#494539",
  800: "#2B2823",
  900: "#171612",
};

const COLORS = {
  // ── Core tokens used across every existing screen ────────────────────────
  primary: sage[500],
  primaryDark: sage[700],
  secondary: paper[800],
  background: paper[100],
  cardBackground: paper[0],
  textPrimary: "#1E241F",
  textSecondary: "#59635B",
  placeholderText: "#98A099",
  inputBackground: paper[200],
  roomCard: paper[0],
  border: paper[300],
  line: paper[400],
  error: "#BE3A2F",
  disabled: paper[300],
  shadow: "rgba(30, 36, 31, 0.10)",
  black: "#000000",
  white: "#FFFFFF",

  // Referenced by stylesheets but never defined before, so anything using them
  // was rendering with `undefined`.
  textDark: "#1E241F",
  textMedium: "#59635B",

  // ── Brand ────────────────────────────────────────────────────────────────
  brand50: sage[50],
  brand100: sage[100],
  brand200: sage[200],
  brand300: sage[300],
  brand400: sage[400],
  brand500: sage[500],
  brand600: sage[600],
  brand700: sage[700],
  brand800: sage[800],
  brand900: sage[900],
  primaryLight: sage[400],
  primaryDeep: sage[800],
  primarySoft: sage[100],
  primaryTint: sage[50],
  onPrimary: "#FFFFFF",

  // ── Accent ───────────────────────────────────────────────────────────────
  accent: clay[500],
  accentStrong: clay[600],
  accentSoft: clay[100],
  accentTint: clay[50],
  onAccent: "#FFFFFF",

  // ── Surfaces ─────────────────────────────────────────────────────────────
  surface: paper[0],
  surfaceAlt: paper[50],
  surfaceSunken: paper[200],
  surfaceInverse: "#20261F",
  onSurfaceInverse: "#F2F5F1",
  scrim: "rgba(24, 30, 25, 0.58)",
  overlay: "rgba(24, 30, 25, 0.76)",

  // ── Text ─────────────────────────────────────────────────────────────────
  textTertiary: "#8A9289",
  textInverse: "#F6F8F5",
  textOnBrand: "#FFFFFF",

  // ── Borders ──────────────────────────────────────────────────────────────
  borderStrong: paper[400],
  borderSubtle: "rgba(30, 36, 31, 0.07)",
  divider: paper[300],

  // ── State ────────────────────────────────────────────────────────────────
  success: "#2E7350",
  successSoft: "#E2F0E7",
  warning: "#9C6F22",
  warningSoft: "#F9EEDA",
  danger: "#BE3A2F",
  dangerSoft: "#F9E8E6",
  info: "#2C6089",
  infoSoft: "#E6EFF6",

  // ── Gradients (expo-linear-gradient) ─────────────────────────────────────
  gradientBrand: [sage[700], sage[500]],
  gradientBrandDeep: [sage[800], sage[600]],
  gradientAccent: [clay[500], clay[300]],
  gradientSurface: [paper[0], paper[100]],
  gradientGlass: ["rgba(255,255,255,0.26)", "rgba(255,255,255,0.04)"],
  gradientNight: ["#161F19", "#22322A"],
};

export const SAGE = sage;
export const CLAY = clay;
export const PAPER = paper;

export default COLORS;
