/**
 * Upgrade to Pro.
 *
 * The screen's earliest design: a big in-page title rather than a header bar, a
 * centred coins card, a feature checklist, two plan cards side by side and a
 * pill button — with the violet that used to mark the premium plan.
 *
 * Rebuilt on the design tokens rather than restored byte for byte, because the
 * original carried defects that had nothing to do with how it looked:
 *
 * * **`#A084E8` under white text is about 2.4:1** — below every WCAG threshold,
 *   so "Best Value" was decoration a good number of people could not read. The
 *   violet is kept as the screen's premium accent, but the badge is a tint with
 *   dark violet text (7.4:1) instead of white on the mid tone.
 * * **The selected plan filled with `#eef7ff`**, a cold blue, in an app whose
 *   palette is warm sage and clay. Selection is the sage tint now — the same
 *   colour selection uses everywhere else in the app.
 * * **"Best Value" sat at `top: -8, right: -8`**, outside the card's bounds,
 *   which Android clips. It is a band inside the card, reserved on both cards
 *   so their titles stay level.
 * * **The button was `paddingVertical: 8`** — roughly 30pt against the 44pt
 *   minimum — and plan selection was signalled by border colour alone, the one
 *   cue a colour-blind user cannot rely on. Hence the radio in each card.
 * * Nineteen hardcoded `fontSize`/`fontWeight` pairs became the shared ramp.
 */

import { StyleSheet } from 'react-native';

import COLORS from '../../constants/colors';
import { LAYOUT, RADIUS, SHADOW, SPACING, TYPE, ms } from '../../constants/theme';

/**
 * The screen's premium accent, from the original design.
 *
 * `base` is the `#A084E8` this screen always used. `strong` is the same hue
 * taken dark enough to carry text on paper (7.4:1) and white on itself, since
 * the mid tone cannot do either.
 */
const VIOLET = {
  soft: '#EFE9FA',
  base: '#A084E8',
  strong: '#563B9C',
};

export default StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // ── Title ────────────────────────────────────────────────────────────────
  // The title is on the page, not in a bar, which is how this screen used to
  // read. The back button is the one thing kept from the header: without it
  // leaving a paid screen depends on knowing the platform gesture, which on
  // Android with gesture navigation is a guess.
  back: {
    width: ms(40),
    height: ms(40),
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  title: { ...TYPE.display, color: COLORS.textPrimary },
  subtitle: {
    ...TYPE.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },

  // ── Coins ────────────────────────────────────────────────────────────────
  // Centred, as it was: the balance, what a coin is worth, and the way to earn
  // one. The old card claimed "each design costs 2 coins" in a sentence nothing
  // kept in step with the server, which charges one — these come from the
  // shared price table instead.
  coinCard: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.xxl,
    ...SHADOW.sm,
  },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  coinValue: { ...TYPE.h1, color: COLORS.primaryDark },
  coinSubtitle: {
    ...TYPE.small,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },

  coinPrices: {
    alignSelf: 'stretch',
    marginTop: SPACING.base,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    gap: SPACING.sm,
  },
  coinPriceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  coinPriceLabel: { flex: 1, ...TYPE.small, color: COLORS.textSecondary },
  coinPriceValue: { ...TYPE.caption, color: COLORS.textPrimary },

  watchAdButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: ms(46),
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primaryDark,
    marginTop: SPACING.base,
  },
  watchAdButtonBusy: { backgroundColor: COLORS.surfaceSunken },
  watchAdButtonText: { ...TYPE.bodyStrong, color: COLORS.white },
  adStatusText: {
    ...TYPE.caption,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

  // ── Features ─────────────────────────────────────────────────────────────
  featureList: { marginBottom: SPACING.xxl, gap: SPACING.md },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  featureText: { flex: 1, ...TYPE.body, color: COLORS.textPrimary },

  // ── Plans, side by side ──────────────────────────────────────────────────
  planLabel: { ...TYPE.h3, color: COLORS.textPrimary, marginBottom: SPACING.md },
  planOptions: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.lg },
  planCard: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingBottom: SPACING.base,
  },
  planCardSelected: {
    borderColor: COLORS.primaryDark,
    backgroundColor: COLORS.primaryTint,
    ...SHADOW.sm,
  },
  planBadge: {
    alignSelf: 'stretch',
    height: ms(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  planBadgeOn: { backgroundColor: VIOLET.soft },
  planBadgeText: { ...TYPE.overline, color: VIOLET.strong },
  planBody: { alignItems: 'center', paddingTop: SPACING.base, paddingHorizontal: SPACING.sm },
  radio: {
    width: ms(20),
    height: ms(20),
    borderRadius: RADIUS.pill,
    borderWidth: 2,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  radioOn: { borderColor: COLORS.primaryDark },
  radioDot: {
    width: ms(10),
    height: ms(10),
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primaryDark,
  },
  planTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  planPrice: { ...TYPE.h3, color: COLORS.textPrimary, marginTop: 2 },
  planPeriod: { ...TYPE.caption, color: COLORS.textTertiary },
  planSavings: { ...TYPE.caption, color: VIOLET.strong, marginTop: SPACING.sm },
  planSavingsPlaceholder: { height: ms(16), marginTop: SPACING.sm },

  // ── Coin packs ───────────────────────────────────────────────────────────
  packRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  pack: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingBottom: SPACING.md,
  },
  packSelected: { borderColor: COLORS.primaryDark, backgroundColor: COLORS.primaryTint },
  packBadge: {
    alignSelf: 'stretch',
    height: ms(18),
    alignItems: 'center',
    justifyContent: 'center',
  },
  packBadgeOn: { backgroundColor: VIOLET.soft },
  packBadgeText: { ...TYPE.overline, color: VIOLET.strong },
  packBody: { alignItems: 'center', paddingTop: SPACING.md, paddingHorizontal: SPACING.xs },
  packCoins: { ...TYPE.h2, color: COLORS.textPrimary },
  packUnit: { ...TYPE.caption, color: COLORS.textSecondary },
  packPrice: { ...TYPE.bodyStrong, color: COLORS.textPrimary, marginTop: SPACING.sm },
  packSaving: { ...TYPE.caption, color: VIOLET.strong },
  packSavingPlaceholder: { height: ms(16) },

  // ── Buttons ──────────────────────────────────────────────────────────────
  upgradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: ms(52),
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primaryDark,
  },
  upgradeButtonDisabled: { backgroundColor: COLORS.surfaceSunken },
  upgradeButtonText: { ...TYPE.bodyStrong, color: COLORS.white },
  upgradeButtonTextDisabled: { color: COLORS.textTertiary },

  // Coins are the alternative, not a second headline act, so this is outlined
  // where the plan button is filled. Two identical dark pills would leave
  // nothing saying which one the screen wants pressed.
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: ms(52),
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    borderColor: COLORS.primaryDark,
    backgroundColor: 'transparent',
  },
  secondaryButtonText: { ...TYPE.bodyStrong, color: COLORS.primaryDark },

  pressed: { opacity: 0.82 },

  sectionGap: { marginTop: SPACING.xxl },
  trustNote: {
    ...TYPE.caption,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: SPACING.base,
    lineHeight: 17,
  },

  // ── Subscriber state ─────────────────────────────────────────────────────
  activeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.successSoft,
    borderWidth: 1,
    borderColor: COLORS.brand200,
    marginBottom: SPACING.xl,
  },
  activeCopy: { flex: 1, minWidth: 0, gap: 2 },
  activeTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  activeText: { ...TYPE.caption, color: COLORS.textSecondary },

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
    maxWidth: LAYOUT.maxContentWidth,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    gap: SPACING.sm,
    ...SHADOW.lg,
  },
  dialogTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  dialogMessage: { ...TYPE.small, color: COLORS.textSecondary, lineHeight: 20 },
  dialogButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: ms(48),
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primaryDark,
    marginTop: SPACING.sm,
  },
  dialogButtonText: { ...TYPE.bodyStrong, color: COLORS.white },
});
