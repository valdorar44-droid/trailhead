import type { ExplorePlaceProfile, ExploreSourcePackItem } from '@/lib/api';

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

export const CURATED_EXPLORE_PLACES: ExplorePlaceProfile[] = WATERFALLS.map((seed, index) => buildWaterfallPlace(seed, index));

export function mergeCuratedExplorePlaces(places: ExplorePlaceProfile[]) {
  const seen = new Set<string>();
  const merged: ExplorePlaceProfile[] = [];
  for (const place of [...places, ...CURATED_EXPLORE_PLACES]) {
    const key = `${normalizeTitle(place.summary.title)}:${String(place.summary.state || '').toUpperCase()}`;
    if (seen.has(place.id) || seen.has(key)) continue;
    seen.add(place.id);
    seen.add(key);
    merged.push(place);
  }
  return merged;
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
  const story = `${seed.title} is a waterfall planning anchor in ${seed.region}. ${seed.summary} Check current access, weather, closures, and local rules before building a day around it.`;
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

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
