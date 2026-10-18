'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import adminApi, { isConflictError } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import ProductForm, { ProductFormData } from '@/components/products/ProductForm';
import PendingSyncPill from '@/components/offline/PendingSyncPill';
import { useStaleRecordDialog } from '@/components/offline/StaleRecordDialog';
import { isQueuedResult } from '@/lib/offline/outbox';
import { SAVED_OFFLINE_MESSAGE } from '@/lib/offline/feedback';

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const stale = useStaleRecordDialog('product');

  const productId = params.id as string;

  const load = useCallback(async () => {
    try {
      setProduct(await adminApi.getProductById(productId));
    } catch {
      toast('Failed to load product', 'error');
    }
  }, [productId, toast]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const handleSubmit = async (data: ProductFormData) => {
    // Optimistic concurrency: the version the form was loaded from. A record
    // that only exists on this device yet has no server version.
    const expectedUpdatedAt = typeof product?.updatedAt === 'string' ? product.updatedAt : undefined;
    try {
      const result = await adminApi.updateProduct(productId, expectedUpdatedAt ? { ...data, expectedUpdatedAt } : data);
      if (isQueuedResult(result)) toast(SAVED_OFFLINE_MESSAGE, 'info');
      else toast('Product updated successfully', 'success');
      router.push('/dashboard/products');
    } catch (err) {
      if (isConflictError(err)) {
        stale.open(load);
        return;
      }
      throw err;
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-6 text-center">
        <p className="text-[hsl(var(--muted-foreground))]">Product not found</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5 md:p-6">
      <PageHeader
        title={`Edit: ${product.name}`}
        breadcrumbs={[
          { label: 'Products', href: '/dashboard/products' },
          { label: 'Edit Product' },
        ]}
      />
      {product.__pending && (
        <div className="mt-3 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <PendingSyncPill record={product} />
          <span>Showing changes saved on this device that haven&apos;t synced yet.</span>
        </div>
      )}
      <div className="mt-6">
        <ProductForm
          initialData={product}
          onSubmit={handleSubmit}
          submitLabel="Update Product"
        />
      </div>
      {stale.dialog}
    </div>
  );
}
