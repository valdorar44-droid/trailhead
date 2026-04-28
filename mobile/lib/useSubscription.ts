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
  // IAP is NOT initialized on mount — only when the user explicitly opens the
  // paywall or taps Restore. initConnection() + getSubscriptions() hit the App
  // Store and trigger iOS "Sign into Apple account" if called automatically.
  const [iapReady, setIapReady] = useState(false);

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
    const iap = getIAP();
    // Only run IAP setup when explicitly triggered (iapReady flag set by openPaywall)
    if (!iap || !iapReady) return;

    let mounted = true;

    async function setup() {
      if (!iap) return;
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
        }));
        setProducts(normalized);
      } catch {
        // Simulator, or store unavailable — degrade silently
      }
    }

    setup();

    return () => {
      mounted = false;
      purchaseListenerRef.current?.remove();
      errorListenerRef.current?.remove();
      iap.endConnection().catch(() => {});
    };
  }, [activateOnBackend, iapReady]);

  // Call this before showing the paywall — initializes IAP on demand
  const openPaywall = useCallback(() => {
    setIapReady(true);
  }, []);

  const purchase = useCallback(async (productId: string) => {
    const iap = getIAP();
    if (!iap || !connected) { setError('Store not available.'); return; }
    setError('');
    setPurchasing(true);
    try {
      await iap.requestSubscription({ sku: productId } as any);
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (!msg.toLowerCase().includes('cancel')) {
        setError('Purchase failed. Please try again.');
      }
      setPurchasing(false);
    }
  }, [connected]);

  const restore = useCallback(async () => {
    const iap = getIAP();
    if (!iap) { setError('Store not available.'); return; }
    setRestoring(true);
    setError('');
    try {
      const purchases = await iap.getAvailablePurchases();
      const sub = purchases.find((p: any) => {
        const id = p.productId ?? p.id ?? '';
        return id === PRODUCT_IDS.monthly || id === PRODUCT_IDS.annual;
      });
      if (sub) {
        const productId     = sub.productId ?? sub.id ?? '';
        const transactionId = sub.transactionId ?? (sub as any).orderId ?? sub.id ?? '';
        await activateOnBackend(productId, transactionId);
        Alert.alert('Restored', 'Your Explorer Plan has been restored.');
      } else {
        Alert.alert('Nothing to restore', 'No active subscription found for this account.');
      }
    } catch {
      setError('Restore failed. Please try again.');
    }
    setRestoring(false);
  }, [activateOnBackend]);

  const monthlyProduct = products.find(p => p.productId === PRODUCT_IDS.monthly);
  const annualProduct  = products.find(p => p.productId === PRODUCT_IDS.annual);

  return { connected, products, monthlyProduct, annualProduct, purchasing, restoring, error, purchase, restore, openPaywall };
}
