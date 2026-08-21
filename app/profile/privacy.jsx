import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import ScreenHeader from '../../components/ScreenHeader';
import COLORS from '../../constants/colors';
import { SPACING, TYPE } from '../../constants/theme';

const Privacy = () => (
  <LinearGradient colors={[COLORS.background, COLORS.white]} style={styles.gradient}>
    <ScreenHeader title="Privacy Policy" />
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.effective}>Effective August 21, 2026</Text>

      <Section title="About this policy">
        <Text style={styles.text}>
          Livinai provides AI-powered interior, exterior, and 3D home-design tools. This policy explains what information we process, why it is needed, and the choices available to you.
        </Text>
      </Section>

      <Section title="Information we process">
        <Bullet text="Account: name, email address, authentication-provider identifier, and profile image when supplied by Sign in with Apple or Google. Livinai does not ask you to create a separate password." />
        <Bullet text="Your content: images you select, design preferences, prompts, generated designs, saved projects, project titles, and floor-plan or 3D project data." />
        <Bullet text="Purchases: product identifiers, transaction status, and subscription or entitlement state. Apple or Google processes payment details; Livinai does not receive your full card details." />
        <Bullet text="App activity: design counts, feature interactions, rewarded-ad activity, device or app identifiers, diagnostics, and information needed to operate and secure the service." />
        <Bullet text="Support: your email address and information you choose to include when contacting us." />
      </Section>

      <Section title="How we use information">
        <Text style={styles.text}>
          We use information to authenticate accounts; create, store, and display designs; operate subscriptions and coins; deliver and measure eligible advertising; award coins for completed rewarded ads; maintain security; diagnose problems; improve reliability; respond to support requests; and meet legal obligations.
        </Text>
        <Text style={styles.text}>
          Uploaded and generated designs are private to your account unless you choose to share or export them. Livinai has no public gallery or social feed.
        </Text>
      </Section>

      <Section title="Service providers">
        <Bullet text="Apple and Google for authentication, and the device store for in-app purchases" />
        <Bullet text="RevenueCat for purchase and subscription entitlement management" />
        <Bullet text="Google AdMob for advertising, including optional rewarded ads" />
        <Bullet text="Render and MongoDB Atlas for application hosting and data infrastructure" />
        <Bullet text="Cloudinary for media storage and delivery" />
        <Bullet text="Modal and RunPod for computing and AI design processing" />
        <Text style={styles.text}>
          We use providers whose contractual and privacy commitments require protections consistent with this policy and applicable law, and limit their access to what is needed to provide their services.
        </Text>
      </Section>

      <Section title="Advertising and tracking">
        <Text style={styles.text}>
          On iOS, Livinai requests permission through Apple&apos;s App Tracking Transparency prompt before allowing tracking across other companies&apos; apps or websites where permission is required. You may decline or change this choice in iOS Settings. Declining does not prevent use of Livinai&apos;s design features; ads may be less personalised.
        </Text>
        <Text style={styles.text}>
          Where regional advertising consent rules require it, Profile &gt; Advertising Privacy lets you review or change your advertising choices.
        </Text>
      </Section>

      <Section title="Sharing and sale">
        <Text style={styles.text}>
          We do not sell your personal information. We disclose information to service providers only as needed to operate Livinai, when required by law, to protect Livinai or others, or as part of a permitted business transfer.
        </Text>
      </Section>

      <Section title="Retention and account deletion">
        <Text style={styles.text}>
          We retain information while your account is active and as needed to provide Livinai. Limited records may be retained for legal, fraud-prevention, security, dispute-resolution, or accounting obligations.
        </Text>
        <Text style={styles.text}>
          To begin permanent deletion, open Profile &gt; Account &gt; Delete Account and confirm Delete Forever. Account deletion does not cancel a store subscription; cancel that separately from Manage Subscription.
        </Text>
      </Section>

      <Section title="Your choices and rights">
        <Text style={styles.text}>
          You can manage photo and tracking permissions in device Settings, restore eligible purchases in Livinai, and manage subscriptions through your store account. Depending on where you live, you may request access, correction, deletion, restriction, objection, or a portable copy of certain personal information by contacting us.
        </Text>
      </Section>

      <Section title="Children">
        <Text style={styles.text}>
          Livinai is not directed to children under 13, and we do not knowingly collect personal information from children under 13. Contact us if you believe a child has provided information.
        </Text>
      </Section>

      <Section title="Security and international processing">
        <Text style={styles.text}>
          We use reasonable technical and organisational safeguards, including encrypted network connections and access controls. No storage or transmission method is completely secure. Livinai and its providers may process information in countries other than your own using safeguards required by applicable law.
        </Text>
      </Section>

      <Section title="Changes">
        <Text style={styles.text}>
          We may update this policy as Livinai, our providers, or legal requirements change. We will publish the revised policy and update its effective date.
        </Text>
      </Section>

      <Section title="Contact">
        <Text style={styles.text}>
          For privacy questions or requests, email{' '}
          <Text
            accessibilityRole="link"
            style={styles.link}
            onPress={() => Linking.openURL('mailto:livinai2025@gmail.com?subject=Livinai%20Privacy%20Request')}
          >
            livinai2025@gmail.com
          </Text>.
        </Text>
      </Section>
    </ScrollView>
  </LinearGradient>
);

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
  gradient: { flex: 1 },
  container: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxxl,
  },
  effective: {
    ...TYPE.caption,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  section: { marginBottom: SPACING.base },
  heading: {
    ...TYPE.h3,
    color: COLORS.textPrimary,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  text: {
    ...TYPE.small,
    color: COLORS.textSecondary,
    lineHeight: 21,
    marginBottom: SPACING.sm,
  },
  link: {
    color: COLORS.primaryDark,
    textDecorationLine: 'underline',
  },
  bulletContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.xs + 2,
  },
  bulletPoint: {
    ...TYPE.small,
    color: COLORS.primary,
    marginRight: SPACING.sm,
  },
  bulletText: {
    flex: 1,
    ...TYPE.small,
    color: COLORS.textSecondary,
    lineHeight: 21,
  },
});

export default Privacy;
