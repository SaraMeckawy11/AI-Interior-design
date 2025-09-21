import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import React, { useState } from 'react';
import styles from '../../assets/styles/create/room.styles';
import { Ionicons } from '@expo/vector-icons';

const MAX_VISIBLE_ICONS = 4;
const MAX_CUSTOM_ROOMS = 1;

const RoomTypeSelector = ({ roomType, setRoomType }) => {
  const [showAllRooms, setShowAllRooms] = useState(false);
  const [customRoomTypes, setCustomRoomTypes] = useState([]);
  const [manualRoomInput, setManualRoomInput] = useState('');
  const [showInputField, setShowInputField] = useState(false);

  // Modal state
  const [errorMessage, setErrorMessage] = useState('');
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [roomToDelete, setRoomToDelete] = useState(null);

  const defaultRoomTypes = [
    'Living Room', 'Bedroom', 'Kitchen', 'Bathroom',
    'Dining Room', 'Office', 'Garage', 'Entryway',
    'Basement', 'Attic', 'Laundry Room', 'Sunroom',
    'Closet', 'Balcony', 'Hallway'
  ];

  const allRoomTypes = [...defaultRoomTypes, ...customRoomTypes];

  const getVisibleRoomTypes = () => {
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
      case 'living room': return 'tv-outline';
      case 'bedroom': return 'bed-outline';
      case 'kitchen': return 'restaurant-outline';
      case 'bathroom': return 'water-outline';
      case 'dining room': return 'pizza-outline';
      case 'office': return 'laptop-outline';
      case 'garage': return 'car-outline';
      case 'entryway': return 'log-in-outline';
      case 'laundry room': return 'shirt-outline';
      case 'closet': return 'cube-outline';
      case 'balcony': return 'sunny-outline';
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
    setShowAllRooms(true);
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
      <View style={styles.labelRow}>
        <Text style={styles.label}>Room type</Text>
        <TouchableOpacity onPress={() => setShowAllRooms(!showAllRooms)}>
          <Text style={styles.seeAllText}>
            {showAllRooms ? 'Show Less' : 'See All'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.iconGrid}>
        {visibleRoomTypes.map((type) => {
          const isCustom = customRoomTypes.includes(type);
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
                  roomType === type && styles.iconCircleSelected,
                  isCustom && styles.customRoomBackground
                ]}
              >
                <Ionicons name={getRoomIcon(type)} size={18} color="gray" />
              </View>
              <Text
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

        {showAllRooms && customRoomTypes.length < MAX_CUSTOM_ROOMS && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setShowInputField(!showInputField)}
          >
            <View style={styles.iconCircle}>
              <Ionicons name="add-outline" size={24} color="gray" />
            </View>
            <Text style={styles.iconLabel}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {showAllRooms && showInputField && (
        <View style={styles.manualCard}>
          <TextInput
            style={styles.manualInput}
            placeholder="Enter room type"
            value={manualRoomInput}
            onChangeText={setManualRoomInput}
          />
          <TouchableOpacity style={styles.addButton} onPress={handleAddRoom}>
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
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
                  Are you sure you want to delete "{roomToDelete}"?
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
