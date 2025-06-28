import { View, Text } from 'react-native';
import React from 'react';
import { Tabs,  Redirect} from "expo-router";
import { Ionicons } from "@expo/vector-icons"; 
import COLORS from '../../constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
        screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: COLORS.primary,
            headerTitleStyle:{
              color: COLORS.textPrimary,
              fontWeight:"600",
            },
            headerShadowVisible:false,

            tabBarStyle:{
              backgroundColor:COLORS.cardBackground,
              //borderTopWidth:1,
              elevation:4,
              borderTopColor: COLORS.border,
              paddingTop: 4,
              height: 60 + insets.bottom,
              paddingBottom: insets.bottom ,
            },
        }}
    >      
      <Tabs.Screen name ="create"
        options={{
            title: "Create",
            tabBarIcon: ({color,size}) => (
            <Ionicons name="add-circle-outline" size={size} color={color}/>
            ),
        }}
      />
      <Tabs.Screen name ="collection"
        options={{
            title:"Collection",
            tabBarIcon: ({color,size}) => (
            <Ionicons name="home-outline" size={size} color={color}/>
            ),
        }}
      />
      <Tabs.Screen name ="profile"
        options={{
            title: "Profile",
            tabBarIcon: ({color,size}) => (
            <Ionicons name="person-outline" size={size} color={color}/>
            ),
        }}
      />
    </Tabs>
  )
}