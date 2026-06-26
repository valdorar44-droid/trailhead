# Route Builder Geoapify Provider Follow-Up

Status: planned, not part of the immediate Route Builder banner/search hotfix.

## Scope

- Keep Geoapify calls backend-only behind `GEOAPIFY_API_KEY`.
- Do not call Geoapify directly from mobile clients.
- Use Geoapify `geocode/autocomplete` as a city/address suggestion fallback when Mapbox, Trailhead catalog, and open fallback geocoding miss or return weak locality results.
- Use Geoapify `v2/places` for category POIs near a selected town, waypoint, or route corridor, especially camp/service searches.
- Preserve provider guards, runtime cache keys, quota backoff, and graceful empty fallbacks.

## Candidate Flow

1. Route Builder asks `/api/geocode` or a backend POI endpoint with query, limit, country filters, and optional route context.
2. Backend ranks Trailhead catalog, current geocode providers, and locality candidates first for generic city-like queries.
3. If results are empty or weak, backend calls Geoapify autocomplete for city/address suggestions.
4. For category queries such as `fuel near moab`, `moab campgrounds`, or `arches trails`, backend can use Geoapify Places near the resolved anchor or corridor.
5. Mobile receives normalized Trailhead result objects only, with user-facing labels like `Town`, `Address`, `Camp`, `Trailhead`, `Explorer pick`, and `Fuel`.
