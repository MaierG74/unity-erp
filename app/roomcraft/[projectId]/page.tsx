'use client';

import dynamic from 'next/dynamic';
import { use } from 'react';
import { canvasStorageKey } from '@/lib/roomcraft/project-store';

const RoomCraftApp = dynamic(
  () => import('@/components/features/roomcraft/RoomCraftApp'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading RoomCraft...
      </div>
    ),
  },
);

export default function RoomCraftProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  return (
    <div className="h-full min-h-0 w-full overflow-hidden">
      <RoomCraftApp storageKey={canvasStorageKey(projectId)} projectId={projectId} />
    </div>
  );
}
