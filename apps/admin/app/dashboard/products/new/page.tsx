'use client';

import { useRouter } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import ProductForm, { ProductFormData } from '@/components/products/ProductForm';
import { isQueuedResult } from '@/lib/offline/outbox';
import { SAVED_OFFLINE_MESSAGE } from '@/lib/offline/feedback';

export default function NewProductPage() {
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (data: ProductFormData) => {
    const result = await adminApi.createProduct(data);
    // Offline: queued with a client id (photos picked offline upload first on sync).
    if (isQueuedResult(result)) toast(SAVED_OFFLINE_MESSAGE, 'info');
    else toast('Product created successfully', 'success');
    router.push('/dashboard/products');
  };

  return (
    <div className="p-4 sm:p-5 md:p-6">
      <PageHeader
        title="Add Product"
        breadcrumbs={[
          { label: 'Products', href: '/dashboard/products' },
          { label: 'New Product' },
        ]}
      />
      <div className="mt-6">
        <ProductForm onSubmit={handleSubmit} submitLabel="Save Product" />
      </div>
    </div>
  );
}
