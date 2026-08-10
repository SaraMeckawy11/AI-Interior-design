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
  COIN_COST,
  YEARLY_SAVING_PERCENT,
  coinLabel,
  packSaving,
} from '../../constants/pricing';

const PRO_FEATURES = [
  { icon: 'color-palette-outline', label: 'Unlimited designs' },
  { icon: 'cube-outline', label: '3D walkthroughs' },
  { icon: 'eye-off-outline', label: 'Ad-free creating' },
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
  onPurchase,
  packs,
  plans,
  priceFor,
  selectPurchaseType,
  setSelection,
  watchAd,
}) {
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
            <Text style={styles.topBarTitle}>Upgrade</Text>
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
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.topBar}>
          {backButton}
          <Text style={styles.topBarTitle}>Upgrade</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <LinearGradient
          colors={COLORS.gradientBrandDeep}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroGlowOne} />
          <View style={styles.heroGlowTwo} />
          <View style={styles.heroEyebrow}>
            <Ionicons name="sparkles" size={13} color={COLORS.accentSoft} />
            <Text style={styles.heroEyebrowText}>LIVINAI PRO</Text>
          </View>
          <Text style={styles.heroTitle}>
            {isSubscribed ? 'Your creativity is unlimited' : 'Design without limits'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {isSubscribed
              ? 'Your Pro membership is active and every premium tool is ready.'
              : 'Create every room, exterior, and walkthrough you can imagine.'}
          </Text>
          <View style={styles.featureStrip} accessibilityRole="list">
            {PRO_FEATURES.map((feature) => (
              <View key={feature.label} style={styles.featureItem} accessibilityRole="text">
                <View style={styles.featureIconWrap}>
                  <Ionicons
                    name={feature.icon}
                    size={16}
                    color={COLORS.onSurfaceInverse}
                    importantForAccessibility="no"
                  />
                </View>
                <Text style={styles.featureText}>{feature.label}</Text>
              </View>
            ))}
          </View>
          {isSubscribed ? (
            <View style={styles.activeTag} accessibilityRole="text">
              <Ionicons name="checkmark-circle" size={14} color={COLORS.successSoft} />
              <Text style={styles.activeTagText}>Pro is active</Text>
            </View>
          ) : null}
        </LinearGradient>

        <View style={styles.purchaseToggle} accessibilityRole="tablist">
          <PurchaseTab
            active={buyingPlan}
            icon="diamond-outline"
            label="Pro membership"
            onPress={() => selectPurchaseType('plan')}
          />
          <PurchaseTab
            active={!buyingPlan}
            coin
            icon="ellipse-outline"
            label="Coin packs"
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

function PurchaseTab({ active, coin = false, icon, label, onPress }) {
  const activeColor = coin ? COLORS.accentStrong : COLORS.primaryDark;
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
      <Ionicons name={icon} size={16} color={active ? activeColor : COLORS.textSecondary} />
      <Text
        style={[
          styles.purchaseToggleText,
          active && (coin ? styles.purchaseToggleTextCoinActive : styles.purchaseToggleTextActive),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PlanOptions({ isSelected, isSubscribed, plans, priceFor, setSelection, onManageSubscription }) {
  return (
    <>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.sectionLabel}>
            {isSubscribed ? 'Choose another plan' : 'Choose your plan'}
          </Text>
          <Text style={styles.sectionHint}>Unlimited access on every plan</Text>
        </View>
        <View style={styles.savingPill}>
          <Text style={styles.savingPillText}>SAVE {YEARLY_SAVING_PERCENT}%</Text>
        </View>
      </View>

      <View style={styles.optionList} accessibilityRole="radiogroup">
        {plans.map((plan) => {
          const selected = isSelected('plan', plan.id);
          const price = priceFor(plan, plan.storePackage);
          return (
            <Pressable
              key={plan.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${plan.title} plan, ${price} per ${plan.period}`}
              android_ripple={{ color: 'rgba(30,36,31,0.06)' }}
              style={({ pressed }) => [
                styles.optionCard,
                selected && styles.optionCardSelected,
                pressed && styles.pressed,
              ]}
              onPress={() => setSelection({ kind: 'plan', id: plan.id })}
            >
              <Radio selected={selected} />
              <View style={styles.optionCopy}>
                <View style={styles.optionTitleRow}>
                  <Text style={styles.optionTitle}>{plan.title}</Text>
                  {plan.badge ? (
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedBadgeText}>RECOMMENDED</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.optionDescription}>
                  {plan.id === 'yearly'
                    ? `Best value · save ${YEARLY_SAVING_PERCENT}%`
                    : 'Flexible monthly billing'}
                </Text>
              </View>
              <View style={styles.optionPriceWrap}>
                <Text style={styles.optionPrice}>{price}</Text>
                <Text style={styles.optionPeriod}>/ {plan.period}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.assuranceRow}>
        <Ionicons name="shield-checkmark-outline" size={17} color={COLORS.primaryDark} />
        <Text style={styles.assuranceText}>Secure Play Store billing · cancel anytime</Text>
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
    </>
  );
}

function CoinOptions({ adMessage, adStatus, coins, isSelected, packs, priceFor, setSelection, watchAd }) {
  return (
    <>
      <View style={styles.balanceCard}>
        <View style={styles.balanceIcon}>
          <Ionicons name="wallet-outline" size={21} color={COLORS.accentStrong} />
        </View>
        <View style={styles.balanceCopy}>
          <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
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
              <Text style={styles.watchAdButtonText}>Earn {AD_COIN_REWARD}</Text>
            </>
          )}
        </Pressable>
      </View>
      {adMessage ? <Text style={styles.adStatusText}>{adMessage}</Text> : null}

      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={styles.sectionLabel}>Choose a coin pack</Text>
          <Text style={styles.sectionHint}>One-off purchase · coins never expire</Text>
        </View>
      </View>

      <View style={styles.optionList} accessibilityRole="radiogroup">
        {packs.map((pack) => {
          const selected = isSelected('pack', pack.id);
          const saving = packSaving(pack);
          return (
            <Pressable
              key={pack.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${pack.coins} coins for ${priceFor(pack, pack.storePackage)}`}
              android_ripple={{ color: 'rgba(30,36,31,0.06)' }}
              style={({ pressed }) => [
                styles.optionCard,
                selected && styles.coinOptionCardSelected,
                pressed && styles.pressed,
              ]}
              onPress={() => setSelection({ kind: 'pack', id: pack.id })}
            >
              <Radio selected={selected} coin />
              <View style={styles.coinAmountIcon}>
                <Ionicons name="ellipse" size={14} color={COLORS.accent} />
              </View>
              <View style={styles.optionCopy}>
                <View style={styles.optionTitleRow}>
                  <Text style={styles.optionTitle}>{coinLabel(pack.coins)}</Text>
                  {pack.badge ? (
                    <View style={styles.coinBadge}>
                      <Text style={styles.coinBadgeText}>{pack.badge.toUpperCase()}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.optionDescription}>
                  {saving > 0 ? `Save ${saving}% per coin` : 'A simple starter pack'}
                </Text>
              </View>
              <Text style={styles.optionPrice}>{priceFor(pack, pack.storePackage)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.coinUseCard}>
        <Text style={styles.coinUseTitle}>What can I create?</Text>
        <CoinUseRow
          icon="color-palette-outline"
          label="Interior or exterior design"
          value={coinLabel(COIN_COST.design)}
        />
        <View style={styles.coinUseDivider} />
        <CoinUseRow
          icon="cube-outline"
          label="3D walkthrough render"
          value={coinLabel(COIN_COST.walkthrough)}
        />
      </View>
    </>
  );
}

function Radio({ selected, coin = false }) {
  return (
    <View style={[styles.radio, selected && (coin ? styles.coinRadioOn : styles.radioOn)]}>
      {selected ? <View style={coin ? styles.coinRadioDot : styles.radioDot} /> : null}
    </View>
  );
}

function CoinUseRow({ icon, label, value }) {
  return (
    <View style={styles.coinUseRow}>
      <Ionicons name={icon} size={17} color={COLORS.textSecondary} />
      <Text style={styles.coinUseLabel}>{label}</Text>
      <Text style={styles.coinUseValue}>{value}</Text>
    </View>
  );
}

function PurchaseFooter({ activePack, activePlan, busy, buyingPlan, insets, isSubscribed, onPress, priceFor }) {
  return (
    <View style={[styles.purchaseFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.summary}>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryEyebrow}>YOUR SELECTION</Text>
          <Text style={styles.summaryLabel} numberOfLines={1}>
            {buyingPlan ? `${activePlan?.title} Pro plan` : `${activePack?.coins} coins · one-off`}
          </Text>
        </View>
        <Text style={styles.summaryValue}>
          {buyingPlan
            ? priceFor(activePlan, activePlan?.storePackage)
            : priceFor(activePack, activePack?.storePackage)}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          buyingPlan
            ? `${isSubscribed ? 'Change to' : 'Subscribe to'} the ${activePlan?.title} plan`
            : `Buy ${activePack?.coins} coins`
        }
        accessibilityState={{ busy: !!busy, disabled: !!busy }}
        android_ripple={busy ? undefined : { color: 'rgba(255,255,255,0.20)' }}
        style={({ pressed }) => [
          styles.primaryButton,
          !!busy && styles.primaryButtonDisabled,
          pressed && !busy && styles.pressed,
        ]}
        disabled={!!busy}
        onPress={onPress}
      >
        {busy ? (
          <ActivityIndicator size="small" color={COLORS.textTertiary} />
        ) : (
          <>
            <Text style={styles.primaryButtonText}>
              {buyingPlan
                ? isSubscribed
                  ? 'Change plan'
                  : 'Continue with Pro'
                : `Buy ${activePack?.coins} coins`}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
          </>
        )}
      </Pressable>
    </View>
  );
}
