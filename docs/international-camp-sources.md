# International Camp Source Plan

Trailhead currently aggregates U.S. camps from RIDB/Recreation.gov, BLM, OSM,
Active, and optional private-stay providers. International camp search should
use the same normalized camp shape and plug into `dashboard.server._aggregate_nearby_camps`.

## First Countries

### New Zealand

Best first non-U.S. integration. The national Department of Conservation has a
developer portal and API surface for recreation data.

- Provider: New Zealand Department of Conservation (DOC)
- Portal: https://api.doc.govt.nz/
- API host: `https://api.doc.govt.nz`
- Likely endpoints: `/v2/campsites`, `/v2/huts`, `/v2/tracks`
- Auth: API key/subscription required; unauthenticated calls return `{"message":"Forbidden"}`
- Value: national coverage, campsites, huts, tracks, official government source
- Trailhead source IDs: `nz_doc_camp_*`, `nz_doc_hut_*`
- Source tier: `live_free` once key is configured
- Notes: treat huts as `camp` only when route/camp search explicitly includes
  hut/backcountry stays; otherwise surface them as POIs or shelters.

### Canada

High-value market, but official camping data is fragmented. Start with federal
open-data discovery and province/territory adapters where data is available.

- Catalog API: `https://open.canada.ca/data/api/action/package_search?q=campground`
- License pattern: Open Government Licence - Canada or provincial open licences
- Good first datasets found:
  - Yukon Government Campgrounds:
    `https://open.canada.ca/data/api/action/package_search?q=campground`
    returns the `Campgrounds` dataset with ZIP resource data and government-run
    campground/recreation-site map data.
  - PEI Provincial Parks Campground Occupancy:
    useful for demand/seasonality, not camp geometry.
- Provider strategy:
  - `ingestors/canada_open_data.py` should use curated dataset definitions,
    not blind catalog search at request time.
  - Add per-province parsers as datasets are confirmed: Yukon first, then BC,
    Alberta, Ontario, Quebec, and Parks Canada if a stable public camp geometry
    source is confirmed.
- Trailhead source IDs: `ca_yk_camp_*`, `ca_bc_camp_*`, etc.
- Source tier: `live_free` for current API/GeoJSON resources, `free_auto` for
  downloaded static packs.

### Australia

High-value overlanding/camping country, but official data is state-based.
Use data.gov.au as discovery plus state catalog/API adapters.

- National catalog API: `https://data.gov.au/data/api/3/action/package_search?q=campground`
- Queensland catalog API:
  `https://www.data.qld.gov.au/api/3/action/package_search?q=camping%20areas`
- Good first datasets found:
  - Tasmania `Campground/site`: official The LIST derivative with point/polygon
    camping and caravan-ground locations.
  - Queensland `Camping and vehicle permits`: official QPWS permit data,
    useful for popularity/seasonality, not enough by itself for live geometry.
  - Victoria `Parks Victoria Camp Grounds and Huts (GovHack 2016)`: has camp
    grounds and huts, but the catalog explicitly says it is temporary/not
    official Parks Victoria data, so use only as low-confidence fallback.
- Provider strategy:
  - `ingestors/australia_open_data.py` should start with Tasmania geometry and
    add Queensland/NSW/Victoria only after stable official feature services or
    GeoJSON/WFS resources are confirmed.
  - The confirmed Noosa Council GeoJSON/WFS feed is wired as an opt-in default
    because the public GeoServer was too slow during live probing. Enable with
    `AUSTRALIA_INCLUDE_DEFAULT_GEOJSON=true` only after mirroring or confirming
    acceptable response times.
  - Keep booking/availability separate from location search unless the source
    explicitly exposes live inventory.
- Trailhead source IDs: `au_tas_camp_*`, `au_qld_camp_*`, etc.

### Pakistan

Pakistan is valuable for Trek/Overland discovery, especially Gilgit-Baltistan,
Hunza, Skardu, Deosai, Khunjerab, and the K2/Baltoro corridor. It should not be
treated as an official campground API market yet.

- Official destination/protected-area sources:
  - Gilgit-Baltistan Tourism: `https://visitgilgitbaltistan.gov.pk/`
  - Gilgit-Baltistan Forest, Wildlife and Environment Department:
    `https://fwegb.gov.pk/`
- Live fallback: OpenStreetMap/Overpass for `tourism=camp_site`,
  `tourism=caravan_site`, `tourism=alpine_hut`, `tourism=wilderness_hut`,
  `amenity=shelter`, `shelter_type=basic_hut`, `tourism=guest_house`,
  `tourism=hostel`, and `tourism=chalet`.
- Trailhead source IDs: `osm_outdoor_stay_*`
- Source tier: `mixed_osm_curated`
- Coverage added first:
  - K2 Base Camp Trek / Baltoro / Concordia
  - Hunza Valley and Upper Hunza
  - Skardu and Askole staging areas
  - Fairy Meadows / Nanga Parbat
  - Rakaposhi
  - Central Karakoram, Deosai, and Khunjerab protected areas
- Notes: label these as mixed-confidence planning leads. Do not imply legal
  camping, booking availability, guide availability, permit status, or current
  road/glacier safety.

Live work added June 15, 2026:

- GDACS RSS is wired into the server conditions pipeline, so Pakistan routes can
  inherit nearby flood, earthquake, cyclone, volcano, drought, and wildfire
  notices without showing unrelated town-wide clutter.
- `/api/route-confidence/pakistan` exists as a conservative API scaffold. It
  marks K2/Baltoro/Karakoram trek corridors as `trekking_only`, mountain access
  regions as `medium` or `low`, and clearly says it is pending OSM road-tag
  validation.
- Docker is available locally again. Build the Pakistan Valhalla artifact from
  Geofabrik next, publish it to R2, then replace the scaffold with real segment
  scoring from the imported OSM graph.

## Next Country Source Leads

These are not all production-ready. Keep them in this order so the catalog grows
from stronger sources before softer tourism or partner data.

### Canada - Yukon first

- Source: open.canada.ca CKAN search for `campground`.
- Confirmed useful result: Government of Yukon `Campgrounds`, with all resource
  data ZIP and government-run campground/recreation-site map data.
- Related result: Yukon `Parks and Protected Areas`, useful for Explorer parks,
  protected areas, monuments/equivalents, and trip context.
- Implementation: add a Yukon parser before trying broad Canada. Use ZIP/static
  pack ingestion, not runtime catalog search.

### Australia - Tasmania first, Noosa as small live test

- Source: data.gov.au CKAN search for `campground`.
- Confirmed useful result: Tasmania Government The LIST `Campground/site`,
  point/polygon camping and caravan-ground locations.
- Existing cautious lead: Noosa Accommodation GeoJSON/WFS includes campground
  and accommodation POIs; keep it opt-in or mirrored because public WFS can be
  slow.
- Low-confidence fallback: Parks Victoria Camp Grounds and Huts is useful as a
  format example, but the catalog says it is temporary/not official Parks
  Victoria data.

### France

- Source: data.gouv.fr API search for `campings`.
- Useful pattern: departmental/local camping and camping-car datasets with CSV,
  KML, SHP, WMS, and WFS resources. Some are official local authority/DDT
  datasets; some are OSM-derived and should be labeled community.
- Implementation: add a France CKAN/udata discovery script, then curate only
  datasets with open formats and working public resources.

### Switzerland

- Source direction: swisstopo / geo.admin official layers for hiking routes,
  closures, terrain, protected areas, and map context.
- Hut data: SAC huts are important, but SAC is not a government source. Treat
  as a partner/free-source candidate unless a clearly licensed open feed is
  confirmed.

### Norway

- Source direction: UT.no / DNT cabins and routes are high-value for huts and
  trails, but not government. Treat as a partner/free-source candidate.
- Government support layers can come from Norwegian mapping/environment data for
  protected areas, trails, roads, avalanche/warning context, and offline maps.

### UK

- Retry data.gov.uk. The catalog endpoint returned a technical-difficulty page
  during this pass, so do not mark any UK campsite feed confirmed yet.

## Other Free Sources Worth Layering

- OpenStreetMap/Overpass: already integrated; keep as global fallback for
  `tourism=camp_site`, `tourism=caravan_site`, `tourism=wilderness_hut`,
  `tourism=alpine_hut`, `amenity=camping`, and related service POIs.
- Wikidata/Wikipedia: useful for monuments, historic sites, landmarks, and
  official page enrichment, but not primary camping truth.
- Country data portals via CKAN: useful for discovery, but do not query catalog
  search on every user search. Curate dataset IDs/resources and cache.

## International Terms To Normalize

Add these terms to search, Explore grouping, and Co-Pilot routing language as
country coverage grows:

- Camping: campground, campsite, camp site, caravan park, holiday park,
  motorhome site, aire, stellplatz, refugio camping, bivouac, bivacco.
- Huts/stays: hut, alpine hut, wilderness hut, mountain hut, bothy, refuge,
  refugio, refugi, rifugio, cabane, shelter, trekking lodge, guest house,
  rest house, forest rest house, dak bungalow, chalet, hostel.
- Parks/protected areas: national park, provincial park, state park,
  conservation area, protected landscape, wildlife sanctuary, game reserve,
  biosphere reserve, national monument, historic site.
- Trails/route areas: trail, track, trek, route, pass, base camp, corridor,
  trailhead, viewpoint, overland route, scenic road.

## Implementation Shape

1. Add `INTERNATIONAL_CAMP_PROVIDERS_ENABLED` and per-provider keys in
   `config/settings.py`.
   - `NZ_DOC_API_KEY` / `DOC_API_KEY`
   - `AUSTRALIA_CAMP_GEOJSON_URLS`
   - `CANADA_CAMP_GEOJSON_URLS`
   - `AUSTRALIA_INCLUDE_DEFAULT_GEOJSON` for the confirmed but slow Noosa WFS
     feed after response time is acceptable.
2. Add provider modules:
   - `ingestors/nz_doc.py`
   - `ingestors/canada_open_data.py`
   - `ingestors/australia_open_data.py`
3. Each provider exposes:
   - `async def get_<provider>_campsites(lat, lng, radius_miles=50, type_filters=None) -> list[dict]`
4. Each result normalizes to the existing camp shape:
   - `id`, `name`, `lat`, `lng`, `tags`, `land_type`, `description`
   - `source`, `verified_source`, `source_badge`, `source_freshness`
   - `official_url`, `booking_url`, `url`, `amenities`, `site_types`
5. Wire providers into `_aggregate_nearby_camps` based on bounding box/country:
   - New Zealand bbox: use DOC only inside NZ.
   - Canada bbox: use Canada curated sources only inside Canada.
   - Australia bbox: use Australia curated sources only inside Australia.
   - Pakistan bbox: use mixed-confidence OSM outdoor stays and curated Explore
     anchors for K2/Hunza/Skardu until official geometry is confirmed.
6. Add source ranks for official international government sources above OSM and
   below first-party U.S. RIDB/NPS if there is no booking/availability.
7. Cache:
   - API key providers: runtime cache plus DB cache for 24-72 hours.
   - Static ZIP/SHP/GeoJSON datasets: scheduled or manual pack build into
     `data/place_packs`, not fetched during every request.

## Caveats

- Official location data does not equal legal current access. Keep Trailhead's
  existing warning: verify access, fees, stay limits, fire restrictions, road
  conditions, and booking rules.
- Booking/availability should not be implied unless the specific government API
  exposes inventory for the requested date.
- Some government catalog results are metadata-only or historical permit usage.
  They are useful for enrichment, not map pins.
