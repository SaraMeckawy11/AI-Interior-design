import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import styles from '../../assets/styles/upgradeV2.styles';
import COLORS from '../../constants/colors';
import {
  AD_COIN_REWARD,
  PRO_RENDER_LIMIT_PER_DAY,
  YEARLY_SAVING_PERCENT,
  coinLabel,
  packSaving,
} from '../../constants/pricing';

const PRO_FEATURES = [
  { icon: 'sparkles-outline', label: `${PRO_RENDER_LIMIT_PER_DAY} renders / day` },
  { icon: 'cube-outline', label: '3D walkthroughs' },
  { icon: 'eye-off-outline', label: 'Ad-free' },
];

const COIN_FEATURES = [
  { icon: 'time-outline', label: 'Never expires' },
  { icon: 'sparkles-outline', label: '1 coin per render' },
  { icon: 'shield-checkmark-outline', label: 'No commitment' },
];

export default function UpgradeExperience({
  activePack,
  activePlan,
  adMessage,
  adStatus,
  busy,
  buyingPlan,
  coins,
  dialog,
  insets,
  isSelected,
  isSubscribed,
  loading,
  onBack,
  onCloseDialog,
  onManageSubscription,
  onOpenPrivacy,
  onOpenTerms,
  onPurchase,
  onRestorePurchases,
  packs,
  plans,
  priceFor,
  selectPurchaseType,
  setSelection,
  watchAd,
}) {
  const heroContent = buyingPlan
    ? {
        eyebrow: 'THE COMPLETE EXPERIENCE',
        title: isSubscribed ? 'Everything is unlocked' : 'Bring every idea to life',
        subtitle: isSubscribed
          ? 'Your full creative toolkit is ready.'
          : 'Design, refine, and explore without counting renders.',
        features: PRO_FEATURES,
      }
    : {
        eyebrow: 'FLEXIBLE CREDITS',
        title: 'Create on your terms',
        subtitle: 'Buy only what you need, or earn more by watching an ad.',
        features: COIN_FEATURES,
      };

  const backButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      onPress={onBack}
    >
      <Ionicons name="chevron-back" size={21} color={COLORS.textPrimary} />
    </Pressable>
  );

  if (loading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.container, styles.loadingContainer]}>
          <View style={styles.topBar}>
            {backButton}
            <Text style={styles.topBarTitle}>Livinai Pro</Text>
            <View style={styles.topBarSpacer} />
          </View>
          <View style={styles.centered}>
            <ActivityIndicator color={COLORS.primaryDark} size="large" />
            <Text style={styles.loadingText}>Loading your options…</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.topBar}>
          {backButton}
          <Text style={styles.topBarTitle}>Livinai Pro</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <LinearGradient
          colors={[COLORS.surface, COLORS.brand100]}
          start={{ x: 0.08, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroOrb} />
          {/* The eyebrow and the Active tag, and nothing else. A gradient tile
              holding a diamond (or, on the coin tab, a plain filled circle) sat
              in front of the eyebrow saying only "this is the paid screen" —
              which the title, the tabs and the price footer all say already. */}
          <View style={styles.heroMetaRow}>
            <View style={styles.heroEyebrow}>
              <Ionicons name="sparkles" size={12} color={COLORS.primaryDark} />
              <Text style={styles.heroEyebrowText}>{heroContent.eyebrow}</Text>
            </View>
            {buyingPlan && isSubscribed ? (
              <View style={styles.activeTag} accessibilityRole="text">
                <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                <Text style={styles.activeTagText}>Active</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.heroTitle}>{heroContent.title}</Text>
          <Text style={styles.heroSubtitle}>{heroContent.subtitle}</Text>
          <View style={styles.featureStrip} accessibilityRole="list">
            {heroContent.features.map((feature) => (
              <View key={feature.label} style={styles.featureItem} accessibilityRole="text">
                <View style={styles.featureIcon}>
                  <Ionicons
                    name={feature.icon}
                    size={13}
                    color={COLORS.primaryDark}
                  />
                </View>
                <Text style={styles.featureText}>{feature.label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <View style={styles.purchaseToggle} accessibilityRole="tablist">
          <PurchaseTab
            active={buyingPlan}
            label="Livinai Pro"
            onPress={() => selectPurchaseType('plan')}
          />
          <PurchaseTab
            active={!buyingPlan}
            label="Pay as you go"
            onPress={() => selectPurchaseType('pack')}
          />
        </View>

        {buyingPlan ? (
          <PlanOptions
            isSelected={isSelected}
            isSubscribed={isSubscribed}
            plans={plans}
            priceFor={priceFor}
            setSelection={setSelection}
            onManageSubscription={onManageSubscription}
            onRestorePurchases={onRestorePurchases}
            restoring={busy === 'restore'}
          />
        ) : (
          <CoinOptions
            adMessage={adMessage}
            adStatus={adStatus}
            coins={coins}
            isSelected={isSelected}
            packs={packs}
            priceFor={priceFor}
            setSelection={setSelection}
            watchAd={watchAd}
          />
        )}
      </ScrollView>

      <PurchaseFooter
        activePack={activePack}
        activePlan={activePlan}
        busy={busy}
        buyingPlan={buyingPlan}
        insets={insets}
        isSubscribed={isSubscribed}
        onOpenPrivacy={onOpenPrivacy}
        onOpenTerms={onOpenTerms}
        onPress={onPurchase}
        priceFor={priceFor}
      />

      <Modal
        visible={!!dialog}
        transparent
        animationType="fade"
        onRequestClose={onCloseDialog}
      >
        <TouchableWithoutFeedback onPress={onCloseDialog}>
          <View style={styles.dialogBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.dialog}>
                <View style={styles.dialogIcon}>
                  <Ionicons name="information-circle-outline" size={24} color={COLORS.primaryDark} />
                </View>
                <Text style={styles.dialogTitle}>{dialog?.title}</Text>
                <Text style={styles.dialogMessage}>{dialog?.message}</Text>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.dialogButton, pressed && styles.pressed]}
                  onPress={onCloseDialog}
                >
                  <Text style={styles.dialogButtonText}>Got it</Text>
                </Pressable>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

function PurchaseTab({ active, label, onPress }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.purchaseToggleItem,
        active && styles.purchaseToggleItemActive,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.purchaseToggleText,
          active && styles.purchaseToggleTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PlanOptions({
  isSelected,
  isSubscribed,
  plans,
  priceFor,
  setSelection,
  onManageSubscription,
  onRestorePurchases,
  restoring,
}) {
  return (
    <>
      <View style={styles.sectionHeadingRow}>
        <Text style={styles.sectionLabel}>
          {isSubscribed ? 'Switch billing cycle' : 'Choose billing cycle'}
        </Text>
      </View>

      <View style={styles.optionList} accessibilityRole="radiogroup">
        {plans.map((plan, index) => {
          const selected = isSelected('plan', plan.id);
          const price = priceFor(plan, plan.storePackage);
          return (
            <PurchaseOptionCard
              key={plan.id}
              accessibilityLabel={`${plan.title} plan, ${price} per ${plan.period}`}
              badge={plan.badge ? 'Best value' : null}
              description={
                plan.id === 'yearly'
                  ? `Save ${YEARLY_SAVING_PERCENT}% compared with monthly`
                  : 'Flexible access, billed every month'
              }
              period={`per ${plan.period}`}
              price={price}
              selected={selected}
              title={plan.title}
              showDivider={index < plans.length - 1}
              onPress={() => setSelection({ kind: 'plan', id: plan.id })}
            />
          );
        })}
      </View>

      {isSubscribed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage your subscription"
          style={({ pressed }) => [styles.manageButton, pressed && styles.pressed]}
          onPress={onManageSubscription}
        >
          <Text style={styles.manageButtonText}>Manage subscription</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Restore previous purchases"
        accessibilityState={{ busy: restoring, disabled: restoring }}
        disabled={restoring}
        style={({ pressed }) => [styles.manageButton, pressed && styles.pressed]}
        onPress={onRestorePurchases}
      >
        {restoring ? (
          <ActivityIndicator size="small" color={COLORS.textSecondary} />
        ) : (
          <Ionicons name="refresh-outline" size={16} color={COLORS.textSecondary} />
        )}
        <Text style={styles.manageButtonText}>
          {restoring ? 'Restoring purchases…' : 'Restore purchases'}
        </Text>
      </Pressable>
    </>
  );
}

function CoinOptions({ adMessage, adStatus, coins, isSelected, packs, priceFor, setSelection, watchAd }) {
  return (
    <>
      <View style={styles.balanceCard}>
        <View style={styles.balanceCopy}>
          <Text style={styles.balanceLabel}>Balance</Text>
          <Text style={styles.balanceValue}>{coinLabel(coins)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Watch an ad to earn ${coinLabel(AD_COIN_REWARD)}`}
          accessibilityState={{ busy: adStatus === 'showing', disabled: adStatus === 'showing' }}
          style={({ pressed }) => [styles.watchAdButton, pressed && styles.pressed]}
          disabled={adStatus === 'showing'}
          onPress={watchAd}
        >
          {adStatus === 'showing' ? (
            <ActivityIndicator size="small" color={COLORS.accentStrong} />
          ) : (
            <>
              <Ionicons name="play" size={13} color={COLORS.accentStrong} />
              <Text style={styles.watchAdButtonText}>Earn +{AD_COIN_REWARD}</Text>
            </>
          )}
        </Pressable>
      </View>
      {adMessage ? <Text style={styles.adStatusText}>{adMessage}</Text> : null}

      <View style={styles.sectionHeadingRow}>
        <Text style={styles.sectionLabel}>Choose a coin pack</Text>
      </View>

      <View style={styles.optionList} accessibilityRole="radiogroup">
        {packs.map((pack, index) => {
          const selected = isSelected('pack', pack.id);
          const saving = packSaving(pack);
          return (
            <PurchaseOptionCard
              key={pack.id}
              accessibilityLabel={`${pack.coins} coins for ${priceFor(pack, pack.storePackage)}`}
              badge={pack.badge}
              description={
                saving > 0 ? `Save ${saving}% per creation` : 'A simple starter pack'
              }
              period="one time"
              price={priceFor(pack, pack.storePackage)}
              selected={selected}
              title={coinLabel(pack.coins)}
              showDivider={index < packs.length - 1}
              onPress={() => setSelection({ kind: 'pack', id: pack.id })}
            />
          );
        })}
      </View>
    </>
  );
}

function PurchaseOptionCard({
  accessibilityLabel,
  badge,
  description,
  onPress,
  period,
  price,
  selected,
  showDivider,
  title,
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: 'rgba(30,36,31,0.06)' }}
      style={({ pressed }) => [
        styles.optionCard,
        showDivider && styles.optionCardDivider,
        selected && styles.optionCardSelected,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Radio selected={selected} />
      <View style={styles.optionCopy}>
        <View style={styles.optionTitleRow}>
          <Text style={styles.optionTitle}>{title}</Text>
          {badge ? (
            <View style={styles.optionBadge}>
              <Text style={styles.optionBadgeText}>
                {badge.toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.optionDescription} numberOfLines={1}>{description}</Text>
      </View>
      <View style={styles.optionPriceWrap}>
        <Text
          style={styles.optionPrice}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.76}
        >
          {price}
        </Text>
        {period ? <Text style={styles.optionPeriod}>{period}</Text> : null}
      </View>
    </Pressable>
  );
}

function Radio({ selected }) {
  return (
    <View style={[styles.radio, selected && styles.radioOn]}>
      {selected ? <Ionicons name="checkmark" size={13} color={COLORS.white} /> : null}
    </View>
  );
}

function PurchaseFooter({
  activePack,
  activePlan,
  busy,
  buyingPlan,
  insets,
  isSubscribed,
  onOpenPrivacy,
  onOpenTerms,
  onPress,
  priceFor,
}) {
  const price = buyingPlan
    ? priceFor(activePlan, activePlan?.storePackage)
    : priceFor(activePack, activePack?.storePackage);
  const unavailable = price === 'Unavailable';
  const disabled = !!busy || unavailable;
  const actionLabel = buyingPlan
    ? `${isSubscribed ? 'Switch to' : 'Start'} ${activePlan?.title}`
    : `Buy ${activePack?.coins ?? 0} coins`;
  return (
    <View style={[styles.purchaseFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.footerInner}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            buyingPlan
              ? `${isSubscribed ? 'Change to' : 'Subscribe to'} the ${activePlan?.title} plan`
              : `Buy ${activePack?.coins} coins`
          }
          accessibilityState={{ busy: !!busy, disabled }}
          android_ripple={busy ? undefined : { color: 'rgba(255,255,255,0.20)' }}
          style={({ pressed }) => [
            styles.primaryButton,
            disabled && styles.primaryButtonDisabled,
            pressed && !disabled && styles.primaryButtonPressed,
          ]}
          disabled={disabled}
          onPress={onPress}
        >
          <LinearGradient
            colors={disabled ? [COLORS.surfaceSunken, COLORS.surfaceSunken] : COLORS.gradientBrandDeep}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.primaryButtonFill}
          >
            {busy ? (
              <ActivityIndicator size="small" color={COLORS.textTertiary} />
            ) : unavailable ? (
              <Text style={styles.primaryButtonTextDisabled}>Store unavailable</Text>
            ) : (
              <>
                <Text
                  style={styles.primaryButtonText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {actionLabel}
                </Text>
                <View style={styles.primaryButtonPriceWrap}>
                  <Text style={styles.primaryButtonPrice}>{price}</Text>
                </View>
              </>
            )}
          </LinearGradient>
        </Pressable>
        <Text
          style={styles.footerNote}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.86}
        >
          {buyingPlan
            ? `Auto-renews until canceled · Up to ${PRO_RENDER_LIMIT_PER_DAY} renders per day`
            : 'One-time purchase · Coins never expire'}
        </Text>
        {buyingPlan ? (
          <View style={styles.legalLinks}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open Terms of Use"
              accessibilityHint="Opens the terms that apply to this subscription"
              hitSlop={6}
              style={({ pressed }) => [styles.legalLink, pressed && styles.pressed]}
              onPress={onOpenTerms}
            >
              <Text style={styles.legalLinkText}>Terms of Use</Text>
            </Pressable>
            <View style={styles.legalDot} />
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open Privacy Policy"
              accessibilityHint="Opens Livinai's privacy policy"
              hitSlop={6}
              style={({ pressed }) => [styles.legalLink, pressed && styles.pressed]}
              onPress={onOpenPrivacy}
            >
              <Text style={styles.legalLinkText}>Privacy Policy</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
