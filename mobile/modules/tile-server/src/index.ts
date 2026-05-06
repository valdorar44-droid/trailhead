import { requireOptionalNativeModule } from 'expo-modules-core';

const M = requireOptionalNativeModule('TileServerModule');

export const TILE_SERVER_PORT = 57832;

/** Start the HTTP server socket (call once on app launch). */
export async function startServer(): Promise<void> {
  if (!M) throw new Error('TileServerModule not in binary');
  return M.startServer();
}

/** Swap the active state PMTiles file without restarting the socket. */
export async function switchState(pmtilesPath: string): Promise<void> {
  if (!M) throw new Error('TileServerModule not in binary');
  return M.switchState(pmtilesPath);
}

/** Load the base (z0–z9 US) PMTiles file. Survives state switches. */
export async function setBase(pmtilesPath: string): Promise<void> {
  if (!M) throw new Error('TileServerModule not in binary');
  return M.setBase(pmtilesPath);
}

/** Load a contour overlay PMTiles file. Survives state/base map switches. */
export async function setContours(pmtilesPath: string): Promise<void> {
  if (!M?.setContours) throw new Error('TileServerModule setContours not in binary');
  return M.setContours(pmtilesPath);
}

/** Clear the active contour overlay PMTiles file. */
export async function clearContours(): Promise<void> {
  if (!M?.clearContours) return;
  return M.clearContours();
}

/** Load a dedicated trail overlay PMTiles file. Survives state/base map switches. */
export async function setTrails(pmtilesPath: string): Promise<void> {
  if (!M?.setTrails) throw new Error('TileServerModule setTrails not in binary');
  return M.setTrails(pmtilesPath);
}

/** Clear the active trail overlay PMTiles file. */
export async function clearTrails(): Promise<void> {
  if (!M?.clearTrails) return;
  return M.clearTrails();
}

/** Stop the server and release all readers. */
export async function stopServer(): Promise<void> {
  if (!M) return;
  return M.stopServer();
}

/** Returns true if the server socket is listening. */
export async function isRunning(): Promise<boolean> {
  if (!M) return false;
  return M.isRunning();
}

/** Calculate a local Valhalla route from a downloaded routing pack tarball. */
export async function routeValhalla(packPath: string, requestJson: string): Promise<string> {
  if (!M?.routeValhalla) throw new Error('TileServerModule routeValhalla not in binary');
  return M.routeValhalla(packPath, requestJson);
}
