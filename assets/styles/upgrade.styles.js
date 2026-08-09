/**
 * The store: subscriptions and coin packs, on one screen.
 *
 * Two rules hold this screen together, and both exist because the last version
 * broke them:
 *
 * 1. **Only interactive things get a surface.** A border or a fill means "you
 *    can press this". Benefits, the balance and the price list are statements,
 *    so they sit directly on the page. The previous pass wrapped every one of
 *    them in its own bordered, shadowed, tinted card, which left eight competing
 *    rectangles on a screen that asks one question.
 *
 * 2. **Sage is selection and action; clay is coins.** Nothing else gets a tint.
 *    Before this, `brand100` icon chips, an `accentTint` panel, a `successSoft`
 *    banner and an `accent` badge all appeared within one scroll, none of them
 *    meaning anything by being that colour.
 *
 * Type comes from the ramp in `constants/theme` with no per-style `fontSize`
 * overrides. The old file had nine of them — 9, 9.5, 10, 10.5, 12.5, 14, 15 —
 * which is what made the screen read as unsettled rather than as designed.
 */

import { StyleSheet } from 'react-native';

import COLORS from '../../constants/colors';
import { LAYOUT, RADIUS, SHADOW, SPACING, TYPE, ms } from '../../constants/theme';

/** The one selectable surface: a plan row or a coin tile, unselected. */
const SELECTABLE = {
  borderRadius: RADIUS.lg,
  backgroundColor: COLORS.surface,
  borderWidth: 1.5,
  borderColor: COLORS.border,
};

/** And selected. Sage, everywhere, because "chosen" is one idea. */
const SELECTED = {
  borderColor: COLORS.primaryDark,
  backgroundColor: COLORS.primaryTint,
};

export default StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  // Explicit, because the action bar below is a second flex child: without it
  // the scroll view sizes to its content and pushes the bar off screen.
  scroll: { flex: 1 },
  container: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },

  // ── Loading ──────────────────────────────────────────────────────────────
  skeletonHero: {
    height: ms(140),
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surfaceSunken,
  },
  skeletonBar: {
    height: ms(48),
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceSunken,
  },
  skeletonRow: {
    height: ms(76),
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surfaceSunken,
  },

  // ── Hero ─────────────────────────────────────────────────────────────────
  // A gradient, a label, a sentence. The floating glow blob and the boxed
  // diamond glyph were ornament on a screen already carrying too much.
  hero: {
    padding: SPACING.lg,
    borderRadius: RADIUS.xl,
    gap: SPACING.sm,
  },
  heroPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    paddingVertical: 5,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroPillText: { ...TYPE.overline, color: COLORS.white },
  heroTitle: { ...TYPE.h2, color: COLORS.white },
  heroText: { ...TYPE.small, color: 'rgba(255,255,255,0.78)' },

  // ── Segmented control ────────────────────────────────────────────────────
  // Shown to everyone. Hiding coins from subscribers meant a Pro member who
  // wanted to top up before cancelling had nowhere on the screen to do it.
  segment: {
    flexDirection: 'row',
    gap: SPACING.xs,
    padding: SPACING.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceSunken,
  },
  segmentTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: ms(40),
    borderRadius: RADIUS.pill,
  },
  segmentTabOn: { backgroundColor: COLORS.surface, ...SHADOW.xs },
  segmentText: { ...TYPE.caption, color: COLORS.textSecondary },
  segmentTextOn: { color: COLORS.textPrimary },

  // ── Sections ─────────────────────────────────────────────────────────────
  panel: { gap: SPACING.lg },
  sectionTitle: { ...TYPE.h3, color: COLORS.textPrimary },
  sectionHint: { ...TYPE.small, color: COLORS.textSecondary, marginTop: 2 },

  // ── Statements: no card, no border, no fill ──────────────────────────────
  benefitList: { gap: SPACING.md },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  benefitText: { flex: 1, ...TYPE.body, color: COLORS.textPrimary },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  statusText: { flex: 1, ...TYPE.body, color: COLORS.textPrimary },

  balanceValue: { ...TYPE.display, color: COLORS.textPrimary },
  balanceLabel: { ...TYPE.small, color: COLORS.textSecondary, marginTop: -2 },

  // What a coin buys. Without it the balance is a number with no unit.
  priceList: {
    marginTop: SPACING.base,
    paddingTop: SPACING.base,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    gap: SPACING.md,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  priceLabel: { flex: 1, ...TYPE.small, color: COLORS.textSecondary },
  priceValue: { ...TYPE.caption, color: COLORS.textPrimary },

  note: { ...TYPE.caption, color: COLORS.textTertiary, lineHeight: 17 },

  // ── Plans ────────────────────────────────────────────────────────────────
  planCard: {
    ...SELECTABLE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.base,
  },
  planCardSelected: SELECTED,
  // Read-only variant for a subscriber: same geometry, no affordance.
  planCardStatic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
  },
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
  planCopy: { flex: 1, minWidth: 0, gap: 3 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  planTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  planNote: { ...TYPE.caption, color: COLORS.textSecondary },
  planPriceBlock: { alignItems: 'flex-end', flexShrink: 0 },
  planPrice: { ...TYPE.h3, color: COLORS.textPrimary },
  planPeriod: { ...TYPE.caption, color: COLORS.textTertiary },

  // Tinted, not filled. A saturated pill on every second row was half the noise.
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.brand100,
  },
  badgeText: { ...TYPE.overline, color: COLORS.brand700 },

  // ── Coin packs ───────────────────────────────────────────────────────────
  // The badge is a band inside the tile. The old one was an absolutely
  // positioned pill sized to "Most popular" — wider than the third-of-a-phone
  // tile it hung off, and clipped on Android for sitting outside its parent.
  packRow: { flexDirection: 'row', gap: SPACING.sm },
  pack: {
    ...SELECTABLE,
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    paddingBottom: SPACING.base,
  },
  packSelected: SELECTED,
  // Present on every tile, badge or not, so all three read off one baseline.
  packBadge: {
    alignSelf: 'stretch',
    height: ms(18),
    alignItems: 'center',
    justifyContent: 'center',
  },
  packBadgeOn: { backgroundColor: COLORS.accentSoft },
  packBadgeText: { ...TYPE.overline, color: COLORS.accentStrong },
  packBody: { alignItems: 'center', paddingHorizontal: SPACING.xs, paddingTop: SPACING.base },
  packCoins: { ...TYPE.h2, color: COLORS.textPrimary },
  packUnit: { ...TYPE.caption, color: COLORS.textSecondary },
  packPrice: { ...TYPE.bodyStrong, color: COLORS.textPrimary, marginTop: SPACING.sm },
  packSaving: { ...TYPE.caption, color: COLORS.success },
  // Holds the line the saving would occupy on the tile that has none, so the
  // three stay the same height without a hidden string a screen reader reads.
  packSavingPlaceholder: { height: ms(16) },

  // ── Earn ─────────────────────────────────────────────────────────────────
  // Interactive, so it gets a surface — but an outline rather than the clay
  // wash it used to have, because it is the cheapest option, not the loudest.
  earnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  earnCopy: { flex: 1, minWidth: 0, gap: 1 },
  earnTitle: { ...TYPE.bodyStrong, color: COLORS.textPrimary },
  earnText: { ...TYPE.caption, color: COLORS.textSecondary },
  earnButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: ms(76),
    height: ms(38),
    paddingHorizontal: SPACING.base,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accentStrong,
  },
  earnButtonBusy: { backgroundColor: COLORS.surfaceSunken },
  earnButtonText: { ...TYPE.caption, color: COLORS.white },

  // ── Docked action bar ────────────────────────────────────────────────────
  // The price you are about to pay and the one button that pays it, pinned
  // where a thumb already is. Two identically styled full-width buttons in the
  // scroll — "Subscribe" and "Buy 30 coins" — was the original screen's worst
  // problem: nothing on it said which one it wanted you to press.
  footer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  footerSummary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  footerLabel: { flexShrink: 1, ...TYPE.small, color: COLORS.textSecondary },
  footerValue: { ...TYPE.h3, color: COLORS.textPrimary },
  footerNote: { ...TYPE.caption, color: COLORS.textTertiary, textAlign: 'center' },

  // ── Actions ──────────────────────────────────────────────────────────────
  // No `flex: 1` on the label. With a leading icon and no trailing one it made
  // the text centre itself in the leftover space, which read as off-centre.
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: ms(54),
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryDark,
  },
  primaryText: { ...TYPE.bodyStrong, color: COLORS.white },
  primaryDisabled: { backgroundColor: COLORS.surfaceSunken },
  primaryTextDisabled: { color: COLORS.textTertiary },
  pressed: { opacity: 0.82 },

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
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryDark,
    marginTop: SPACING.sm,
  },
  dialogButtonText: { ...TYPE.bodyStrong, color: COLORS.white },
});
