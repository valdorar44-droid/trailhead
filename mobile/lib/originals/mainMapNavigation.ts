export type OriginalStartDestination = {
  pathname: '/(tabs)/map';
  params: {
    original: string;
    version: string;
  };
};

export function originalStartDestination(packId: string, version: number): OriginalStartDestination {
  return {
    pathname: '/(tabs)/map',
    params: {
      original: packId,
      version: String(version),
    },
  };
}

export function consumerOriginalPlayerShouldRedirect(
  simulate: string | null | undefined,
  privateField?: string | null,
) {
  return simulate !== '1' && privateField !== '1';
}
