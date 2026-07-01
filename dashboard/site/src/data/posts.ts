export const posts = [
  {
    slug: 'start-from-the-map',
    category: 'Map',
    title: 'Start from the map.',
    description: 'A trip is easier to shape when camps, trails, routes, and reports stay in the same place.',
    body: [
      'Trailhead keeps search, routes, saved places, and reports close so a trip does not turn into a stack of disconnected tabs.',
      'The map is the starting point. Search a place, open nearby camps or trails, then decide whether it belongs in the route.',
      'Conditions, prices, access, and weather can change. Check current details before travel.'
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
    slug: 'routes-need-more-than-pins',
    category: 'Routes',
    title: 'Routes need more than pins.',
    description: 'A saved place is more useful when it stays connected to the map, route, reports, and nearby options.',
    body: [
      'A long list of places is useful, but it does not tell the whole route story.',
      'Trailhead keeps camps, reports, trails, route geometry, GPX, and saved places in one flow.',
      'The goal is simple: find a place, understand the nearby options, and keep moving.'
    ]
  }
];

export function getPost(slug: string) {
  return posts.find(post => post.slug === slug);
}
