'use client';

import dynamic from 'next/dynamic';

const RoomCraftApp = dynamic(
  () => import('@/components/features/roomcraft/RoomCraftApp'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading RoomCraft...
      </div>
    ),
  }
);

export default function RoomCraftPage() {
  return (
    <div className="h-full min-h-0 w-full overflow-hidden">
      <RoomCraftApp storageKey="unity-roomcraft:draft" />
    </div>
  );
}

