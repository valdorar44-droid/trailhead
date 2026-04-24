const { withAppBuildGradle, withSettingsGradle, withAndroidManifest } = require('@expo/config-plugins');

/**
 * Config plugin that wires react-native-maps into the Android Gradle build.
 * Expo managed workflow doesn't auto-link community packages, so we do it here.
 */
const withReactNativeMaps = (config, { googleMapsApiKey = '' } = {}) => {
  // 1. Include the react-native-maps android project in settings.gradle
  config = withSettingsGradle(config, (mod) => {
    const content = mod.modResults.contents;
    const include = `\ninclude ':react-native-maps'\nproject(':react-native-maps').projectDir = new File(rootProject.projectDir, '../node_modules/react-native-maps/android')\n`;
    if (!content.includes("react-native-maps")) {
      mod.modResults.contents = content + include;
    }
    return mod;
  });

  // 2. Add react-native-maps as a dependency in app/build.gradle
  config = withAppBuildGradle(config, (mod) => {
    const content = mod.modResults.contents;
    const dep = `    implementation project(':react-native-maps')`;
    if (!content.includes("react-native-maps")) {
      mod.modResults.contents = content.replace(
        /dependencies\s*\{/,
        `dependencies {\n${dep}`
      );
    }
    return mod;
  });

  // 3. Inject Google Maps API key into AndroidManifest.xml
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) return mod;
    if (!app['meta-data']) app['meta-data'] = [];
    const metaData = app['meta-data'];
    const mapsKeyName = 'com.google.android.geo.API_KEY';
    if (!metaData.find(m => m.$?.['android:name'] === mapsKeyName)) {
      metaData.push({
        $: {
          'android:name': mapsKeyName,
          'android:value': googleMapsApiKey,
        },
      });
    }
    return mod;
  });

  return config;
};

module.exports = withReactNativeMaps;
