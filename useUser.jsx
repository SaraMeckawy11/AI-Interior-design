import { useEffect, useState, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import axios from "axios";

export const setAuthorizationHeader = async () => {
  const token = await SecureStore.getItemAsync("accessToken");
  if (token) {
    axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }
};

export default function useUser() {
  const [user, setUser] = useState(null);
  const [loader, setLoader] = useState(true);
  const [shouldRefetch, setShouldRefetch] = useState(false);

  const fetchUserData = useCallback(async () => {
    setLoader(true);
    try {
      await setAuthorizationHeader();
      console.log("Authorization Header:", axios.defaults.headers.common["Authorization"]);

      const response = await axios.get(`http://192.168.1.162:3000/me`);
      const fetchedUser = response.data.user;

      await SecureStore.setItemAsync("name", fetchedUser.name);
      await SecureStore.setItemAsync("email", fetchedUser.email);
      await SecureStore.setItemAsync("avatar", fetchedUser.avatar);

      setUser(fetchedUser);
    } catch (error) {
      console.error("Error fetching user data:", error.response?.data || error.message);
    } finally {
      setLoader(false);
    }
  }, []);

  useEffect(() => {
    fetchUserData();
    return () => setShouldRefetch(false);
  }, [fetchUserData, shouldRefetch]);

  const refetch = () => setShouldRefetch(true);

  return { user, loader, refetch };
}
