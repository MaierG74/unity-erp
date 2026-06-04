import { use } from 'react';
import { ConfigureShell } from '@/components/features/roomcraft/configure/ConfigureShell';

export default function ConfigurePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConfigureShell projectId={projectId} />
    </div>
  );
}
