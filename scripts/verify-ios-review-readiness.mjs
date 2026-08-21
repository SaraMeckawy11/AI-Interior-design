import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const pass = (condition, message) => {
  if (!condition) failures.push(message);
};

const rawAppConfig = JSON.parse(read('app.json'));
const appConfig = rawAppConfig.expo;
const plugin = (name) => appConfig.plugins.find((entry) =>
  (Array.isArray(entry) ? entry[0] : entry) === name);

const adsPlugin = plugin('react-native-google-mobile-ads');
const trackingPlugin = plugin('expo-tracking-transparency');
const adsOptions = Array.isArray(adsPlugin) ? adsPlugin[1] : {};
const trackingOptions = Array.isArray(trackingPlugin) ? trackingPlugin[1] : {};
const purpose = trackingOptions.userTrackingPermission || '';

pass(appConfig.ios?.bundleIdentifier === 'com.livinai.app', 'Unexpected iOS bundle identifier.');
pass(appConfig.ios?.usesAppleSignIn === true, 'Sign in with Apple entitlement is not enabled.');
pass(appConfig.ios?.supportsTablet === false, 'The iPhone-only setting changed.');
pass(Boolean(trackingPlugin), 'expo-tracking-transparency is missing from app plugins.');
pass(Boolean(adsPlugin), 'Google Mobile Ads is missing from app plugins.');
pass(adsOptions.delayAppMeasurementInit === true, 'AdMob app measurement is not delayed.');
pass(adsOptions.userTrackingUsageDescription === purpose, 'ATT purpose strings disagree between plugins.');
pass(/other companies/i.test(purpose) && /ads/i.test(purpose), 'ATT purpose string does not clearly describe cross-company ad tracking.');

const privacy = read('lib/adsPrivacy.js');
const requestAt = privacy.indexOf('trackingStatus = await requestTrackingWhileVisible()');
const consentAt = privacy.indexOf('AdsConsent.gatherConsent()');
const initializeAt = privacy.indexOf('mobileAds().initialize()');
pass(requestAt >= 0, 'Root advertising privacy flow does not await ATT.');
pass(consentAt > requestAt, 'Google consent runs before ATT resolves.');
pass(initializeAt > consentAt, 'AdMob initializes before ATT and Google consent resolve.');
pass(privacy.includes('AppState.currentState === "active"'), 'ATT request is not gated on an active app.');
pass(privacy.includes('PermissionStatus.UNDETERMINED'), 'ATT request does not check for an undetermined choice.');
pass(privacy.includes('if (Platform.OS !== "ios") return PermissionStatus.GRANTED'), 'Apple ATT is not limited to iOS.');

const layout = read('app/_layout.jsx');
pass(layout.includes('initializeAdvertisingPrivacy()'), 'Root layout does not start the privacy gate.');
pass(layout.includes('if (!advertisingPrivacyResolved) return <Loader branded />'), 'Navigation is not held behind the privacy gate.');

const indexRoute = read('app/index.jsx');
pass(!indexRoute.includes('mobileAds'), 'Index route initializes AdMob separately.');
pass(!indexRoute.includes('requestTrackingPermissionsAsync'), 'Index route requests ATT separately.');

for (const file of [
  'app/(tabs)/create.jsx',
  'components/collection/NativeCollectionAd.js',
  'components/create/CreateBannerAd.jsx',
  'lib/useRewardedCoins.js',
]) {
  pass(read(file).includes('useAdvertisingReady'), `${file} is not gated on advertising readiness.`);
}

const profile = read('app/(tabs)/profile.jsx');
pass(profile.includes('AdsConsent.showPrivacyOptionsForm()'), 'Profile is missing the regional advertising privacy-options entry point.');
pass(profile.includes('AdsConsentPrivacyOptionsRequirementStatus.REQUIRED'), 'Advertising privacy options are not limited to users who require them.');

const privacyPolicy = read('app/profile/privacy.jsx');
pass(privacyPolicy.includes('Profile &gt; Account &gt; Delete Account'), 'Privacy policy is missing the in-app deletion path.');
pass(privacyPolicy.includes('protections consistent with this policy'), 'Privacy policy does not confirm equivalent provider protection.');
pass(privacyPolicy.includes('App Tracking Transparency'), 'Privacy policy does not disclose ATT-based advertising.');

const terms = read('app/profile/terms.jsx');
pass(terms.includes('Standard Apple Terms of Use (EULA)'), 'Terms are missing Apple\'s standard EULA link.');
pass(!terms.includes('service improvement'), 'User-content license is broader than the disclosed processing purpose.');

const upgrade = read('components/upgrade/UpgradeExperience.jsx');
pass(upgrade.includes('Auto-renews until canceled'), 'Subscription screen is missing the auto-renewal disclosure.');
pass(upgrade.includes('Restore purchases'), 'Subscription screen is missing Restore Purchases.');
pass(upgrade.includes('Terms of Use') && upgrade.includes('Privacy Policy'), 'Subscription screen is missing legal links.');

const userRoutes = read('backend/src/routes/userRoutes.js');
pass(userRoutes.includes("router.delete('/me'"), 'Backend account-deletion endpoint is missing.');
for (const model of ['CoinGrant', 'Design', 'Order', 'WalkthroughPlan', 'PrePremium']) {
  pass(userRoutes.includes(`${model}.deleteMany`), `Account deletion does not remove ${model} records.`);
}
pass(userRoutes.includes('cloudinary.uploader.destroy'), 'Account deletion does not remove stored media.');

for (const privacyManifest of [
  'node_modules/@react-native-async-storage/async-storage/ios/PrivacyInfo.xcprivacy',
  'node_modules/expo-constants/ios/PrivacyInfo.xcprivacy',
  'node_modules/expo-file-system/ios/PrivacyInfo.xcprivacy',
  'node_modules/react-native/React/Resources/PrivacyInfo.xcprivacy',
]) {
  pass(fs.existsSync(path.join(root, privacyManifest)), `Required SDK privacy manifest is missing: ${privacyManifest}`);
}

const androidManifest = read('android/app/src/main/AndroidManifest.xml');
pass(androidManifest.includes('com.google.android.gms.permission.AD_ID'), 'Android Advertising ID permission is missing.');
pass(/com\.google\.android\.gms\.ads\.DELAY_APP_MEASUREMENT_INIT[\s\S]*?android:value="true"/.test(androidManifest), 'Android native ad measurement is not delayed.');
pass(Array.isArray(appConfig.android?.permissions)
  && appConfig.android.permissions.includes('com.google.android.gms.permission.AD_ID'),
'Android Advertising ID permission is missing from app config.');
const nativeAdsConfig = rawAppConfig['react-native-google-mobile-ads'] || {};
pass(nativeAdsConfig.android_app_id === adsOptions.androidAppId, 'Native Android and Expo AdMob application IDs disagree.');
pass(nativeAdsConfig.ios_app_id === adsOptions.iosAppId, 'Native iOS and Expo AdMob application IDs disagree.');
pass(nativeAdsConfig.delay_app_measurement_init === true, 'Native Android ad measurement is not delayed in the library configuration.');

const notes = read('APP_REVIEW_NOTES.md');
const notesStart = notes.indexOf('Livinai 1.0');
const notesEnd = notes.indexOf('## App Store Connect checklist');
const field = notes.slice(notesStart, notesEnd).trim();
pass(Buffer.byteLength(field, 'utf8') <= 4000, 'App Review Notes exceed Apple\'s 4,000-byte limit.');
pass(field.includes('Profile > Account > Delete Account'), 'Review Notes contain the wrong account-deletion path.');
pass(field.includes('https://livinai2025.github.io/support/'), 'Review Notes are missing the live Support URL.');

if (failures.length) {
  console.error(`App Review readiness failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('App Review readiness checks passed.');
console.log(`App Review Notes: ${Buffer.byteLength(field, 'utf8')} / 4000 bytes.`);
