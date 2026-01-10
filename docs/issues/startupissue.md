# January → Main Merge: Full Issue Summary

**Date:** January 10, 2026  
**Duration:** Full day  
**Branch:** `merge/january-to-main-20260108`  
**Status:** Branch pushed to origin, PR ready to open

---

## Objective

Merge all changes from the `January` branch into `main`, preserving UI/UX improvements (PageToolbar, semantic colors, admin user management) while resolving conflicts and ensuring `npm run lint` + `npm run build` pass before pushing.

---

## Timeline of Events

### Phase 1: Initial Merge & Conflict Resolution

1. **Created merge branch** `merge/january-to-main-20260108` from `main`
2. **Ran `git merge January`** — produced conflicts in multiple files
3. **Manually resolved conflicts** in:
   - `app/staff/hours/page.tsx`
   - `components/features/labor/jobs-manager.tsx`
   - `components/features/staff/DailyAttendanceGrid.tsx`
   - `docs/domains/components/inventory-master.md`
   - `docs/domains/timekeeping/labor-section.md`
   - `docs/overview/STYLE_GUIDE.md`
   - `netlify.toml` (removed hardcoded secrets)

### Phase 2: Lint Errors

4. **`npm run lint` failed** with JSX parsing error in `DailyAttendanceGrid.tsx`
   - **Root cause:** Duplicated JSX blocks from merge conflict artifacts
   - **Fix:** Removed ~200 lines of duplicated UI code (view mode tabs, date picker, mass action dialog)

### Phase 3: Build Errors (ESM/CJS Interop)

5. **`npm run build` failed** with module resolution errors:
   ```
   Module not found: Can't resolve '@radix-ui/react-context'
   Attempted import error: 'parsers' is not exported from 'date-fns/parse/_lib/parsers'
   Attempted import error: 'Cardinal' is not exported from 'd3-shape/src/curve/cardinal.js'
   ```
   - **Root cause:** Next.js server bundling struggles with ESM packages that have mixed exports
   - **Fix:** Modified `next.config.mjs`:
     ```javascript
     transpilePackages: [
       'tailwind-merge',
       '@radix-ui/react-avatar',
       '@radix-ui/react-context',
       'date-fns',
       'react-day-picker',
       'recharts',
       'd3-shape',
       'victory-vendor',
     ],
     experimental: {
       esmExternals: 'loose',
     },
     ```

### Phase 4: Git Repository Corruption

6. **`git commit` crashed** with `zsh: bus error` (SIGBUS signal 10)
   - Used manual workaround: `git write-tree` + `git commit-tree` + `git update-ref`

7. **`git push` crashed** with `error: pack-objects died of signal 10`
   - **Root cause:** Critically low disk space (~95% full) + corrupted Git objects
   - **Attempted fixes:**
     - Removed `.next` directory (1.2GB freed)
     - Tried conservative pack settings
     - Ran `git fsck` — found missing/corrupt objects

8. **Diagnosed repository as corrupted** — multiple Git operations failing with SIGBUS

### Phase 5: Fresh Clone Strategy

9. **Created fresh clone** at `/Users/gregorymaier/Documents/Projects/unity-erp-repair-20260110`
   ```bash
   git clone https://github.com/MaierG74/unity-erp.git unity-erp-repair-20260110
   ```

10. **Recreated the merge** in clean clone:
    - Checked out new branch `merge/january-to-main-20260108`
    - Merged `origin/January` into it
    - Copied resolved files from old repo using targeted `rsync`
    - Manually fixed index entries for problematic docs files using `git hash-object` + `git update-index`

11. **Created merge commit** — `d2a173f`

### Phase 6: Pre-Push Verification (Clean Clone)

12. **`npm ci`** — installed 880 packages in 39s ✅
13. **`npm run lint`** — passed (warnings only, no errors) ✅
14. **`npm run build`** — passed, all routes compiled ✅

### Phase 7: Push to Origin

15. **`git push -u origin merge/january-to-main-20260108`** — SUCCESS ✅
    ```
    remote: Create a pull request for 'merge/january-to-main-20260108' on GitHub by visiting:
    remote: https://github.com/MaierG74/unity-erp/pull/new/merge/january-to-main-20260108
    ```

---

## Current State

| Item | Status |
|------|--------|
| Branch `merge/january-to-main-20260108` on GitHub | ✅ Pushed |
| `npm run lint` | ✅ Passes |
| `npm run build` | ✅ Passes |
| PR to `main` | ⏳ Ready to open |
| Old repo (`unity-erp`) | ❌ Corrupted, do not use |
| Clean clone (`unity-erp-repair-20260110`) | ✅ Healthy |

---

## Key Files Modified

### Code Changes
- **`components/features/staff/DailyAttendanceGrid.tsx`** — Removed duplicated JSX blocks
- **`next.config.mjs`** — Added `transpilePackages` and `esmExternals: 'loose'`
- **`netlify.toml`** — Removed hardcoded `AIRTABLE_BASE_ID`

### Documentation
- **`docs/changelogs/nextjs-server-build-fix-20251107.md`** — Added addendum about ESM/CJS workaround

---

## Root Causes Summary

1. **Merge conflicts** left duplicated code blocks in `DailyAttendanceGrid.tsx`
2. **ESM/CJS interop issues** in Next.js server bundling for packages like `date-fns`, `d3-shape`, `recharts`
3. **Git repository corruption** caused by low disk space (~95% full) leading to SIGBUS crashes
4. **Stale IDE workspace** pointing to corrupted old repo instead of clean clone

---

## IDE Errors Explanation

If you see errors like:
```
File '.../node_modules/next/navigation.d.ts' is not a module.
File '.../node_modules/date-fns/index.d.mts' is not a module.
```

These are from the **OLD corrupted repository** at `/Users/gregorymaier/Documents/Projects/unity-erp`.

**Solution:** Switch your IDE workspace to the clean clone:
```
/Users/gregorymaier/Documents/Projects/unity-erp-repair-20260110
```

---

## Next Steps

1. **Open PR:** Visit https://github.com/MaierG74/unity-erp/pull/new/merge/january-to-main-20260108
2. **Review & merge** the PR into `main`
3. **Switch IDE** to the clean clone directory
4. **Delete or archive** the old corrupted repo to free disk space
5. **Rename** clean clone if desired:
   ```bash
   mv unity-erp unity-erp-corrupted-backup
   mv unity-erp-repair-20260110 unity-erp
   ```

---

## Lessons Learned

1. **Monitor disk space** — Git operations fail catastrophically when disk is >90% full
2. **Keep `transpilePackages` updated** — ESM-only packages need explicit transpilation in Next.js
3. **Fresh clone as escape hatch** — When Git operations crash with SIGBUS, a fresh clone is often faster than repair
4. **Use timeouts** — Long-running commands should have hard timeouts to detect hangs early
5. **Document workarounds** — Build config changes should be logged in changelogs for future reference

---

## Commands Reference

### Verify branch is pushed
```bash
git ls-remote --heads origin merge/january-to-main-20260108
```

### Open PR (browser)
```
https://github.com/MaierG74/unity-erp/pull/new/merge/january-to-main-20260108
```

### Switch to clean clone
```bash
cd /Users/gregorymaier/Documents/Projects/unity-erp-repair-20260110
```
