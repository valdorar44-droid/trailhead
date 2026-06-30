export const posts = [
  {
    slug: 'offline-maps-are-not-magic',
    category: 'Offline maps',
    title: 'Offline maps are not magic.',
    description: 'They are files. Boring, specific, heavy files. If the files are not on your phone before service disappears, the map cannot politely manifest itself.',
    body: [
      'Trailhead keeps the full app close. Use the website when a larger screen helps, then keep downloaded regions, route details, and saved places ready on the phone.',
      'Cached is not the same as downloaded. A route you viewed five minutes ago may stay alive in memory. That is useful. It is not the same as a deliberate offline pack with the map data, route data, and supporting files already stored.',
      'Prepare the map region you will actually drive through, the route geometry, planned stops, surrounding bail-out area, and enough fuel and camp notes to work without a live request.',
      'Road closures, fire restrictions, weather, land access, washouts, and gates still need current local verification. Trailhead helps you prepare. It should not replace judgment.'
    ]
  },
  {
    slug: 'app-on-web-phone-in-field',
    category: 'Product note',
    title: 'One place for trip work.',
    description: 'Trailhead keeps search, saved places, routes, and account work in the same flow.',
    body: [
      'Trailhead keeps the browser and phone experience close so places, routes, and saved work do not feel detached.',
      'Use the bigger screen when it helps. Use the phone when location, camera, and field controls matter.',
      'The important part is continuity: the place you found should be the place you can route to, save, report on, and reopen later.'
    ]
  },
  {
    slug: 'trailhead-vs-ioverlander',
    category: 'Comparison',
    title: 'Trailhead and iOverlander are not trying to be the same thing.',
    description: 'iOverlander is useful for finding spots. Trailhead is built around routes, offline packs, saved places, and field handoff.',
    body: [
      'iOverlander is useful because people have added a lot of places. That does not automatically make it an offline map system or a trail-building tool.',
      'Trailhead is more opinionated. Camps, reports, pins, trails, route geometry, GPX, credits, and offline packs should live in one trip flow.',
      'The goal is not to insult another app. The goal is to avoid pretending a long list of pins is the same as a field-ready route.'
    ]
  }
];

export function getPost(slug: string) {
  return posts.find(post => post.slug === slug);
}
