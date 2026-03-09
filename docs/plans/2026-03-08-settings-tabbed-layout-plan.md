# Settings Tabbed Sidebar Layout — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the monolithic settings page into sidebar-navigated sub-pages, one per settings domain.

**Architecture:** Next.js App Router nested layout. `layout.tsx` renders a sidebar + `{children}` content area. Each settings domain is a separate route (`/settings/company`, `/settings/payroll`, etc.). No database changes — purely a frontend restructuring.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, `usePathname()` for active state, existing Supabase hooks.

**Design doc:** `docs/plans/2026-03-08-settings-tabbed-layout-design.md`

---

### Task 1: Create the Settings Sidebar Layout

**Files:**
- Modify: `app/settings/layout.tsx`

**Step 1: Write the sidebar layout**

Replace the current passthrough layout with a two-column layout: sidebar nav on the left, `{children}` on the right.

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Building2,
  FileText,
  DollarSign,
  Clock,
  Ruler,
  Scissors,
  Layers,
  Package,
} from 'lucide-react';

const SETTINGS_NAV = [
  {
    group: 'General',
    items: [
      { label: 'Company Details', href: '/settings/company', icon: Building2 },
    ],
  },
  {
    group: 'Production',
    items: [
      { label: 'Configurator', href: '/settings/configurator', icon: Ruler },
      { label: 'Cutlist', href: '/settings/cutlist', icon: Scissors },
      { label: 'Option Sets', href: '/settings/option-sets', icon: Layers },
    ],
  },
  {
    group: 'Documents',
    items: [
      { label: 'Templates', href: '/settings/documents', icon: FileText },
    ],
  },
  {
    group: 'Workforce',
    items: [
      { label: 'Payroll', href: '/settings/payroll', icon: DollarSign },
      { label: 'Work Schedules', href: '/settings/schedules', icon: Clock },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { label: 'Finished Goods', href: '/settings/finished-goods', icon: Package },
    ],
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <nav className="w-56 shrink-0 border-r bg-card p-4 space-y-6">
        <h2 className="text-lg font-semibold px-2">Settings</h2>
        {SETTINGS_NAV.map((group) => (
          <div key={group.group}>
            <h3 className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.group}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Verify it renders**

Run: `npm run lint`
Expected: No errors in `app/settings/layout.tsx`

**Step 3: Commit**

```bash
git add app/settings/layout.tsx
git commit -m "feat(settings): add sidebar navigation layout"
```

---

### Task 2: Create the Root Redirect + Company Settings Page

**Files:**
- Rewrite: `app/settings/page.tsx` (replace 1,100 lines with a redirect)
- Create: `app/settings/company/page.tsx`

**Step 1: Replace the root page with a redirect**

Replace `app/settings/page.tsx` entirely with:

```tsx
import { redirect } from 'next/navigation';

export default function SettingsRootPage() {
  redirect('/settings/company');
}
```

**Step 2: Create the Company Details page**

Create `app/settings/company/page.tsx` — extract from old `page.tsx` lines 16-33 (Settings interface), 158-279 (state + handlers for company settings + logo upload + save), and 457-575 (Company Settings Card JSX).

This page is self-contained: it fetches company settings via `/api/settings`, manages local state, and has its own Save button. **Remove** the "Inventory & Finished Goods" subsection (lines 548-567) — that moves to its own page.

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface Settings {
  setting_id: number;
  company_name: string;
  company_logo_path: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  vat_number: string | null;
  bank_details: string | null;
  terms_conditions: string | null;
  fg_auto_consume_on_add?: boolean;
  po_default_cc_email?: string | null;
}

export default function CompanySettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/settings', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setSettings(json.settings as Settings);
        if (json.settings?.company_logo_path) {
          const { data } = supabase.storage
            .from('QButton')
            .getPublicUrl(json.settings.company_logo_path);
          setLogoUrl(data.publicUrl);
        }
      } catch (e: any) {
        toast.error(e?.message ?? 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onChange = (k: keyof Settings, v: any) => {
    if (!settings) return;
    setSettings({ ...settings, [k]: v });
  };

  const uploadLogo = async (file: File) => {
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `logos/company-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('QButton').upload(path, file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('QButton').getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      await save({ company_logo_path: path });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to upload logo');
    }
  };

  const save = async (partial?: Partial<Settings>) => {
    if (!settings) return;
    setSaving(true);
    try {
      const body = { ...settings, ...(partial || {}) } as Partial<Settings>;
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSettings(json.settings as Settings);
      toast.success('Settings saved');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse text-muted-foreground">Loading settings…</div>;
  }

  if (!settings) {
    return <div className="text-destructive">Unable to load settings.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Company Details</h1>
        <p className="text-sm text-muted-foreground">Branding and details used in quotes and emails</p>
      </div>

      {/* Logo */}
      <div>
        <label className="block text-sm font-medium mb-2">Company Logo</label>
        <div className="flex items-center gap-4">
          <div className="w-28 h-28 rounded bg-muted flex items-center justify-center overflow-hidden">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Company logo" className="object-contain w-full h-full" />
            ) : (
              <span className="text-xs text-muted-foreground">No logo</span>
            )}
          </div>
          <div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
            />
            {settings.company_logo_path && (
              <div className="text-xs text-muted-foreground mt-1">Stored at: {settings.company_logo_path}</div>
            )}
          </div>
        </div>
      </div>

      {/* Basics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Company Name</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.company_name || ''} onChange={(e) => onChange('company_name', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Phone</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.phone || ''} onChange={(e) => onChange('phone', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.email || ''} onChange={(e) => onChange('email', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Website</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.website || ''} onChange={(e) => onChange('website', e.target.value)} />
        </div>
      </div>

      {/* Address */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Address line 1</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.address_line1 || ''} onChange={(e) => onChange('address_line1', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Address line 2</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.address_line2 || ''} onChange={(e) => onChange('address_line2', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">City</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.city || ''} onChange={(e) => onChange('city', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Postal Code</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.postal_code || ''} onChange={(e) => onChange('postal_code', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Country</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.country || ''} onChange={(e) => onChange('country', e.target.value)} />
        </div>
      </div>

      {/* Tax & Bank */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">VAT Number</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.vat_number || ''} onChange={(e) => onChange('vat_number', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Bank Details</label>
          <input className="w-full px-3 py-2 rounded border bg-background" value={settings.bank_details || ''} onChange={(e) => onChange('bank_details', e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => save()} disabled={saving} className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Verify**

Run: `npm run lint`
Navigate to `localhost:3000/settings` — should redirect to `/settings/company` and show sidebar + company form.

**Step 4: Commit**

```bash
git add app/settings/page.tsx app/settings/company/page.tsx
git commit -m "feat(settings): extract company details into own page, add root redirect"
```

---

### Task 3: Create Documents (Templates) Page

**Files:**
- Create: `app/settings/documents/page.tsx`

**Step 1: Create the documents page**

Extract from old `page.tsx`: the template state (lines 165-181), template fetch (lines 200-228), template save/add/delete/auto-save handlers (lines 281-428), and the Document Templates Card JSX (lines 637-813).

This page needs to also fetch company settings for the `po_default_cc_email` field. It can fetch both in the same `useEffect`.

The page should include the quote and PO template sub-sections with their expand/collapse toggles, identical to the current UI but without the wrapping card — the layout already provides the content container.

Key imports: `DocumentTemplate`, `POContactInfo` from `@/types/templates`, `parsePOContactInfo` from `@/lib/templates`, `ChevronDown`, `ChevronRight`, `FileText`, `ShoppingCart`, `Plus`, `Trash2` from `lucide-react`.

**Step 2: Verify**

Run: `npm run lint`
Navigate to `localhost:3000/settings/documents` — should show templates form.

**Step 3: Commit**

```bash
git add app/settings/documents/page.tsx
git commit -m "feat(settings): extract document templates into own page"
```

---

### Task 4: Create Payroll Settings Page

**Files:**
- Create: `app/settings/payroll/page.tsx`

**Step 1: Create the payroll page**

Extract from old `page.tsx`: payroll state (lines 48-51), org settings sync (lines 64-70), save handler (lines 86-104), and Payroll Settings Card JSX (lines 815-866).

Uses `useOrgSettings()` hook and `useAuth()` for org_id.

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function PayrollSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgSettings = useOrgSettings();
  const [weekStartDay, setWeekStartDay] = useState(5);
  const [otThreshold, setOtThreshold] = useState(30);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!orgSettings.isLoading && !initialized) {
      setWeekStartDay(orgSettings.weekStartDay);
      setOtThreshold(orgSettings.otThresholdMinutes);
      setInitialized(true);
    }
  }, [orgSettings.isLoading, orgSettings.weekStartDay, orgSettings.otThresholdMinutes, initialized]);

  const handleSave = async () => {
    const orgId = getOrgId(user);
    if (!orgId) return;
    setSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({ week_start_day: weekStartDay, ot_threshold_minutes: otThreshold })
      .eq('id', orgId);
    setSaving(false);
    if (error) {
      toast.error('Failed to save payroll settings');
    } else {
      toast.success('Payroll settings saved');
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
    }
  };

  if (orgSettings.isLoading) {
    return <div className="animate-pulse text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Payroll Settings</h1>
        <p className="text-sm text-muted-foreground">Work week boundaries and overtime threshold</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium mb-1">Work Week Starts On</label>
          <p className="text-xs text-muted-foreground mb-2">First day of the payroll work week</p>
          <select
            className="w-full px-3 py-2 rounded border bg-background"
            value={weekStartDay}
            onChange={(e) => setWeekStartDay(Number(e.target.value))}
          >
            {DAY_NAMES.map((name, i) => (
              <option key={i} value={i}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">OT Threshold (minutes)</label>
          <p className="text-xs text-muted-foreground mb-2">
            Weekly overtime below this is treated as scan drift and auto-zeroed during payroll review
          </p>
          <input
            type="number"
            min="0"
            max="600"
            className="w-full px-3 py-2 rounded border bg-background"
            value={otThreshold}
            onChange={(e) => setOtThreshold(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Payroll Settings'}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify**

Run: `npm run lint`
Navigate to `localhost:3000/settings/payroll`.

**Step 3: Commit**

```bash
git add app/settings/payroll/page.tsx
git commit -m "feat(settings): extract payroll settings into own page"
```

---

### Task 5: Create Work Schedules Page

**Files:**
- Create: `app/settings/schedules/page.tsx`
- Existing: `app/settings/work-schedules/page.tsx` (keep for now — `WorkSchedulesContent` is exported from here)

**Step 1: Create the schedules wrapper page**

```tsx
'use client';

import { WorkSchedulesContent } from '@/app/settings/work-schedules/page';

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
```

**Step 2: Verify**

Navigate to `localhost:3000/settings/schedules` — should show the three day-group cards.

**Step 3: Commit**

```bash
git add app/settings/schedules/page.tsx
git commit -m "feat(settings): add work schedules settings page"
```

---

### Task 6: Create Configurator Defaults Page

**Files:**
- Create: `app/settings/configurator/page.tsx`

**Step 1: Create the configurator page**

Extract from old `page.tsx`: configurator state (lines 53-58), sync effect (lines 72-77), save handler (lines 106-130), and Configurator Defaults Card JSX (lines 868-1075).

Uses `useOrgSettings()`, `useAuth()`, `DEFAULT_CUPBOARD_CONFIG` from `@/lib/configurator/templates/types`.

The page renders all configurator fields directly (no collapse toggle needed — it's its own page now). Keep the same form layout: board measurements, overhangs, gaps & slots, door & shelf defaults.

**Step 2: Verify**

Run: `npm run lint`
Navigate to `localhost:3000/settings/configurator`.

**Step 3: Commit**

```bash
git add app/settings/configurator/page.tsx
git commit -m "feat(settings): extract configurator defaults into own page"
```

---

### Task 7: Create Cutlist Defaults Page

**Files:**
- Create: `app/settings/cutlist/page.tsx`

**Step 1: Create the cutlist page**

Extract from old `page.tsx`: cutlist state (lines 59-61), sync effect (lines 79-84), save handler (lines 132-156), and Cutlist Defaults Card JSX (lines 577-635).

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrgSettings, type CutlistDefaults } from '@/hooks/use-org-settings';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export default function CutlistSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgSettings = useOrgSettings();
  const [cutlistDefaults, setCutlistDefaults] = useState<CutlistDefaults>({});
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!orgSettings.isLoading && !initialized) {
      setCutlistDefaults(orgSettings.cutlistDefaults);
      setInitialized(true);
    }
  }, [orgSettings.isLoading, orgSettings.cutlistDefaults, initialized]);

  const updateDefault = (key: keyof CutlistDefaults, value: number | undefined) => {
    setCutlistDefaults(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const orgId = getOrgId(user);
    if (!orgId) return;
    setSaving(true);
    const cleaned: CutlistDefaults = {
      minReusableOffcutDimensionMm: Number(cutlistDefaults.minReusableOffcutDimensionMm) || 150,
      preferredOffcutDimensionMm: Number(cutlistDefaults.preferredOffcutDimensionMm) || 300,
      minReusableOffcutAreaMm2: Number(cutlistDefaults.minReusableOffcutAreaMm2) || 100000,
    };
    const { error } = await supabase
      .from('organizations')
      .update({ cutlist_defaults: cleaned })
      .eq('id', orgId);
    setSaving(false);
    if (error) {
      toast.error('Failed to save cutlist defaults');
    } else {
      toast.success('Cutlist defaults saved');
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
    }
  };

  if (orgSettings.isLoading) {
    return <div className="animate-pulse text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Cutlist Defaults</h1>
        <p className="text-sm text-muted-foreground">Organization-wide rules for what counts as a reusable offcut</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Minimum reusable dimension (mm)</label>
          <input
            type="number"
            min={1}
            className="w-full px-3 py-2 rounded border bg-background"
            value={cutlistDefaults.minReusableOffcutDimensionMm ?? 150}
            onChange={(e) => updateDefault('minReusableOffcutDimensionMm', Number(e.target.value) || undefined)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            Leftover pieces smaller than this are treated as too small to reuse.
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Preferred offcut dimension (mm)</label>
          <input
            type="number"
            min={1}
            className="w-full px-3 py-2 rounded border bg-background"
            value={cutlistDefaults.preferredOffcutDimensionMm ?? 300}
            onChange={(e) => updateDefault('preferredOffcutDimensionMm', Number(e.target.value) || undefined)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            Bigger values push the optimizer toward larger, cleaner leftover pieces.
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Minimum reusable area (mm²)</label>
          <input
            type="number"
            min={1}
            className="w-full px-3 py-2 rounded border bg-background"
            value={cutlistDefaults.minReusableOffcutAreaMm2 ?? 100000}
            onChange={(e) => updateDefault('minReusableOffcutAreaMm2', Number(e.target.value) || undefined)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            Prevents tiny odd-shaped leftovers from being counted as useful stock.
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Cutlist Defaults'}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify**

Navigate to `localhost:3000/settings/cutlist`.

**Step 3: Commit**

```bash
git add app/settings/cutlist/page.tsx
git commit -m "feat(settings): extract cutlist defaults into own page"
```

---

### Task 8: Create Finished Goods Page

**Files:**
- Create: `app/settings/finished-goods/page.tsx`

**Step 1: Create the finished goods page**

Extract the "Inventory & Finished Goods" subsection from old Company Settings Card (lines 548-567). Needs its own fetch of company settings and save handler.

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function FinishedGoodsSettingsPage() {
  const [autoConsume, setAutoConsume] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setAutoConsume(Boolean(json.settings?.fg_auto_consume_on_add));
      } catch (e: any) {
        toast.error(e?.message ?? 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fg_auto_consume_on_add: autoConsume }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Finished goods settings saved');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Finished Goods</h1>
        <p className="text-sm text-muted-foreground">Inventory behavior for finished goods</p>
      </div>

      <div className="flex items-start gap-3">
        <input
          id="fg-auto-consume"
          type="checkbox"
          className="mt-1"
          checked={autoConsume}
          onChange={(e) => setAutoConsume(e.target.checked)}
        />
        <label htmlFor="fg-auto-consume" className="text-sm">
          Consume reservations automatically when FG is added
          <div className="text-xs text-muted-foreground">
            When on, newly added finished goods will be allocated to existing reservations (FIFO) and deducted from on‑hand immediately.
            When off (default), consumption occurs at shipping.
          </div>
        </label>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify**

Navigate to `localhost:3000/settings/finished-goods`.

**Step 3: Commit**

```bash
git add app/settings/finished-goods/page.tsx
git commit -m "feat(settings): extract finished goods settings into own page"
```

---

### Task 9: Update App Sidebar Link

**Files:**
- Modify: `components/layout/sidebar.tsx`

**Step 1: Remove the separate Option Sets entry from the main app sidebar**

The option sets page is now accessible from the settings sidebar, so the standalone sidebar entry is redundant. Remove lines 120-124 (`{ name: 'Option Sets', href: '/settings/option-sets', icon: Layers }`).

**Step 2: Verify**

Run: `npm run lint`
Check that the main sidebar no longer shows "Option Sets" as a separate item, and that `/settings` still navigates to the settings area.

**Step 3: Commit**

```bash
git add components/layout/sidebar.tsx
git commit -m "refactor(sidebar): remove standalone Option Sets entry, now in settings sidebar"
```

---

### Task 10: Clean Up Old Work Schedules Page

**Files:**
- Modify: `app/settings/work-schedules/page.tsx`

**Step 1: Remove the standalone page default export**

The `WorkSchedulesContent` component is still needed (imported by `schedules/page.tsx`). Remove only the `WorkSchedulesPage` default export (lines 371-383) that renders the standalone full-page wrapper — it's no longer needed since the new `schedules/page.tsx` provides the wrapper.

Replace the default export with a simple re-export or remove it and change the import in `schedules/page.tsx` to import `WorkSchedulesContent` directly.

Simplest: keep the file as-is for `WorkSchedulesContent` but change the default export to redirect to `/settings/schedules` so old bookmarks still work:

```tsx
// At the bottom of work-schedules/page.tsx, replace the default export:
import { redirect } from 'next/navigation';

export default function WorkSchedulesPage() {
  redirect('/settings/schedules');
}
```

Wait — this won't work because the file uses `'use client'`. Instead, just make the schedules page import `WorkSchedulesContent` from the work-schedules file and leave the work-schedules default export as-is. Users hitting `/settings/work-schedules` will see the old page in the new layout (sidebar + content). That's acceptable.

**Actually, no changes needed here.** The `work-schedules/page.tsx` default export will render inside the settings layout with the sidebar, which is fine. If someone visits `/settings/work-schedules` they'll see schedules in the sidebar context. No action needed.

**Step 1 (revised): Skip this task — no changes needed.**

---

### Task 11: Verify Full Integration

**Step 1: Run lint**

Run: `npm run lint`
Expected: No errors.

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No new errors (pre-existing ones are acceptable).

**Step 3: Browser verification**

Navigate to each settings page via the sidebar and confirm content renders correctly:
- `/settings` → redirects to `/settings/company`
- `/settings/company` → company form with save button
- `/settings/documents` → quote + PO templates
- `/settings/payroll` → week start + OT threshold
- `/settings/schedules` → three day-group schedule cards
- `/settings/configurator` → all configurator default fields
- `/settings/cutlist` → three offcut threshold fields
- `/settings/option-sets` → existing option sets editor
- `/settings/finished-goods` → auto-consume toggle

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(settings): complete tabbed sidebar layout migration"
```
