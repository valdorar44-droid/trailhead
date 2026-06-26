# Route Intelligence Source Cache

## Implemented hot path

- Route Builder, planner context, and future copilots should prefer `/api/route/intelligence` for camps, fuel, services, and route POIs.
- The endpoint samples the route/corridor once, serves canonical cached places when fresh enough, refreshes stale or thin results through the existing backend source fanout, and writes normalized pins back to `places`.
- Mobile still keeps local/offline packs and old per-source calls as empty/error fallbacks.
- Provider names are backend concerns. Mobile rows should show category/source quality labels, not raw provider routing.

## Current source coverage

- Camps/reservations: RIDB/Recreation.gov, BLM, USFS, NPS, OSM/Overpass, ACTIVE/ReserveAmerica, international registry adapters, curated regional packs.
- Fuel/services/POI: OSM/Overpass, NREL alternative fuels, Geoapify Places, Foursquare Places, provider-guarded Google Places legacy code, Mapbox/map-context search, Nominatim fallback.
- Trails/explore: NPS, OSM/Geofabrik, USFS, BLM, Wikidata, OpenBeta, curated Pakistan/NZ DOC paths, Explore catalog fixtures.
- Activities/offers: ACTIVE activities, Viator, Outdoorsy offers.
- Conditions/context: NWS/weather, fire perimeters, mobile coverage, hydro/marine providers, offline place packs.

## Source refresh rules

- Store every useful pin in canonical `places` with `last_refreshed_at`, `refresh_after`, `cache_status`, and source freshness notes.
- Treat official/open government recreation data as slower-moving and refresh on a roughly 14-day window unless a source exposes an update timestamp.
- Treat commercial/POI/service data as faster-moving and refresh on a roughly 7-day window.
- Return stale cached data when providers are slow, but mark it stale and trigger a source refresh when possible.
- Keep all paid or keyed providers backend-only through existing provider guards, runtime cache, quota backoff, and graceful empty fallback.

## Good next additions

- Geoapify Autocomplete: backend fallback for weak city/address suggestions, paired with Geoapify Places around a selected town or route corridor.
- State/provincial open data: parks, campgrounds, trailheads, dump stations, and visitor centers from state GIS portals and Canadian provincial open-data portals.
- iOverlander, The Dyrt, KOA, Hipcamp, Harvest Hosts, Campendium/Roadtrippers-style sources: useful only with explicit API/licensing/partnership terms. Do not scrape or call from mobile.
- Public EV/fuel additions: Open Charge Map for EV chargers and state DOT rest-area datasets, alongside NREL.
- Closures and hazards: agency alerts from NPS/USFS/BLM/state parks, 511/DOT road closures, NOAA/NWS alerts, and fire/air-quality feeds.

## Non-goals for this hotfix

- No new mobile direct provider calls.
- No new paid provider dependency in the OTA path.
- No scraping of sources without clear API/license terms.
