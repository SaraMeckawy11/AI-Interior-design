import { View, Text, Image, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform,Alert} from 'react-native';
import React, { useState, useEffect } from 'react';
import styles from "../../assets/styles/signup.styles";
import {Ionicons} from "@expo/vector-icons";
import COLORS from '../../constants/colors';
import { Link, router } from 'expo-router';
import { useRouter } from "expo-router";
import { useAuthStore } from '../../store/authStore';
import { LinearGradient } from 'expo-linear-gradient';

export default function Signup() {

    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showpassword, setShowPassword] = useState(false);
    const {user, isLoading, register} = useAuthStore();

    console.log("user is here:", user);

    const router = useRouter();

    const handleSignUp = async () =>{
      const result = await register(username, email, password);

      if(!result.success) Alert.alert("Error", result.error)
    };

  return (
    <KeyboardAvoidingView
    style={{flex:1}}
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ILLUSTRATION */}
      {/* <View style={styles.topIllustration}>
        <Image
        source={require("../../assets/images/i4.png")}
        style={styles.illustrationImage}
        resizeMode="contain"
        />
      </View> */}

      <View style={styles.container}>
        <View style={styles.card}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Roomify</Text>
            <Text style={styles.subtitle}>Inspired by you. Designed by Roomify</Text>
          </View>
          <View style={styles.formContainer}>

            {/*Username input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Username</Text>
              <View style={styles.inputContainer}>
                <Ionicons
                  name="person-outline"
                  size={20}
                  color={COLORS.primary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="SaraMeckawy"
                  placeholderTextColor={COLORS.placeholderText}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* Email */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputContainer}>
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={COLORS.primary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="SaraMeckawy@gmail.com"
                  placeholderTextColor={COLORS.placeholderText}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

             {/*PASSWORD */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputContainer}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={COLORS.primary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  placeholderTextColor={COLORS.placeholderText}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showpassword}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showpassword)}
                  style={styles.eyeIcon}
                >
                  <Ionicons
                    name={showpassword ? "eye-outline" : "eye-off-outline"}
                    size={20}
                    color={COLORS.primary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/*SignUp button */}
            {/* <TouchableOpacity style={styles.button} onPress={handleSignUp}
            disabled={isLoading}>
              {isLoading?(
                <ActivityIndicator color="#fff" />
              ):(
                <Text style={styles.buttonText}>Sign Up</Text>
              )}
            </TouchableOpacity> */}

            <TouchableOpacity style={styles.buttonWrapper} onPress={handleSignUp} disabled={isLoading}>
                <LinearGradient
                  colors={[COLORS.primary, COLORS.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.buttonGradient}
                >

                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Sign Up</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account?</Text>
                <TouchableOpacity onPress={ () => router.back()}>
                  <Text style={styles.link}>Login</Text>
                </TouchableOpacity>
            </View>
            
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>

  )
}