import { useCallback, useEffect, useState } from 'react';
import { api, type ProductFeatures } from './api';
import { useStore } from './store';

let activeIdentity = '';
let identityGeneration = 0;
let cachedFeatures: ProductFeatures | null = null;
let pendingRequest: Promise<ProductFeatures> | null = null;

function tokenFingerprint(token: string) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function activateIdentity(identity: string) {
  if (identity === activeIdentity) return;
  activeIdentity = identity;
  identityGeneration += 1;
  cachedFeatures = null;
  pendingRequest = null;
}

function loadProductFeatures(identity: string, force = false) {
  activateIdentity(identity);
  if (!force && cachedFeatures) return Promise.resolve(cachedFeatures);
  if (!force && pendingRequest) return pendingRequest;
  const requestGeneration = identityGeneration;
  const request = api.productFeatures()
    .then(features => {
      if (identity === activeIdentity && requestGeneration === identityGeneration) {
        cachedFeatures = features;
      }
      return features;
    })
    .finally(() => {
      if (pendingRequest === request) pendingRequest = null;
    });
  pendingRequest = request;
  return request;
}

export function resetProductFeaturesCache() {
  activeIdentity = '';
  identityGeneration += 1;
  cachedFeatures = null;
  pendingRequest = null;
}

export function useProductFeatures(enabled = true) {
  const accountId = useStore(state => state.user?.id ?? null);
  const token = useStore(state => state.token ?? '');
  const identity = accountId == null || !token
    ? 'anonymous'
    : `account:${accountId}:${tokenFingerprint(token)}`;
  const initialFeatures = activeIdentity === identity ? cachedFeatures : null;
  const [result, setResult] = useState<{ identity: string; features: ProductFeatures | null }>({
    identity,
    features: initialFeatures,
  });
  const [loading, setLoading] = useState(enabled && !initialFeatures);
  const [error, setError] = useState(false);
  const features = result.identity === identity ? result.features : null;

  const reload = useCallback(async () => {
    if (!enabled) return;
    activateIdentity(identity);
    setLoading(true);
    setError(false);
    try {
      const next = await loadProductFeatures(identity, true);
      if (activeIdentity === identity) setResult({ identity, features: next });
    } catch {
      if (activeIdentity === identity) setError(true);
    } finally {
      if (activeIdentity === identity) setLoading(false);
    }
  }, [enabled, identity]);

  useEffect(() => {
    let active = true;
    activateIdentity(identity);
    if (!enabled) {
      setResult({ identity, features: null });
      setLoading(false);
      setError(false);
      return () => { active = false; };
    }
    setResult({ identity, features: cachedFeatures });
    setLoading(!cachedFeatures);
    setError(false);
    void loadProductFeatures(identity)
      .then(next => {
        if (active && activeIdentity === identity) setResult({ identity, features: next });
      })
      .catch(() => {
        if (active && activeIdentity === identity) setError(true);
      })
      .finally(() => {
        if (active && activeIdentity === identity) setLoading(false);
      });
    return () => { active = false; };
  }, [enabled, identity]);

  return { features, loading, error, reload };
}
