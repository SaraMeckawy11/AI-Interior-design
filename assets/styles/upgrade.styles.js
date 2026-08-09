/**
 * Upgrade to Pro.
 *
 * This is the original screen's design — a subtitle, a coins card, a feature
 * checklist, two plan cards side by side and one pill button — kept as the
 * shape it always was, and rebuilt on the design tokens rather than on the
 * `scale()` / `verticalScale()` helpers and hardcoded `fontSize` / `fontWeight`
 * pairs it used to carry. The layout is the old one on purpose; what changed is
 * everything that was wrong underneath it:
 *
 * * **The selected plan was `#eef7ff`** — a cold blue, in an app whose entire
 *   palette is warm sage and clay. It is now the sage tint, so a chosen plan
 *   looks like it belongs to this product.
 * * **"Best Value" hung off the card at `top: -8, right: -8`.** Anything drawn
 *   outside its parent's bounds is clipped on Android, so on most phones the
 *   badge was cut in half. It sits inside the card now, in a band both cards
 *   reserve so their titles stay on one line.
 * * **Touch targets.** The button was `paddingVertical: 8` — about 30pt tall
 *   against the 44pt minimum. Plan cards had no selected state beyond a border
 *   colour, which is the one cue a colour-blind user cannot rely on, so there
 *   is a real radio in the corner now.
 * * **Type.** Nineteen hardcoded sizes and weights became the shared ramp, so
 *   this screen sets text the same way the rest of the app does.
 */

import { StyleSheet } from 'react-native';

import COLORS from '../../constants/colors';
import { LAYOUT, RADIUS, SHADOW, SPACING, TYPE, ms } from '../../constants/theme';

export default StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxxl,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  subtitle: { ...TYPE.body, color: COLORS.textSecondary, marginBottom: SPACING.xl },

  // ── Coins ────────────────────────────────────────────────────────────────
  // The card the old screen opened with, still a card, but it now says what a
  // coin is actually worth. It used to claim "each design costs 2 coins" in a
  // sentence that had gone out of date — the server charges one.
  coinCard: {
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.xl,
    ...SHADOW.sm,
  },
  coinTopRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  coinBadge: {
    width: ms(44),
    height: ms(44),
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentSoft,
  },
  coinCopy: { flex: 1, minWidth: 0 },
  coinValue: { ...TYPE.h1, color: COLORS.textPrimary },
  coinLabel: { ...TYPE.small, color: COLORS.textSecondary },

  coinPrices: {
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: ms(46),
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accentStrong,
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
  featureList: { marginBottom: SPACING.xl, gap: SPACING.md },
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
  // Warm sage, not the cold `#eef7ff` this used to be.
  planCardSelected: {
    borderColor: COLORS.primaryDark,
    backgroundColor: COLORS.primaryTint,
    ...SHADOW.sm,
  },
  // Reserved on both cards, filled on one, so the two titles align.
  planBadge: {
    alignSelf: 'stretch',
    height: ms(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  planBadgeOn: { backgroundColor: COLORS.accent },
  planBadgeText: { ...TYPE.overline, color: COLORS.white },
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
  // The old pill, at a size a thumb can actually hit: `paddingVertical: 8` put
  // it around 30pt tall against the 44pt minimum.
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
  // where the plan button is filled. Two identical dark pills on one screen
  // would leave nothing saying which one the screen wants pressed.
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
