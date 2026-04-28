const { withPlugins } = require('@expo/config-plugins');

// Config plugin: registers the TileServer CocoaPod so EAS Build picks it up.
function withTileServer(config) {
  return withPlugins(config, []);
}

module.exports = withTileServer;
