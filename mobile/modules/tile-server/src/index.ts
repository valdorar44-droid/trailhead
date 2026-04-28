import { NativeModulesProxy } from 'expo-modules-core';

const M = NativeModulesProxy.TileServerModule;

export const TILE_SERVER_PORT = 57832;
export const LOCAL_STYLE_URL  = `http://127.0.0.1:${TILE_SERVER_PORT}/api/style.json`;
export const LOCAL_TILE_URL   = `http://127.0.0.1:${TILE_SERVER_PORT}/api/tiles/{z}/{x}/{y}.pbf`;
export const LOCAL_GLYPH_URL  = `https://tiles.gettrailhead.app/api/fonts/{fontstack}/{range}.pbf`;

/** Start the tile server reading from a local .pmtiles file. Idempotent. */
export async function startServer(pmtilesPath: string): Promise<void> {
  return M.startServer(pmtilesPath);
}

/** Stop the tile server. */
export async function stopServer(): Promise<void> {
  return M.stopServer();
}

/** Returns true if the server is currently listening. */
export async function isRunning(): Promise<boolean> {
  return M.isRunning();
}
