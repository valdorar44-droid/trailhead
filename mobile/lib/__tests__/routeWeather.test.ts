import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RouteWeatherResult, WeatherForecast } from '../api';
import {
  routeWeatherCacheEnvelope,
  routeWeatherCacheFileName,
  routeWeatherForecastForWaypoint,
  routeWeatherResultFromCache,
  routeWeatherWaypointSignature,
} from '../routeWeather';

function forecast(latitude: number, longitude: number, high: number): WeatherForecast {
  return {
    latitude,
    longitude,
    daily: {
      time: ['2026-07-15'],
      temperature_2m_max: [high],
      temperature_2m_min: [high - 20],
      precipitation_sum: [0],
      windspeed_10m_max: [8],
      weathercode: [1],
    },
  };
}

test('uses the exact waypoint name before coordinate fallback', () => {
  const exact = forecast(38.8, -109.8, 91);
  const nearby = forecast(38.5733, -109.5498, 84);
  const result: RouteWeatherResult = {
    trip_id: 'trip-1',
    forecasts: { 'Sand Flats': exact, Moab: nearby },
  };

  assert.equal(
    routeWeatherForecastForWaypoint(result, { name: 'Sand Flats', lat: 38.57, lng: -109.55 }),
    exact,
  );
});

test('uses a nearby forecast when close waypoints were consolidated', () => {
  const moab = forecast(38.5733, -109.5498, 84);
  const result: RouteWeatherResult = { trip_id: 'trip-2', forecasts: { Moab: moab } };

  assert.equal(
    routeWeatherForecastForWaypoint(result, { name: 'Sand Flats Recreation Area', lat: 38.585, lng: -109.51 }),
    moab,
  );
});

test('matches the restored Sand Flats camp to the live Moab forecast', () => {
  const moab = forecast(38.582798, -109.55138, 103.1);
  const result: RouteWeatherResult = {
    trip_id: 'manual_1784093097924_vrkzd8',
    forecasts: { 'Moab, Utah, United States': moab },
  };

  assert.equal(
    routeWeatherForecastForWaypoint(result, {
      name: 'Sand Flats Recreation Area Group Campsites',
      type: 'camp',
      day: 1,
      lat: 38.5676972,
      lng: -109.5270972,
    }),
    moab,
  );
});

test('does not reuse a forecast outside the route-weather radius', () => {
  const result: RouteWeatherResult = {
    trip_id: 'trip-3',
    forecasts: { Moab: forecast(38.5733, -109.5498, 84) },
  };

  assert.equal(
    routeWeatherForecastForWaypoint(result, { name: 'Green River', lat: 38.9956, lng: -110.161 }, 20),
    null,
  );
});

test('ignores forecasts without usable coordinates', () => {
  const coordinateFree = forecast(38.5733, -109.5498, 84);
  delete coordinateFree.latitude;
  delete coordinateFree.longitude;
  const result: RouteWeatherResult = { trip_id: 'trip-4', forecasts: { Moab: coordinateFree } };

  assert.equal(
    routeWeatherForecastForWaypoint(result, { name: 'Sand Flats', lat: 38.585, lng: -109.51 }),
    null,
  );
});

test('cache identity changes with units and normalized waypoint geometry', () => {
  const waypoints = [{ name: ' Sand Flats ', type: 'CAMP', day: 1, lat: 38.5676972, lng: -109.5270972 }];
  const signature = routeWeatherWaypointSignature(waypoints);
  assert.equal(
    signature,
    routeWeatherWaypointSignature([{ name: 'sand flats', type: 'camp', day: 1, lat: 38.5677, lng: -109.5271 }]),
  );
  assert.notEqual(
    routeWeatherCacheFileName('trip-1', 'imperial', signature),
    routeWeatherCacheFileName('trip-1', 'metric', signature),
  );
  assert.notEqual(
    routeWeatherCacheFileName('trip-1', 'imperial', signature),
    routeWeatherCacheFileName('trip-1', 'imperial', routeWeatherWaypointSignature([{ ...waypoints[0], lat: 38.7 }])),
  );
});

test('cached weather must match units, waypoint identity, and camp coverage', () => {
  const camp = { name: 'Sand Flats', type: 'camp', day: 1, lat: 38.5677, lng: -109.5271 };
  const signature = routeWeatherWaypointSignature([camp]);
  const result: RouteWeatherResult = {
    trip_id: 'trip-5',
    forecasts: { Moab: forecast(38.582798, -109.55138, 103.1) },
  };
  const envelope = routeWeatherCacheEnvelope(result, 'imperial', signature);

  assert.equal(routeWeatherResultFromCache(envelope, 'imperial', signature, [camp]), result);
  assert.equal(routeWeatherResultFromCache(envelope, 'metric', signature, [camp]), null);
  assert.equal(routeWeatherResultFromCache(envelope, 'imperial', 'changed', [camp]), null);
  assert.equal(
    routeWeatherResultFromCache(envelope, 'imperial', signature, [{ ...camp, lat: 39.5 }]),
    null,
  );
});
