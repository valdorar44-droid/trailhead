import { authHeaders, type ProductFeatures } from '../api';
import { TRAILHEAD_API_BASE } from '../apiBase';
import { HttpSearchV2Client, type SearchV2FeatureGate } from './client';

export function productFeaturesAllowSearchV2(
  features: Pick<ProductFeatures, 'search_v2'> | null | undefined,
): boolean {
  return features?.search_v2 === true;
}

export function createAppSearchV2Client(isEnabled: SearchV2FeatureGate): HttpSearchV2Client {
  return new HttpSearchV2Client({
    baseUrl: TRAILHEAD_API_BASE,
    isEnabled,
    getHeaders: authHeaders,
  });
}

