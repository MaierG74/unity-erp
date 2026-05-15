'use client';

import { RoomProvider } from './context/RoomContext';
import { AppShell } from './components/layout/AppShell';
import { Sidebar } from './components/ui/Sidebar';
import { RoomCanvas } from './components/canvas/RoomCanvas';
import { ToastProvider } from './components/ui/Toast';
import { PlacementProvider } from './context/PlacementContext';

interface RoomCraftAppProps {
  storageKey: string;
  projectId?: string;
}

function RoomCraftApp({ storageKey, projectId }: RoomCraftAppProps) {
  return (
    <ToastProvider>
      <RoomProvider storageKey={storageKey}>
        <PlacementProvider>
          <AppShell sidebar={<Sidebar />}>
            <RoomCanvas projectId={projectId} />
          </AppShell>
        </PlacementProvider>
      </RoomProvider>
    </ToastProvider>
  );
}

export default RoomCraftApp;

