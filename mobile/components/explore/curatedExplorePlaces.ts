import type { ExplorePlaceProfile, ExploreSourcePackItem, ExploreTrailCard } from '@/lib/api';

type WaterfallSeed = {
  title: string;
  state: string;
  region: string;
  lat: number;
  lng: number;
  image: string;
  officialUrl: string;
  wikiUrl: string;
  height: string;
  access: string;
  season: string;
  safety: string;
  summary: string;
  highlight: string;
};

const LAST_UPDATED = 1781496931;
const YOSEMITE_TRAILS_URL = 'https://www.nps.gov/yose/planyourvisit/hiking.htm';
const YOSEMITE_FALLS_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Yosemite_falls_winter_2010.JPG/960px-Yosemite_falls_winter_2010.JPG';
const VERNAL_FALL_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Vernal_Fall%2C_Yosemite_NP%2C_CA%2C_US_-_Diliff.jpg/960px-Vernal_Fall%2C_Yosemite_NP%2C_CA%2C_US_-_Diliff.jpg';
const HALF_DOME_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Half_dome_yosemite_nationalpark.JPG/1280px-Half_dome_yosemite_nationalpark.JPG';
const MIRROR_LAKE_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Yosemite_national_park_mirror_lake_2010u.JPG/1280px-Yosemite_national_park_mirror_lake_2010u.JPG';
const GLACIER_POINT_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Glacier_Point_at_Sunset%2C_Yosemite_NP%2C_CA%2C_US_-_Diliff.jpg/1280px-Glacier_Point_at_Sunset%2C_Yosemite_NP%2C_CA%2C_US_-_Diliff.jpg';

const YOSEMITE_TRAILS: ExploreTrailCard[] = [
  {
    id: 'yosemite-mist-trail',
    title: 'Mist Trail',
    difficulty: 'Easy',
    distance_mi: 3.2,
    route_type: 'Out & Back',
    elevation_gain_ft: 700,
    typical_time: '2-3 hrs',
    area: 'Yosemite Valley',
    image_url: VERNAL_FALL_IMAGE,
    summary: 'Close-up Vernal Fall access with mist, granite steps, and big valley views.',
    description: 'A popular Yosemite Valley hike that climbs toward Vernal Fall. Expect wet steps in high flow and heavy use on peak days.',
    best_season: 'Spring to early summer flow',
    dogs: 'Not allowed',
    bikes: 'Not allowed',
    tags: ['Waterfalls', 'Popular'],
    highlights: ['Waterfalls', 'Scenic Views', 'Wildflowers', 'Family Friendly'],
    lat: 37.7325,
    lng: -119.5586,
    source_url: 'https://www.nps.gov/yose/planyourvisit/vernalnevadatrail.htm',
  },
  {
    id: 'yosemite-half-dome',
    title: 'Half Dome',
    difficulty: 'Hard',
    distance_mi: 14.2,
    route_type: 'Out & Back',
    elevation_gain_ft: 4800,
    typical_time: '10-12 hrs',
    area: 'High Country',
    image_url: HALF_DOME_IMAGE,
    summary: 'Permit-only cable route with major elevation, exposure, and all-day commitment.',
    description: 'Half Dome is a long, exposed Yosemite classic. Permits, weather, water, and turnaround time matter before starting.',
    best_season: 'Cable season only',
    dogs: 'Not allowed',
    bikes: 'Not allowed',
    tags: ['Iconic', 'Challenging'],
    highlights: ['Summit', 'Permits', 'Exposure', 'Big Views'],
    lat: 37.7460,
    lng: -119.5332,
    source_url: 'https://www.nps.gov/yose/planyourvisit/halfdome.htm',
  },
  {
    id: 'yosemite-mirror-lake-loop',
    title: 'Mirror Lake Loop',
    difficulty: 'Easy',
    distance_mi: 2.0,
    route_type: 'Loop',
    elevation_gain_ft: 100,
    typical_time: '1-2 hrs',
    area: 'Yosemite Valley',
    image_url: MIRROR_LAKE_IMAGE,
    summary: 'Easy valley walk to seasonal water and Half Dome reflections.',
    description: 'Mirror Lake is a low-effort Yosemite Valley stop with seasonal water, shaded walking, and easy add-on distance.',
    best_season: 'Spring and early summer',
    dogs: 'Paved section only',
    bikes: 'Paved section only',
    tags: ['Family Friendly', 'Scenic'],
    highlights: ['Lake', 'Reflections', 'Easy Walk', 'Half Dome'],
    lat: 37.7485,
    lng: -119.5491,
    source_url: 'https://www.nps.gov/yose/planyourvisit/mirrorlaketrail.htm',
  },
  {
    id: 'yosemite-upper-yosemite-fall',
    title: 'Upper Yosemite Fall Trail',
    difficulty: 'Hard',
    distance_mi: 7.2,
    route_type: 'Out & Back',
    elevation_gain_ft: 2700,
    typical_time: '6-8 hrs',
    area: 'Yosemite Valley',
    image_url: YOSEMITE_FALLS_IMAGE,
    summary: 'Steep climb to the top of Yosemite Falls with exposed switchbacks.',
    description: 'A demanding valley climb with heat, drop-offs, and major payoff views. Start early and carry enough water.',
    best_season: 'Spring to early summer flow',
    dogs: 'Not allowed',
    bikes: 'Not allowed',
    tags: ['Waterfalls', 'Climb'],
    highlights: ['Waterfalls', 'Valley Views', 'Steep Grade', 'Exposure'],
    lat: 37.7426,
    lng: -119.6024,
    source_url: 'https://www.nps.gov/yose/planyourvisit/yosemitefallstrail.htm',
  },
  {
    id: 'yosemite-taft-point',
    title: 'Taft Point & The Fissures',
    difficulty: 'Easy',
    distance_mi: 2.2,
    route_type: 'Out & Back',
    elevation_gain_ft: 200,
    typical_time: '1-2 hrs',
    area: 'Glacier Point Road',
    image_url: GLACIER_POINT_IMAGE,
    summary: 'Short forest approach to cliff-edge views and deep granite fissures.',
    description: 'Taft Point is short but exposed. Stay back from cliff edges and check Glacier Point Road status before driving up.',
    best_season: 'Road-open season',
    dogs: 'Not allowed',
    bikes: 'Not allowed',
    tags: ['Scenic', 'Cliff Views'],
    highlights: ['Fissures', 'Views', 'Sunset', 'Short Hike'],
    lat: 37.7128,
    lng: -119.6047,
    source_url: YOSEMITE_TRAILS_URL,
  },
  {
    id: 'yosemite-mariposa-grove',
    title: 'Mariposa Grove',
    difficulty: 'Easy',
    distance_mi: 2.0,
    route_type: 'Loop',
    elevation_gain_ft: 300,
    typical_time: '1.5-3 hrs',
    area: 'South Entrance',
    image_url: MIRROR_LAKE_IMAGE,
    summary: 'Giant sequoia grove walks with longer loop options beyond the arrival area.',
    description: 'Mariposa Grove gives Yosemite a forest-focused trail day. Shuttle access, snow, and restoration closures can affect plans.',
    best_season: 'Spring through fall',
    dogs: 'Not allowed',
    bikes: 'Not allowed',
    tags: ['Sequoias', 'Family Friendly'],
    highlights: ['Giant Sequoias', 'Forest', 'Loop Options', 'Shade'],
    lat: 37.5116,
    lng: -119.6008,
    source_url: 'https://www.nps.gov/yose/planyourvisit/mg.htm',
  },
];

const WATERFALLS: WaterfallSeed[] = [
  {
    title: 'Multnomah Falls',
    state: 'OR',
    region: 'Columbia River Gorge',
    lat: 45.57595,
    lng: -122.11536,
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Multnomah_Falls_on_2_August_2012.jpg/1280px-Multnomah_Falls_on_2_August_2012.jpg',
    officialUrl: 'https://www.fs.usda.gov/recarea/crgnsa/recarea/?recid=30026',
    wikiUrl: 'https://en.wikipedia.org/wiki/Multnomah_Falls',
    height: '620 ft',
    access: 'Historic Columbia River Highway / I-84',
    season: 'Spring flow, year-round access checks',
    safety: 'Timed permits, icy paths, and closures can apply',
    summary: 'Oregon gorge waterfall with a two-tier drop, bridge viewpoint, and quick access from the Historic Columbia River Highway.',
    highlight: 'A real waterfall anchor for Columbia River Gorge routes, with bridge views, short walks, and permit-sensitive access.',
  },
  {
    title: 'Yosemite Falls',
    state: 'CA',
    region: 'Yosemite Valley',
    lat: 37.756845,
    lng: -119.596785,
    image: 'https://upload.wikimedia.org/wikipedia/commons/3/38/Yosemite_falls_winter_2010.JPG',
    officialUrl: 'https://www.nps.gov/yose/planyourvisit/yosemitefalls.htm',
    wikiUrl: 'https://en.wikipedia.org/wiki/Yosemite_Falls',
    height: '2,425 ft',
    access: 'Yosemite Valley trailheads',
    season: 'Peak flow is usually spring to early summer',
    safety: 'Mist, ice, heat, and exposed upper trail sections',
    summary: 'Yosemite Valley waterfall system with lower-view access and a strenuous upper-falls trail option.',
    highlight: 'A major Yosemite waterfall stop that can be planned as a short valley walk or a harder all-day climb.',
  },
  {
    title: 'Havasu Falls',
    state: 'AZ',
    region: 'Havasupai Reservation',
    lat: 36.255278,
    lng: -112.698056,
    image: 'https://upload.wikimedia.org/wikipedia/commons/4/41/New_havasu_falls.JPG',
    officialUrl: 'https://theofficialhavasupaitribe.com/',
    wikiUrl: 'https://en.wikipedia.org/wiki/Havasu_Falls',
    height: '100 ft',
    access: 'Havasupai permit and campground reservation required',
    season: 'Permit windows and flash-flood risk drive timing',
    safety: 'Remote canyon travel, heat, water crossings, and tribal rules',
    summary: 'Blue-green Grand Canyon waterfall on Havasu Creek inside Havasupai tribal lands.',
    highlight: 'A permit-controlled canyon waterfall that belongs in planning only after access, dates, and tribal rules are confirmed.',
  },
  {
    title: 'Shoshone Falls',
    state: 'ID',
    region: 'Twin Falls',
    lat: 42.595278,
    lng: -114.400833,
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Shoshone_Falls%2C_Idaho.jpg/1280px-Shoshone_Falls%2C_Idaho.jpg',
    officialUrl: 'https://www.tfid.org/309/Shoshone-Falls',
    wikiUrl: 'https://en.wikipedia.org/wiki/Shoshone_Falls',
    height: '212 ft',
    access: 'City park viewpoints near Twin Falls',
    season: 'Spring runoff is usually strongest',
    safety: 'Seasonal flow, road hours, and overlook edges',
    summary: 'Wide Snake River waterfall near Twin Falls with road-access viewpoints and seasonal flow changes.',
    highlight: 'A high-impact roadside waterfall stop that works well as a short scenic break on southern Idaho routes.',
  },
  {
    title: 'Tahquamenon Falls',
    state: 'MI',
    region: 'Upper Peninsula',
    lat: 46.574,
    lng: -85.256,
    image: 'https://upload.wikimedia.org/wikipedia/commons/7/74/Upper_Tahquamenon_Falls_Fall_2007.jpeg',
    officialUrl: 'https://www.michigan.gov/dnr/places/state-parks/tahquamenon-falls',
    wikiUrl: 'https://en.wikipedia.org/wiki/Tahquamenon_Falls',
    height: '50 ft',
    access: 'State park roads and boardwalk viewpoints',
    season: 'Four-season stop with winter access checks',
    safety: 'Snow, boardwalk ice, and river-edge conditions',
    summary: 'Upper Peninsula waterfall series known for amber water, broad views, and state-park trail access.',
    highlight: 'A Great Lakes waterfall anchor with easy viewpoints, forest trails, and useful campground context nearby.',
  },
  {
    title: 'Cumberland Falls',
    state: 'KY',
    region: 'Daniel Boone Country',
    lat: 36.83801,
    lng: -84.34444,
    image: 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Cumberland_falls_2015_1.jpg',
    officialUrl: 'https://parks.ky.gov/corbin/parks/resort/cumberland-falls-state-resort-park',
    wikiUrl: 'https://en.wikipedia.org/wiki/Cumberland_Falls',
    height: '68 ft',
    access: 'State resort park viewpoints and trails',
    season: 'Moonbow nights need date and weather checks',
    safety: 'Wet rock, river levels, and overlook boundaries',
    summary: 'Kentucky waterfall on the Cumberland River, known for broad flow and occasional moonbow viewing.',
    highlight: 'A route-worthy waterfall stop with lodge, trail, and timing context around the famous moonbow window.',
  },
  {
    title: 'Amicalola Falls',
    state: 'GA',
    region: 'North Georgia Mountains',
    lat: 34.5675,
    lng: -84.244444,
    image: 'https://upload.wikimedia.org/wikipedia/commons/2/20/Amicalola_Falls.JPG',
    officialUrl: 'https://gastateparks.org/AmicalolaFalls',
    wikiUrl: 'https://en.wikipedia.org/wiki/Amicalola_Falls',
    height: '729 ft',
    access: 'State park roads, stairs, and approach trails',
    season: 'Good most of year; storms and ice change footing',
    safety: 'Steep stairs, slippery decks, and busy trailheads',
    summary: 'Tall Georgia waterfall in Amicalola Falls State Park with stair viewpoints and Appalachian approach-trail context.',
    highlight: 'A strong southeastern waterfall card with real trail decisions: stairs, overlooks, or longer approach-trail hiking.',
  },
  {
    title: 'Palouse Falls',
    state: 'WA',
    region: 'Palouse Falls State Park',
    lat: 46.663611,
    lng: -118.223611,
    image: 'https://upload.wikimedia.org/wikipedia/commons/b/b3/Palouse_Falls_%284634460573%29.jpg',
    officialUrl: 'https://parks.wa.gov/find-parks/state-parks/palouse-falls-state-park-heritage-site',
    wikiUrl: 'https://en.wikipedia.org/wiki/Palouse_Falls',
    height: '200 ft',
    access: 'State park overlook above canyon',
    season: 'Spring light and flow are common planning targets',
    safety: 'Cliff edges, heat, rattlesnakes, and limited shade',
    summary: 'Eastern Washington canyon waterfall with dramatic overlook access and desert-route exposure.',
    highlight: 'A waterfall card that should plan like a canyon viewpoint: short stop, big exposure, and careful edge safety.',
  },
  {
    title: 'Taughannock Falls',
    state: 'NY',
    region: 'Finger Lakes',
    lat: 42.545,
    lng: -76.606,
    image: 'https://upload.wikimedia.org/wikipedia/commons/f/f3/Taughannock_Falls.JPG',
    officialUrl: 'https://parks.ny.gov/parks/taughannockfalls',
    wikiUrl: 'https://en.wikipedia.org/wiki/Taughannock_Falls_State_Park',
    height: '215 ft',
    access: 'State park gorge and overlook trails',
    season: 'Spring flow and fall color both work well',
    safety: 'Gorge trail closures, ice, and falling-rock zones',
    summary: 'Finger Lakes waterfall with gorge-route and overlook-route options inside a New York state park.',
    highlight: 'A waterfall stop with the trail-choice feel from the mock: easy overlook, gorge walk, or lake-side add-ons.',
  },
];

const YOSEMITE_TRAIL_AREA = buildYosemiteTrailArea();

export const CURATED_EXPLORE_PLACES: ExplorePlaceProfile[] = [
  YOSEMITE_TRAIL_AREA,
  ...WATERFALLS.map((seed, index) => buildWaterfallPlace(seed, index)),
];

export function mergeCuratedExplorePlaces(places: ExplorePlaceProfile[]) {
  const enrichedPlaces = places.map(place => isYosemiteTrailPlace(place) ? withYosemiteTrailDetails(place) : place);
  const curatedPlaces = CURATED_EXPLORE_PLACES.filter(place => place.id !== YOSEMITE_TRAIL_AREA.id);
  const seen = new Set<string>();
  const merged: ExplorePlaceProfile[] = [];
  for (const place of [YOSEMITE_TRAIL_AREA, ...enrichedPlaces, ...curatedPlaces]) {
    const key = `${normalizeTitle(place.summary.title)}:${String(place.summary.state || '').toUpperCase()}`;
    if (isLooseYosemiteTrailPlace(place) && seen.has('yosemite-trails:CA')) continue;
    if (seen.has(place.id) || seen.has(key)) continue;
    seen.add(place.id);
    seen.add(key);
    merged.push(place);
  }
  return merged;
}

function isYosemiteTrailPlace(place: ExplorePlaceProfile) {
  const title = normalizeTitle(String(place.summary.title || ''));
  const state = String(place.summary.state || '').toUpperCase();
  const categoryText = normalizeTitle([
    place.summary.category,
    place.category,
    ...(Array.isArray(place.subcategories) ? place.subcategories : []),
  ].filter(Boolean).join(' '));
  return state === 'CA' && title.includes('yosemite') && title.includes('trail') && categoryText.includes('trail');
}

function isLooseYosemiteTrailPlace(place: ExplorePlaceProfile) {
  const title = normalizeTitle(String(place.summary.title || ''));
  const state = String(place.summary.state || '').toUpperCase();
  return state === 'CA' && title.includes('yosemite') && title.includes('trail');
}

function withYosemiteTrailDetails(place: ExplorePlaceProfile): ExplorePlaceProfile {
  const guide = YOSEMITE_TRAIL_AREA;
  return {
    ...place,
    category: guide.category,
    subcategories: guide.subcategories,
    quality: guide.quality,
    quality_score: Math.max(Number((place as any).quality_score || 0), Number((guide as any).quality_score || 0)),
    search_aliases: Array.from(new Set([
      ...((place as any).search_aliases || []),
      ...((guide as any).search_aliases || []),
    ])),
    best_season: (guide as any).best_season,
    access: (guide as any).access,
    safety: (guide as any).safety,
    trails: YOSEMITE_TRAILS,
    sources: (guide as any).sources,
    card: {
      ...((place as any).card || {}),
      ...((guide as any).card || {}),
    },
    summary: {
      ...place.summary,
      ...guide.summary,
      id: place.summary.id || place.id,
      rank: Math.min(Number(place.summary.rank ?? 99), Number(guide.summary.rank ?? 12)),
      hero_rank: Math.min(Number(place.summary.hero_rank ?? place.summary.rank ?? 99), Number(guide.summary.hero_rank ?? 12)),
    },
    profile: {
      ...place.profile,
      ...guide.profile,
    },
    audio_script: guide.audio_script,
    wiki_extract: guide.wiki_extract,
    source_pack: guide.source_pack,
    facts: {
      ...place.facts,
      ...guide.facts,
    },
    attribution: guide.attribution,
  };
}

function buildWaterfallPlace(seed: WaterfallSeed, index: number): ExplorePlaceProfile {
  const id = `explore:waterfalls:${normalizeTitle(seed.title)}`;
  const thingsToDo: ExploreSourcePackItem[] = [
    {
      title: 'Open Area Map',
      description: seed.access,
      url: seed.officialUrl,
      lat: seed.lat,
      lng: seed.lng,
      image_url: seed.image,
      image_credit: 'Wikimedia Commons',
    },
    {
      title: 'Timing Check',
      description: seed.season,
      url: seed.officialUrl,
    },
  ];
  const story = `${seed.title} is a waterfall stop in ${seed.region}. ${seed.summary} Check current access, weather, closures, and local rules before building a day around it.`;
  return {
    id,
    category: 'Waterfall',
    subcategories: ['waterfalls', 'viewpoints', 'trails'],
    quality: 'official_plus_open_media',
    quality_score: 86,
    search_aliases: ['waterfall', 'waterfalls', 'falls', 'cascade', seed.region],
    best_season: seed.season,
    access: { summary: seed.access },
    safety: { summary: seed.safety },
    sources: [
      { title: `${seed.title} access`, publisher: 'Official source', url: seed.officialUrl, kind: 'official' },
      { title: `${seed.title} image reference`, publisher: 'Wikimedia Commons', url: seed.wikiUrl, kind: 'open_media' },
    ],
    card: {
      title: seed.title,
      region: seed.region,
      headline: seed.highlight,
      summary: seed.summary,
      highlight: seed.highlight,
      facts: [seed.height, seed.access, seed.season, seed.safety],
    },
    summary: {
      id,
      title: seed.title,
      category: 'Waterfall',
      explore_group: 'water',
      state: seed.state,
      region: seed.region,
      lat: seed.lat,
      lng: seed.lng,
      rank: 420 + index,
      hero_rank: 28 + index,
      tags: ['waterfalls', 'falls', 'viewpoint', 'trail', 'scenic'],
      badges: ['Waterfall'],
      hook: seed.highlight,
      short_description: seed.summary,
      thumbnail_url: seed.image,
      image_url: seed.image,
      image_credit: 'Wikimedia Commons',
      image_license: 'Open image reference',
      source_url: seed.officialUrl,
      source_title: 'Official access source',
    },
    profile: {
      hook: seed.highlight,
      summary: seed.summary,
      story,
      why_it_matters: seed.highlight,
      what_to_know: `${seed.access}. ${seed.safety}.`,
      best_time_to_stop: seed.season,
      access_notes: seed.access,
      nearby_context: 'Use the area map to layer trailheads, campgrounds, parking, fuel, weather, and road access around this waterfall.',
    },
    audio_script: story,
    wiki_extract: '',
    source_pack: {
      quality: 'official',
      primary: 'Official access source',
      official_url: seed.officialUrl,
      sources: [
        { title: `${seed.title} access`, publisher: 'Official source', url: seed.officialUrl, kind: 'official' },
        { title: `${seed.title} open image`, publisher: 'Wikimedia Commons', url: seed.wikiUrl, kind: 'open_media' },
      ],
      photos: [{ url: seed.image, caption: seed.title, credit: 'Wikimedia Commons' }],
      activities: ['Waterfall', 'Viewpoint', 'Trail access', 'Photography'],
      things_to_do: thingsToDo,
      things_to_see: [
        {
          title: seed.title,
          description: seed.summary,
          url: seed.officialUrl,
          lat: seed.lat,
          lng: seed.lng,
          image_url: seed.image,
          image_credit: 'Wikimedia Commons',
        },
      ],
      source_note: 'Curated with official access pages and open image references. Verify current access, fees, permits, closures, and rules before you go.',
      license: 'Open image reference; verify media license at source.',
      image_asset: seed.image,
    },
    facts: {
      coordinates: `${seed.lat.toFixed(5)}, ${seed.lng.toFixed(5)}`,
      source_url: seed.officialUrl,
      source_title: 'Official access source',
      official_url: seed.officialUrl,
      source_quality: 'official',
      last_updated: LAST_UPDATED,
    },
    attribution: 'Official access source + Wikimedia Commons image reference',
  };
}

function buildYosemiteTrailArea(): ExplorePlaceProfile {
  const id = 'explore:trails:yosemite-trails';
  const story = 'Yosemite Trails brings the valley classics into one place: waterfall walks, Half Dome permits, family loops, cliff viewpoints, and giant sequoia routes. Pick the trail by distance, route type, elevation, and current access.';
  return {
    id,
    category: 'Trails',
    subcategories: ['trails', 'hiking'],
    quality: 'official_plus_open_media',
    quality_score: 92,
    search_aliases: ['yosemite trails', 'yosemite hikes', 'mist trail', 'half dome', 'mirror lake', 'upper yosemite fall'],
    best_season: 'Year-round, check road and trail status',
    access: { summary: 'Yosemite Valley, Glacier Point Road, and South Entrance trailheads' },
    safety: { summary: 'Permits, snow, heat, wet rock, and cliff exposure vary by trail' },
    trails: YOSEMITE_TRAILS,
    sources: [
      { title: 'Yosemite hiking', publisher: 'National Park Service', url: YOSEMITE_TRAILS_URL, kind: 'official' },
      { title: 'Open Yosemite trail imagery', publisher: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/Category:Yosemite_National_Park', kind: 'open_media' },
    ],
    card: {
      title: 'Yosemite Trails',
      region: 'Yosemite National Park',
      headline: 'Valley walks, waterfall climbs, big-view routes, and permit hikes in one trail list.',
      summary: 'Choose Yosemite hikes by distance, route type, elevation, time, and current access.',
      highlight: 'Open the area to compare Mist Trail, Half Dome, Mirror Lake, Yosemite Falls, Taft Point, and sequoia routes.',
      facts: ['6 trails', 'Easy - Hard', 'Year-round status checks', 'Official trail pages'],
    },
    summary: {
      id,
      title: 'Yosemite Trails',
      category: 'Trails',
      explore_group: 'trails',
      state: 'CA',
      region: 'Yosemite National Park',
      lat: 37.7485,
      lng: -119.5870,
      rank: 12,
      hero_rank: 12,
      tags: ['trails', 'hiking', 'waterfalls', 'views', 'loops', 'yosemite'],
      badges: ['Trails'],
      hook: 'Yosemite hikes with distance, route type, elevation, and trail-specific details.',
      short_description: 'Choose Yosemite hikes by distance, route type, elevation, time, and current access.',
      thumbnail_url: GLACIER_POINT_IMAGE,
      image_url: GLACIER_POINT_IMAGE,
      image_credit: 'Wikimedia Commons',
      image_license: 'Open image reference',
      source_url: YOSEMITE_TRAILS_URL,
      source_title: 'National Park Service hiking page',
    },
    profile: {
      hook: 'Explore trails in and around Yosemite National Park.',
      summary: 'From easy valley walks to exposed all-day routes, Yosemite trails need distance, route type, elevation, access, and weather checks.',
      story,
      why_it_matters: 'Yosemite has very different trail days in the same area: short loops, wet waterfall steps, permit routes, and high-exposure viewpoints.',
      what_to_know: 'Check current trail status, seasonal road access, permits, weather, daylight, and water before starting.',
      best_time_to_stop: 'Year-round, check road and trail status',
      access_notes: 'Use Yosemite Valley shuttles and signed trailheads where available. Glacier Point Road and Mariposa Grove access can be seasonal.',
      nearby_context: 'Trailheads, campgrounds, waterfall stops, fuel towns, and weather checks sit close together in Yosemite.',
    },
    audio_script: story,
    wiki_extract: '',
    source_pack: {
      quality: 'official',
      primary: 'National Park Service',
      official_url: YOSEMITE_TRAILS_URL,
      nps_park_code: 'yose',
      sources: [
        { title: 'Yosemite hiking', publisher: 'National Park Service', url: YOSEMITE_TRAILS_URL, kind: 'official' },
        { title: 'Open Yosemite images', publisher: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/Category:Yosemite_National_Park', kind: 'open_media' },
      ],
      photos: YOSEMITE_TRAILS.slice(0, 4).map(trail => ({ url: trail.image_url, caption: trail.title, credit: 'Wikimedia Commons' })),
      activities: ['Hiking', 'Waterfalls', 'Viewpoints', 'Backcountry access'],
      things_to_do: YOSEMITE_TRAILS.map(trail => ({
        title: trail.title,
        description: `${trail.distance_mi.toFixed(1)} mi · ${trail.route_type} · ${trail.difficulty}`,
        url: trail.source_url || YOSEMITE_TRAILS_URL,
        lat: trail.lat,
        lng: trail.lng,
        image_url: trail.image_url,
        image_credit: 'Wikimedia Commons',
      })),
      things_to_see: [
        { title: 'Vernal Fall', description: 'Mist Trail waterfall viewpoint.', url: 'https://www.nps.gov/yose/planyourvisit/vernalnevadatrail.htm', image_url: VERNAL_FALL_IMAGE },
        { title: 'Half Dome', description: 'Permit-only cable route and Yosemite landmark.', url: 'https://www.nps.gov/yose/planyourvisit/halfdome.htm', image_url: HALF_DOME_IMAGE },
        { title: 'Mirror Lake', description: 'Seasonal lake and easy valley walk.', url: 'https://www.nps.gov/yose/planyourvisit/mirrorlaketrail.htm', image_url: MIRROR_LAKE_IMAGE },
      ],
      source_note: 'Trail details use official Yosemite hiking pages and open image references. Check current trail status before starting.',
      license: 'Open image reference; verify media license at source.',
      image_asset: GLACIER_POINT_IMAGE,
    },
    facts: {
      coordinates: '37.74850, -119.58700',
      source_url: YOSEMITE_TRAILS_URL,
      source_title: 'National Park Service hiking page',
      official_url: YOSEMITE_TRAILS_URL,
      source_quality: 'official',
      last_updated: LAST_UPDATED,
    },
    attribution: 'National Park Service trail pages + Wikimedia Commons image references',
  };
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
