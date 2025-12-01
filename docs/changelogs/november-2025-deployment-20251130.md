# November 2025 Production Deployment

**Date**: November 30, 2025  
**Type**: Major Deployment  
**Branch**: `November` → `main`

## Summary

Successfully deployed the November development branch to production on Netlify. This was the first major deployment since July 2025, bringing 4+ months of development work to production.

## Deployment Statistics

- **Commits merged**: 36
- **Files changed**: 508
- **Insertions**: 72,000+
- **Deletions**: 14,000+
- **Build time**: ~2.5 minutes

## Pre-Deployment Setup

### Backup Strategy

Created a backup branch before merging:
- **Branch**: `backup/main-2025-07-26-production`
- **Commit**: `5263867d93637167f81b697c95cdd2c4dbc78dd5`
- **Purpose**: Rollback point if deployment fails

### Pull Request

- **PR #4**: Merge November into main
- **Method**: Squash and merge

## Build Issues Resolved

### 1. pnpm Lockfile Mismatch

**Error**: `ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile"`

**Cause**: `pnpm-lock.yaml` was out of sync with `package.json` after dependency additions.

**Fix**: Removed `pnpm-lock.yaml` to use npm for CI:
```bash
git rm pnpm-lock.yaml
git commit -m "Remove pnpm-lock.yaml to use npm for CI"
```

### 2. Missing Import in order-detail.tsx

**Error**: `'Input' is not defined. react/jsx-no-undef`

**File**: `components/features/purchasing/order-detail.tsx`

**Fix**: Added missing import:
```typescript
import { Input } from '@/components/ui/input';
```

### 3. Resend Client Build-Time Error

**Error**: `Missing API key. Pass it to the constructor new Resend("re_123")`

**Cause**: Resend client was instantiated at module top-level, running during Next.js build-time page data collection.

**File**: `lib/email.tsx`

**Fix**: Changed from top-level instantiation to lazy getter:
```typescript
// Before (runs at build time)
const resend = new Resend(process.env.RESEND_API_KEY);

// After (runs at request time)
function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY environment variable is not set');
  }
  return new Resend(apiKey);
}
```

## Environment Variables Added

The following environment variables were added to Netlify:

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Email sending via Resend |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database access |
| `EMAIL_FROM` | Verified sender email address |
| `NEXT_PUBLIC_APP_URL` | Production URL for email links |

## Post-Deployment Fixes

### Email Links Pointing to localhost

**Issue**: Supplier follow-up emails contained links to `http://localhost:3000/supplier-response/...`

**Cause**: `NEXT_PUBLIC_APP_URL` environment variable was not set in Netlify.

**Fix**: Added `NEXT_PUBLIC_APP_URL=https://unity-erp.windsurf.build` to Netlify environment variables.

## Configuration Changes

### netlify.toml

Updated build command to handle npm with legacy peer deps:
```toml
[build]
  command = "npm install --legacy-peer-deps && npm run build"
  publish = ".next"

[build.environment]
  NPM_FLAGS = "--legacy-peer-deps"
```

## Files Modified

1. `netlify.toml` - Build configuration
2. `lib/email.tsx` - Lazy Resend client initialization
3. `components/features/purchasing/order-detail.tsx` - Missing Input import
4. Removed: `pnpm-lock.yaml`

## Commits

| SHA | Message |
|-----|---------|
| `6ee80aa` | November branch merge |
| `7f115ec` | Fix: Add missing Input import |
| `072807c` | Remove pnpm-lock.yaml to use npm for CI |
| `a28334c` | Fix: Move Resend client instantiation to runtime |

## Verification

- ✅ Site loads at https://unity-erp.windsurf.build
- ✅ User authentication works
- ✅ Database connections successful
- ✅ Email sending functional (follow-up emails)
- ✅ Supplier response links work correctly

## Rollback Instructions

If rollback is needed:

```bash
git checkout main
git reset --hard backup/main-2025-07-26-production
git push --force origin main
```

Or use Netlify's deploy rollback feature to publish a previous deploy.

## Lessons Learned

1. **Environment variables**: Always verify all required env vars are set in production before deploying
2. **Build-time vs runtime**: API clients should be instantiated inside handlers, not at module scope
3. **Package manager consistency**: Stick to one package manager (npm) for CI to avoid lockfile issues
4. **Backup branches**: Always create a backup branch before major merges

## Related Documentation

- [Deployment Guide](../operations/deployment-guide.md) - Full deployment procedures
- [Email Integration](../operations/email-integration.md) - Email system documentation
