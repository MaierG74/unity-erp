'use client';

import { WorkSchedulesContent } from './work-schedules-content';

export { WorkSchedulesContent };

export default function WorkSchedulesPage() {
  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Work Schedules</h1>
        <p className="text-sm text-muted-foreground">
          Configure shift hours and break times per day group. Changes apply to the labor planning board.
        </p>
      </div>
      <WorkSchedulesContent />
    </div>
  );
}
