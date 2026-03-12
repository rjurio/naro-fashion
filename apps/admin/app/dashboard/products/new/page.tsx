'use client';

import { useRouter } from 'next/navigation';
import { useToast } from '@/contexts/ToastContext';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import ProductForm, { ProductFormData } from '@/components/products/ProductForm';

export default function NewProductPage() {
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (data: ProductFormData) => {
    await adminApi.createProduct(data);
    toast('Product created successfully', 'success');
    router.push('/dashboard/products');
  };

  return (
    <div className="p-6">
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
