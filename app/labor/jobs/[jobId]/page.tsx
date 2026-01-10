'use client';

import { use } from 'react';
import { JobDetail } from '@/components/features/labor/job-detail';

interface JobDetailPageProps {
  params: Promise<{ jobId: string }>;
}

export default function JobDetailPage({ params }: JobDetailPageProps) {
  const { jobId } = use(params);

  return <JobDetail jobId={parseInt(jobId)} />;
}
