import React from 'react';
import { ScrollView, View, Text, StyleSheet, Linking, TouchableOpacity } from 'react-native';

const Contact = () => {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Contact Us</Text>

      <Section title="Customer Support">
        <Text style={styles.text}>
          For help with using Roomify, bug reports, feature requests, or general questions, please contact our support team.
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL('mailto:support@roomify.app')}>
          <Text style={styles.link}>support@roomify.app</Text>
        </TouchableOpacity>
      </Section>

      <Section title="Privacy Concerns">
        <Text style={styles.text}>
          If you have questions or concerns about how your data is handled or want to exercise your privacy rights, email our privacy team.
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL('mailto:privacy@roomify.app')}>
          <Text style={styles.link}>privacy@roomify.app</Text>
        </TouchableOpacity>
      </Section>

      <Section title="Business Inquiries">
        <Text style={styles.text}>
          For partnerships, collaborations, press, or investment inquiries, feel free to reach out.
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL('mailto:business@roomify.app')}>
          <Text style={styles.link}>business@roomify.app</Text>
        </TouchableOpacity>
      </Section>

      <Section title="Head Office">
        <Text style={styles.text}>
          [Insert Legal Business Name]{'\n'}
          [Insert Street Address]{'\n'}
          [Insert City, Country, Postal Code]
        </Text>
      </Section>

      <Section title="Website">
        <TouchableOpacity onPress={() => Linking.openURL('https://www.roomify.app')}>
          <Text style={styles.link}>www.roomify.app</Text>
        </TouchableOpacity>
      </Section>
    </ScrollView>
  );
};

const Section = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.heading}>{title}</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
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
    fontSize: 15,
    color: '#007aff',
    textDecorationLine: 'underline',
    marginBottom: 10,
  },
  section: {
    marginBottom: 20,
  },
});

export default Contact;
