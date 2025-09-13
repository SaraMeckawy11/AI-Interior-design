import { 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput, 
  Modal, 
  TouchableWithoutFeedback 
} from 'react-native';
import React, { useState } from 'react';
import styles from '../../assets/styles/create/colorTone.styles';
import { Ionicons } from '@expo/vector-icons';
import ColorPicker from 'react-native-wheel-color-picker';

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

export default function ColorToneSelector({ colorTone, setColorTone }) {
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

    const newTone = { name: hexInput.toUpperCase(), color: hexInput };
    setCustomTones((prev) => [...prev, newTone]);
    setColorTone(hexInput.toUpperCase());
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
          return (
            <TouchableOpacity
              key={tone.name}
              style={styles.iconButton}
              onPress={() => setColorTone(tone.name)}
              onLongPress={() => isCustom && handleDeleteTone(tone.name)}
            >
              <View
                style={[
                  styles.colorSwatch,
                  { backgroundColor: tone.color },
                  isSelected && styles.colorToneSelected,
                ]}
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
            onPress={() => setShowColorPicker(true)}
          >
            <View style={styles.addSwatch}>
              <Ionicons name="add-outline" size={28} color="#6B7280" />
            </View>
            <Text style={styles.iconLabel}>Add Tone</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Color Picker Modal */}
      <Modal
        visible={showColorPicker}
        animationType="fade"
        transparent
        onRequestClose={() => setShowColorPicker(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowColorPicker(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContainer}>
                <Text style={styles.modalTitle}>Pick a Color</Text>

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
                  />
                  <View
                    style={[styles.hexPreview, { backgroundColor: selectedColor }]}
                  />
                </View>

                <TouchableOpacity
                  style={styles.doneButton}
                  onPress={handleAddCustomTone}
                >
                  <Text style={styles.doneButtonText}>Add Color</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setShowColorPicker(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
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
                  Are you sure you want to delete "{deleteModal.toneName}"?
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
