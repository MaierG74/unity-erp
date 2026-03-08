'use client';

import { WorkSchedulesContent } from '@/app/settings/work-schedules/work-schedules-content';

export default function SchedulesSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Work Schedules</h1>
        <p className="text-sm text-muted-foreground">
          Shift hours and break times per day group. Changes apply to the labor planning board.
        </p>
      </div>
      <WorkSchedulesContent />
    </div>
  );
}
