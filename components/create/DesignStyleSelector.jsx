import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  Modal,
  TouchableWithoutFeedback,
} from "react-native";
import React, { useState } from "react";
import styles from "../../assets/styles/create/design.styles";
import { Ionicons } from "@expo/vector-icons";

const INITIAL_STYLES = ["Modern", "Rustic", "Bohemian"];

const ALL_DESIGN_STYLES = [
  "Modern",
  "Rustic",
  "Bohemian",
  "Classic",
  "Cozy",
  "Minimalist",
  "Industrial",
  "Scandinavian",
  "Traditional",
  "Contemporary",
  "Mediterranean",
  "Japandi",
  "Tropical",
];

const STYLE_IMAGE_MAP = {
  modern: require("../../assets/images/designStyles/modern.jpg"),
  classic: require("../../assets/images/designStyles/classic.jpg"),
  cozy: require("../../assets/images/designStyles/cozy.jpg"),
  minimalist: require("../../assets/images/designStyles/minimalist.jpg"),
  bohemian: require("../../assets/images/designStyles/bohemian.jpg"),
  industrial: require("../../assets/images/designStyles/industrial.jpg"),
  scandinavian: require("../../assets/images/designStyles/scandinavian.jpg"),
  rustic: require("../../assets/images/designStyles/rustic.jpg"),
  traditional: require("../../assets/images/designStyles/traditional.jpg"),
  contemporary: require("../../assets/images/designStyles/contemporary.jpg"),
  mediterranean: require("../../assets/images/designStyles/mediterranean.jpg"),
  japandi: require("../../assets/images/designStyles/japendi.jpg"),
  tropical: require("../../assets/images/designStyles/tropical.jpg"),
};

export default function DesignStyleSelector({ designStyle, setDesignStyle }) {
  const [showAll, setShowAll] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [customStyles, setCustomStyles] = useState([]);
  const [showInput, setShowInput] = useState(false);

  // modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [styleToDelete, setStyleToDelete] = useState(null);

  const allStyles = [...ALL_DESIGN_STYLES, ...customStyles];

  const getVisibleStyles = () => {
    if (showAll) return allStyles;

    const base = [...INITIAL_STYLES];

    if (designStyle && !base.includes(designStyle)) {
      const updated = [...base];
      updated[updated.length - 1] = designStyle;
      return updated;
    }

    return base;
  };

  const visibleStyles = getVisibleStyles();

  const getImageSource = (style) => {
    const formatted = style.toLowerCase().replace(/\s+/g, "");
    return STYLE_IMAGE_MAP[formatted] || null;
  };

  const handleSelectStyle = (style) => {
    if (!style || style.trim() === "") return;
    setDesignStyle(style);
  };

  const MAX_CUSTOM_STYLES = 2;

  const handleAddCustomStyle = () => {
    const trimmed = manualInput.trim();
    if (!trimmed) return;

    if (ALL_DESIGN_STYLES.includes(trimmed) || customStyles.includes(trimmed)) {
      // optional: show modal if needed
      return;
    }

    if (customStyles.length >= MAX_CUSTOM_STYLES) {
      // optional: show modal if needed
      return;
    }

    setCustomStyles((prev) => [...prev, trimmed]);
    setDesignStyle(trimmed);
    setManualInput("");
    setShowInput(false);
    setShowAll(true);
  };

  const handleDeleteStyle = (style) => {
    setStyleToDelete(style);
    setShowDeleteModal(true);
  };

  const confirmDeleteStyle = () => {
    if (styleToDelete) {
      setCustomStyles((prev) => prev.filter((s) => s !== styleToDelete));
      if (designStyle === styleToDelete) setDesignStyle(null);
    }
    setStyleToDelete(null);
    setShowDeleteModal(false);
  };

  return (
    <View style={styles.formGroup}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Design Style</Text>
        <TouchableOpacity onPress={() => setShowAll(!showAll)}>
          <Text style={styles.seeAllText}>
            {showAll ? "Show Less" : "See All"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.iconGrid}>
        {visibleStyles.map((style) => {
          const isSelected = designStyle === style;
          const isCustom = customStyles.includes(style);
          return (
            <TouchableOpacity
              key={style}
              style={styles.iconButton}
              onPress={() => handleSelectStyle(style)}
              onLongPress={() => isCustom && handleDeleteStyle(style)}
            >
              <View
                style={[
                  styles.iconImageWrapper,
                  isSelected && styles.iconImageSelected,
                  isCustom && styles.customStyleBackground,
                ]}
              >
                {getImageSource(style) ? (
                  <Image
                    source={getImageSource(style)}
                    style={styles.iconImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons
                    name="color-palette-outline"
                    size={24}
                    color="#6B7280"
                  />
                )}
              </View>
              <Text
                style={[
                  styles.iconLabel,
                  isSelected && styles.iconLabelSelected,
                ]}
              >
                {style}
              </Text>
            </TouchableOpacity>
          );
        })}

        {showAll && customStyles.length < MAX_CUSTOM_STYLES && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setShowInput(!showInput)}
          >
            <View style={styles.iconAdd}>
              <Ionicons name="add-outline" size={28} color="#6B7280" />
            </View>
            <Text style={styles.iconLabel}>Add Style</Text>
          </TouchableOpacity>
        )}
      </View>

      {showInput && (
        <View style={styles.manualCard}>
          <TextInput
            style={styles.manualInput}
            placeholder="Enter design style"
            value={manualInput}
            onChangeText={setManualInput}
          />
          <TouchableOpacity style={styles.addButton} onPress={handleAddCustomStyle}>
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowDeleteModal(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.errorModalContainer}>
                <Text style={styles.modalTitle}>Delete Custom Style</Text>
                <Text style={styles.modalMessage}>
                  Are you sure you want to delete "{styleToDelete}"?
                </Text>

                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setShowDeleteModal(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={confirmDeleteStyle}
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
