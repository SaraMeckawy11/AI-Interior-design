import React, { useEffect, useState } from "react";
import {
  View,
  FlatList,
  ActivityIndicator,
  Text,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
} from "react-native";
import { useAuthStore } from "../../authStore";
import styles from "../../assets/styles/collection.styles";
import { Image } from "expo-image";
import { formatPublishDate } from "../../lib/utils";
import COLORS from "../../constants/colors";
import Loader from "../../components/Loader";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import NativeCollectionAd from "../../components/collection/NativeCollectionAd";

export default function Collection() {
  const { token } = useAuthStore();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [selectedDesignId, setSelectedDesignId] = useState(null);

  const router = useRouter();

  // ✅ Fetch subscription & premium status
  useEffect(() => {
    const fetchSubscriptionStatus = async () => {
      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (res.ok && data.user) {
          setIsSubscribed(data.user.isSubscribed === true || data.user.isSubscribed === "true");
          setIsPremium(data.user.isPremium === true || data.user.isPremium === "true");
        }
      } catch (error) {
        // silently fail, just don't break rendering
      } finally {
        setStatusLoaded(true);
      }
    };

    if (token) fetchSubscriptionStatus();
    else setStatusLoaded(true);
  }, [token]);

  // ✅ Fetch designs
  const fetchDesigns = async (pageNum = 1, refresh = false) => {
    try {
      if (refresh) setRefreshing(true);
      else if (pageNum === 1) setLoading(true);

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SERVER_URI}/api/designs?page=${pageNum}&limit=5`,
        {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to fetch designs");

      const newDesigns = data.designs || data.output || [];
      setDesigns((prev) => (refresh ? newDesigns : [...prev, ...newDesigns]));
      setHasMore(pageNum < data.totalPages);
      setPage(pageNum);
    } catch {
      // no console log to keep it clean
    } finally {
      if (refresh) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    fetchDesigns();
  }, []);

  const handleDeleteDesign = async () => {
    try {
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SERVER_URI}/api/designs/${selectedDesignId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to delete design");

      setDesigns((prev) => prev.filter((d) => d._id !== selectedDesignId));
      setDeleteModalVisible(false);
    } catch {
      setDeleteModalVisible(false);
    }
  };

  const confirmDelete = (designId) => {
    setSelectedDesignId(designId);
    setDeleteModalVisible(true);
  };

  const handleLoadMore = () => {
    if (hasMore && !loading && !refreshing) fetchDesigns(page + 1);
  };

  // ✅ Only show ads if user status is loaded AND user is not premium/subscribed
  const showAds = statusLoaded && !isSubscribed ;

  const renderItem = ({ item, index }) => {
    const generatedImage = item.generatedImage || null;
    const originalImage = item.image || null;

    return (
      <>
        <TouchableOpacity
          style={styles.bookCard}
          onPress={() =>
            router.push({
              pathname: "/outputScreen",
              params: {
                generatedImage,
                image: originalImage,
                prompt: item.prompt || "",       // send prompt if exists
                roomType: item.roomType || "",   // send roomType if exists
                designStyle: item.designStyle || "",
                colorTone: item.colorTone || "",
                createdAt: item.createdAt,
              },
            })
          }
        >
          <View style={styles.bookImageContainer}>
            <Image
              source={{
                uri: generatedImage || originalImage || "https://via.placeholder.com/150",
              }}
              style={styles.bookImage}
              contentFit="cover"
            />
          </View>

          <View style={styles.detailsContainer}>
            <View style={styles.bookDetails}>
              {/*  If prompt exists → show prompt only */}
              {item.prompt ? (
                <>
                  <Text style={styles.bookTitle} numberOfLines={2}>
                    {item.prompt}
                  </Text>

                  <Text style={styles.date}>
                    Created on {formatPublishDate(item.createdAt)}
                  </Text>
                </>
              ) : (
                <>
                  {/*  Normal interior generation → Show details */}
                  <Text style={styles.bookTitle}>
                    <Text style={styles.label}>Room Type: </Text>{item.roomType}
                  </Text>

                  <Text style={styles.caption}>
                    <Text style={styles.label}>Design Style: </Text>{item.designStyle}
                  </Text>

                  <Text style={styles.caption}>
                    <Text style={styles.label}>Color Tone: </Text>{item.colorTone}
                  </Text>

                  <Text style={styles.date}>
                    Created on {formatPublishDate(item.createdAt)}
                  </Text>
                </>
              )}

            </View>

            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => confirmDelete(item._id)}
            >
              <Ionicons name="trash-outline" size={20} color={COLORS.primaryDark} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        {/* ✅ Show native ads only for non-premium/non-subscribed users */}
        {/* {showAds && ((index + 1) % 4 === 0 || index === 0) && (
          <View style={{ marginVertical: 10 }}>
            <NativeCollectionAd />
          </View>
        )} */}
      </>
    );
  };

  if (loading && !refreshing && designs.length === 0) return <Loader />;

  const renderFooter = () =>
    loading && !refreshing ? (
      <ActivityIndicator style={styles.footerLoader} size="small" color={COLORS.primary} />
    ) : null;

  return (
    <View style={styles.container}>
      <FlatList
        data={designs}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item._id ?? "key"}-${index}`}
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
            <Text style={styles.title}>LIVINAI</Text>
          </View>
        }
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          !loading && <Text style={styles.emptyText}>No designs found.</Text>
        }
      />

      {/* Delete Confirmation Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={deleteModalVisible}
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setDeleteModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Delete Design</Text>
                <Text style={styles.modalMessage}>
                  Are you sure you want to delete this design?
                </Text>
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => setDeleteModalVisible(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.deleteConfirmButton]}
                    onPress={handleDeleteDesign}
                  >
                    <Text style={[styles.modalButtonText, { color: COLORS.white }]}>
                      Delete
                    </Text>
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
