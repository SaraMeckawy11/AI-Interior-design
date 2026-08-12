import { 
  View, 
  Text, 
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  TouchableWithoutFeedback 
} from 'react-native';
import React, { useMemo, useState } from 'react';
import styles from '../../assets/styles/create/colorTone.styles';
import { Ionicons } from '@expo/vector-icons';
import ColorPicker from 'react-native-wheel-color-picker';

import { buildPalette, nameOf } from '../../lib/colorPalettes';
import COLORS from '../../constants/colors';

const baseColorTones = [
  { name: 'Ivory', color: '#FFFFF0' },
  { name: 'Pearl', color: '#F8F6F0' },
  { name: 'Alabaster', color: '#FAFAFA' },
  { name: 'Neutral', color: '#A9A9A9' },
  { name: 'Ash', color: '#B2BEB5' },
  { name: 'Stone', color: '#DCDCDC' },
  { name: 'Charcoal', color: '#36454F' },
  { name: 'Slate', color: '#708090' },
  { name: 'Vanilla Latte', color: '#F3E5AB' },
  { name: 'Taupe', color: '#D8B384' },
  { name: 'Earthy', color: '#8B4513' },
  { name: 'Walnut', color: '#5C4033' },
  { name: 'Blush', color: '#FFC0CB' },
  { name: 'Rose', color: '#FF007F' },
  { name: 'Crimson', color: '#DC143C' },
  { name: 'Rust', color: '#B7410E' },
  { name: 'Warm', color: '#FFB347' },
  { name: 'Amber', color: '#FFBF00' },
  { name: 'Gold', color: '#FFD700' },
  { name: 'Ochre', color: '#CC7722' },
  { name: 'Mint', color: '#98FF98' },
  { name: 'Olive', color: '#808000' },
  { name: 'Sage', color: '#9DC183' },
  { name: 'Forest', color: '#228B22' },
  { name: 'Sky', color: '#87CEEB' },
  { name: 'Cool', color: '#ADD8E6' },
  { name: 'Denim', color: '#1560BD' },
  { name: 'Navy', color: '#000080' },
  { name: 'Lavender', color: '#E6E6FA' },
  { name: 'Lilac', color: '#C8A2C8' },
  { name: 'Plum', color: '#8E4585' },
  { name: 'Eggplant', color: '#3B0A45' },
];

const topTones = ['Neutral', 'Taupe', 'Sage', 'Sky'];

const schemeShares = (colorCount) => (
  colorCount === 1 ? [100] : colorCount === 2 ? [70, 30] : [60, 30, 10]
);

const schemeEntries = (palette, colorCount) => (
  [palette?.dominant, palette?.secondary, palette?.accent]
    .filter(Boolean)
    .slice(0, colorCount)
);

/** Preview exactly the number of colors this design path will send. */
function PaletteTrio({ palette, selected, colorCount }) {
  if (!palette) return null;
  const entries = schemeEntries(palette, colorCount);
  const entryStyles = [styles.trioDominant, styles.trioSecondary, styles.trioAccent];
  return (
    <View style={[styles.trio, selected && styles.trioSelected]}>
      {entries.map((entry, index) => (
        <View
          key={entry.role}
          style={[entryStyles[index], { backgroundColor: entry.hex }]}
        />
      ))}
    </View>
  );
}

export default function ColorToneSelector({ colorTone, setColorTone, colorCount = 3, onPaletteChange }) {
  const normalizedColorCount = Math.max(1, Math.min(3, Number(colorCount) || 3));
  const [showAll, setShowAll] = useState(false);
  const [customTones, setCustomTones] = useState([]);
  const [selectedColor, setSelectedColor] = useState('#FFFFFF');
  const [hexInput, setHexInput] = useState('#FFFFFF');
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Custom Modals
  const [errorModal, setErrorModal] = useState({ visible: false, title: '', message: '' });
  const [deleteModal, setDeleteModal] = useState({ visible: false, toneName: '' });

  const MAX_CUSTOM_TONES = 4;
  const allTones = [...baseColorTones, ...customTones];

  // Derived once per tone rather than on every render of every swatch: the grid
  // draws up to 36 of these and each one costs an RGB → HSL → RGB round trip.
  const palettes = useMemo(() => {
    const map = {};
    allTones.forEach((tone) => { map[tone.name] = buildPalette(tone.color); });
    return map;
    // `allTones` is rebuilt every render, so key off what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTones]);

  const selectedPalette = palettes[colorTone] || null;

  const getVisibleTones = () => {
    const top = baseColorTones.filter((t) => topTones.includes(t.name));
    if (!showAll && colorTone && !topTones.includes(colorTone)) {
      const selected = allTones.find((t) => t.name === colorTone);
      if (selected) top[top.length - 1] = selected;
    }
    return showAll ? allTones : top;
  };

  const handleAddCustomTone = () => {
    const isValidHex = /^#([0-9A-F]{6}|[0-9A-F]{3})$/i.test(hexInput);
    if (!isValidHex) {
      setErrorModal({ visible: true, title: 'Invalid Hex', message: 'Please enter a valid hex code.' });
      return;
    }

    if (customTones.length >= MAX_CUSTOM_TONES) {
      setErrorModal({ visible: true, title: 'Limit Reached', message: `You can only add up to ${MAX_CUSTOM_TONES} custom tones.` });
      return;
    }

    const newTone = { name: getColorName(hexInput), color: hexInput };
    const newPalette = buildPalette(hexInput);
    setCustomTones((prev) => [...prev, newTone]);
    setColorTone(newTone.name);
    onPaletteChange?.(newPalette);
    setShowColorPicker(false);
    setShowAll(true);
  };

  const handleDeleteTone = (toneName) => {
    setDeleteModal({ visible: true, toneName });
  };

  const handleHexChange = (text) => {
    let formatted = text.startsWith('#') ? text : `#${text}`;
    setHexInput(formatted);

    if (/^#([0-9A-F]{6}|[0-9A-F]{3})$/i.test(formatted)) {
      setSelectedColor(formatted);
    }
  };
  
  // Naming lives in lib/colorPalettes.js, where it is memoised and does not
  // scan six colour lists per call. See the note on its import there.
  const getColorName = (hex) => nameOf(hex);

  return (
    <View style={styles.formGroup}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Color Tone</Text>
        <TouchableOpacity onPress={() => setShowAll((prev) => !prev)}>
          <Text style={styles.seeAllText}>{showAll ? 'Show Less' : 'See All'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.iconGrid}>
        {getVisibleTones().map((tone) => {
          const isCustom = customTones.includes(tone);
          const isSelected = colorTone === tone.name;
          const palette = palettes[tone.name] || buildPalette(tone.color);
          const previewEntries = schemeEntries(palette, normalizedColorCount);
          const previewShares = schemeShares(normalizedColorCount);
          return (
            <TouchableOpacity
              key={tone.name}
              style={styles.iconButton}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, checked: isSelected }}
              accessibilityLabel={
                palette
                  ? `${tone.name}: ${previewEntries.map((entry, index) => `${previewShares[index]}% ${entry.name}`).join(', ')}`
                  : tone.name
              }
              onPress={() => {
                setColorTone(tone.name);
                onPaletteChange?.(palette);
              }}
              onLongPress={() => isCustom && handleDeleteTone(tone.name)}
            >
              <PaletteTrio
                palette={palette}
                selected={isSelected}
                colorCount={normalizedColorCount}
              />
              <Text
                style={[
                  styles.iconLabel,
                  isSelected && styles.iconLabelSelected,
                ]}
              >
                {tone.name}
              </Text>
            </TouchableOpacity>
          );
        })}

        {showAll && customTones.length < MAX_CUSTOM_TONES && (
          <TouchableOpacity
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Add a custom color tone"
            onPress={() => setShowColorPicker(true)}
          >
            <View style={styles.addSwatch}>
              <Ionicons name="add" size={20} color={COLORS.primaryDark} />
            </View>
            <Text style={[styles.iconLabel, styles.addItemLabel]}>Custom</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* The visible scheme always matches the number of colors sent.
          A one-color path — Exterior asks for a single facade color — has no
          scheme to explain, so the legend is not drawn: "100% Neutral" under a
          row of single swatches restates the swatch the user just tapped and
          reads as a leftover from the 60/30/10 interior version. */}
      {!!selectedPalette && normalizedColorCount > 1 && (
        <View style={styles.paletteLegend}>
          {schemeEntries(selectedPalette, normalizedColorCount).map((entry, index) => (
            <View key={entry.role} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: entry.hex }]} />
              <Text style={styles.legendText} numberOfLines={1}>
                <Text style={styles.legendShare}>{schemeShares(normalizedColorCount)[index]}% </Text>
                {entry.name}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Color Picker Modal */}
      <Modal
        visible={showColorPicker}
        animationType="fade"
        transparent
        onRequestClose={() => setShowColorPicker(false)}
      >
        <KeyboardAvoidingView
          style={styles.keyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <TouchableWithoutFeedback onPress={() => setShowColorPicker(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContainer}>
                <View style={styles.pickerHeader}>
                  <Text style={styles.modalTitleP}>Custom tone</Text>
                  <TouchableOpacity
                    style={styles.pickerCloseButton}
                    accessibilityRole="button"
                    accessibilityLabel="Close color picker"
                    onPress={() => setShowColorPicker(false)}
                  >
                    <Ionicons name="close" size={20} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.pickerWrapper}>
                  <ColorPicker
                    color={selectedColor}
                    onColorChange={(c) => {
                      setSelectedColor(c);
                      setHexInput(c);
                    }}
                    thumbSize={24}
                    sliderSize={24}
                    noSnap
                    row={false}
                    style={{ flex: 1, width: "100%" }}
                  />
                </View>

                <View style={styles.hexRow}>
                  <Text style={styles.hexLabel}>Hex</Text>
                  <TextInput
                    style={styles.hexInput}
                    value={hexInput}
                    onChangeText={handleHexChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="#FFFFFF"
                    placeholderTextColor={COLORS.placeholderText}
                    selectionColor={COLORS.primaryDark}
                    keyboardType="ascii-capable"
                    returnKeyType="done"
                    onSubmitEditing={handleAddCustomTone}
                  />
                  <View
                    style={[styles.hexPreview, { backgroundColor: selectedColor }]}
                  />
                </View>

                <View style={styles.modalButtonRowP}>
                  <TouchableOpacity
                    style={styles.pickerCancelButton}
                    onPress={() => setShowColorPicker(false)}
                  >
                    <Text style={styles.pickerCancelText}>Cancel</Text>
                  </TouchableOpacity>

                   <TouchableOpacity
                    style={styles.pickerPrimaryButton}
                    onPress={handleAddCustomTone}
                  >
                    <Ionicons name="checkmark" size={18} color={COLORS.white} />
                    <Text style={styles.pickerPrimaryText}>Add tone</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Error Modal */}
      <Modal
        visible={errorModal.visible}
        animationType="fade"
        transparent
        onRequestClose={() => setErrorModal({ ...errorModal, visible: false })}
      >
        <TouchableWithoutFeedback onPress={() => setErrorModal({ ...errorModal, visible: false })}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.errorModalContainer}>
                <Text style={styles.modalTitle}>{errorModal.title}</Text>
                <Text style={styles.modalMessage}>{errorModal.message}</Text>
                <TouchableOpacity
                  style={styles.doneButton}
                  onPress={() => setErrorModal({ ...errorModal, visible: false })}
                >
                  <Text style={styles.doneButtonText}>OK</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={deleteModal.visible}
        animationType="fade"
        transparent
        onRequestClose={() => setDeleteModal({ visible: false, toneName: '' })}
      >
        <TouchableWithoutFeedback onPress={() => setDeleteModal({ visible: false, toneName: '' })}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.errorModalContainer}>
                <Text style={styles.modalTitle}>Delete Custom Tone</Text>
                <Text style={styles.modalMessage}>
                  Are you sure you want to delete &ldquo;{deleteModal.toneName}&rdquo;?
                </Text>

                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setDeleteModal({ visible: false, toneName: '' })}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => {
                      setCustomTones((prev) => prev.filter((t) => t.name !== deleteModal.toneName));
                      if (colorTone === deleteModal.toneName) setColorTone(null);
                      if (colorTone === deleteModal.toneName) onPaletteChange?.(null);
                      setDeleteModal({ visible: false, toneName: '' });
                    }}
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}
