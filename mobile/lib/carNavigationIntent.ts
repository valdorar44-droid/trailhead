export type CarNavigationAction = 'navigation' | 'directions' | 'add_a_stop';

export type CarNavigationRouteBuilderRequest = {
  destination: string;
  action: CarNavigationAction;
};

export function routeBuilderRequestFromGeoUrl(
  url: string | null | undefined,
): CarNavigationRouteBuilderRequest | null {
  if (!url || !/^geo:/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol.toLowerCase() !== 'geo:') return null;
    const query = parsed.searchParams.get('q')?.trim() ?? '';
    const destination = query || decodeURIComponent(parsed.pathname).trim();
    if (!destination) return null;
    const actionValue = parsed.searchParams.get('intent')?.trim().toLowerCase();
    const action: CarNavigationAction = actionValue === 'add_a_stop' || actionValue === 'directions'
      ? actionValue
      : 'navigation';
    return { destination: destination.slice(0, 240), action };
  } catch {
    return null;
  }
}
