import React from 'react';
import { ScrollView, Text, StyleSheet, Linking, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import COLORS from '../constants/colors';

const Privacy = () => {
  return (
    <LinearGradient
      colors={[COLORS.background, '#ffffff']} // gradient background
      style={styles.gradient}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Privacy Policy</Text>

        <Section title="General">
          <Text style={styles.text}>
            LIVINAI ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how your personal information is collected, used, and disclosed by LIVINAI.
          </Text>
          <Text style={styles.text}>
            By accessing or using our mobile application, LIVINAI, you agree to the collection, storage, use, and disclosure of your personal information as described in this Privacy Policy and our Terms of Service.
          </Text>
        </Section>

        <Section title="Definitions and Key Terms">
          <Bullet text="Cookie: Small data file stored in your browser used to remember preferences or login info." />
          <Bullet text="Personal Data: Any information that identifies you (name, email, device ID, etc.)." />
          <Bullet text="Device: Any connected device (e.g., phone, tablet, computer) used to access LIVINAI." />
          <Bullet text="Service: Refers to LIVINAI and its features." />
        </Section>

        <Section title="Information Automatically Collected">
          <Text style={styles.text}>
            We collect IP address, device characteristics, browser type, OS, referring URLs, and usage activity like screen views, page durations, and interaction logs to secure and optimize the app.
          </Text>
        </Section>

        <Section title="Personal Data and Collection Methods">
          <Bullet text="Identity: Name and email address" />
          <Bullet text="Contact: Email address" />
          <Bullet text="Device: IP address, device name, OS version, identifiers" />
          <Bullet text="Content: Uploaded room photos, visual design preferences" />
        </Section>

        <Section title="Use of Information">
          <Bullet text="Provide AI-generated interior design services" />
          <Bullet text="Improve app functionality" />
          <Bullet text="Respond to customer support requests" />
          <Bullet text="Communicate important updates" />
          <Bullet text="Comply with legal obligations" />
        </Section>

        <Section title="Third-Party Services and Sharing">
          <Text style={styles.text}>
            We do not sell your personal data. We may share data with trusted third parties including:
          </Text>
          <Bullet text="Cloud storage providers" />
          <Bullet text="Analytics and crash reporting platforms" />
          <Bullet text="AI model processing services" />
          <Bullet text="Legal authorities if required by law" />
          <Text style={styles.text}>
            All partners are contractually required to follow data privacy obligations.
          </Text>
        </Section>

        <Section title="Data Retention">
          <Text style={styles.text}>
            We retain your data as long as needed to provide services and for legal compliance. You may request deletion of your data at any time.
          </Text>
        </Section>

        <Section title="Security">
          <Text style={styles.text}>
            We use encryption, access control, and secure infrastructure to protect your data. Despite our efforts, no system is entirely secure.
          </Text>
        </Section>

        <Section title="Children's Privacy">
          <Text style={styles.text}>
            We do not knowingly collect information from children under 13. If we become aware, we will delete it promptly.
          </Text>
        </Section>

        <Section title="User Rights">
          <Text style={styles.text}>
            All users have the same fundamental privacy rights. This includes the right to access, update, delete, or object to the processing of your data. To exercise your rights, contact us at{' '}
            <Text 
              style={styles.link} 
              onPress={() => Linking.openURL('mailto:livinai2025@gmail.com')}
            >
              livinai2025@gmail.com
            </Text>.
          </Text>
        </Section>

        <Section title="Data Breach Notification">
          <Text style={styles.text}>
            In the event of a data breach, we will notify affected users and relevant authorities as required by applicable law.
          </Text>
        </Section>

        <Section title="Cookies and Tracking">
          <Text style={styles.text}>
            We may use cookies or local storage to enhance functionality and performance. You can disable these through your device settings.
          </Text>
        </Section>

        <Section title="Push Notifications">
          <Text style={styles.text}>
            We may send push notifications. You may disable them through your device settings at any time.
          </Text>
        </Section>

        <Section title="In-App Purchases">
          <Text style={styles.text}>
            Payments are processed securely through the Apple App Store or Google Play Store. LIVINAI does not store any credit card or payment details.
          </Text>
        </Section>

        <Section title="Compliance">
          <Text style={styles.text}>
            This Privacy Policy is designed to comply with global privacy principles that promote transparency, fairness, and user control.
          </Text>
        </Section>

        <Section title="Changes to this Policy">
          <Text style={styles.text}>
            We may revise this Privacy Policy from time to time. Significant changes will be communicated via app updates or email. Continued use of LIVINAI implies acceptance of any updates.
          </Text>
        </Section>

        <Section title="Contact Us">
          <Text style={styles.text}>
            Email: <Text 
              style={styles.link} 
              onPress={() => Linking.openURL('mailto:livinai2025@gmail.com')}
            >
              livinai2025@gmail.com
            </Text>{'\n'}
          </Text>
        </Section>
      </ScrollView>
    </LinearGradient>
  );
};

const Section = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.heading}>{title}</Text>
    {children}
  </View>
);

const Bullet = ({ text }) => (
  <View style={styles.bulletContainer}>
    <Text style={styles.bulletPoint}>{'\u2022'}</Text>
    <Text style={styles.bulletText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 10,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
  },
  link: {
    color: '#007aff',
    textDecorationLine: 'underline',
  },
  bulletContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  bulletPoint: {
    fontSize: 15,
    marginRight: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    marginBottom: 20,
  },
});

export default Privacy;
