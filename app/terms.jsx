import React from 'react';
import { ScrollView, Text, StyleSheet, Linking, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import COLORS from '../constants/colors';

const Terms = () => {
  return (
    <LinearGradient
      colors={[COLORS.background, COLORS.white]} // 🎨 Gradient background
      style={styles.gradient}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Terms and Conditions</Text>

        <Section title="Acceptance of Terms">
          <Text style={styles.text}>
            By downloading, accessing, or using LIVINAI, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use the application.
          </Text>
        </Section>

        <Section title="Use of the App">
          <Text style={styles.text}>
            LIVINAI provides AI-powered interior design features for personal and non-commercial use. You agree to use the app legally and responsibly, without harming other users, LIVINAI’s functionality, or its integrity.
          </Text>
        </Section>

        <Section title="Eligibility">
          <Text style={styles.text}>
            You must be at least 13 years old to use LIVINAI. If you are under the age of majority in your jurisdiction, you must have permission from a parent or legal guardian.
          </Text>
        </Section>

        <Section title="User Accounts">
          <Text style={styles.text}>
            You may need to register for an account. You are responsible for keeping your login information secure and for all activity under your account. You agree not to impersonate others or misrepresent your identity.
          </Text>
        </Section>

        <Section title="User Content">
          <Text style={styles.text}>
            You retain ownership of the content you upload, such as room images and preferences. By uploading content, you grant LIVINAI a non-exclusive, royalty-free license to use it for processing, design generation, and service improvement.
          </Text>
          <Text style={styles.text}>
            You must not upload any material that is unlawful, harmful, or infringes on third-party rights.
          </Text>
        </Section>

        <Section title="Prohibited Conduct">
          <Bullet text="Impersonating others or submitting misleading information" />
          <Bullet text="Uploading illegal, offensive, or infringing content" />
          <Bullet text="Disrupting the operation of LIVINAI or violating security" />
          <Bullet text="Attempting to reverse-engineer, copy, or exploit the app" />
        </Section>

        <Section title="Subscription and Payments">
          <Text style={styles.text}>
            Certain features are offered via subscription. Payments are handled through the App Store or Google Play and are subject to those platforms’ terms. LIVINAI does not store or access your payment details.
          </Text>
          <Text style={styles.text}>
            You are responsible for managing your subscription, including cancellations and renewals.
          </Text>
        </Section>

        <Section title="Intellectual Property">
          <Text style={styles.text}>
            All LIVINAI content, software, branding, and design (excluding your own uploads) are owned or licensed by LIVINAI and protected by intellectual property laws. You may not copy, modify, or distribute them without permission.
          </Text>
        </Section>

        <Section title="Availability and Updates">
          <Text style={styles.text}>
            We strive to maintain uninterrupted service but cannot guarantee the app will always be available. We may update, modify, or discontinue features without notice.
          </Text>
        </Section>

        <Section title="Termination">
          <Text style={styles.text}>
            We may suspend or terminate your account if you violate these Terms or misuse the service. You may also delete your account at any time through app settings or by contacting us.
          </Text>
        </Section>

        <Section title="Disclaimer of Warranty">
          <Text style={styles.text}>
            LIVINAI is provided "as is" and without warranties of any kind. We do not guarantee that the app will be error-free, uninterrupted, or meet your expectations.
          </Text>
        </Section>

        <Section title="Limitation of Liability">
          <Text style={styles.text}>
            LIVINAI will not be liable for indirect, incidental, special, or consequential damages resulting from your use of the app. Your sole remedy is to stop using the service.
          </Text>
        </Section>

        <Section title="Indemnification">
          <Text style={styles.text}>
            You agree to defend and hold LIVINAI harmless from any claims, damages, or losses arising from your breach of these Terms or misuse of the app.
          </Text>
        </Section>

        <Section title="Changes to Terms">
          <Text style={styles.text}>
            We reserve the right to update these Terms at any time. Material changes will be communicated via the app or email. Continued use of LIVINAI indicates acceptance of the updated Terms.
          </Text>
        </Section>

        <Section title="Governing Law">
          <Text style={styles.text}>
            These Terms are governed by and construed in accordance with the laws of [Insert Country or Jurisdiction]. Any disputes shall be resolved in the courts of that jurisdiction.
          </Text>
        </Section>

        <Section title="Contact Us">
          <Text style={styles.text}>
            If you have any questions about these Terms, contact us at:
          </Text>
          <Text style={styles.text}>
            Email: <Text style={styles.link} onPress={() => Linking.openURL('mailto:livinai2025@gmail.com')}>livinai2025@gmail.com</Text>
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

export default Terms;
