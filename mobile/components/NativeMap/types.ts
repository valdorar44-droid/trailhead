/** Shared types for the native map. */

export interface RouteStep {
  type: string;
  modifier: string;
  name: string;
  distance: number;  // metres
  duration: number;  // seconds
  lat?: number;
  lng?: number;
  lanes?: { indications: string[]; valid: boolean; active?: boolean }[];
  speedLimit?: number | null;
}

export interface WP {
  lat: number; lng: number; name: string; day: number; type: string;
}

export interface RouteOpts {
  avoidTolls: boolean; avoidHighways: boolean;
  backRoads: boolean;  noFerries: boolean;
}

export interface MapBounds {
  n: number; s: number; e: number; w: number; zoom: number;
}

export interface RouteResult {
  coords: [number, number][];
  steps: RouteStep[];
  legs: RouteStep[][];
  totalDistance: number;
  totalDuration: number;
  isProper: boolean;
  fromCache?: boolean;
}
