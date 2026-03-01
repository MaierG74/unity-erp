'use client';

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useFactoryFloor } from '@/hooks/use-factory-floor';
import { useShiftInfo } from '@/hooks/use-shift-info';
import { useJobActions } from '@/hooks/use-job-actions';
import { QueryError } from '@/components/ui/query-error';
import { FloorHeader } from './floor-header';
import { SectionZone } from './section-zone';
import { FloorDetailPanel } from './floor-detail-panel';
import { SectionsSettingsDialog } from './sections-settings-dialog';
import { CompleteJobDialog } from './complete-job-dialog';
import { PauseJobDialog } from './pause-job-dialog';
import { TransferJobDialog } from './transfer-job-dialog';
import type { FloorStaffJob } from './types';
import { Loader2 } from 'lucide-react';

export function FactoryFloorPage() {
  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const { sections, isLoading, error, refetch } =
    useFactoryFloor();
  const shiftInfo = useShiftInfo(todayStr);
  const [selectedJob, setSelectedJob] = useState<FloorStaffJob | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const { completeJob, pauseJob, resumeJob, transferJob } = useJobActions();

  if (error) {
    return (
      <div className="p-6">
        <QueryError error={error} queryKey={['factory-floor']} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <FloorHeader
        sections={sections}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        onOpenSettings={() => setSettingsOpen(true)}
        shiftInfo={shiftInfo}
      />

      {isLoading && sections.length === 0 ? (
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sections.map((s) => (
            <SectionZone
              key={s.section.section_id}
              data={s}
              onStaffClick={setSelectedJob}
              shiftInfo={shiftInfo}
            />
          ))}
        </div>
      )}

      <FloorDetailPanel
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onComplete={() => setCompleteDialogOpen(true)}
        onPause={() => setPauseDialogOpen(true)}
        onResume={(assignmentId) => {
          resumeJob.mutate(assignmentId, {
            onSuccess: () => setSelectedJob(null),
          });
        }}
        onTransfer={() => setTransferDialogOpen(true)}
        isUpdating={completeJob.isPending || pauseJob.isPending || resumeJob.isPending || transferJob.isPending}
        shiftInfo={shiftInfo}
      />

      <CompleteJobDialog
        job={selectedJob}
        open={completeDialogOpen}
        onOpenChange={setCompleteDialogOpen}
        onComplete={({ items, actualStart, actualEnd, notes }) => {
          if (!selectedJob) return;
          completeJob.mutate({
            assignmentId: selectedJob.assignment_id,
            items,
            actualStart,
            actualEnd,
            notes,
          }, {
            onSuccess: () => {
              setCompleteDialogOpen(false);
              setSelectedJob(null);
            },
          });
        }}
        isPending={completeJob.isPending}
      />

      <PauseJobDialog
        job={selectedJob}
        open={pauseDialogOpen}
        onOpenChange={setPauseDialogOpen}
        onPause={(reason, notes) => {
          if (!selectedJob) return;
          pauseJob.mutate({
            assignmentId: selectedJob.assignment_id,
            reason,
            notes,
          }, {
            onSuccess: () => {
              setPauseDialogOpen(false);
              setSelectedJob(null);
            },
          });
        }}
        isPending={pauseJob.isPending}
      />

      <TransferJobDialog
        job={selectedJob}
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onTransfer={(newStaffId, notes) => {
          if (!selectedJob) return;
          transferJob.mutate({
            assignmentId: selectedJob.assignment_id,
            newStaffId,
            notes,
          }, {
            onSuccess: () => {
              setTransferDialogOpen(false);
              setSelectedJob(null);
            },
          });
        }}
        isPending={transferJob.isPending}
      />

      <SectionsSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}
