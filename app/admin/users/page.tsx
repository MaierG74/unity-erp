/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/lib/supabase";

type Membership = {
  org_id: string | null;
  role: string | null;
  is_active: boolean | null;
  banned_until: string | null;
};

type ProfileEntry = {
  id: string;
  username: string | null;
  display_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  login: string | null;
  avatar_url: string | null;
  email: string | null;
  metadata?: Record<string, any>;
  memberships?: Membership[];
  primary_org_id?: string | null;
  primary_role?: string | null;
  is_active?: boolean | null;
  banned_until?: string | null;
};

const ROLE_OPTIONS = ["owner", "admin", "manager", "staff"] as const;

function displayForProfile(profile: ProfileEntry) {
  const nameFromParts = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  return (
    profile.display_name ||
    nameFromParts ||
    profile.username ||
    profile.metadata?.full_name ||
    profile.metadata?.name ||
    profile.login ||
    profile.email ||
    profile.id
  );
}

function statusBadge(profile: ProfileEntry) {
  if (profile.is_active === false) return { label: "Inactive", tone: "secondary" as const };
  if (profile.banned_until) return { label: "Banned", tone: "destructive" as const };
  return { label: "Active", tone: "default" as const };
}

async function authorizedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) {
    const err: any = new Error("Missing Supabase access token");
    err.code = "NO_TOKEN";
    throw err;
  }
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(input, { ...init, headers });
}

export default function AdminUsersPage() {
  const [profiles, setProfiles] = useState<ProfileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [createState, setCreateState] = useState<{
    login: string;
    password: string;
    displayName: string;
    firstName: string;
    lastName: string;
    role: string;
    orgId: string;
    avatarUrl: string;
  }>({
    login: "",
    password: "",
    displayName: "",
    firstName: "",
    lastName: "",
    role: "manager",
    orgId: "",
    avatarUrl: "",
  });

  const [editing, setEditing] = useState<{
    user: ProfileEntry | null;
    displayName: string;
    firstName: string;
    lastName: string;
    login: string;
    avatarUrl: string;
  }>({
    user: null,
    displayName: "",
    firstName: "",
    lastName: "",
    login: "",
    avatarUrl: "",
  });

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuthError(null);
    try {
      const res = await authorizedFetch("/api/profiles");
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Failed to load profiles");
      }
      const json = await res.json();
      const list = Array.isArray(json?.profiles) ? (json.profiles as ProfileEntry[]) : [];
      setProfiles(list);
    } catch (err: any) {
      if (err?.code === "NO_TOKEN") {
        setAuthError("Sign in again to obtain a Supabase session token.");
      }
      setError(err?.message ?? "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => displayForProfile(a).localeCompare(displayForProfile(b)));
  }, [profiles]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        login: createState.login.trim(),
        password: createState.password,
        display_name: createState.displayName.trim(),
        first_name: createState.firstName.trim(),
        last_name: createState.lastName.trim(),
        role: createState.role,
        org_id: createState.orgId.trim(),
        avatar_url: createState.avatarUrl.trim() || undefined,
      };
      const res = await authorizedFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Failed to create user");
      }
      setCreateState(prev => ({ ...prev, password: "" }));
      await loadProfiles();
      alert(`User created. Synthetic email: ${json.email}. Password (save now): ${json.password}`);
    } catch (err: any) {
      setError(err?.message ?? "Failed to create user");
    }
  };

  const handleResetPassword = async (user: ProfileEntry) => {
    const newPassword = prompt("Enter new password for user", "");
    if (!newPassword) return;
    try {
      const res = await authorizedFetch(`/api/admin/users/${user.id}/password`, {
        method: "POST",
        body: JSON.stringify({ new_password: newPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to reset password");
      alert(`Password updated. New password: ${json.new_password}`);
    } catch (err: any) {
      alert(err?.message ?? "Failed to reset password");
    }
  };

  const openEditDialog = (user: ProfileEntry) => {
    setEditing({
      user,
      displayName: user.display_name || user.username || "",
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      login: user.login || "",
      avatarUrl: user.avatar_url || "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editing.user) return;
    try {
      const res = await authorizedFetch(`/api/admin/users/${editing.user.id}/profile`, {
        method: "PATCH",
        body: JSON.stringify({
          display_name: editing.displayName || undefined,
          first_name: editing.firstName || undefined,
          last_name: editing.lastName || undefined,
          login: editing.login || undefined,
          avatar_url: editing.avatarUrl || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to update profile");
      setEditing(prev => ({ ...prev, user: null }));
      await loadProfiles();
    } catch (err: any) {
      alert(err?.message ?? "Failed to update profile");
    }
  };

  const handleChangeRole = async (user: ProfileEntry) => {
    const role = prompt("Role (owner/admin/manager/staff)", user.primary_role || "") ?? "";
    if (!role) return;
    const orgId = prompt("Org ID", user.primary_org_id || "") ?? "";
    if (!orgId) return;
    try {
      const res = await authorizedFetch(`/api/admin/users/${user.id}/role`, {
        method: "POST",
        body: JSON.stringify({ role, org_id: orgId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to change role");
      await loadProfiles();
    } catch (err: any) {
      alert(err?.message ?? "Failed to change role");
    }
  };

  const handleToggleActive = async (user: ProfileEntry) => {
    const nextActive = !(user.is_active ?? true);
    let orgId = user.primary_org_id || "";
    if (!orgId) {
      orgId = prompt("Org ID for membership to toggle", "") ?? "";
      if (!orgId) return;
    }
    let banned_until: string | null | undefined = undefined;
    if (!nextActive) {
      const banInput = prompt("Optional banned_until (ISO string) or leave blank", "") ?? "";
      banned_until = banInput ? banInput : null;
    }
    try {
      const res = await authorizedFetch(`/api/admin/users/${user.id}/deactivate`, {
        method: "POST",
        body: JSON.stringify({ is_active: nextActive, org_id: orgId, banned_until }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to update status");
      await loadProfiles();
    } catch (err: any) {
      alert(err?.message ?? "Failed to update status");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Users</h1>
          <p className="text-sm text-muted-foreground">Create, edit, reset passwords, and manage activation.</p>
        </div>
        <Button variant="outline" onClick={loadProfiles} disabled={loading}>
          Refresh
        </Button>
      </div>

      {authError ? <p className="text-sm text-red-500">{authError}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Create User</CardTitle>
          <CardDescription>Synthetic email is derived from login (e.g. login@qbutton.co.za). Password is shown once.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="login">Login</Label>
              <Input
                id="login"
                required
                value={createState.login}
                onChange={e => setCreateState(prev => ({ ...prev, login: e.target.value }))}
                placeholder="jdoe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={createState.password}
                onChange={e => setCreateState(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Min 12 chars"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={createState.displayName}
                onChange={e => setCreateState(prev => ({ ...prev, displayName: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={createState.firstName}
                onChange={e => setCreateState(prev => ({ ...prev, firstName: e.target.value }))}
                placeholder="Jane"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={createState.lastName}
                onChange={e => setCreateState(prev => ({ ...prev, lastName: e.target.value }))}
                placeholder="Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                className="h-10 w-full rounded-md border px-3 text-sm"
                value={createState.role}
                onChange={e => setCreateState(prev => ({ ...prev, role: e.target.value }))}
              >
                {ROLE_OPTIONS.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org">Org ID</Label>
              <Input
                id="org"
                required
                value={createState.orgId}
                onChange={e => setCreateState(prev => ({ ...prev, orgId: e.target.value }))}
                placeholder="UUID for org"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avatar">Avatar URL (optional)</Label>
              <Input
                id="avatar"
                value={createState.avatarUrl}
                onChange={e => setCreateState(prev => ({ ...prev, avatarUrl: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Working..." : "Create user"}
              </Button>
            </div>
          </form>
          {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
        </CardContent>
      </Card>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Existing users</h2>
          <p className="text-sm text-muted-foreground">{sortedProfiles.length} users</p>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Login</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Org</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {sortedProfiles.map(profile => {
                const role = profile.primary_role || profile.metadata?.role || profile.metadata?.app_metadata?.role || "—";
                const org = profile.primary_org_id || profile.metadata?.org_id || profile.metadata?.app_metadata?.org_id || "—";
                const status = statusBadge(profile);
                return (
                  <tr key={profile.id}>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center space-x-3">
                        {profile.avatar_url ? (
                          <img src={profile.avatar_url} alt={displayForProfile(profile)} className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                            {displayForProfile(profile).substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="leading-tight">
                          <div className="font-semibold">{displayForProfile(profile)}</div>
                          <div className="text-xs text-muted-foreground">{profile.email ?? "No email"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-muted-foreground">{profile.login ?? "—"}</td>
                    <td className="px-4 py-3 align-top text-sm">{role}</td>
                    <td className="px-4 py-3 align-top text-sm">{org}</td>
                    <td className="px-4 py-3 align-top text-sm">
                      <Badge variant={status.tone}>{status.label}</Badge>
                      {profile.banned_until ? (
                        <div className="text-xs text-muted-foreground">until {new Date(profile.banned_until).toLocaleString()}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openEditDialog(profile)}>
                          Edit profile
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleChangeRole(profile)}>
                          Change role/org
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleResetPassword(profile)}>
                          Reset password
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleToggleActive(profile)}>
                          {profile.is_active === false ? "Reactivate" : "Deactivate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={Boolean(editing.user)} onOpenChange={open => !open && setEditing(prev => ({ ...prev, user: null }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>Update name, login, and avatar. Changing login regenerates the synthetic email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="editDisplayName">Display name</Label>
                <Input
                  id="editDisplayName"
                  value={editing.displayName}
                  onChange={e => setEditing(prev => ({ ...prev, displayName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editLogin">Login</Label>
                <Input id="editLogin" value={editing.login} onChange={e => setEditing(prev => ({ ...prev, login: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editFirstName">First name</Label>
                <Input
                  id="editFirstName"
                  value={editing.firstName}
                  onChange={e => setEditing(prev => ({ ...prev, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editLastName">Last name</Label>
                <Input
                  id="editLastName"
                  value={editing.lastName}
                  onChange={e => setEditing(prev => ({ ...prev, lastName: e.target.value }))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="editAvatar">Avatar URL</Label>
                <Input
                  id="editAvatar"
                  value={editing.avatarUrl}
                  onChange={e => setEditing(prev => ({ ...prev, avatarUrl: e.target.value }))}
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(prev => ({ ...prev, user: null }))}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
