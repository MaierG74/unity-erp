'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { toast } from 'sonner';

type OrganizationOption = {
  id: string;
  name: string;
};

type ModuleEntitlementRow = {
  module_key: string;
  module_name: string;
  description: string | null;
  dependency_keys: string[];
  is_core: boolean;
  enabled: boolean;
  billing_model: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
};

type ToggleConflictPayload = {
  error?: string;
  missing_dependencies?: string[];
  dependent_modules?: Array<{ module_key: string; module_name: string }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authorizedFetch(url, { method: 'GET' });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export default function AdminModulesPage() {
  const [orgs, setOrgs] = useState<OrganizationOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [rows, setRows] = useState<ModuleEntitlementRow[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const selectedOrg = useMemo(
    () => orgs.find((org) => org.id === selectedOrgId) ?? null,
    [orgs, selectedOrgId]
  );
  const enabledKeys = useMemo(
    () => new Set(rows.filter((item) => item.enabled).map((item) => item.module_key)),
    [rows]
  );
  const enabledDependentsByModule = useMemo(() => {
    const map = new Map<string, ModuleEntitlementRow[]>();
    for (const row of rows) {
      if (!row.enabled) continue;
      for (const dependency of row.dependency_keys) {
        const current = map.get(dependency) ?? [];
        current.push(row);
        map.set(dependency, current);
      }
    }
    return map;
  }, [rows]);

  const loadOrganizations = useCallback(async () => {
    setLoadingOrgs(true);
    setError(null);
    try {
      const json = await fetchJson<{ organizations?: OrganizationOption[] }>('/api/admin/orgs');
      const orgList = Array.isArray(json.organizations) ? json.organizations : [];
      setOrgs(orgList);
      if (!selectedOrgId && orgList.length > 0) {
        setSelectedOrgId(orgList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setLoadingOrgs(false);
    }
  }, [selectedOrgId]);

  const loadEntitlements = useCallback(async (orgId: string) => {
    if (!orgId) return;
    setLoadingRows(true);
    setError(null);
    try {
      const json = await fetchJson<{ entitlements?: ModuleEntitlementRow[] }>(
        `/api/admin/orgs/${orgId}/modules`
      );
      setRows(Array.isArray(json.entitlements) ? json.entitlements : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load module entitlements');
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  useEffect(() => {
    if (selectedOrgId) {
      void loadEntitlements(selectedOrgId);
    }
  }, [loadEntitlements, selectedOrgId]);

  const toggleModule = useCallback(
    async (row: ModuleEntitlementRow, enabled: boolean) => {
      if (!selectedOrgId) return;
      setUpdatingKey(row.module_key);
      setError(null);

      try {
        const res = await authorizedFetch(
          `/api/admin/orgs/${selectedOrgId}/modules/${row.module_key}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              enabled,
              billing_model: row.billing_model,
              status: enabled ? 'active' : 'inactive',
              notes: row.notes,
              source: 'admin-modules-ui',
            }),
          }
        );

        const json = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          const payload = json as ToggleConflictPayload;
          if (res.status === 409) {
            if (Array.isArray(payload.missing_dependencies) && payload.missing_dependencies.length > 0) {
              throw new Error(
                `Enable dependencies first: ${payload.missing_dependencies.join(', ')}`
              );
            }
            if (Array.isArray(payload.dependent_modules) && payload.dependent_modules.length > 0) {
              const labels = payload.dependent_modules.map((item) => item.module_name || item.module_key);
              throw new Error(`Disable dependent modules first: ${labels.join(', ')}`);
            }
          }
          throw new Error(payload.error ?? `Update failed (${res.status})`);
        }

        setRows((current) =>
          current.map((item) =>
            item.module_key === row.module_key
              ? {
                  ...item,
                  enabled,
                  status: enabled ? 'active' : 'inactive',
                }
              : item
          )
        );
        toast.success(
          `${row.module_name} ${enabled ? 'enabled' : 'disabled'} for ${selectedOrg?.name ?? 'organization'}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update module';
        setError(message);
        toast.error(message);
      } finally {
        setUpdatingKey(null);
      }
    },
    [selectedOrg?.name, selectedOrgId]
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Module Entitlements</h1>
          <p className="text-sm text-muted-foreground">
            Enable or disable modules per organization (tenant-level licensing controls).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => selectedOrgId && void loadEntitlements(selectedOrgId)}>
            Refresh
          </Button>
          <Link href="/admin/users">
            <Button variant="secondary">Admin Users</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Organization</CardTitle>
          <CardDescription>Select the tenant to manage module access.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-md space-y-2">
            <Label htmlFor="org-select">Tenant</Label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId} disabled={loadingOrgs || orgs.length === 0}>
              <SelectTrigger id="org-select">
                <SelectValue placeholder={loadingOrgs ? 'Loading organizations…' : 'Select organization'} />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">
            Modules {selectedOrg ? `for ${selectedOrg.name}` : ''}
          </CardTitle>
          <CardDescription>Toggle access on or off per module.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRows ? (
            <p className="text-sm text-muted-foreground">Loading module entitlements…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No modules found for this organization.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => {
                const isUpdating = updatingKey === row.module_key;
                const missingDependencies = row.dependency_keys.filter((key) => !enabledKeys.has(key));
                const enabledDependents = enabledDependentsByModule.get(row.module_key) ?? [];
                const enableBlocked = !row.enabled && missingDependencies.length > 0;
                const disableBlocked = row.enabled && enabledDependents.length > 0;
                const toggleBlockedReason = enableBlocked
                  ? `Enable dependencies first: ${missingDependencies.join(', ')}`
                  : disableBlocked
                    ? `Disable dependents first: ${enabledDependents
                        .map((item) => item.module_name || item.module_key)
                        .join(', ')}`
                    : null;
                return (
                  <div
                    key={row.module_key}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{row.module_name}</p>
                        {row.module_key === 'furniture_configurator' ? (
                          <Badge variant="secondary">Sellable add-on</Badge>
                        ) : null}
                        {row.is_core ? <Badge variant="outline">Core</Badge> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {row.description ?? row.module_key}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Status: <span className="font-medium">{row.status}</span> | Billing:{' '}
                        <span className="font-medium">{row.billing_model}</span>
                      </p>
                      {row.dependency_keys.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Depends on: <span className="font-medium">{row.dependency_keys.join(', ')}</span>
                        </p>
                      ) : null}
                      {toggleBlockedReason ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">{toggleBlockedReason}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`toggle-${row.module_key}`} className="text-sm text-muted-foreground">
                        {row.enabled ? 'Enabled' : 'Disabled'}
                      </Label>
                      <Switch
                        id={`toggle-${row.module_key}`}
                        checked={row.enabled}
                        disabled={isUpdating || !selectedOrgId || Boolean(toggleBlockedReason)}
                        title={toggleBlockedReason ?? undefined}
                        onCheckedChange={(enabled) => {
                          void toggleModule(row, enabled);
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
