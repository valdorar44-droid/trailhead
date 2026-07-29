const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname, {
  annotateReactComponents: false,
  includeWebReplay: false,
  enableSourceContextInDevelopment: false,
});

// expo-sqlite's web worker imports wa-sqlite as a WebAssembly asset.
// Keep native and web exports on the same Metro configuration.
if (!config.resolver.assetExts.includes('wasm')) config.resolver.assetExts.push('wasm');

module.exports = config;
