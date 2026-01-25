'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import dynamic from 'next/dynamic';
import { useProductCutlistAdapter } from '@/components/features/cutlist/adapters';

// Dynamically import to avoid SSR issues with drag-and-drop
const CutlistWorkspace = dynamic(
  () => import('@/components/features/cutlist/CutlistWorkspace'),
  { ssr: false }
);

interface CutlistBuilderPageProps {
  params: Promise<{
    productId: string;
  }>;
}

export default function CutlistBuilderPage({ params }: CutlistBuilderPageProps) {
  const { productId: productIdParam } = use(params);
  const productId = parseInt(productIdParam, 10);
  const router = useRouter();

  // Use the product cutlist adapter for persistence
  const adapter = useProductCutlistAdapter(productId);

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 pb-4 border-b mb-4 flex-shrink-0">
        <Button variant="outline" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Cutlist Builder</h1>
          <p className="text-sm text-muted-foreground">
            Import parts, group them, and calculate sheet requirements
          </p>
        </div>
      </div>

      {/* Main Content - takes remaining height */}
      <div className="flex-1 min-h-0 overflow-auto">
        <CutlistWorkspace
          mode="grouped"
          showCSVImport={true}
          showCosting={false}
          showResults={true}
          showMaterialPalette={false}
          persistenceAdapter={adapter}
        />
      </div>
    </div>
  );
}
