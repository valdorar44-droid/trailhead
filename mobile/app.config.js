module.exports = {
  expo: {
    name: 'Trailhead',
    slug: 'trailhead',
    version: '1.0.2',
    runtimeVersion: { policy: 'fingerprint' },
    updates: { url: 'https://u.expo.dev/92c016d2-6e63-480e-a483-a6898d7e77d5' },
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'trailhead',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#0c0f14',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.trailhead.app',
      buildNumber: '4',
      usesAppleSignIn: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: 'Trailhead uses your location to show your position on the map, provide turn-by-turn navigation, find nearby campsites, and alert you to road hazard reports near your current position.',
        NSLocationAlwaysAndWhenInUseUsageDescription: 'Trailhead uses your location in the background so navigation and audio guide narrations continue when your phone is locked while driving.',
        NSLocationAlwaysUsageDescription: 'Trailhead uses background location so turn-by-turn navigation and landmark audio narrations play while your screen is off.',
        NSMicrophoneUsageDescription: 'Trailhead uses your microphone when you choose to speak to the Extreme Explorer Co-Pilot.',
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
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.MODIFY_AUDIO_SETTINGS',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.VIBRATE',
        'android.permission.RECORD_AUDIO',
        'com.android.vending.BILLING',
      ],
    },
    plugins: [
      'expo-router',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'Trailhead uses location to auto-play audio guides as you drive near landmarks.',
          locationAlwaysPermission: 'Background location lets Trailhead narrate landmarks while your phone is in your pocket.',
          isAndroidBackgroundLocationEnabled: true,
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
      'expo-apple-authentication',
      'expo-font',
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
      './plugins/withKotlinVersion',
    ],
    experiments: { typedRoutes: true },
    extra: {
      googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
      googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
      googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
      router: { origin: false },
      eas: { projectId: '92c016d2-6e63-480e-a483-a6898d7e77d5' },
    },
    owner: 'danub44',
  },
};
