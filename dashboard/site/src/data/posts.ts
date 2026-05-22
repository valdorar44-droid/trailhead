export const posts = [
  {
    slug: 'offline-maps-are-not-magic',
    category: 'Offline maps',
    title: 'Offline maps are not magic.',
    description: 'They are files. Boring, specific, heavy files. If the files are not on your phone before service disappears, the map cannot politely manifest itself.',
    body: [
      'Trailhead splits the job on purpose. The website is for planning while you have bandwidth, keyboard space, and patience. The phone app is for downloaded map regions, cached route data, and the field interface.',
      'Cached is not the same as downloaded. A route you viewed five minutes ago may stay alive in memory. That is useful. It is not the same as a deliberate offline pack with the map data, route data, and supporting files already stored.',
      'Prepare the map region you will actually drive through, the route geometry, planned stops, surrounding bail-out area, and enough fuel and camp notes to work without a live request.',
      'Road closures, fire restrictions, weather, land access, washouts, and gates still need current local verification. Trailhead helps you prepare. It should not replace judgment.'
    ]
  },
  {
    slug: 'web-planning-phone-navigation',
    category: 'Product note',
    title: 'Plan on the web. Navigate on the phone.',
    description: 'A browser is a good place to think. It is a questionable place to trust your day when the road gets rough and the signal disappears.',
    body: [
      'The web planner should feel close to the app, but it has a different job: build the trip, revise the stops, compare options, and prepare the handoff.',
      'The phone stores the route, map packs, and field data locally. It keeps location and map controls built for motion and poor service.',
      'That split is not a limitation. It is the product being honest about where each surface is strongest.'
    ]
  },
  {
    slug: 'trailhead-vs-ioverlander',
    category: 'Comparison',
    title: 'Trailhead and iOverlander are not trying to be the same thing.',
    description: 'iOverlander is useful for finding spots. Trailhead is being built around route planning, offline packs, map layers, and field handoff.',
    body: [
      'iOverlander is useful because people have added a lot of places. That does not automatically make it a route planner, an offline map system, or a trail-building tool.',
      'Trailhead is more opinionated. Camps, reports, pins, trails, route geometry, GPX, credits, and offline packs should live in one planning flow.',
      'The goal is not to insult another app. The goal is to avoid pretending a long list of pins is the same as a field-ready route.'
    ]
  }
];

export function getPost(slug: string) {
  return posts.find(post => post.slug === slug);
}
