import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import styles from '../../assets/styles/profile.styles';

/**
 * The app's one confirm dialog.
 *
 * Same shape as the delete dialog in the Collection screen: a centred card,
 * centred copy, and two equal-width buttons — an outlined Cancel beside a filled
 * confirm. Every screen that needs a yes/no now asks it the same way.
 */
export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onCancel,
  onConfirm,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.dialogOverlay} onPress={onCancel}>
        <Pressable style={styles.dialogContent} onPress={() => {}}>
          <Text style={styles.dialogTitle}>{title}</Text>
          {!!message && <Text style={styles.dialogMessage}>{message}</Text>}

          <View style={styles.dialogActions}>
            <Pressable
              style={[styles.dialogButton, styles.dialogCancel]}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={styles.dialogCancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.dialogButton, styles.dialogConfirm]}
              onPress={onConfirm}
              accessibilityRole="button"
            >
              <Text style={styles.dialogConfirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
