import { useEffect } from 'react';
import { Text, View } from 'react-native';
import styles from '../../assets/styles/profile.styles';
import { useAuthStore } from '../../authStore';


export default function ProfileHeader() {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth(); // Load from AsyncStorage
  }, []);

  const {user} = useAuthStore();

  if(!user) return null;

  return (
    <View style={styles.profileHeader} marginTop={32}>
      {/* <Image source={{uri: user.profileImage }} style={styles.profileImage} />*/} 
      <Text style={styles.username}>{user.name}</Text>
      <Text style={styles.email}>{user.email}</Text>
      {/* <Text style={styles.memberSince}>Joined {formatMemberSince(user.createdAt)}</Text> */}
    </View>
  )
}