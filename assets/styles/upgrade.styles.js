/**
 * Upgrade to Pro.
 *
 * Same order as always — title, copy, coins, features, plans, packs — set
 * smaller and quieter, because the screen's problem was never its structure. It
 * was that nothing on it agreed with anything else: an `h1` balance shouting
 * over `h3` section headings, three different card treatments (shadowed,
 * outlined, tinted) within one scroll, two filled pills and one outlined one,
 * and badges in three sizes.
 *
 * One rule now settles all of it:
 *
 *   **One card shape, one selected state, one button height, one type step
 *   between a heading and its body.**
 *
 * Concretely: every card is `surface` + `1px border` + `RADIUS.lg`, with no
 * shadows anywhere — on a warm paper background, elevation reads from the tone
 * difference, and the drop shadows were what made the cards look pasted on.
 * Selection is the sage tint plus a 1.5px sage border, everywhere. Buttons are
 * one height. Headings are `TYPE.bodyStrong`, bodies are `TYPE.small`, meta is
 * `TYPE.caption` — one step apart, never two.
 *
 * Sizes came down a full step across the board: the title from `display` to
 * `h2`, section headings from `h3` to `bodyStrong`, the coin balance from `h1`
 * to `h2`, plan prices from `h3` to `bodyStrong`. At the old sizes the page was
 * three-quarters heading by area.
 */

import { StyleSheet } from 'react-native';

import COLORS from '../../constants/colors';
import { RADIUS, SPACING, TYPE, ms } from '../../constants/theme';

/** The one card. No shadow: tone carries elevation on this background. */
const CARD = {
  borderRadius: RADIUS.lg,
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
};

/** The one selected state, on plans and packs alike. */
const SELECTED = {
  borderColor: COLORS.primaryDark,
  borderWidth: 1.5,
  backgroundColor: COLORS.primaryTint,
};

/** The one button. 48pt clears the 44pt minimum without dominating the page. */
const BUTTON = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: SPACING.sm,
  height: ms(48),
  borderRadius: RADIUS.pill,
};

export default StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  back: {
    width: ms(36),
    height: ms(36),
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.base,
  },
  title: { ...TYPE.h2, color: COLORS.textPrimary },
  subtitle: {
    ...TYPE.small,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },

  // ── Section headings ─────────────────────────────────────────────────────
  // One step above the body they introduce, not three.
  sectionLabel: {
    ...TYPE.bodyStrong,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  sectionGap: { marginTop: SPACING.xl },

  // ── Coins ────────────────────────────────────────────────────────────────
  coinCard: { ...CARD, padding: SPACING.base, marginBottom: SPACING.lg },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  coinValue: { ...TYPE.h3, color: COLORS.textPrimary },
  coinSubtitle: { ...TYPE.caption, color: COLORS.textSecondary, marginTop: 2 },

  coinPrices: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    gap: SPACING.sm,
  },
  coinPriceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  coinPriceLabel: { flex: 1, ...TYPE.caption, color: COLORS.textSecondary },
  coinPriceValue: { ...TYPE.caption, color: COLORS.textPrimary },

  // Both of these were full-width bars: a 48pt grey pill for "Watch Ad" and a
  // bordered card for "Pro is active". Neither is a primary action — one earns a
  // single coin, the other states a fact — so at that size they read as more
  // important than the button that actually buys something. They are the same
  // compact tag the Premium badge uses elsewhere in the app: self-sizing, pill,
  // tinted, caption text beside a small glyph.
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
  },
  tagText: { ...TYPE.caption, fontSize: 10.5 },

  // Clay, because coins are clay everywhere on this screen.
  watchAdTag: { backgroundColor: COLORS.accentSoft, marginLeft: 'auto' },
  watchAdTagText: { color: COLORS.accentStrong },

  // Sage, because it is a membership state, not a coin one.
  activeTag: { backgroundColor: COLORS.brand100, marginBottom: SPACING.base },
  activeTagText: { color: COLORS.brand700 },

  adStatusText: {
    ...TYPE.caption,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

  // ── Features ─────────────────────────────────────────────────────────────
  // ── What Pro includes ────────────────────────────────────────────────────
  // Three things went wrong here. The list was the only block on the page with
  // no heading, so between the coin balance and "Choose a plan" it read as
  // three unexplained ticks. `alignItems: "center"` centred the tick against
  // the whole row rather than the first line: the labels do fit on one line at
  // default settings — the longest clears 320pt with about 10pt to spare — but
  // they wrap as soon as the system font scale is turned up, and that is the
  // case where a tick floating halfway down the row looks broken. And 8pt
  // between rows was tighter than the 19pt line height inside them, which makes
  // a list read as one grey mass.
  featureList: { marginBottom: SPACING.xl, gap: SPACING.md },
  featureItem: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  // (19pt line height - 15pt glyph) / 2, so the tick sits on the first line's
  // optical centre however many lines follow it.
  featureIcon: { marginTop: 2 },
  featureText: { flex: 1, ...TYPE.small, color: COLORS.textPrimary },

  // ── Plans, side by side ──────────────────────────────────────────────────
  planOptions: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.base },
  planCard: {
    ...CARD,
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    paddingBottom: SPACING.md,
  },
  planCardSelected: SELECTED,

  // The badge is a band inside the card, the same 18pt band the packs use, and
  // it is reserved on both cards so the two titles sit on one line. It used to
  // be an absolutely positioned pill at `top: -8, right: -8` — outside the
  // card's bounds, which Android clips, and a different size and colour from
  // the pack badge doing the same job six rows down.
  badge: {
    alignSelf: 'stretch',
    height: ms(18),
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOn: { backgroundColor: COLORS.brand100 },
  badgeText: { ...TYPE.caption, fontSize: 9.5, letterSpacing: 0.4, color: COLORS.brand700 },

  cardBody: { alignItems: 'center', paddingTop: SPACING.md, paddingHorizontal: SPACING.sm },
  radio: {
    width: ms(18),
    height: ms(18),
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  radioOn: { borderColor: COLORS.primaryDark },
  radioDot: {
    width: ms(9),
    height: ms(9),
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primaryDark,
  },
  planTitle: { ...TYPE.caption, color: COLORS.textSecondary },
  planPrice: { ...TYPE.bodyStrong, color: COLORS.textPrimary, marginTop: 1 },
  planPeriod: { ...TYPE.caption, fontSize: 10, color: COLORS.textTertiary },
  savings: { ...TYPE.caption, fontSize: 10, color: COLORS.accentStrong, marginTop: SPACING.xs },
  savingsPlaceholder: { height: ms(14), marginTop: SPACING.xs },

  // ── Coin packs ───────────────────────────────────────────────────────────
  // Same card, same badge band, same selected state as the plans above.
  packRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.base },
  packCoins: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  packUnit: { ...TYPE.caption, fontSize: 10, color: COLORS.textSecondary },
  packPrice: { ...TYPE.caption, color: COLORS.textPrimary, marginTop: SPACING.xs },

  // ── Buttons ──────────────────────────────────────────────────────────────
  primaryButton: { ...BUTTON, backgroundColor: COLORS.primaryDark },
  primaryButtonDisabled: { backgroundColor: COLORS.surfaceSunken },
  primaryButtonText: { ...TYPE.caption, color: COLORS.white },
  primaryButtonTextDisabled: { color: COLORS.textTertiary },

  // What is about to be charged, on the line above the button that charges it.
  // With one button serving five options, the button's own label is the only
  // other thing saying which one is selected, and "Upgrade now" does not say
  // whether that is the monthly or the yearly.
  summary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginTop: SPACING.base,
    marginBottom: SPACING.sm,
  },
  summaryLabel: { flexShrink: 1, ...TYPE.caption, color: COLORS.textSecondary },
  summaryValue: { ...TYPE.bodyStrong, color: COLORS.textPrimary },

  pressed: { opacity: 0.82 },

  // Bottom of the screen, and quieter than either purchase button: managing an
  // existing plan is housekeeping, not the thing this page is for.
  ghostButton: { ...BUTTON, backgroundColor: 'transparent', marginTop: SPACING.xs },
  ghostButtonText: { ...TYPE.caption, color: COLORS.textSecondary },

  trustNote: {
    ...TYPE.caption,
    fontSize: 10,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: SPACING.base,
    lineHeight: 15,
  },

  // ── Dialog ───────────────────────────────────────────────────────────────
  dialogBackdrop: {
    flex: 1,
    backgroundColor: COLORS.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  dialog: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
    gap: SPACING.xs,
  },
  dialogTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  dialogMessage: { ...TYPE.small, color: COLORS.textSecondary, lineHeight: 19 },
  dialogButton: { ...BUTTON, backgroundColor: COLORS.primaryDark, marginTop: SPACING.sm },
  dialogButtonText: { ...TYPE.caption, color: COLORS.white },
});
