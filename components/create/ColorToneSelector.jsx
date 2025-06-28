import { View, Text, TouchableOpacity } from 'react-native';
import React, { useState } from 'react';
import styles from '../../assets/styles/create/colorTone.styles';
import { Ionicons } from '@expo/vector-icons';

const baseColorTones = [
  // Whites & Off-Whites
  { name: 'Ivory', color: '#FFFFF0' },
  { name: 'Pearl', color: '#F8F6F0' },
  { name: 'Alabaster', color: '#FAFAFA' },

  // Neutrals & Grays
  { name: 'Neutral', color: '#A9A9A9' },
  { name: 'Ash', color: '#B2BEB5' },
  { name: 'Stone', color: '#DCDCDC' },
  { name: 'Charcoal', color: '#36454F' },
  { name: 'Slate', color: '#708090' },

  // Beiges & Browns
  { name: 'Vanilla Latte', color: '#F3E5AB' },
  { name: 'Taupe', color: '#D8B384' },
  { name: 'Earthy', color: '#8B4513' },
  { name: 'Walnut', color: '#5C4033' },

  // Reds & Pinks
  { name: 'Blush', color: '#FFC0CB' },
  { name: 'Rose', color: '#FF007F' },
  { name: 'Crimson', color: '#DC143C' },
  { name: 'Rust', color: '#B7410E' },

  // Oranges & Yellows
  { name: 'Warm', color: '#FFB347' },
  { name: 'Amber', color: '#FFBF00' },
  { name: 'Gold', color: '#FFD700' },
  { name: 'Ochre', color: '#CC7722' },

  // Greens
  { name: 'Mint', color: '#98FF98' },
  { name: 'Olive', color: '#808000' },
  { name: 'Sage', color: '#9DC183' },
  { name: 'Forest', color: '#228B22' },

  // Blues
  { name: 'Sky', color: '#87CEEB' },
  { name: 'Cool', color: '#ADD8E6' },
  { name: 'Denim', color: '#1560BD' },
  { name: 'Navy', color: '#000080' },

  // Purples
  { name: 'Lavender', color: '#E6E6FA' },
  { name: 'Lilac', color: '#C8A2C8' },
  { name: 'Plum', color: '#8E4585' },
  { name: 'Eggplant', color: '#3B0A45' },
];

const topTones = ['Neutral', 'Taupe', 'Sage', 'Sky'];

export default function ColorToneSelector({ colorTone, setColorTone }) {
  const [showAll, setShowAll] = useState(false);

  const getVisibleTones = () => {
    const top = baseColorTones.filter(t => topTones.includes(t.name));
    if (!showAll && colorTone && !topTones.includes(colorTone)) {
      const selected = baseColorTones.find(t => t.name === colorTone);
      if (selected) top[top.length - 1] = selected;
    }
    return showAll ? baseColorTones.slice(0, 32) : top;
  };

  return (
    <View style={styles.formGroup}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Color Tone</Text>
        <TouchableOpacity onPress={() => setShowAll(prev => !prev)}>
          <Text style={styles.seeAllText}>{showAll ? 'Show Less' : 'See All'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.iconGrid}>
        {getVisibleTones().map((tone) => (
          <TouchableOpacity
            key={tone.name}
            style={styles.iconButton}
            onPress={() => setColorTone(tone.name)}
          >
            <View
              style={[
                styles.colorSwatch,
                { backgroundColor: tone.color },
                colorTone === tone.name && styles.colorToneSelected,
              ]}
            />
            <Text
              style={[
                styles.iconLabel,
                colorTone === tone.name && styles.iconLabelSelected,
              ]}
            >
              {tone.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
