'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { FurnitureConfigurator } from '@/components/features/configurator/FurnitureConfigurator';
import { useModuleAccess } from '@/lib/hooks/use-module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';

interface ConfiguratorPageProps {
  params: Promise<{
    productId: string;
  }>;
}

export default function ConfiguratorPage({ params }: ConfiguratorPageProps) {
  const { productId: productIdParam } = use(params);
  const productId = parseInt(productIdParam, 10);
  const router = useRouter();
  const { data: accessData, isLoading: accessLoading } = useModuleAccess(MODULE_KEYS.FURNITURE_CONFIGURATOR);

  if (isNaN(productId)) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Invalid product ID.</p>
      </div>
    );
  }

  if (accessLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Checking module access…</p>
      </div>
    );
  }

  if (!accessData?.allowed) {
    const accessMessage =
      accessData?.error ??
      'Furniture Configurator is disabled for your organization. Ask your Unity super admin to enable it.';

    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-destructive">
          {accessMessage ?? 'You do not have access to the Furniture Configurator module.'}
        </p>
        <button
          onClick={() => router.back()}
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Product
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3">
        <button
          onClick={() => router.back()}
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Product
        </button>
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Furniture Configurator</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
            Design furniture panels parametrically. Select dimensions, shelves, and doors to auto-generate
            a complete parts list for the cutlist optimizer.
          </p>
        </div>
      </div>

      <FurnitureConfigurator productId={productId} />
    </div>
  );
}
