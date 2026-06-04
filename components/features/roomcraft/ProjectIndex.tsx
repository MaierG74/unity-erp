'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Folder, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { listProjects } from '@/lib/roomcraft/project-store';
import type { ProjectStatus, RoomCraftProject } from '@/lib/roomcraft/types';
import { CreateProjectModal } from './CreateProjectModal';
import { DraftMigrationPrompt } from './DraftMigrationPrompt';

const HOUSE_ACCOUNT_CUSTOMER_ID = 108;
const HOUSE_ACCOUNT_CUSTOMER_NAME = 'Walk In';

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Draft',
  configuring: 'Configuring',
  ready: 'Ready',
  converted: 'Converted',
};

const STATUS_VARIANTS: Record<ProjectStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  configuring: 'default',
  ready: 'outline',
  converted: 'secondary',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function projectStatus(project: RoomCraftProject): ProjectStatus {
  return project.pieces.length === 0 ? 'draft' : 'configuring';
}

export function ProjectIndex() {
  const router = useRouter();
  const [projects, setProjects] = React.useState<RoomCraftProject[]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);

  const refreshProjects = React.useCallback(() => {
    setProjects(listProjects().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, []);

  React.useEffect(() => {
    refreshProjects();
  }, [modalOpen, refreshProjects]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">RoomCraft Projects</h1>
        <Button onClick={() => setModalOpen(true)} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          New project
        </Button>
      </div>

      <DraftMigrationPrompt
        houseAccountCustomerId={HOUSE_ACCOUNT_CUSTOMER_ID}
        houseAccountCustomerName={HOUSE_ACCOUNT_CUSTOMER_NAME}
        onMigrated={refreshProjects}
      />

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
          <Folder className="h-10 w-10 opacity-30" />
          <p className="text-sm">No projects yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {projects.map((project) => {
            const status = projectStatus(project);

            return (
              <button
                key={project.id}
                className="flex w-full items-center justify-between gap-4 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/50"
                onClick={() => router.push(`/roomcraft/${project.id}`)}
                type="button"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium">{project.reference}</p>
                  <p className="truncate text-xs text-muted-foreground">{project.customerName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatDate(project.updatedAt)}</span>
                  <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <CreateProjectModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
