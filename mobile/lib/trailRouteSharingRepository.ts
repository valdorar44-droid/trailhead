import type { OfflineTrail } from './offlineTrails';
import {
  prepareOfflineTrailForSharing,
  sharedTrailTokenFromUrl,
  sharedTrailUrlFromToken,
  stableTrailRouteDigest,
  trailRouteIdempotencyKey,
  trailRouteRequestIsCurrent,
  type OwnedTrailRouteCreateV1,
  type OwnedTrailRouteUpdateV1,
  type OwnedTrailRouteV1,
  type SharedTrailRouteV1,
  type TrailRouteCropV1,
  type TrailRouteRevokeMutationV1,
  type TrailRouteShareMutationV1,
  type TrailRouteSharingRequestKeyV1,
} from './trailRouteSharing';

export type TrailRouteSharingClientV1 = Readonly<{
  createOwnedTrailRoute: (data: OwnedTrailRouteCreateV1, idempotencyKey: string, authToken: string | null) => Promise<OwnedTrailRouteV1>;
  getOwnedTrailRoute: (routeId: string, authToken: string | null) => Promise<OwnedTrailRouteV1>;
  updateOwnedTrailRoute: (
    routeId: string,
    data: OwnedTrailRouteUpdateV1,
    idempotencyKey: string,
    authToken: string | null,
  ) => Promise<OwnedTrailRouteV1>;
  createOwnedTrailShareLink: (
    routeId: string,
    expectedRevision: number,
    mode: 'create' | 'replace',
    idempotencyKey: string,
    authToken: string | null,
  ) => Promise<TrailRouteShareMutationV1>;
  revokeOwnedTrailShareLink: (
    routeId: string,
    expectedRevision: number,
    idempotencyKey: string,
    authToken: string | null,
  ) => Promise<TrailRouteRevokeMutationV1>;
  resolveSharedTrailRoute: (shareToken: string) => Promise<SharedTrailRouteV1>;
}>;

export type PersistSharedTrailMappingV1 = (trail: OfflineTrail) => Promise<void>;

export type TrailRouteLinkResultV1 =
  | Readonly<{
      status: 'ready';
      route: OwnedTrailRouteV1;
      shareUrl: string;
      shareToken: string;
      trail: OfflineTrail;
    }>
  | Readonly<{
      status: 'active_without_token';
      route: OwnedTrailRouteV1;
      rotateRequired: true;
      trail: OfflineTrail;
    }>;

export class StaleTrailRouteSharingRequestError extends Error {
  constructor() {
    super('Trail route sharing request is no longer active.');
    this.name = 'StaleTrailRouteSharingRequestError';
  }
}

function requireOwnerRoute(value: unknown): OwnedTrailRouteV1 {
  const route = value as Partial<OwnedTrailRouteV1> | null | undefined;
  if (
    !route
    || typeof route.id !== 'string'
    || !route.id
    || !Number.isInteger(route.revision)
    || Number(route.revision) < 1
    || !route.geometry
    || route.geometry.type !== 'LineString'
    || !Array.isArray(route.geometry.coordinates)
  ) {
    throw new Error('Trailhead received an invalid route response. Try again later.');
  }
  return route as OwnedTrailRouteV1;
}

function requestBase(request: TrailRouteSharingRequestKeyV1) {
  return {
    ownerScope: request.ownerScope,
    localRouteId: request.localRouteId,
    localRevision: request.localRevision,
  };
}

function mappedTrail(
  trail: OfflineTrail,
  ownerScope: string,
  route: OwnedTrailRouteV1,
  crop?: TrailRouteCropV1,
): OfflineTrail {
  return {
    ...trail,
    sharing: {
      schemaVersion: 1,
      ownerScope,
      origin: route.origin,
      remoteRouteId: route.id,
      remoteRevision: route.revision,
      uploadedSavedAt: crop ? trail.savedAt : (trail.sharing?.uploadedSavedAt ?? 0),
      uploadedCropStart: crop?.start ?? trail.sharing?.uploadedCropStart ?? 0,
      uploadedCropFinish: crop?.finish ?? trail.sharing?.uploadedCropFinish ?? 1,
      shareEnabled: route.share_enabled,
      shareRevision: route.share_revision,
      shareRouteRevision: route.share_route_revision,
    },
  };
}

function shareResultUrl(result: TrailRouteShareMutationV1): { token: string; url: string } | null {
  const token = String(result.share_token || '').trim();
  const directUrl = String(result.share_url || '').trim();
  const url = directUrl || sharedTrailUrlFromToken(token) || '';
  const parsedToken = sharedTrailTokenFromUrl(url);
  if (!parsedToken || parsedToken !== token) return null;
  return { token, url };
}

export class TrailRouteSharingRepositoryV1 {
  private generation = 0;
  private activeRequest: TrailRouteSharingRequestKeyV1 | null = null;

  constructor(
    private readonly client: TrailRouteSharingClientV1,
    private readonly ownerScopeIsCurrent: (ownerScope: string) => boolean,
    private readonly captureAuthToken: () => Promise<string | null>,
  ) {}

  cancel(): void {
    this.generation += 1;
    this.activeRequest = null;
  }

  private begin(ownerScope: string, trail: OfflineTrail): TrailRouteSharingRequestKeyV1 {
    const request = {
      ownerScope,
      localRouteId: trail.id,
      localRevision: trail.savedAt,
      generation: ++this.generation,
    };
    this.activeRequest = request;
    this.assertCurrent(request);
    return request;
  }

  private assertCurrent(request: TrailRouteSharingRequestKeyV1): void {
    if (
      !this.ownerScopeIsCurrent(request.ownerScope)
      || !trailRouteRequestIsCurrent(this.activeRequest, request)
    ) {
      throw new StaleTrailRouteSharingRequestError();
    }
  }

  private async bindAuthToken(request: TrailRouteSharingRequestKeyV1): Promise<string> {
    this.assertCurrent(request);
    const token = await this.captureAuthToken();
    this.assertCurrent(request);
    if (!token) throw new Error('Sign in again to share this route.');
    return token;
  }

  private async persistIfCurrent(
    request: TrailRouteSharingRequestKeyV1,
    trail: OfflineTrail,
    route: OwnedTrailRouteV1,
    persist: PersistSharedTrailMappingV1,
    crop?: TrailRouteCropV1,
  ): Promise<OfflineTrail> {
    this.assertCurrent(request);
    const updated = mappedTrail(trail, request.ownerScope, route, crop);
    await persist(updated);
    this.assertCurrent(request);
    return updated;
  }

  private async remoteRoute(
    request: TrailRouteSharingRequestKeyV1,
    trail: OfflineTrail,
    crop: TrailRouteCropV1,
    persist: PersistSharedTrailMappingV1,
    privacyConfirmed: boolean,
    authToken: string,
  ): Promise<{ route: OwnedTrailRouteV1; trail: OfflineTrail }> {
    this.assertCurrent(request);
    const prepared = prepareOfflineTrailForSharing(trail, crop);
    const payloadDigest = stableTrailRouteDigest(JSON.stringify(prepared.payload));
    const mapping = trail.sharing?.ownerScope === request.ownerScope ? trail.sharing : null;
    let route: OwnedTrailRouteV1;
    let local = trail;

    if (!mapping?.remoteRouteId) {
      this.assertCurrent(request);
      route = requireOwnerRoute(await this.client.createOwnedTrailRoute(
        prepared.payload,
        trailRouteIdempotencyKey(requestBase(request), 'create', payloadDigest),
        authToken,
      ));
      local = await this.persistIfCurrent(request, local, route, persist, prepared.crop);
    } else {
      this.assertCurrent(request);
      route = requireOwnerRoute(await this.client.getOwnedTrailRoute(mapping.remoteRouteId, authToken));
      this.assertCurrent(request);
      local = await this.persistIfCurrent(request, local, route, persist);
      if (
        mapping.uploadedSavedAt !== trail.savedAt
        || mapping.uploadedCropStart !== prepared.crop.start
        || mapping.uploadedCropFinish !== prepared.crop.finish
      ) {
        this.assertCurrent(request);
        route = requireOwnerRoute(await this.client.updateOwnedTrailRoute(route.id, {
          expected_revision: route.revision,
          title: prepared.payload.title,
          geometry: prepared.payload.geometry,
          ...(prepared.payload.activity ? { activity: prepared.payload.activity } : {}),
          ...(prepared.payload.route_shape ? { route_shape: prepared.payload.route_shape } : {}),
          permitted_uses: [],
          trailheads: prepared.payload.trailheads,
          source_evidence: prepared.payload.source_evidence,
          photos: [],
        }, trailRouteIdempotencyKey(
          requestBase(request),
          'update',
          `${route.id}:${route.revision}:${payloadDigest}`,
        ), authToken));
        local = await this.persistIfCurrent(request, local, route, persist, prepared.crop);
      }
    }

    if (!route.privacy_reviewed_at) {
      if (!privacyConfirmed) throw new Error('Review route privacy before creating an unlisted link.');
      this.assertCurrent(request);
      route = requireOwnerRoute(await this.client.updateOwnedTrailRoute(route.id, {
        expected_revision: route.revision,
        privacy_reviewed: true,
      }, trailRouteIdempotencyKey(
        requestBase(request),
        'privacy',
        `${route.id}:${route.revision}`,
      ), authToken));
      local = await this.persistIfCurrent(request, local, route, persist, prepared.crop);
    }
    return { route, trail: local };
  }

  async prepareOwnedRoute(
    ownerScope: string,
    trail: OfflineTrail,
    crop: TrailRouteCropV1,
    persist: PersistSharedTrailMappingV1,
  ): Promise<{ route: OwnedTrailRouteV1; trail: OfflineTrail }> {
    const request = this.begin(ownerScope, trail);
    const authToken = await this.bindAuthToken(request);
    return this.remoteRoute(request, trail, crop, persist, true, authToken);
  }

  async createLink(
    ownerScope: string,
    trail: OfflineTrail,
    crop: TrailRouteCropV1,
    persist: PersistSharedTrailMappingV1,
    privacyConfirmed = false,
  ): Promise<TrailRouteLinkResultV1> {
    if (!privacyConfirmed) throw new Error('Review route privacy before creating an unlisted link.');
    const request = this.begin(ownerScope, trail);
    const authToken = await this.bindAuthToken(request);
    let { route, trail: local } = await this.remoteRoute(request, trail, crop, persist, privacyConfirmed, authToken);
    if (route.share_enabled) {
      return { status: 'active_without_token', route, rotateRequired: true, trail: local };
    }
    this.assertCurrent(request);
    const result = await this.client.createOwnedTrailShareLink(
      route.id,
      route.revision,
      'create',
      trailRouteIdempotencyKey(
        requestBase(request),
        'share',
        `${route.id}:${route.revision}:${route.share_revision ?? 0}`,
      ),
      authToken,
    );
    this.assertCurrent(request);
    route = requireOwnerRoute(result.route);
    local = await this.persistIfCurrent(request, local, route, persist);
    const link = shareResultUrl(result);
    if (!link) {
      return { status: 'active_without_token', route, rotateRequired: true, trail: local };
    }
    return { status: 'ready', route, shareUrl: link.url, shareToken: link.token, trail: local };
  }

  async updateLink(
    ownerScope: string,
    trail: OfflineTrail,
    crop: TrailRouteCropV1,
    persist: PersistSharedTrailMappingV1,
    privacyConfirmed = false,
  ): Promise<TrailRouteLinkResultV1> {
    if (!privacyConfirmed) throw new Error('Review route privacy before updating an unlisted link.');
    const request = this.begin(ownerScope, trail);
    const authToken = await this.bindAuthToken(request);
    let { route, trail: local } = await this.remoteRoute(request, trail, crop, persist, privacyConfirmed, authToken);
    const mode = route.share_enabled ? 'replace' : 'create';
    const operation = mode === 'replace' ? 'replace' : 'share';
    this.assertCurrent(request);
    const result = await this.client.createOwnedTrailShareLink(
      route.id,
      route.revision,
      mode,
      trailRouteIdempotencyKey(
        requestBase(request),
        operation,
        `${route.id}:${route.revision}:${route.share_revision ?? 0}`,
      ),
      authToken,
    );
    this.assertCurrent(request);
    route = requireOwnerRoute(result.route);
    local = await this.persistIfCurrent(request, local, route, persist);
    const link = shareResultUrl(result);
    if (!link) {
      return { status: 'active_without_token', route, rotateRequired: true, trail: local };
    }
    return { status: 'ready', route, shareUrl: link.url, shareToken: link.token, trail: local };
  }

  async revokeLink(
    ownerScope: string,
    trail: OfflineTrail,
    persist: PersistSharedTrailMappingV1,
  ): Promise<OfflineTrail> {
    const request = this.begin(ownerScope, trail);
    const authToken = await this.bindAuthToken(request);
    const mapping = trail.sharing?.ownerScope === ownerScope ? trail.sharing : null;
    if (!mapping?.remoteRouteId) throw new Error('This route does not have an unlisted link.');
    this.assertCurrent(request);
    const latest = requireOwnerRoute(await this.client.getOwnedTrailRoute(mapping.remoteRouteId, authToken));
    this.assertCurrent(request);
    if (!latest.share_enabled) return this.persistIfCurrent(request, trail, latest, persist);
    this.assertCurrent(request);
    const result = await this.client.revokeOwnedTrailShareLink(
      latest.id,
      latest.revision,
      trailRouteIdempotencyKey(
        requestBase(request),
        'revoke',
        `${latest.id}:${latest.revision}:${latest.share_revision ?? 0}`,
      ),
      authToken,
    );
    this.assertCurrent(request);
    return this.persistIfCurrent(request, trail, requireOwnerRoute(result.route), persist);
  }
}
