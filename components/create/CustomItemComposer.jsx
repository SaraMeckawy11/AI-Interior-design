import React from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import COLORS from "../../constants/colors";
import { RADIUS, SPACING, TYPE, ms } from "../../constants/theme";

/**
 * One compact add pattern for room, exterior and design-style selectors.
 * Keeping the action beside the field avoids adding a second full-width row
 * and leaves the user's selected options in view while the keyboard is open.
 */
export default function CustomItemComposer({
  title,
  placeholder,
  value,
  onChangeText,
  onAdd,
  onClose,
  onInputFocus,
}) {
  const canAdd = value.trim().length > 0;

  return (
    <View style={styles.card}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={COLORS.placeholderText}
        selectionColor={COLORS.primaryDark}
        value={value}
        onChangeText={onChangeText}
        onFocus={(event) => onInputFocus?.(event.target)}
        onSubmitEditing={onAdd}
        returnKeyType="done"
        autoFocus
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close custom item field"
        hitSlop={6}
        onPress={onClose}
        style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={18} color={COLORS.textSecondary} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${title.toLowerCase()}`}
        accessibilityState={{ disabled: !canAdd }}
        disabled={!canAdd}
        onPress={onAdd}
        style={({ pressed }) => [
          styles.addButton,
          !canAdd && styles.addButtonDisabled,
          pressed && canAdd && styles.pressed,
        ]}
      >
        <Ionicons
          name="checkmark"
          size={19}
          color={canAdd ? COLORS.white : COLORS.textTertiary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    marginTop: SPACING.xs,
    padding: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  closeButton: {
    width: ms(38),
    height: ms(40),
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: ms(40),
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    color: COLORS.textPrimary,
    ...TYPE.small,
  },
  addButton: {
    width: ms(40),
    height: ms(40),
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primaryDark,
  },
  addButtonDisabled: { backgroundColor: COLORS.surfaceSunken },
  pressed: { opacity: 0.72 },
});
