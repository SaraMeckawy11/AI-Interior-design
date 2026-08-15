import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import React, { useState, useMemo, useEffect } from 'react';
import styles from '../../assets/styles/create/room.styles';
import { Ionicons } from '@expo/vector-icons';
import COLORS from '../../constants/colors';
import CustomItemComposer from './CustomItemComposer';

const MAX_VISIBLE_ICONS = 4;
const MAX_CUSTOM_ROOMS = 1;

/** Stable default to avoid new [] each render (effect deps). */
const NO_EXCLUDED_ROOMS = [];

const RoomTypeSelector = ({
  roomType,
  setRoomType,
  label = 'Room type',
  excludeRoomTypes = NO_EXCLUDED_ROOMS,
  onInputFocus,
  /** When true, every option is shown and the See All control is hidden (e.g. plan “Space options”). */
  showAllOptions = false,
}) => {
  const [showAllRooms, setShowAllRooms] = useState(false);
  const [customRoomTypes, setCustomRoomTypes] = useState([]);
  const [manualRoomInput, setManualRoomInput] = useState('');
  const [showInputField, setShowInputField] = useState(false);

  // Modal state
  const [errorMessage, setErrorMessage] = useState('');
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [roomToDelete, setRoomToDelete] = useState(null);

  const defaultRoomTypes = useMemo(
    () =>
      [
        'Full Apartment',
        'Living Room',
        // The living room that eats, named so nobody has to guess whether a
        // dining table is coming, and the formal seating room that never does.
        'Living + Dining',
        'Salon',
        'Salon + Dining',
        'Bedroom',
        'Kitchen',
        'Bathroom',
        'Dining Room',
        'Balcony',
        'Closet',
        'Office',
        'Kids Room',
        'Laundry Room',
        'Hallway',
        'Entryway',
        'Basement',
      ].filter((t) => !excludeRoomTypes.includes(t)),
    [excludeRoomTypes],
  );

  const allRoomTypes = [...defaultRoomTypes, ...customRoomTypes];

  useEffect(() => {
    if (!roomType || !excludeRoomTypes.includes(roomType)) return;
    const next = defaultRoomTypes[0] || 'Living Room';
    if (next !== roomType) setRoomType(next);
  }, [roomType, excludeRoomTypes, defaultRoomTypes, setRoomType]);

  const expanded = showAllOptions || showAllRooms;

  const getVisibleRoomTypes = () => {
    if (showAllOptions) return allRoomTypes;

    const base = allRoomTypes.slice(0, MAX_VISIBLE_ICONS);

    if (!showAllRooms && roomType && !base.includes(roomType)) {
      const modified = [...base];
      modified[modified.length - 1] = roomType;
      return modified;
    }
    return showAllRooms ? allRoomTypes : base;
  };

  const visibleRoomTypes = getVisibleRoomTypes();

  const getRoomIcon = (type) => {
    switch (type.toLowerCase()) {
      case 'full apartment': return 'home-outline';
      case 'whole apartment': return 'home-outline';
      case 'living room': return 'tv-outline';
      case 'living + dining': return 'restaurant-outline';
      case 'salon': return 'cafe-outline';
      case 'salon + dining': return 'restaurant-outline';
      case 'balcony': return 'sunny-outline';
      case 'bedroom': return 'bed-outline';
      case 'kitchen': return 'restaurant-outline';
      case 'bathroom': return 'water-outline';
      case 'dining room': return 'pizza-outline';
      case 'office': return 'laptop-outline';
      case 'kids room': return 'happy-outline';
      case 'garage': return 'car-outline';
      case 'entryway': return 'log-in-outline';
      case 'laundry room': return 'shirt-outline';
      case 'closet': return 'cube-outline';
      case 'basement': return 'download-outline';
      case 'attic': return 'cloud-upload-outline';
      case 'hallway': return 'walk-outline';
      case 'sunroom': return 'sunny-outline';
      default: return 'home-outline';
    }
  };

  const handleAddRoom = () => {
    const trimmed = manualRoomInput.trim();
    if (!trimmed) return;

    if (allRoomTypes.includes(trimmed)) {
      setErrorMessage("This room type already exists.");
      setShowErrorModal(true);
      return;
    }

    if (customRoomTypes.length >= MAX_CUSTOM_ROOMS) {
      setErrorMessage(
        `You've reached the maximum of ${MAX_CUSTOM_ROOMS} custom room types. Please delete one to add another.`
      );
      setShowErrorModal(true);
      return;
    }

    setCustomRoomTypes([...customRoomTypes, trimmed]);
    setRoomType(trimmed);
    setManualRoomInput('');
    setShowInputField(false);
    if (!showAllOptions) setShowAllRooms(true);
  };

  const handleDeleteRoom = (room) => {
    setRoomToDelete(room);
  };

  const confirmDelete = () => {
    if (roomToDelete) {
      setCustomRoomTypes((prev) => prev.filter((r) => r !== roomToDelete));
      if (roomType === roomToDelete) setRoomType(null);
      setRoomToDelete(null);
    }
  };

  return (
    <View style={styles.formGroup}>
      <View style={[styles.labelRow, showAllOptions && styles.labelRowSingle]}>
        <Text style={styles.label}>{label}</Text>
        {!showAllOptions && (
          <TouchableOpacity onPress={() => setShowAllRooms(!showAllRooms)}>
            <Text style={styles.seeAllText}>
              {showAllRooms ? 'Show Less' : 'See All'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.iconGrid, showAllOptions && styles.iconGridExpanded]}>
        {visibleRoomTypes.map((type) => {
          const isCustom = customRoomTypes.includes(type);
          const selected = roomType === type;
          return (
            <TouchableOpacity
              key={type}
              style={styles.iconButton}
              onPress={() => setRoomType(type)}
              onLongPress={() => isCustom && handleDeleteRoom(type)}
            >
              <View
                style={[
                  styles.iconCircle,
                  selected && styles.iconCircleSelected,
                  isCustom && styles.customRoomBackground,
                ]}
              >
                <Ionicons
                  name={getRoomIcon(type)}
                  size={18}
                  color={selected ? COLORS.primaryDark : COLORS.textSecondary}
                />
              </View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                style={[
                  styles.iconLabel,
                  roomType === type && styles.iconLabelSelected,
                ]}
              >
                {type}
              </Text>
            </TouchableOpacity>
          );
        })}

        {expanded && customRoomTypes.length < MAX_CUSTOM_ROOMS && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setShowInputField(!showInputField)}
          >
            <View style={[styles.iconCircle, styles.addItemCircle]}>
              <Ionicons name="add" size={20} color={COLORS.primaryDark} />
            </View>
            <Text style={[styles.iconLabel, styles.addItemLabel]}>Custom</Text>
          </TouchableOpacity>
        )}
      </View>

      {expanded && showInputField && (
        <CustomItemComposer
          title="Custom room"
          placeholder="e.g. Reading nook"
          value={manualRoomInput}
          onChangeText={setManualRoomInput}
          onInputFocus={onInputFocus}
          onAdd={handleAddRoom}
          onClose={() => setShowInputField(false)}
        />
      )}

      {/* Error Modal */}
      <Modal
        transparent
        visible={showErrorModal}
        animationType="fade"
        onRequestClose={() => setShowErrorModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowErrorModal(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.errorModalContainer}>
                <Text style={styles.modalMessage}>{errorMessage}</Text>
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => setShowErrorModal(false)}
                  >
                    <Text style={styles.deleteText}>OK</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        transparent
        visible={!!roomToDelete}
        animationType="fade"
        onRequestClose={() => setRoomToDelete(null)}
      >
        <TouchableWithoutFeedback onPress={() => setRoomToDelete(null)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.errorModalContainer}>
                <Text style={styles.modalTitle}>Delete Room</Text>
                <Text style={styles.modalMessage}>
                  Are you sure you want to delete &ldquo;{roomToDelete}&rdquo;?
                </Text>
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setRoomToDelete(null)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={confirmDelete}
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
};

export default RoomTypeSelector;
