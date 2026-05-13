import { useEffect, useRef, useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { api } from './api';
import { useStore } from './store';
import { storage } from './storage';

export const PRODUCT_IDS = {
  monthly: 'com.trailhead.explorer.monthly.v2',
  annual:  'com.trailhead.explorer.annual.v2',
} as const;

export interface IAPProduct {
  productId: string;
  title: string;
  description: string;
  localizedPrice: string;
  currency: string;
  offerTokenAndroid?: string;
  introductoryPricePaymentModeIOS?: string;
  introductoryPriceNumberOfPeriodsIOS?: string;
  introductoryPriceSubscriptionPeriodIOS?: string;
}

function formatIapError(err: any, fallback: string) {
  const code = err?.code ?? err?.responseCode ?? err?.debugCode ?? '';
  const message = err?.message ?? err?.debugMessage ?? '';
  const joined = [code, message].filter(Boolean).join(': ').trim();
  return joined ? `${fallback} (${joined})` : fallback;
}

function isUserCancelledIap(err: any) {
  const code = String(err?.code ?? err?.responseCode ?? err?.debugCode ?? '').toLowerCase();
  const message = String(err?.message ?? err?.debugMessage ?? '').toLowerCase();
  return code.includes('cancel') || code.includes('user_cancel') || message.includes('cancel') || message.includes('user');
}

function normalizePeriodUnit(unit?: string) {
  const lower = (unit ?? '').toLowerCase();
  if (lower === 'day') return 'day';
  if (lower === 'week') return 'week';
  if (lower === 'month') return 'month';
  if (lower === 'year') return 'year';
  return '';
}

export function freeTrialLabel(product?: IAPProduct) {
  const mode = (product?.introductoryPricePaymentModeIOS ?? '').toUpperCase();
  if (mode !== 'FREETRIAL') return '';
  const count = Number(product?.introductoryPriceNumberOfPeriodsIOS ?? 0);
  const unit = normalizePeriodUnit(product?.introductoryPriceSubscriptionPeriodIOS);
  if (!count || !unit) return 'Free trial';
  return `${count}-${unit}${count === 1 ? '' : 's'} free trial`;
}

export function priceLine(product: IAPProduct | undefined, fallbackPrice: string, period: string) {
  const price = product?.localizedPrice || fallbackPrice;
  const trial = freeTrialLabel(product);
  return trial ? `${trial}, then ${price}/${period}` : `${price}/${period}`;
}

// Lazy-load react-native-iap so old binaries (without the native module) don't crash on import.
// Returns null if the native module isn't present.
function getIAP(): typeof import('react-native-iap') | null {
  try {
    return require('react-native-iap');
  } catch {
    return null;
  }
}

function purchaseTransactionId(purchase: any) {
  return purchase.transactionId
    ?? purchase.originalTransactionIdentifierIOS
    ?? purchase.purchaseToken
    ?? purchase.orderId
    ?? purchase.id
    ?? '';
}

function androidOffer(product: any) {
  const offers = product?.subscriptionOfferDetails ?? [];
  if (!Array.isArray(offers) || !offers.length) return null;
  return offers.find((offer: any) => offer?.offerToken && !offer?.offerId) ?? offers.find((offer: any) => offer?.offerToken) ?? null;
}

function androidPrice(product: any, offer: any) {
  const phases = offer?.pricingPhases?.pricingPhaseList ?? [];
  const recurring = Array.isArray(phases)
    ? phases.find((phase: any) => Number(phase?.recurrenceMode) === 1) ?? phases[phases.length - 1]
    : null;
  return recurring?.formattedPrice ?? product?.localizedPrice ?? product?.price ?? '';
}

function storeName() {
  return Platform.OS === 'android' ? 'Google Play' : 'App Store';
}

export function useSubscription() {
  const setPlan = useStore(s => s.setPlan);
  const token   = useStore(s => s.token);

  const [connected,  setConnected]  = useState(false);
  const [products,   setProducts]   = useState<IAPProduct[]>([]);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring,  setRestoring]  = useState(false);
  const [error,      setError]      = useState('');
  const [storeLoading, setStoreLoading] = useState(false);
  // IAP is NOT initialized on mount — only when the user explicitly opens the
  // paywall or taps Restore. initConnection() + getSubscriptions() hit the App
  // Store and trigger iOS "Sign into Apple account" if called automatically.
  const [iapReady, setIapReady] = useState(false);
  const [iapAttempt, setIapAttempt] = useState(0);

  const purchaseListenerRef = useRef<{ remove: () => void } | null>(null);
  const errorListenerRef    = useRef<{ remove: () => void } | null>(null);

  const activateOnBackend = useCallback(async (productId: string, transactionId: string) => {
    if (!token) {
      if (productId && transactionId) {
        storage.set('trailhead_iap_pending', JSON.stringify({ productId, transactionId, updatedAt: Date.now() })).catch(() => {});
      }
      setError('Purchase saved. Sign in or create an account when you want Explorer access synced in Trailhead.');
      return true;
    }
    if (productId && transactionId) {
      storage.set('trailhead_iap_pending', JSON.stringify({ productId, transactionId, updatedAt: Date.now() })).catch(() => {});
    }
    try {
      const res = await api.activateSubscription(productId, transactionId);
      const active = res.status !== 'error';
      setPlan(active, active ? res.plan_expires_at ?? null : null);
      storage.del('trailhead_iap_pending').catch(() => {});
      return active;
    } catch (e: any) {
      setError(e?.message ?? 'Purchase was received, but Explorer could not be activated yet. Tap Restore purchases to retry.');
      return false;
    }
  }, [token, setPlan]);

  useEffect(() => {
    // Only run IAP setup when explicitly triggered (iapReady flag set by openPaywall)
    if (!iapReady) return;

    const iap = getIAP();
    if (!iap) {
      setConnected(false);
      setProducts([]);
      setStoreLoading(false);
      return;
    }

    let mounted = true;

    async function setup() {
      if (!iap) return;
      setStoreLoading(true);
      setError('');
      try {
        await iap.initConnection();
        if (!mounted) return;
        setConnected(true);

        // Listeners must be set up AFTER initConnection() succeeds.
        // If they run before/outside the try, they crash when the store is unavailable.
        purchaseListenerRef.current = iap.purchaseUpdatedListener(async (purchase: any) => {
          const productId     = purchase.productId ?? purchase.id ?? '';
          const transactionId = purchaseTransactionId(purchase);
          if (!productId) return;
          try {
            const activated = await activateOnBackend(productId, transactionId);
            if (activated) {
              await iap.finishTransaction({ purchase, isConsumable: false });
            }
          } catch {
            setError('Purchase was received, but Explorer could not be activated yet. Tap Restore purchases to retry.');
          }
          setPurchasing(false);
        });

        errorListenerRef.current = iap.purchaseErrorListener((err: any) => {
          if (isUserCancelledIap(err)) {
            setError('User cancelled');
          } else {
            setError('Purchase failed. Please try again.');
          }
          setPurchasing(false);
        });

        const skus = [PRODUCT_IDS.monthly, PRODUCT_IDS.annual];
        const items = await iap.getSubscriptions({ skus });
        if (!mounted) return;

        const normalized: IAPProduct[] = (items ?? []).map((p: any) => {
          const offer = Platform.OS === 'android' ? androidOffer(p) : null;
          return {
            productId:      p.productId ?? p.id ?? '',
            title:          p.title ?? p.displayName ?? p.name ?? '',
            description:    p.description ?? '',
            localizedPrice: Platform.OS === 'android' ? androidPrice(p, offer) : (p.localizedPrice ?? p.price ?? ''),
            currency:       p.currency ?? offer?.pricingPhases?.pricingPhaseList?.[0]?.priceCurrencyCode ?? '',
            offerTokenAndroid: offer?.offerToken,
            introductoryPricePaymentModeIOS: p.introductoryPricePaymentModeIOS ?? p.subscription?.introductoryOffer?.paymentMode,
            introductoryPriceNumberOfPeriodsIOS: p.introductoryPriceNumberOfPeriodsIOS ?? p.subscription?.introductoryOffer?.period?.value?.toString?.(),
            introductoryPriceSubscriptionPeriodIOS: p.introductoryPriceSubscriptionPeriodIOS ?? p.subscription?.introductoryOffer?.period?.unit,
          };
        });
        setProducts(normalized);
        const found = new Set(normalized.map(p => p.productId));
        if (!found.has(PRODUCT_IDS.monthly) && !found.has(PRODUCT_IDS.annual)) {
          setError(`${storeName()} did not return Trailhead plans yet. The subscriptions may still be propagating or waiting for store review.`);
        }
      } catch (e: any) {
        // Simulator, store review network hiccups, or a temporary store outage.
        // Keep the paywall usable and avoid showing a fatal-looking IAP error.
        if (mounted) {
          setConnected(false);
          setProducts([]);
          setError(formatIapError(e, `Could not load ${storeName()} plans.`));
        }
      } finally {
        if (mounted) setStoreLoading(false);
      }
    }

    setup();

    return () => {
      mounted = false;
      purchaseListenerRef.current?.remove();
      errorListenerRef.current?.remove();
      iap.endConnection().catch(() => {});
    };
  }, [activateOnBackend, iapAttempt, iapReady]);

  // Call this before showing the paywall — initializes IAP on demand
  const openPaywall = useCallback(() => {
    setError('');
    setIapReady(true);
    setIapAttempt(n => n + 1);
  }, []);

  const purchase = useCallback(async (productId: string) => {
    const iap = getIAP();
    if (!iap || !connected) {
      setError('Purchases are temporarily unavailable. Please try again in a moment.');
      return false;
    }
    const productLoaded = products.some(p => p.productId === productId);
    if (!productLoaded) {
      setError(`That Trailhead plan is not available from ${storeName()} yet. Try retrying the store, or wait for review/propagation.`);
      return false;
    }
    const product = products.find(p => p.productId === productId);
    if (Platform.OS === 'android' && !product?.offerTokenAndroid) {
      setError('Google Play returned the plan without a base plan offer. Check the subscription base plan in Play Console.');
      return false;
    }
    setError('');
    setPurchasing(true);
    try {
      if (Platform.OS === 'android') {
        await iap.requestSubscription({
          subscriptionOffers: [{ sku: productId, offerToken: product!.offerTokenAndroid! }],
        } as any);
      } else {
        await iap.requestSubscription({ sku: productId } as any);
      }
      return true;
    } catch (e: any) {
      if (isUserCancelledIap(e)) {
        setError('User cancelled');
      } else {
        setError(formatIapError(e, 'Purchase failed. Please try again.'));
      }
      setPurchasing(false);
      return false;
    }
  }, [connected, products]);

  const restore = useCallback(async () => {
    const iap = getIAP();
    if (!iap) {
      setError('Purchases are temporarily unavailable. Please try again in a moment.');
      return;
    }
    setRestoring(true);
    setError('');
    try {
      const purchases = await iap.getAvailablePurchases();
      const sub = purchases.find((p: any) => {
        const id = p.productId ?? p.id ?? '';
        return id === PRODUCT_IDS.monthly || id === PRODUCT_IDS.annual;
      });
      if (sub) {
        const restoredPurchase = sub as any;
        const productId     = restoredPurchase.productId ?? restoredPurchase.id ?? '';
        const transactionId = purchaseTransactionId(restoredPurchase);
        const activated = await activateOnBackend(productId, transactionId);
        if (activated) {
          Alert.alert('Restored', 'Your Explorer Plan has been restored.');
        } else {
          Alert.alert('Restore pending', `${storeName()} returned a purchase, but Trailhead could not activate it yet. Try again in a moment.`);
        }
      } else {
        Alert.alert('Nothing to restore', 'No active subscription found for this account.');
      }
    } catch (e: any) {
      setError(formatIapError(e, 'Restore failed. Please try again.'));
    }
    setRestoring(false);
  }, [activateOnBackend]);

  const monthlyProduct = products.find(p => p.productId === PRODUCT_IDS.monthly);
  const annualProduct  = products.find(p => p.productId === PRODUCT_IDS.annual);

  return { connected, products, monthlyProduct, annualProduct, purchasing, restoring, error, storeLoading, purchase, restore, openPaywall };
}
