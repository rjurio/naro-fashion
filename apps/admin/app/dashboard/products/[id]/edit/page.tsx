'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import adminApi from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import ProductForm, { ProductFormData } from '@/components/products/ProductForm';

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const productId = params.id as string;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) adminApi.setToken(token);

    adminApi.getProductById(productId)
      .then(setProduct)
      .catch(() => toast('Failed to load product', 'error'))
      .finally(() => setLoading(false));
  }, [productId, toast]);

  const handleSubmit = async (data: ProductFormData) => {
    await adminApi.updateProduct(productId, data);
    toast('Product updated successfully', 'success');
    router.push('/dashboard/products');
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
    <div className="p-6">
      <PageHeader
        title={`Edit: ${product.name}`}
        breadcrumbs={[
          { label: 'Products', href: '/dashboard/products' },
          { label: 'Edit Product' },
        ]}
      />
      <div className="mt-6">
        <ProductForm
          initialData={product}
          onSubmit={handleSubmit}
          submitLabel="Update Product"
        />
      </div>
    </div>
  );
}
