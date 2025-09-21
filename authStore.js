import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const useAuthStore = create((set) => ({
  user: null,
  token: null,
  isLoading: false,
  isCheckingAuth: true,

  // Login and persist data
  login: async (googleUser, idToken) => {
    try {
      set({ isLoading: true });

      // Validate token format
      if (!idToken || typeof idToken !== "string" || idToken.split(".").length !== 3) {
        console.error("Invalid JWT token format:", idToken);
        set({ isLoading: false });
        return;
      }

      // Save to storage
      await AsyncStorage.multiSet([
        ["user", JSON.stringify(googleUser)],
        ["token", idToken],
      ]);

      set({
        user: googleUser,
        token: idToken,
        isLoading: false,
      });
    } catch (error) {
      console.error("Login error:", error);
      set({ isLoading: false });
    }
  },

  // Check if user is already logged in
  checkAuth: async () => {
    try {
      const [token, userJson] = await AsyncStorage.multiGet(["token", "user"]);

      const storedToken = token[1]?.trim() || null;
      const storedUser = userJson[1] ? JSON.parse(userJson[1]) : null;

      set({ token: storedToken, user: storedUser });
    } catch (error) {
      console.error("Auth check failed:", error);
    } finally {
      set({ isCheckingAuth: false });
    }
  },

  // Clear session
  logout: async () => {
    try {
      await AsyncStorage.multiRemove(["token", "user"]);
      console.log("Logged out: token and user removed");
      set({ token: null, user: null });
    } catch (error) {
      console.error("Logout error:", error);
    }
  },

  // Optional: expose token getter
  getToken: () => {
    const { token } = useAuthStore.getState();
    return token;
  },
}))
