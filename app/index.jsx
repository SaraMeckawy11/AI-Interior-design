// import React, { useEffect, useState } from "react";
// import * as SecureStore from "expo-secure-store";
// import { Redirect } from "expo-router";


// export default function Index() {
//   const [loggedInUser, setLoggedInUser] = useState(false);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     async function checkLoginStatus() {
//       try {
//         const token = await SecureStore.getItemAsync("accessToken");
//         setLoggedInUser(!!token);
//       } catch (error) {
//         console.error("Error checking token", error);
//         setLoggedInUser(false);
//       } finally {
//         setLoading(false);
//       }
//     }

//     checkLoginStatus();
//   }, []);

//   if (loading) return null;

//   return <Redirect href={loggedInUser ? '/create' : "/(routes)/onboarding"} />;
  
// }


import React, { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuthStore } from "@/authStore"; // Update if needed
import Loader from "@/components/Loader"; // Optional loader

export default function Index() {
  const { token, isCheckingAuth, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth(); // This loads token & user from AsyncStorage
  }, []);

if (isCheckingAuth) return <Loader />; // or return null;

  return <Redirect href={token ? "/create" : "/(routes)/onboarding"} />;
}

