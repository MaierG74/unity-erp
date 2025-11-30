# Recovery and Folder Swap Plan (September Branch)

Date: 2025-09-19 19:38 +02:00
Author: Cascade
Target repo/branch: `MaierG74/unity-erp` @ branch `September`

---

## Purpose
Restore a clean, working local checkout that exactly matches the remote `September` branch without touching GitHub or `main`. Keep the familiar project path `.../unity-erp` by safely swapping in a fresh clone.

## Current State
- Clean clone exists at: `~/Documents/Projects/unity-erp-september-clean`
- Branch: `September` (tracking `origin/September`)
- HEAD: `f912ec4` (matches GitHub)
- Secrets: `.env.local` copied from old folder into the clean clone
- Dev server successfully started from the clean clone (and can be restarted as needed)

## Why not overwrite the old folder in place?
- Overwrite merges files; it can preserve stale/corrupted artifacts (e.g., `.next/`, stray files, a damaged `.git`).
- File watchers/locks from a running dev server can make in-place copies fail.
- A clean swap guarantees the local tree exactly matches the remote branch.

## Safe Swap Plan (does NOT modify GitHub)
These steps replace the contents at `~/Documents/Projects/unity-erp` with the known-good clean clone.

1) Stop any dev server on port 3000 (just in case)
```
lsof -ti tcp:3000 | xargs kill -TERM 2>/dev/null || true
```

2) Swap folders (timestamped backup of the old folder)
```
ts=$(date +%Y%m%d-%H%M%S)
mv "~/Documents/Projects/unity-erp" "~/Documents/Projects/unity-erp-old-$ts"
mv "~/Documents/Projects/unity-erp-september-clean" "~/Documents/Projects/unity-erp"
```

3) Verify the new folder
```
cd ~/Documents/Projects/unity-erp
git status -sb
git rev-parse --short HEAD
git branch --show-current
# Expect: on branch September, HEAD f912ec4 (or later if new commits exist)
```

4) Run locally to validate
```
npm install --verbose
npm run dev
# Open http://localhost:3000
```

## What stays absolutely safe
- Remote GitHub branches (`September`, `main`) remain untouched. We do not push during recovery.
- The old local folder is preserved as `unity-erp-old-<timestamp>` for rollback/reference.

## Rollback plan (if needed)
If you need to revert to the previous local folder structure:
```
# Stop the dev server first if running
lsof -ti tcp:3000 | xargs kill -TERM 2>/dev/null || true

# Swap back (using your actual timestamp)
mv "~/Documents/Projects/unity-erp" "~/Documents/Projects/unity-erp-clean-backup-$(date +%Y%m%d-%H%M%S)"
mv "~/Documents/Projects/unity-erp-old-<timestamp>" "~/Documents/Projects/unity-erp"
```

## Notes & Observations
- The clean clone succeeded even while the old dev server was running because cloning is independent and ignores transient build artifacts.
- Security: `.env.local` has been copied into the clean clone but is not tracked by Git.
- `npm audit` reported some vulnerabilities; do NOT run `npm audit fix --force` right now. We will address dependencies deliberately later.

## Next Steps (pick one)
- Proceed with the safe swap now (recommended).
- Keep working inside the clean clone path (`unity-erp-september-clean`) for a while and swap later.
- If you prefer an in-place reset in the old folder, we can do a local-only backup + `git reset --hard origin/September` + `git clean` (dry-run first). The fresh swap is typically safer/easier.

## Commands we can run for you (on request)
- Stop dev server and perform the swap
```
ts=$(date +%Y%m%d-%H%M%S)
lsof -ti tcp:3000 | xargs kill -TERM 2>/dev/null || true
mv "~/Documents/Projects/unity-erp" "~/Documents/Projects/unity-erp-old-$ts"
mv "~/Documents/Projects/unity-erp-september-clean" "~/Documents/Projects/unity-erp"
```
- Post-swap verification
```
cd ~/Documents/Projects/unity-erp
git status -sb && git rev-parse --short HEAD && git branch --show-current
npm install --verbose && npm run dev
```

---
Prepared by Cascade to ensure a safe, reversible recovery while keeping GitHub data intact and `main` unchanged.
