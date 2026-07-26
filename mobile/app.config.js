const enabled = value => /^(1|true|yes|on|enabled)$/i.test(String(value || ''));
const { resolveReleaseCommitSha } = require('./scripts/release-identity.cjs');
const branchApiKey = process.env.BRANCH_API_KEY || process.env.EXPO_PUBLIC_BRANCH_KEY || '';
const branchDomain = process.env.EXPO_PUBLIC_BRANCH_DOMAIN || 'go.gettrailhead.app';
const branchAlternateDomain = process.env.EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN || '';
const branchProvidedDomains = String(
  process.env.EXPO_PUBLIC_BRANCH_PROVIDED_DOMAINS
    || 'zswub.app.link,zswub-alternate.app.link',
).split(',').map(value => value.trim()).filter(Boolean);
const branchUniversalLinkDomains = [
  ...new Set([branchDomain, branchAlternateDomain, ...branchProvidedDomains].filter(Boolean)),
];
const releaseCommitSha = resolveReleaseCommitSha(process.env);
const sentryPluginOptions = {
  url: process.env.SENTRY_URL || 'https://sentry.io/',
  ...(process.env.SENTRY_ORG ? { organization: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
};

module.exports = {
  expo: {
    name: 'Trailhead',
    slug: 'trailhead',
    version: '1.0.10',
    runtimeVersion: 'native-1.0.10-ios.3',
    newArchEnabled: true,
    updates: { url: 'https://u.expo.dev/92c016d2-6e63-480e-a483-a6898d7e77d5' },
    icon: './assets/icon.png',
    scheme: 'trailhead',
    userInterfaceStyle: 'automatic',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#0c0f14',
    },
    ios: {
      runtimeVersion: 'native-1.0.10-ios.3',
      supportsTablet: true,
      bundleIdentifier: 'com.trailhead.app',
      usesAppleSignIn: true,
      associatedDomains: [
        'applinks:gettrailhead.app',
        'applinks:api.gettrailhead.app',
        ...branchUniversalLinkDomains.map(domain => `applinks:${domain}`),
      ],
      infoPlist: {
        NSLocationWhenInUseUsageDescription: 'Trailhead uses your location to show your position on the map, provide turn-by-turn navigation, find nearby campsites, and alert you to road hazard reports near your current position.',
        NSLocationAlwaysAndWhenInUseUsageDescription: 'Trailhead uses location in the background so navigation and Original stories can continue after you lock your phone or switch apps. Location stops when you end navigation or the tour.',
        NSLocationAlwaysUsageDescription: 'Trailhead uses location in the background so navigation and Original stories can continue after you lock your phone or switch apps. Location stops when you end navigation or the tour.',
        NSMicrophoneUsageDescription: 'Trailhead uses your microphone only when you choose the Co-Pilot voice assistant.',
        NSCameraUsageDescription: 'Trailhead uses your camera to take photos for field reports. For example, you can photograph a washed-out road, a campsite condition, or a trail hazard to warn other overlanders.',
        NSPhotoLibraryUsageDescription: 'Trailhead uses your photo library to attach existing photos to field reports. For example, you can select a photo of a trail condition, campsite, or road hazard to share with the overlanding community.',
        NSAppTransportSecurity: {
          NSAllowsLocalNetworking: true,
        },
        UIBackgroundModes: ['location', 'audio', 'fetch'],
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      runtimeVersion: 'native-1.0.10-android.4',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0c0f14',
      },
      package: 'com.trailhead.app',
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
      permissions: [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.VIBRATE',
        'android.permission.RECORD_AUDIO',
        'com.android.vending.INSTALL_REFERRER',
        'com.android.vending.BILLING',
      ],
      blockedPermissions: [
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          category: ['BROWSABLE', 'DEFAULT'],
          data: [
            { scheme: 'https', host: 'gettrailhead.app', pathPrefix: '/originals' },
            { scheme: 'https', host: 'gettrailhead.app', pathPrefix: '/app' },
            { scheme: 'https', host: 'gettrailhead.app', pathPrefix: '/r' },
            { scheme: 'https', host: 'gettrailhead.app', pathPrefix: '/support' },
            { scheme: 'https', host: 'gettrailhead.app', pathPrefix: '/trips' },
            { scheme: 'https', host: 'gettrailhead.app', pathPrefix: '/prizes' },
            { scheme: 'https', host: 'gettrailhead.app', pathPrefix: '/verify-email' },
          ],
        },
        {
          action: 'VIEW',
          autoVerify: true,
          category: ['BROWSABLE', 'DEFAULT'],
          data: [
            { scheme: 'https', host: 'api.gettrailhead.app', pathPrefix: '/originals' },
          ],
        },
        {
          action: 'VIEW',
          autoVerify: true,
          category: ['BROWSABLE', 'DEFAULT'],
          data: branchUniversalLinkDomains.map(host => ({ scheme: 'https', host })),
        },
      ],
    },
    plugins: [
      'expo-router',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'Trailhead uses location in the background so navigation and Original stories can continue after you lock your phone or switch apps. Location stops when you end navigation or the tour.',
          locationAlwaysPermission: 'Trailhead uses location in the background so navigation and Original stories can continue after you lock your phone or switch apps. Location stops when you end navigation or the tour.',
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/icon.png',
          color: '#e67e22',
          sounds: [],
        },
      ],
      [
        'expo-image-picker',
        {
          cameraPermission: 'Trailhead uses your camera to take photos for field reports. For example, you can photograph a washed-out road, a campsite condition, or a trail hazard to warn other overlanders.',
          photosPermission: 'Trailhead uses your photo library to attach existing photos to field reports. For example, you can select a photo of a trail condition, campsite, or road hazard to share with the overlanding community.',
        },
      ],
      'expo-asset',
      'expo-audio',
      'expo-apple-authentication',
      [
        'expo-font',
        {
          fonts: [
            './assets/fonts/BarlowCondensed-SemiBold.ttf',
            './assets/fonts/BarlowCondensed-Bold.ttf',
          ],
        },
      ],
      'expo-sqlite',
      ['@sentry/react-native/expo', sentryPluginOptions],
      [
        '@config-plugins/react-native-branch',
        {
          apiKey: branchApiKey || 'branch_key_not_configured',
          iosAppDomain: branchDomain,
          iosUniversalLinkDomains: branchUniversalLinkDomains,
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: '16.4',
          },
        },
      ],
      '@config-plugins/react-native-webrtc',
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsImpl: 'mapbox',
          RNMapboxMapsVersion: process.env.RNMAPBOX_MAPS_VERSION || '11.16.0',
        },
      ],
      '@maplibre/maplibre-react-native',
      './modules/tile-server/app.plugin.js',
      './plugins/withAndroidAuto',
      './plugins/withKotlinVersion',
    ],
    experiments: { typedRoutes: true },
    extra: {
      releaseCommitSha,
      uiSystemV2Enabled: enabled(
        process.env.EXPO_PUBLIC_UI_SYSTEM_V2_ENABLED || process.env.UI_SYSTEM_V2_ENABLED || '',
      ),
      branch: {
        attributionEnabled: enabled(process.env.EXPO_PUBLIC_BRANCH_ATTRIBUTION_ENABLED || 'false'),
        // The native key stays secret. OTA manifests use this public capability
        // bit so an update cannot accidentally disable an already-configured
        // native Branch SDK just because EAS does not expose secret values to
        // local env:exec commands.
        configured: enabled(
          process.env.EXPO_PUBLIC_BRANCH_CONFIGURED || (branchApiKey ? 'true' : 'false'),
        ),
        domain: branchDomain,
      },
      googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '253003227791-o34lb5706rokbgq6qdjhagggue5kqddh.apps.googleusercontent.com',
      googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '253003227791-1diqvaq7d5oqnvncmdk22aus8ech1t8p.apps.googleusercontent.com',
      googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
      router: { origin: false },
      eas: { projectId: '92c016d2-6e63-480e-a483-a6898d7e77d5' },
    },
    owner: 'danub44',
  },
};
