const { withPlugins, withPodfile, withXcodeProject } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const TAG = 'trailhead-tile-server';

function applyIos164Platform(contents) {
  if (contents.includes("platform :ios, '16.4'")) return contents;
  return contents
    .replace(/platform :ios,\s*min_ios_version_supported/g, "platform :ios, '16.4'")
    .replace(/platform :ios,\s*['"][0-9.]+['"]/g, "platform :ios, '16.4'");
}

function applyPodfilePostInstall(contents) {
  const result = mergeContents({
    tag: `${TAG}:post-install`,
    src: contents,
    newSrc: '    $TrailheadTileServer.post_install(installer)',
    anchor: /post_install do \|installer\|/,
    offset: 1,
    comment: '#',
  });
  return result.didMerge || result.didClear ? result.contents : contents;
}

// Config plugin: registers the TileServer CocoaPod so EAS Build picks it up.
function withTileServer(config) {
  return withPlugins(config, [
    c => withPodfile(c, podfileConfig => {
      podfileConfig.modResults.contents = applyPodfilePostInstall(
        applyIos164Platform(podfileConfig.modResults.contents)
      );
      return podfileConfig;
    }),
    c => withXcodeProject(c, xcodeConfig => {
      xcodeConfig.modResults.updateBuildProperty('IPHONEOS_DEPLOYMENT_TARGET', '16.4');
      return xcodeConfig;
    }),
  ]);
}

module.exports = withTileServer;
