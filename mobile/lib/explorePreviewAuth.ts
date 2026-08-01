export function withExplorePreviewAuthHeaderV1(
  headers: Record<string, string>,
  previewEnabled: boolean,
): Record<string, string> {
  if (!headers.Authorization || !previewEnabled) return { ...headers };
  return {
    ...headers,
    'X-Trailhead-Explore-Preview': 'internal',
  };
}
