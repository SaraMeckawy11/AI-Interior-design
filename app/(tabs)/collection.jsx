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

export default function Collection() {
  const { token } = useAuthStore();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const [activeDesigns, setActiveDesigns] = useState(0);
  const [totalDesigns, setTotalDesigns] = useState(null);

  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [selectedDesignId, setSelectedDesignId] = useState(null);

  const router = useRouter();

  // Fetch subscription + activeDesigns
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (res.ok && data.user) {
          setIsSubscribed(data.user.isSubscribed);
          setIsPremium(data.user.isPremium);
          setActiveDesigns(data.user.activeDesigns || 0); // DB count
        }
      } catch {}
      finally { setStatusLoaded(true); }
    };

    if (token) fetchStatus();
  }, [token]);

  // Fetch paginated designs
  const fetchDesigns = async (pageNum = 1, refresh = false) => {
    try {
      if (refresh) setRefreshing(true);
      else if (pageNum === 1) setLoading(true);

      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SERVER_URI}/api/designs?page=${pageNum}&limit=5`,
        {
          headers: { Authorization: token ? `Bearer ${token}` : "" }
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error();

      const newDesigns = data.output || [];
      setTotalDesigns(data.totalDesigns || newDesigns.length);  // use DB count

      setDesigns(prev => refresh ? newDesigns : [...prev, ...newDesigns]);
      setHasMore(pageNum < data.totalPages);
      setPage(pageNum);
    } catch {}
    finally {
      refresh ? setRefreshing(false) : setLoading(false);
    }
  };

  useEffect(() => {
    fetchDesigns();
  }, []);

  // DELETE design
  const handleDeleteDesign = async () => {
    try {
      await fetch(`${process.env.EXPO_PUBLIC_SERVER_URI}/api/designs/${selectedDesignId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });

      setDesigns(prev => prev.filter(d => d._id !== selectedDesignId));
      setActiveDesigns(prev => Math.max(prev - 1, 0));
      setTotalDesigns(prev => Math.max(prev - 1, 0));

      setDeleteModalVisible(false);
    } catch {
      setDeleteModalVisible(false);
    }
  };

  const confirmDelete = id => {
    setSelectedDesignId(id);
    setDeleteModalVisible(true);
  };

  const handleLoadMore = () => {
    if (hasMore && !loading && !refreshing) fetchDesigns(page + 1);
  };

  // ===============================
  // RENDER EACH ITEM
  // ===============================
  const renderItem = ({ item, index }) => {
    const fullPrompt = (item.customPrompt || "").trim();
    const isPrompt = fullPrompt || item.roomType === "Prompt Only";
    const shortPrompt = fullPrompt.length > 80 ? fullPrompt.slice(0, 80) + "..." : fullPrompt;

    // USE totalDesigns → fallback → designs.length
    const total =
      (typeof totalDesigns === "number" && totalDesigns > 0)
        ? totalDesigns
        : (activeDesigns > 0 ? activeDesigns : designs.length);

    let num = total - index;
    if (num < 1) num = 1;

    const designNumber = num.toString().padStart(2, "0");

    return (
      <TouchableOpacity
        style={styles.bookCard}
        onPress={() =>
          router.push({
            pathname: "/outputScreen",
            params: {
              generatedImage: item.generatedImage || null,
              image: item.image,
              customPrompt: fullPrompt,
              roomType: item.roomType || "",
              designStyle: item.designStyle || "",
              colorTone: item.colorTone || "",
              createdAt: item.createdAt,
              _id: item._id,
            },
          })
        }
      >
        <View style={styles.bookImageContainer}>
          <Image
            source={{ uri: item.generatedImage || item.image }}
            style={styles.bookImage}
            contentFit="cover"
          />
        </View>

        <View style={styles.detailsContainer}>
          <View style={styles.bookDetails}>
            {isPrompt ? (
              <>
                <Text style={styles.bookTitle} numberOfLines={1}>
                  Design description
                </Text>

                <Text style={styles.caption} numberOfLines={2}>
                  {shortPrompt || "No description provided"}
                </Text>

                <Text style={styles.date}>
                  Created on {formatPublishDate(item.createdAt)}
                </Text>
              </>
            ) : (
              <>
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

         {/* RIGHT SIDE — number at top right, trash at bottom right */}
          <View
            style={{
              width: 50,
              justifyContent: "space-between",
              alignItems: "center",
              paddingVertical: 4,
            }}
          >
            {/* Number at the top */}
            <Text
              style={{
                fontSize: 12,
                color: COLORS.textSecondary,
                fontWeight: "600",
                opacity: 0.7,
                marginBottom: 6,
                marginTop: 8,
              }}
            >
              #{designNumber}
            </Text>

            {/* Spacer pushes trash icon down */}
            <View style={{ flex: 1 }} />

            {/* Trash icon at the bottom (unchanged style) */}
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => confirmDelete(item._id)}
            >
              <Ionicons name="trash-outline" size={20} color={COLORS.primaryDark} />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && designs.length === 0) return <Loader />;

  return (
    <View style={styles.container}>
      <FlatList
        data={designs}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item._id}-${index}`}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchDesigns(1, true)}
            colors={[COLORS.primary]}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>LIVINAI</Text>
          </View>
        }
      />

      {/* DELETE MODAL */}
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
                    <Text style={{ color: COLORS.white }}>Delete</Text>
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
