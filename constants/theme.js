/**
 * Livinai design tokens.
 *
 * Everything visual in the app should come from here rather than from magic
 * numbers so spacing, radii, elevation and type stay consistent across the
 * create flows, the walkthrough and the profile area.
 *
 * Spacing follows a 4pt base grid. Type follows a 1.2 modular scale anchored on
 * a 16pt body size, which keeps headings distinct without shouting on small
 * phones.
 */

import { Dimensions, Platform } from "react-native";
import COLORS from "./colors";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Reference frame is the iPhone 11 / Pixel 5 class device (390 x 844).
const guideline = { width: 390, height: 844 };

export const scaleWidth = (size) => (SCREEN_WIDTH / guideline.width) * size;
export const scaleHeight = (size) => (SCREEN_HEIGHT / guideline.height) * size;

/** Moderate scale: grows with the viewport but never runs away on tablets. */
export const ms = (size, factor = 0.35) =>
  Math.round((size + (scaleWidth(size) - size) * factor) * 100) / 100;

export const SPACING = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
};

export const RADIUS = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
};

export const FONTS = {
  light: "Poppins_300Light",
  regular: "Poppins_400Regular",
  medium: "Poppins_500Medium",
  semibold: "Poppins_600SemiBold",
  bold: "Poppins_700Bold",
};

/**
 * Type ramp. `letterSpacing` tightens as the size grows, which is what keeps
 * large Poppins headings from looking loose and dated.
 */
export const TYPE = {
  display: {
    fontFamily: FONTS.bold,
    fontSize: ms(32),
    lineHeight: ms(38),
    letterSpacing: -0.8,
  },
  h1: {
    fontFamily: FONTS.semibold,
    fontSize: ms(26),
    lineHeight: ms(32),
    letterSpacing: -0.6,
  },
  h2: {
    fontFamily: FONTS.semibold,
    fontSize: ms(21),
    lineHeight: ms(27),
    letterSpacing: -0.4,
  },
  h3: {
    fontFamily: FONTS.semibold,
    fontSize: ms(17),
    lineHeight: ms(23),
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: FONTS.regular,
    fontSize: ms(15),
    lineHeight: ms(22),
    letterSpacing: 0,
  },
  bodyStrong: {
    fontFamily: FONTS.medium,
    fontSize: ms(15),
    lineHeight: ms(22),
    letterSpacing: 0,
  },
  small: {
    fontFamily: FONTS.regular,
    fontSize: ms(13),
    lineHeight: ms(19),
    letterSpacing: 0.1,
  },
  caption: {
    fontFamily: FONTS.medium,
    fontSize: ms(11.5),
    lineHeight: ms(16),
    letterSpacing: 0.2,
  },
  overline: {
    fontFamily: FONTS.semibold,
    fontSize: ms(10.5),
    lineHeight: ms(14),
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
};

/**
 * Elevation. iOS gets a soft, wide, low-opacity shadow; Android only supports
 * `elevation`, so the two are declared together and the platform picks one.
 */
const shadow = (y, blur, opacity, elevation) =>
  Platform.select({
    ios: {
      shadowColor: "#16211D",
      shadowOffset: { width: 0, height: y },
      shadowOpacity: opacity,
      shadowRadius: blur,
    },
    android: { elevation },
    default: {
      shadowColor: "#16211D",
      shadowOffset: { width: 0, height: y },
      shadowOpacity: opacity,
      shadowRadius: blur,
    },
  });

export const SHADOW = {
  none: Platform.select({ android: { elevation: 0 }, default: {} }),
  xs: shadow(1, 3, 0.05, 1),
  sm: shadow(2, 8, 0.07, 2),
  md: shadow(6, 18, 0.1, 5),
  lg: shadow(12, 30, 0.13, 10),
  brand: Platform.select({
    ios: {
      shadowColor: COLORS.brand600,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.26,
      shadowRadius: 18,
    },
    android: { elevation: 7 },
    default: {},
  }),
};

/** Motion durations/easing shared by every animated surface. */
export const MOTION = {
  fast: 140,
  base: 220,
  slow: 380,
  reveal: 550,
  spring: { damping: 16, stiffness: 180, mass: 0.8 },
  pressScale: 0.975,
};

export const LAYOUT = {
  screenWidth: SCREEN_WIDTH,
  screenHeight: SCREEN_HEIGHT,
  gutter: SPACING.xl,
  maxContentWidth: 640,
  tabBarHeight: 62,
  headerHeight: 56,
  hitSlop: { top: 10, bottom: 10, left: 10, right: 10 },
};

const THEME = { COLORS, SPACING, RADIUS, FONTS, TYPE, SHADOW, MOTION, LAYOUT, ms };

export default THEME;
