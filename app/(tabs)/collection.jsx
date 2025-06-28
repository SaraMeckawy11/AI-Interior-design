import React, { useEffect, useState } from 'react'; 
import { View, FlatList, ActivityIndicator, Text, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useAuthStore } from '../../authStore';
import styles from '../../assets/styles/collection.styles';
import { Image } from 'expo-image';
import { formatPublishDate } from '../../lib/utils';
import COLORS from '../../constants/colors';
import Loader from '../../components/Loader';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';


export default function Collection() {
  const { token } = useAuthStore();
  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const router = useRouter();

  const fetchDesigns = async (pageNum = 1, refresh = false) => {
  try {
    if (refresh) setRefreshing(true);
    else if (pageNum === 1) setLoading(true);

    const response = await fetch(
      `${process.env.EXPO_PUBLIC_SERVER_URI}:3000/api/designs?page=${pageNum}&limit=5`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    // console.log("Fetched data:", data);

    if (!response.ok) throw new Error(data.message || "Failed to fetch designs");

    const newDesigns = data.designs || data.output || [];

    setDesigns((prev) => (refresh ? newDesigns : [...prev, ...newDesigns]));
    setHasMore(pageNum < data.totalPages);
    setPage(pageNum);
  } catch (error) {
    console.log(" Error fetching designs:", error.message);
  } finally {
    if (refresh) setRefreshing(false);
    else setLoading(false);
  }
};

  useEffect(() => {
    fetchDesigns();
  }, []);

  const handleDeleteDesign = async (designId) => {
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}:3000/api/designs/${designId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.message || "Failed to delete design");

      // Update state to remove the deleted item from the UI
      setDesigns((prevDesigns) => prevDesigns.filter((design) => design._id !== designId));

      Alert.alert("Success", "Design deleted successfully");
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to delete design");
    }
  };

  const confirmDelete = (designId) => {
    Alert.alert(
      "Delete design",
      "Are you sure you want to delete this design and all its associated images?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => handleDeleteDesign(designId) },
      ]
    );
  };


  const handleLoadMore = () => {
    if (hasMore && !loading && !refreshing) {
      fetchDesigns(page + 1);
    }
  };

  const renderItem = ({ item }) => {
  const imageUri = item.generatedImage || item.image || 'https://via.placeholder.com/150';

  return (
    <TouchableOpacity
      style={styles.bookCard}
      onPress={() => router.push({
        pathname: '/outputScreen',
        params: { imageUri: imageUri }
      })}

    >
      <View style={styles.bookImageContainer}>
        <Image
          source={{ uri: imageUri }}
          style={styles.bookImage}
          contentFit="cover"
        />
      </View>

      <View style={styles.detailsContainer}>
        <View style={styles.bookDetails}>
          <Text style={styles.bookTitle}><Text style={styles.label}>Room Type:</Text> {item.roomType}</Text>
          <Text style={styles.caption}><Text style={styles.label}>Design Style:</Text> {item.designStyle}</Text>
          <Text style={styles.caption}><Text style={styles.label}>Color Tone:</Text> {item.colorTone}</Text>
          <Text style={styles.date}>Created on {formatPublishDate(item.createdAt)}</Text>
        </View>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => confirmDelete(item._id)}
        >
          <Ionicons name="trash-outline" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

  if (loading && !refreshing && designs.length === 0) return <Loader />;

  const renderFooter = () =>
    loading && !refreshing ? (
      <ActivityIndicator  style={styles.footerLoader} size="small" color={COLORS.primary} />
    ) : null;

  return (
    <View style={styles.container} >
      <FlatList
        data={designs}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item._id ?? 'key'}-${index}`}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchDesigns(1, true)}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Roomify</Text>
            {/* <Text style={styles.headerSubtitle}>Design your dream home</Text> */}
          </View>
        }
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          !loading && (
            <Text style={styles.emptyText}>
              No designs found.
            </Text>
          )
        }
      />
    </View>
  );
}
