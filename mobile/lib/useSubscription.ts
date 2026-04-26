import { useEffect, useRef, useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  restorePurchases,
  getAvailablePurchases,
} from 'expo-iap';
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

export function useSubscription() {
  const setPlan  = useStore(s => s.setPlan);
  const token    = useStore(s => s.token);

  const [connected,  setConnected]  = useState(false);
  const [products,   setProducts]   = useState<IAPProduct[]>([]);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring,  setRestoring]  = useState(false);
  const [error,      setError]      = useState('');

  const purchaseListenerRef = useRef<{ remove: () => void } | null>(null);
  const errorListenerRef    = useRef<{ remove: () => void } | null>(null);

  // Activate plan on our backend and update store
  const activateOnBackend = useCallback(async (productId: string, transactionId: string) => {
    if (!token) return;
    try {
      const res = await api.activateSubscription(productId, transactionId);
      setPlan(res.status !== 'error', res.plan_expires_at ?? null);
    } catch {
      // Backend activation failed — still mark locally so UX doesn't break
      setPlan(true, Date.now() / 1000 + 366 * 86400);
    }
  }, [token, setPlan]);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      try {
        await initConnection();
        if (!mounted) return;
        setConnected(true);

        // Load product info (prices come from Apple, never hardcode them)
        const skus = [PRODUCT_IDS.monthly, PRODUCT_IDS.annual];
        const items = await fetchProducts({ skus, type: 'subs' });
        if (!mounted) return;

        const normalized: IAPProduct[] = (items ?? []).map((p: any) => ({
          productId:      p.productId ?? p.id ?? '',
          title:          p.title ?? p.displayName ?? '',
          description:    p.description ?? '',
          localizedPrice: p.localizedPrice ?? p.price ?? '',
          currency:       p.currency ?? '',
        }));
        setProducts(normalized);
      } catch (e: any) {
        // Simulator or device without IAP — graceful degradation
        if (mounted) setError(e?.message ?? 'Store unavailable');
      }
    }

    setup();

    // Listen for completed purchases
    purchaseListenerRef.current = purchaseUpdatedListener(async (purchase: any) => {
      const productId     = purchase.productId ?? purchase.id ?? '';
      const transactionId = purchase.transactionId ?? (purchase as any).orderId ?? purchase.id ?? '';
      if (!productId) return;

      try {
        await activateOnBackend(productId, transactionId);
        await finishTransaction({ purchase, isConsumable: false });
      } catch {
        await finishTransaction({ purchase, isConsumable: false });
      }
      setPurchasing(false);
    });

    errorListenerRef.current = purchaseErrorListener((err: any) => {
      // User cancelled is not a real error
      const msg = err?.message ?? '';
      if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('user')) {
        setError('Purchase failed. Please try again.');
      }
      setPurchasing(false);
    });

    return () => {
      mounted = false;
      purchaseListenerRef.current?.remove();
      errorListenerRef.current?.remove();
      endConnection().catch(() => {});
    };
  }, [activateOnBackend]);

  const purchase = useCallback(async (productId: string) => {
    if (!connected) { setError('Store not available.'); return; }
    setError('');
    setPurchasing(true);
    try {
      await requestPurchase({
        type: 'subs',
        request: {
          apple:  { sku: productId },
          google: { skus: [productId] } as any,
        },
      });
      // Result arrives via purchaseUpdatedListener — don't await here
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (!msg.toLowerCase().includes('cancel')) {
        setError('Purchase failed. Please try again.');
      }
      setPurchasing(false);
    }
  }, [connected]);

  const restore = useCallback(async () => {
    setRestoring(true);
    setError('');
    try {
      await restorePurchases();
      const purchases = await getAvailablePurchases();
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

  return { connected, products, monthlyProduct, annualProduct, purchasing, restoring, error, purchase, restore };
}
