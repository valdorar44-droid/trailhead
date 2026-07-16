const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('@expo/config-plugins');

const CAR_PERMISSIONS = [
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'androidx.car.app.ACCESS_SURFACE',
  'androidx.car.app.NAVIGATION_TEMPLATES',
];

function addPermission(manifest, name) {
  const permissions = manifest['uses-permission'] || (manifest['uses-permission'] = []);
  if (!permissions.some(item => item?.$?.['android:name'] === name)) {
    permissions.push({ $: { 'android:name': name } });
  }
}

function upsertMetadata(application, name, attributes) {
  const metadata = application['meta-data'] || (application['meta-data'] = []);
  let item = metadata.find(entry => entry?.$?.['android:name'] === name);
  if (!item) {
    item = { $: { 'android:name': name } };
    metadata.push(item);
  }
  Object.assign(item.$, attributes);
}

function upsertCarService(application) {
  const services = application.service || (application.service = []);
  let carService = services.find(item => item?.$?.['android:name'] === '.car.TrailheadCarAppService');
  if (!carService) {
    carService = { $: { 'android:name': '.car.TrailheadCarAppService', 'android:exported': 'true' } };
    services.push(carService);
  }
  carService.$['android:exported'] = 'true';
  carService['intent-filter'] = [
    {
      action: [{ $: { 'android:name': 'androidx.car.app.CarAppService' } }],
      category: [{ $: { 'android:name': 'androidx.car.app.category.NAVIGATION' } }],
    },
  ];

  let locationService = services.find(item => item?.$?.['android:name'] === '.car.TrailheadCarLocationService');
  if (!locationService) {
    locationService = { $: { 'android:name': '.car.TrailheadCarLocationService' } };
    services.push(locationService);
  }
  Object.assign(locationService.$, {
    'android:exported': 'false',
    'android:foregroundServiceType': 'location',
  });
}

function hasManifestValue(items, key, value) {
  return (items || []).some(item => item?.$?.[key] === value);
}

function addManifestValue(item, group, key, value) {
  const items = item[group] || (item[group] = []);
  if (!hasManifestValue(items, key, value)) {
    items.push({ $: { [key]: value } });
  }
}

function upsertMainActivityIntents(application) {
  const activities = application.activity || (application.activity = []);
  const mainActivity = activities.find(item => {
    const name = item?.$?.['android:name'] || '';
    return name === '.MainActivity' || name.endsWith('.MainActivity');
  });
  if (!mainActivity) {
    throw new Error('Trailhead Android Auto setup could not find MainActivity');
  }

  const filters = mainActivity['intent-filter'] || (mainActivity['intent-filter'] = []);
  let navigationFilter = filters.find(filter => hasManifestValue(
    filter.action,
    'android:name',
    'androidx.car.app.action.NAVIGATE',
  ));
  if (!navigationFilter) {
    navigationFilter = {};
    filters.push(navigationFilter);
  }
  addManifestValue(navigationFilter, 'action', 'android:name', 'androidx.car.app.action.NAVIGATE');
  addManifestValue(navigationFilter, 'category', 'android:name', 'android.intent.category.DEFAULT');
  addManifestValue(navigationFilter, 'data', 'android:scheme', 'geo');

  let mapsFilter = filters.find(filter => hasManifestValue(
    filter.category,
    'android:name',
    'android.intent.category.APP_MAPS',
  ));
  if (!mapsFilter) {
    mapsFilter = {};
    filters.push(mapsFilter);
  }
  addManifestValue(mapsFilter, 'action', 'android:name', 'android.intent.action.MAIN');
  addManifestValue(mapsFilter, 'category', 'android:name', 'android.intent.category.APP_MAPS');
}

function withCarManifest(config) {
  return withAndroidManifest(config, configWithManifest => {
    const manifest = configWithManifest.modResults.manifest;
    CAR_PERMISSIONS.forEach(permission => addPermission(manifest, permission));
    const permissions = manifest['uses-permission'] || [];
    manifest['uses-permission'] = permissions.filter(item => item?.$?.['android:name'] !== 'androidx.car.app.MAP_TEMPLATES');
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(configWithManifest.modResults);
    application.$['android:allowBackup'] = 'false';
    upsertMetadata(application, 'androidx.car.app.minCarApiLevel', { 'android:value': '1' });
    upsertMetadata(application, 'com.google.android.gms.car.application', {
      'android:resource': '@xml/automotive_app_desc',
    });
    upsertCarService(application);
    upsertMainActivityIntents(application);
    return configWithManifest;
  });
}

function withCarDependencies(config) {
  return withAppBuildGradle(config, configWithGradle => {
    if (configWithGradle.modResults.language !== 'groovy') return configWithGradle;
    const dependencies = [
      'implementation("androidx.car.app:app:1.7.0")',
      'implementation("androidx.car.app:app-projected:1.7.0")',
      'implementation("com.mapbox.maps:android-ndk27:11.16.0")',
      'testImplementation("androidx.car.app:app-testing:1.7.0")',
    ];
    let contents = configWithGradle.modResults.contents;
    dependencies.forEach(dependency => {
      if (!contents.includes(dependency)) {
        contents = contents.replace(/dependencies\s*\{/, match => `${match}\n    ${dependency}`);
      }
    });
    configWithGradle.modResults.contents = contents;
    return configWithGradle;
  });
}

function withAutomotiveDescriptor(config) {
  return withDangerousMod(config, ['android', async configWithFiles => {
    const xmlDir = path.join(
      configWithFiles.modRequest.platformProjectRoot,
      'app', 'src', 'main', 'res', 'xml',
    );
    await fs.promises.mkdir(xmlDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(xmlDir, 'automotive_app_desc.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<automotiveApp>\n  <uses name="template" />\n</automotiveApp>\n',
      'utf8',
    );
    return configWithFiles;
  }]);
}

module.exports = function withAndroidAuto(config) {
  config = withCarManifest(config);
  config = withCarDependencies(config);
  config = withAutomotiveDescriptor(config);
  return config;
};
