# Official Place Enrichment

Trailhead should treat official/free public data as the default enrichment layer for Places Nearby, trip timelines, guide tabs, and offline place packs. Mobile UI should read fast normalized records from the backend cache; live third-party provider calls should be ingestion or explicit unlock paths, not the default app path.

## Source Registry

- National Park Service API: parks, places, things to do, campgrounds, visitor centers, alerts, activities, and official images. Use for parks, historic stops, visitor centers, viewpoints, campgrounds, and guide content. Sources: https://www.nps.gov/subjects/developer/api-documentation.htm and https://www.nps.gov/subjects/digital/nps-data-api.htm
- RIDB / Recreation.gov API: federal recreation areas, facilities, campsites, media, attributes, activities, and booking URLs. Use for developed federal camps, fees, amenities, reservable status, and media. Source: https://ridb.recreation.gov/
- Bureau of Land Management ArcGIS: recreation sites and public-land recreation features. Use for BLM camps, trailheads, day-use areas, water/river access, OHV areas, and access notes. Sources: https://www.blm.gov/services/geospatial/GISData and https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation/MapServer/layers
- US Forest Service ArcGIS / Enterprise Data Warehouse: recreation sites, trails, roads, and visitor map data. Use for USFS camps, trailheads, picnic/day-use sites, visitor centers, and forest access context. Source: https://www.fs.usda.gov/about-agency/enterprise-data-warehouse
- Census / TIGERweb and USGS GNIS: city, county, place, boundary, and official name context. Use for parent place labels, county/city grouping, region search, and source QA. Sources: https://www.census.gov/data/developers/data-sets/TIGERweb-map-service.html, https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb, and https://www.usgs.gov/tools/geographic-names-information-system-gnis
- Data.gov, Socrata, CKAN, and ArcGIS Hub catalogs: discovery layer for city/county/state datasets. Add adapters per jurisdiction for parks, trailheads, public art, historic places, waterfront access, visitor assets, facilities, restrooms, parking, and open-space boundaries. Sources: https://resources.data.gov/catalog-api/, https://open.gsa.gov/api/datadotgov/, and https://docs.ckan.org/en/latest/api/
- Wikipedia, Wikidata, Wikimedia Commons, and Openverse: free contextual summaries and media where official sources do not have full profiles. Use for guide copy, historical context, and non-sensitive landmark images with source badges and license attribution. Sources: https://www.wikidata.org/wiki/Help:Queries and https://docs.openverse.org/api/
- OpenStreetMap / Overpass: open fallback for common POIs and missing local data. Use as an ingestion fallback, not the primary authority for official park/camp/access records when government data exists. Source: https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL

## Normalized Cache Shape

Every adapter should write one normalized place profile shape: name, lat/lng, type/subtype, source/source badge, official URL, photos/media with credits, summary/description, activities/things to do, amenities, fees/permits, hours/seasonality, alerts, accessibility, parent park/forest/city/county, route position metadata, and offline readiness.

## Image Source Registry

Automated image enrichment should use official/open sources first:

- NPS, RIDB/Recreation.gov, USFS, BLM, state/county/city open-data portals, and official ArcGIS Hub media when the payload includes image URLs, credits, and source URLs.
- Wikimedia Commons, Wikidata, Wikipedia lead images, and Openverse when license, creator/credit, source URL, and reuse terms are stored with each media item.
- Pixabay-style API providers only when the adapter stores provider name, asset URL, source page URL, license/reuse terms, author/credit, and fetched timestamp.

Manual or provider-specific fallback candidates:

- Adobe Stock free assets, iStock free assets, Vecteezy free photos, Pixabay, Kaboompics, and similar commercial-use libraries can fill missing scenic/place cards after provider terms are checked for each asset class.
- Do not bulk-ingest stock/free-photo search results without saving the provider, source page, license text or license URL, author/credit, commercial-use status, editorial restriction flag, and approval timestamp.
- If a trail card has no own photo, the app should fall back to the parent Explore area photo, then to official source-pack child photos, then to an intentional placeholder. Blank image cards should not ship.

## Product Rules

- Official/free enrichment is available to everyone and can satisfy Places Nearby, trip timeline, and guide-tab discovery without paid provider unlocks.
- Google/Foursquare-style rich provider details stay explicit/on-demand and locked where required.
- Nearby trip results should be sorted by day/leg position when route context is available, then source priority, then distance.
- Place pack downloads should cache the normalized records and media references needed for fast offline discovery.
- City/county/state data should be harvested into source-specific adapters, then normalized into the same place profile shape. Avoid live mobile calls to scattered municipal portals.
- Cache raw source payloads separately from normalized records so schema fixes can be replayed without re-pulling every upstream API.
