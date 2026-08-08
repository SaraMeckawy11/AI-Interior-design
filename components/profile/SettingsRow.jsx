import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles from '../../assets/styles/profile.styles';
import COLORS from '../../constants/colors';

/**
 * One tappable row inside a settings card.
 *
 * `showDivider` is set by the parent for every row except the first, so a card
 * never ends with a dangling separator line.
 */
export default function SettingsRow({
  icon,
  label,
  value,
  onPress,
  showDivider = false,
  accent = false,
  danger = false,
}) {
  const tint = danger ? COLORS.danger : accent ? COLORS.accentStrong : COLORS.primaryDark;
  const readOnly = !onPress;

  return (
    <Pressable
      onPress={onPress}
      disabled={readOnly}
      accessibilityRole={readOnly ? "text" : "button"}
      accessibilityLabel={value ? `${label}: ${value}` : label}
      style={({ pressed }) => [
        styles.item,
        showDivider && styles.itemDivider,
        pressed && !readOnly && styles.itemPressed,
      ]}
    >
      <View
        style={[
          styles.itemIcon,
          accent && styles.itemIconAccent,
          danger && styles.itemIconDanger,
        ]}
      >
        <Ionicons name={icon} size={17} color={tint} />
      </View>

      <Text style={[styles.itemText, danger && styles.itemTextDanger]}>{label}</Text>

      {/* A row can either state a fact or lead somewhere. Showing a chevron on a
          read-only row promises a screen that does not exist. */}
      {value ? (
        <Text style={styles.itemValue} numberOfLines={1}>{value}</Text>
      ) : null}

      {!readOnly && (
        <Ionicons
          name="chevron-forward"
          size={17}
          color={COLORS.textTertiary}
          style={styles.itemChevron}
        />
      )}
    </Pressable>
  );
}
