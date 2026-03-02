'use client';

import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { JobQueueTable } from '@/components/production/job-queue-table';

export default function JobCardsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Staff
          </Link>
        </Button>
      </div>

      <JobQueueTable showHeader defaultStatusFilter="all" />
    </div>
  );
}
