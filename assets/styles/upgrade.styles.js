/**
 * The store: subscriptions and coin packs, on one screen.
 *
 * This used to be two half-designed things stacked — a "coins" card with a
 * balance and a Watch Ad button, then a pair of plan cards — with no statement
 * anywhere of what a coin was for or how many a design took, beyond one grey
 * sentence that had gone out of date. It is now one screen with two ways to pay
 * and a price list, because "which of these should I buy?" is the only question
 * it exists to answer.
 *
 * Rebuilt on the design tokens, so it looks like the rest of the app rather than
 * like a page from a different product: the old version had `#eef7ff` — a cold
 * blue — as the selected-plan fill, in an app whose entire palette is warm sage
 * and clay.
 */

import { StyleSheet } from 'react-native';

import COLORS from '../../constants/colors';
import { LAYOUT, RADIUS, SHADOW, SPACING, TYPE, ms } from '../../constants/theme';

export default StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: {
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxxl,
    gap: SPACING.md,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // ── Hero ────────────────────────────────────────────────────────────────
  hero: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: ms(250),
    padding: SPACING.xl,
    borderRadius: RADIUS.xxl,
    ...SHADOW.lg,
  },
  heroGlow: {
    position: 'absolute',
    width: ms(210),
    height: ms(210),
    borderRadius: RADIUS.pill,
    right: -74,
    top: -82,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: ms(30),
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  heroPillText: { ...TYPE.overline, fontSize: 9.5, color: COLORS.white },
  heroMark: {
    width: ms(42),
    height: ms(42),
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroTitle: { ...TYPE.display, color: COLORS.white, maxWidth: '88%', marginTop: SPACING.lg },
  heroText: {
    ...TYPE.small,
    color: 'rgba(255,255,255,0.78)',
    maxWidth: '92%',
    marginTop: SPACING.sm,
  },
  heroBenefits: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.lg },
  heroBenefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  heroBenefitText: { ...TYPE.caption, fontSize: 9.5, color: COLORS.white },

  // ── Balance ──────────────────────────────────────────────────────────────
  // The one number the person came here about, at the size of a headline, with
  // the price list directly under it so "43 coins" means something.
  balanceCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  balanceIcon: {
    width: ms(46),
    height: ms(46),
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.brand100,
  },
  balanceCopy: { flex: 1, gap: 1 },
  balanceValue: { ...TYPE.h1, color: COLORS.textPrimary },
  balanceLabel: { ...TYPE.small, color: COLORS.textSecondary },

  priceList: {
    marginTop: SPACING.base,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    gap: SPACING.sm,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  priceLabel: { flex: 1, ...TYPE.small, color: COLORS.textSecondary },
  priceValue: { ...TYPE.caption, color: COLORS.textPrimary },

  // ── Earn ─────────────────────────────────────────────────────────────────
  earnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginTop: SPACING.base,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.accentTint,
    borderWidth: 1,
    borderColor: COLORS.accentSoft,
  },
  earnIcon: {
    width: ms(38),
    height: ms(38),
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accentSoft,
  },
  earnCopy: { flex: 1, gap: 1 },
  earnTitle: { ...TYPE.bodyStrong, fontSize: 14, color: COLORS.textPrimary },
  earnText: { ...TYPE.caption, color: COLORS.textSecondary },
  earnButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 1,
    height: ms(38),
    paddingHorizontal: SPACING.base,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accentStrong,
  },
  earnButtonBusy: { backgroundColor: COLORS.accentSoft },
  earnButtonText: { ...TYPE.caption, color: COLORS.white },

  // ── Sections ─────────────────────────────────────────────────────────────
  sectionHead: { marginTop: SPACING.lg, gap: 3 },
  sectionEyebrow: { ...TYPE.overline, color: COLORS.accentStrong },
  sectionTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  sectionHint: { ...TYPE.small, color: COLORS.textSecondary },

  // ── Plans ────────────────────────────────────────────────────────────────
  /**
   * Full-width rows, not two squeezed side-by-side cards.
   *
   * Two plans in a row meant the yearly price, its per-month equivalent and its
   * saving all had to fit in half a phone's width, so the saving became a "Save
   * 80%" badge that was not true of the prices next to it. Down the page there
   * is room to state the actual arithmetic.
   */
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  planCardSelected: {
    borderColor: COLORS.primaryDark,
    backgroundColor: COLORS.primaryTint,
    ...SHADOW.sm,
  },
  plansPanel: {
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    ...SHADOW.sm,
  },
  availablePlanCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
  },
  availablePlanIcon: {
    width: ms(38),
    height: ms(38),
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryTint,
  },
  // A real radio, so which plan is about to be charged for is legible without
  // having to compare two border colours.
  radio: {
    width: ms(22),
    height: ms(22),
    borderRadius: RADIUS.pill,
    borderWidth: 2,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: COLORS.primaryDark },
  radioDot: {
    width: ms(11),
    height: ms(11),
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primaryDark,
  },
  planCopy: { flex: 1, minWidth: 0, gap: 2 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  planTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  planPrice: { ...TYPE.h3, color: COLORS.textPrimary },
  planPriceBlock: { alignItems: 'flex-end', flexShrink: 0 },
  planPeriod: { ...TYPE.caption, fontSize: 9.5, color: COLORS.textTertiary },
  planNote: { ...TYPE.caption, color: COLORS.textSecondary },
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accent,
  },
  badgeText: { ...TYPE.caption, fontSize: 10, color: COLORS.white },

  featureList: { gap: SPACING.sm, marginTop: SPACING.sm },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  featureText: { flex: 1, ...TYPE.small, color: COLORS.textPrimary },

  // ── Coin packs ───────────────────────────────────────────────────────────
  packRow: { flexDirection: 'row', gap: SPACING.sm },
  pack: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: SPACING.base,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  packSelected: { borderColor: COLORS.primaryDark, backgroundColor: COLORS.primaryTint },
  packBadge: {
    position: 'absolute',
    top: -9,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accent,
  },
  packBadgeText: { ...TYPE.caption, fontSize: 9.5, color: COLORS.white },
  packCoins: { ...TYPE.h3, color: COLORS.textPrimary, marginTop: SPACING.xs },
  packUnit: { ...TYPE.caption, color: COLORS.textSecondary },
  packPrice: { ...TYPE.bodyStrong, fontSize: 14, color: COLORS.primaryDark, marginTop: SPACING.xs },
  packSaving: { ...TYPE.caption, fontSize: 10, color: COLORS.success },

  // ── Actions ──────────────────────────────────────────────────────────────
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: ms(54),
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryDark,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    ...SHADOW.brand,
  },
  primaryText: { flex: 1, ...TYPE.bodyStrong, fontSize: 15, color: COLORS.white, textAlign: 'center' },
  primaryDisabled: { backgroundColor: COLORS.surfaceSunken, ...SHADOW.none },
  primaryTextDisabled: { color: COLORS.textTertiary },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    height: ms(48),
    borderRadius: RADIUS.md,
    marginTop: SPACING.xs,
  },
  secondaryText: { ...TYPE.bodyStrong, fontSize: 14, color: COLORS.primaryDark },
  pressed: { opacity: 0.78 },

  trustNote: {
    ...TYPE.caption,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: SPACING.md,
    lineHeight: 16,
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
  },
  activeIcon: {
    width: ms(52),
    height: ms(52),
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  activeCopy: { flex: 1, minWidth: 0 },
  activeTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  activeText: { ...TYPE.caption, color: COLORS.textSecondary, marginTop: 2 },
  activeAction: {
    width: ms(40),
    height: ms(40),
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
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
    maxWidth: LAYOUT.maxContentWidth,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    alignItems: 'center',
    gap: SPACING.sm,
    ...SHADOW.lg,
  },
  dialogTitle: { ...TYPE.h3, color: COLORS.textPrimary, textAlign: 'center' },
  dialogMessage: {
    ...TYPE.small,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  dialogButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    height: ms(48),
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryDark,
    marginTop: SPACING.sm,
  },
  dialogButtonText: { ...TYPE.bodyStrong, color: COLORS.white },
});
