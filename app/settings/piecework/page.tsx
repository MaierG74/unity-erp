'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { authorizedFetch } from '@/lib/client/auth-fetch';

type PieceworkActivity = {
  id: string;
  code: string;
  label: string;
  default_rate: number | string;
  unit_label: string;
  target_role_id: number | null;
  is_active: boolean;
};

type LaborRole = {
  role_id: number;
  name: string;
  color: string | null;
};

type DraftActivity = {
  id?: string;
  code: string;
  label: string;
  default_rate: string;
  unit_label: string;
  target_role_id: string;
  is_active: boolean;
};

const CODE_LABELS: Record<string, string> = {
  cut_pieces: 'Cut pieces',
  edge_bundles: 'Edge bundles',
};

function toDraft(activity: PieceworkActivity): DraftActivity {
  return {
    id: activity.id,
    code: activity.code,
    label: activity.label,
    default_rate: String(activity.default_rate ?? ''),
    unit_label: activity.unit_label,
    target_role_id: activity.target_role_id ? String(activity.target_role_id) : 'none',
    is_active: activity.is_active,
  };
}

function blankDraft(code: string): DraftActivity {
  return {
    code,
    label: CODE_LABELS[code] ?? code,
    default_rate: '0.00',
    unit_label: code === 'edge_bundles' ? 'bundle' : 'piece',
    target_role_id: 'none',
    is_active: true,
  };
}

export default function PieceworkSettingsPage() {
  const [activities, setActivities] = useState<PieceworkActivity[]>([]);
  const [roles, setRoles] = useState<LaborRole[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftActivity>>({});
  const [newDraft, setNewDraft] = useState<DraftActivity | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const existingCodes = useMemo(() => new Set(activities.map((activity) => activity.code)), [activities]);
  const availableCodes = codes.filter((code) => !existingCodes.has(code));

  async function load() {
    setLoading(true);
    const res = await authorizedFetch('/api/settings/piecework-activities');
    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(json.error ?? 'Failed to load piecework activities');
      return;
    }

    const loadedActivities = (json.activities ?? []) as PieceworkActivity[];
    setActivities(loadedActivities);
    setRoles((json.roles ?? []) as LaborRole[]);
    setCodes((json.codes ?? []) as string[]);
    setCanWrite(Boolean(json.canWrite));
    setDrafts(Object.fromEntries(loadedActivities.map((activity) => [activity.id, toDraft(activity)])));
  }

  useEffect(() => {
    void load();
  }, []);

  function updateDraft(id: string, patch: Partial<DraftActivity>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  async function saveDraft(draft: DraftActivity) {
    setSavingId(draft.id ?? 'new');
    const res = await authorizedFetch('/api/settings/piecework-activities', {
      method: draft.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...draft,
        default_rate: Number(draft.default_rate),
        target_role_id: draft.target_role_id === 'none' ? null : Number(draft.target_role_id),
      }),
    });
    const json = await res.json();
    setSavingId(null);

    if (!res.ok) {
      toast.error(json.error ?? 'Failed to save activity');
      return;
    }

    toast.success('Piecework activity saved');
    setNewDraft(null);
    await load();
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading piecework activities...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Piecework Activities</h1>
        <p className="text-sm text-muted-foreground">
          Manage organization piecework rates for cutting and edging cards.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <div className="grid min-w-[920px] grid-cols-[1fr_1.4fr_120px_120px_1.3fr_88px_96px] gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
          <div>Code</div>
          <div>Label</div>
          <div>Rate</div>
          <div>Unit</div>
          <div>Target role</div>
          <div>Active</div>
          <div />
        </div>

        {activities.map((activity) => {
          const draft = drafts[activity.id] ?? toDraft(activity);
          return (
            <div
              key={activity.id}
              className="grid min-w-[920px] grid-cols-[1fr_1.4fr_120px_120px_1.3fr_88px_96px] items-center gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <div className="text-sm font-medium">{CODE_LABELS[activity.code] ?? activity.code}</div>
              <Input
                value={draft.label}
                disabled={!canWrite}
                onChange={(event) => updateDraft(activity.id, { label: event.target.value })}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.default_rate}
                disabled={!canWrite}
                onChange={(event) => updateDraft(activity.id, { default_rate: event.target.value })}
              />
              <Input
                value={draft.unit_label}
                disabled={!canWrite}
                onChange={(event) => updateDraft(activity.id, { unit_label: event.target.value })}
              />
              <Select
                value={draft.target_role_id}
                disabled={!canWrite}
                onValueChange={(value) => updateDraft(activity.id, { target_role_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No role</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.role_id} value={String(role.role_id)}>
                      {role.name.trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Switch
                checked={draft.is_active}
                disabled={!canWrite}
                onCheckedChange={(value) => updateDraft(activity.id, { is_active: value })}
              />
              <Button
                type="button"
                size="sm"
                disabled={!canWrite || savingId === activity.id}
                onClick={() => saveDraft(draft)}
              >
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
            </div>
          );
        })}

        {activities.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No piecework activities configured for this organization.
          </div>
        )}
      </div>

      {newDraft ? (
        <div className="rounded-md border p-4">
          <div className="mb-4 text-sm font-medium">Add activity</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.4fr_120px_120px_1.3fr_88px]">
            <Select value={newDraft.code} onValueChange={(value) => setNewDraft(blankDraft(value))}>
              <SelectTrigger>
                <SelectValue placeholder="Code" />
              </SelectTrigger>
              <SelectContent>
                {availableCodes.map((code) => (
                  <SelectItem key={code} value={code}>
                    {CODE_LABELS[code] ?? code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={newDraft.label}
              onChange={(event) => setNewDraft({ ...newDraft, label: event.target.value })}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              value={newDraft.default_rate}
              onChange={(event) => setNewDraft({ ...newDraft, default_rate: event.target.value })}
            />
            <Input
              value={newDraft.unit_label}
              onChange={(event) => setNewDraft({ ...newDraft, unit_label: event.target.value })}
            />
            <Select
              value={newDraft.target_role_id}
              onValueChange={(value) => setNewDraft({ ...newDraft, target_role_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="No role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No role</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role.role_id} value={String(role.role_id)}>
                    {role.name.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={newDraft.is_active}
              onCheckedChange={(value) => setNewDraft({ ...newDraft, is_active: value })}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setNewDraft(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={savingId === 'new'} onClick={() => saveDraft(newDraft)}>
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          disabled={!canWrite || availableCodes.length === 0}
          onClick={() => setNewDraft(blankDraft(availableCodes[0]))}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add activity
        </Button>
      )}
    </div>
  );
}
