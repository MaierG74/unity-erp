'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { canvasStorageKey, saveProject } from '@/lib/roomcraft/project-store';
import type { RoomCraftProject } from '@/lib/roomcraft/types';

const MIGRATION_DISMISSED_KEY = 'unity-roomcraft:migration-dismissed';
const DRAFT_KEY = 'unity-roomcraft:draft';
const PRODUCT_KEY_PREFIX = 'unity-roomcraft:product:';

function findLegacyKeys(): string[] {
  const keys: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key === DRAFT_KEY || key.startsWith(PRODUCT_KEY_PREFIX)) {
      keys.push(key);
    }
  }

  return keys;
}

function referenceForLegacyKey(key: string, count: number): string {
  if (key === DRAFT_KEY) return count > 1 ? 'Migrated draft' : 'Untitled draft';

  const productId = key.slice(PRODUCT_KEY_PREFIX.length);
  return productId ? `Migrated product draft ${productId}` : 'Migrated product draft';
}

interface DraftMigrationPromptProps {
  houseAccountCustomerId: number;
  houseAccountCustomerName: string;
  onMigrated?: () => void;
}

export function DraftMigrationPrompt({
  houseAccountCustomerId,
  houseAccountCustomerName,
  onMigrated,
}: DraftMigrationPromptProps) {
  const router = useRouter();
  const [legacyKeys, setLegacyKeys] = React.useState<string[]>([]);

  React.useEffect(() => {
    const dismissed = localStorage.getItem(MIGRATION_DISMISSED_KEY);
    if (!dismissed) {
      setLegacyKeys(findLegacyKeys());
    }
  }, []);

  if (legacyKeys.length === 0) return null;

  function handleMigrate() {
    legacyKeys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;

      const now = new Date().toISOString();
      const project: RoomCraftProject = {
        id: crypto.randomUUID(),
        customerId: houseAccountCustomerId,
        customerName: houseAccountCustomerName,
        reference: referenceForLegacyKey(key, legacyKeys.length),
        createdAt: now,
        updatedAt: now,
        pieces: [],
      };

      localStorage.setItem(canvasStorageKey(project.id), raw);
      localStorage.removeItem(key);
      saveProject(project);
    });

    localStorage.setItem(MIGRATION_DISMISSED_KEY, 'true');
    setLegacyKeys([]);
    onMigrated?.();
    router.refresh();
  }

  function handleDismiss() {
    legacyKeys.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(MIGRATION_DISMISSED_KEY, 'true');
    setLegacyKeys([]);
  }

  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm">
          {legacyKeys.length === 1
            ? 'You have an unsaved RoomCraft draft.'
            : `You have ${legacyKeys.length} unsaved RoomCraft drafts.`}{' '}
          Convert to project records?
        </span>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={handleMigrate}>
            Convert
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss}>
            Discard
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
