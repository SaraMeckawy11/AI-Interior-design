/**
 * Upgrade to Pro.
 *
 * The layout is the one this screen has had since coins arrived — title, copy,
 * the coins card, a feature checklist, "Choose a plan:", two plan cards side by
 * side, a pill button and "Cancel anytime" — with the coin packs added back
 * underneath in the same visual language.
 *
 * Built on the design tokens, and the `#A084E8` violet is gone: the app's
 * accent is clay, and a lilac that appears on no other screen read as borrowed
 * from a different product. Clay carries the badge and the saving now.
 *
 * The defects the original layout carried, and what replaced them:
 *
 * * `bestValueBadge` sat at `top: -8, right: -8` — outside the card's bounds,
 *   which Android clips, so on most phones the badge was cut in half. It is a
 *   band inside the card, reserved on both cards so their titles stay level.
 * * `planCardSelected` filled with `#eef7ff`, a cold blue, in an app whose
 *   palette is warm sage and clay. Selection is the sage tint.
 * * Selection was signalled by border colour alone — the one cue a colour-blind
 *   user cannot rely on. Each card carries a radio.
 * * `upgradeButton` was `paddingVertical: 8`, roughly 30pt tall against the
 *   44pt minimum. Buttons are 52pt.
 * * Nineteen hardcoded `fontSize`/`fontWeight` pairs became the shared ramp, so
 *   this screen sets text the way the rest of the app does.
 */

import { StyleSheet } from 'react-native';

import COLORS from '../../constants/colors';
import { RADIUS, SHADOW, SPACING, TYPE, ms } from '../../constants/theme';

export default StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxxl,
    backgroundColor: COLORS.background,
    flexGrow: 1,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  title: { ...TYPE.h1, color: COLORS.textPrimary },
  subtitle: {
    ...TYPE.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xl,
  },

  // ── Coins ────────────────────────────────────────────────────────────────
  coinContainer: {
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

  // What a coin actually buys. The card used to state a balance with no unit
  // attached to it, and the one sentence that did say ("each design costs 2
  // coins") had gone out of date — the server charges one.
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
  // Reserved on both cards, filled on one, so the two titles sit on one line.
  bestValueBadge: {
    alignSelf: 'stretch',
    height: ms(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  bestValueBadgeOn: { backgroundColor: COLORS.accent },
  bestValueText: { ...TYPE.overline, color: COLORS.white },
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
  planSavings: { ...TYPE.caption, color: COLORS.accentStrong, marginTop: SPACING.sm },
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
  packBadgeOn: { backgroundColor: COLORS.accentSoft },
  packBadgeText: { ...TYPE.overline, color: COLORS.accentStrong },
  packBody: { alignItems: 'center', paddingTop: SPACING.md, paddingHorizontal: SPACING.xs },
  packCoins: { ...TYPE.h2, color: COLORS.textPrimary },
  packUnit: { ...TYPE.caption, color: COLORS.textSecondary },
  packPrice: { ...TYPE.bodyStrong, color: COLORS.textPrimary, marginTop: SPACING.sm },
  packSaving: { ...TYPE.caption, color: COLORS.accentStrong },
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

  // Outlined where the plan button is filled: coins are the alternative, not a
  // second headline act, and two identical dark pills would leave nothing
  // saying which one the screen wants pressed.
  buyCoinsButton: {
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
  buyCoinsButtonText: { ...TYPE.bodyStrong, color: COLORS.primaryDark },

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
