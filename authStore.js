import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { apiUrl } from "./configs/api";

export const useAuthStore = create((set) => ({
  user: null,
  token: null,
  isLoading: false,
  isCheckingAuth: true,

  // Complete a Google or Apple login after the backend verifies the provider token.
  loginSocial: async (user, accessToken) => {
    try {
      set({ isLoading: true });

      if (!accessToken) throw new Error("No token received");

      const normalizedUser = {
        ...user,
        username: user.username || user.name || "user" + Date.now(),
      };

      await AsyncStorage.multiSet([
        ["user", JSON.stringify(normalizedUser)],
        ["token", accessToken],
      ]);

      set({ user: normalizedUser, token: accessToken, isLoading: false });
      return { success: true };
    } catch (error) {
      console.error("Social login error:", error);
      set({ isLoading: false });
      return { success: false, error: error.message || "Login failed" };
    }
  },

  //Login with email + password
  loginWithEmail: async (email, password) => {
    try {
      set({ isLoading: true });

      const res = await axios.post(
        apiUrl("/api/auth/login"),
        { email, password }
      );

      const { user, accessToken } = res.data;

      if (!accessToken) throw new Error("No token received");

      const normalizedUser = {
        ...user,
        username: user.username || user.name || "user" + Date.now(),
      };

      await AsyncStorage.multiSet([
        ["user", JSON.stringify(normalizedUser)],
        ["token", accessToken],
      ]);

      set({ user: normalizedUser, token: accessToken, isLoading: false });
      return { success: true };
    } catch (error) {
      console.error("Email login error:", error.response?.data || error.message);
      set({ isLoading: false });
      return { success: false, error: error.response?.data?.message || "Login failed" };
    }
  },

  //Signup with email + password
  signupWithEmail: async (username, email, password) => {
    try {
      set({ isLoading: true });

      const res = await axios.post(
        apiUrl("/api/auth/signup"),
        { username, email, password }
      );

      const { user, accessToken } = res.data;

      if (!accessToken) throw new Error("No token received");

      const normalizedUser = {
        ...user,
        username: user.username || user.name || username || "user" + Date.now(),
      };

      await AsyncStorage.multiSet([
        ["user", JSON.stringify(normalizedUser)],
        ["token", accessToken],
      ]);

      set({ user: normalizedUser, token: accessToken, isLoading: false });
      return { success: true };
    } catch (error) {
      console.error("Signup error:", error.response?.data || error.message);
      set({ isLoading: false });
      return { success: false, error: error.response?.data?.message || "Signup failed" };
    }
  },

  //Aliases (shortcuts)
  register: (...args) => useAuthStore.getState().signupWithEmail(...args),
  signup: (...args) => useAuthStore.getState().signupWithEmail(...args),
  login: (...args) => useAuthStore.getState().loginWithEmail(...args),

  //Check persisted login
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

  //Logout
  logout: async () => {
    try {
      await AsyncStorage.multiRemove(["token", "user"]);
      set({ token: null, user: null });
    } catch (error) {
      console.error("Logout error:", error);
    }
  },

  // Getter
  getToken: () => {
    const { token } = useAuthStore.getState();
    return token;
  },

    // Fetch user data from backend and update store
  fetchUser: async () => {
    const { token } = useAuthStore.getState();
    if (!token) return null;

    try {
      const res = await axios.get(
        apiUrl("/api/users/me"),
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 60000,
        }
      );

      if (res.data?.user) {
        await AsyncStorage.setItem("user", JSON.stringify(res.data.user));
        useAuthStore.setState({ user: res.data.user });
        return res.data.user;
      }
      return null;
    } catch (error) {
      if (error.response?.status === 401) {
        await AsyncStorage.multiRemove(["token", "user"]);
        useAuthStore.setState({ token: null, user: null });
        console.warn("Stored session is no longer valid. Please sign in again.");
        return null;
      }

      console.error(
        "fetchUser error:",
        error.response?.data || error.message,
        "URL:",
        apiUrl("/api/users/me")
      );
      return null;
    }
  },

}));

