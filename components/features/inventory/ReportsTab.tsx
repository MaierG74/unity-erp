'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { ReportsOverviewTab } from './ReportsOverviewTab';
import { ReportsSnapshotTab } from './ReportsSnapshotTab';
import { ReportsOrderingTab } from './ReportsOrderingTab';

const SUB_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'snapshot', label: 'Snapshot' },
  { key: 'ordering', label: 'Ordering' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['key'];

export function ReportsTab() {
  const [activeTab, setActiveTab] = useState<SubTab>('overview');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'components', 'reports'] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'critical-components'] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'snapshot'] });
    toast({
      title: 'Data refreshed',
      description: 'Reports have been refreshed.',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/50 p-1">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Button onClick={refreshData} className="h-9" variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {activeTab === 'overview' && <ReportsOverviewTab />}
      {activeTab === 'snapshot' && <ReportsSnapshotTab />}
      {activeTab === 'ordering' && <ReportsOrderingTab />}
    </div>
  );
}
