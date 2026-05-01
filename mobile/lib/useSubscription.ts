import { useEffect, useRef, useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { api } from './api';
import { useStore } from './store';

export const PRODUCT_IDS = {
  monthly: 'com.trailhead.explorer.monthly',
  annual:  'com.trailhead.explorer.annual',
} as const;

export interface IAPProduct {
  productId: string;
  title: string;
  description: string;
  localizedPrice: string;
  currency: string;
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
    if (!token) return;
    try {
      const res = await api.activateSubscription(productId, transactionId);
      setPlan(res.status !== 'error', res.plan_expires_at ?? null);
    } catch {
      setPlan(true, Date.now() / 1000 + 366 * 86400);
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
          const transactionId = purchase.transactionId ?? (purchase as any).orderId ?? purchase.id ?? '';
          if (!productId) return;
          try {
            await activateOnBackend(productId, transactionId);
            await iap.finishTransaction({ purchase, isConsumable: false });
          } catch {
            await iap.finishTransaction({ purchase, isConsumable: false });
          }
          setPurchasing(false);
        });

        errorListenerRef.current = iap.purchaseErrorListener((err: any) => {
          const msg = err?.message ?? '';
          if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('user')) {
            setError('Purchase failed. Please try again.');
          }
          setPurchasing(false);
        });

        const skus = [PRODUCT_IDS.monthly, PRODUCT_IDS.annual];
        const items = await iap.getSubscriptions({ skus });
        if (!mounted) return;

        const normalized: IAPProduct[] = (items ?? []).map((p: any) => ({
          productId:      p.productId ?? p.id ?? '',
          title:          p.title ?? p.displayName ?? '',
          description:    p.description ?? '',
          localizedPrice: p.localizedPrice ?? p.price ?? '',
          currency:       p.currency ?? '',
          introductoryPricePaymentModeIOS: p.introductoryPricePaymentModeIOS ?? p.subscription?.introductoryOffer?.paymentMode,
          introductoryPriceNumberOfPeriodsIOS: p.introductoryPriceNumberOfPeriodsIOS ?? p.subscription?.introductoryOffer?.period?.value?.toString?.(),
          introductoryPriceSubscriptionPeriodIOS: p.introductoryPriceSubscriptionPeriodIOS ?? p.subscription?.introductoryOffer?.period?.unit,
        }));
        setProducts(normalized);
        const found = new Set(normalized.map(p => p.productId));
        if (!found.has(PRODUCT_IDS.monthly) && !found.has(PRODUCT_IDS.annual)) {
          setError('App Store did not return Trailhead plans yet. The first subscriptions may still be propagating or waiting for Apple review.');
        }
      } catch (e: any) {
        // Simulator, App Review network hiccups, or a temporary StoreKit outage.
        // Keep the paywall usable and avoid showing a fatal-looking IAP error.
        if (mounted) {
          setConnected(false);
          setProducts([]);
          setError(formatIapError(e, 'Could not load App Store plans.'));
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
      setError('That Trailhead plan is not available from the App Store yet. Try Retry App Store, or wait for Apple review/propagation.');
      return false;
    }
    setError('');
    setPurchasing(true);
    try {
      await iap.requestSubscription({ sku: productId } as any);
      return true;
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (!msg.toLowerCase().includes('cancel')) {
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
        const transactionId = restoredPurchase.transactionId ?? restoredPurchase.orderId ?? restoredPurchase.id ?? '';
        await activateOnBackend(productId, transactionId);
        Alert.alert('Restored', 'Your Explorer Plan has been restored.');
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
