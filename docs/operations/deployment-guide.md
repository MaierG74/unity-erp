# Unity ERP Deployment Guide

This document covers the deployment setup, environment configuration, and operational procedures for Unity ERP on Netlify.

## Production Environment

| Item | Value |
|------|-------|
| **Live URL** | https://unity-erp.windsurf.build |
| **Hosting Provider** | Netlify |
| **Framework** | Next.js |
| **Database** | Supabase (PostgreSQL) |
| **Email Service** | Resend |

## GitHub Repository

- **Repository**: [MaierG74/unity-erp](https://github.com/MaierG74/unity-erp)
- **Production Branch**: `main`
- **Development Branches**: Feature branches merged via PR

## Environment Variables

The following environment variables must be configured in Netlify for the application to function correctly:

### Required Variables

| Variable | Purpose | Secret? |
|----------|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side) | **Yes** |
| `RESEND_API_KEY` | Resend email API key | **Yes** |
| `EMAIL_FROM` | Verified sender email address | No |
| `NEXT_PUBLIC_APP_URL` | Production app URL (for email links) | No |

### Setting Environment Variables in Netlify

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Select the Unity ERP project
3. Navigate to **Site settings → Build & deploy → Environment → Environment variables**
4. Add each variable with the appropriate value
5. Mark sensitive values (API keys) as "Secret"

### Local Development

For local development, create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://ttlyfhkrsjjrzxiagzpb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
RESEND_API_KEY=re_your_api_key
EMAIL_FROM=noreply@apexza.net
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> ⚠️ **Never commit `.env.local` to version control!**

## Build Configuration

### netlify.toml

The build configuration is defined in `netlify.toml`:

```toml
[build]
  command = "npm install --legacy-peer-deps && npm run build"
  publish = ".next"

[build.environment]
  NEXT_PUBLIC_SUPABASE_URL = "https://ttlyfhkrsjjrzxiagzpb.supabase.co"
  NEXT_PUBLIC_SUPABASE_ANON_KEY = "..."
  NPM_FLAGS = "--legacy-peer-deps"
```

### Package Manager

The project uses **npm** for CI/CD (Netlify). The `pnpm-lock.yaml` was removed to avoid lockfile conflicts in CI environments.

- Local development can use either `npm` or `pnpm`
- CI builds use `npm install --legacy-peer-deps`

## Deployment Process

### Automatic Deployments

Netlify automatically deploys when changes are pushed to the `main` branch.

### Manual Deployment

To trigger a manual deployment:

1. Via Netlify Dashboard: **Deploys → Trigger deploy → Deploy site**
2. Via Netlify MCP (if available): Use the deploy-site operation

### Deployment Checklist

Before deploying to production:

- [ ] All tests pass locally
- [ ] Build succeeds locally (`npm run build`)
- [ ] Environment variables are configured in Netlify
- [ ] Database migrations are applied to Supabase
- [ ] Feature branch is merged to `main` via PR

## Rollback Procedures

### Quick Rollback via Netlify

1. Go to **Deploys** in Netlify Dashboard
2. Find the last working deploy
3. Click **Publish deploy** to roll back

### Git-based Rollback

If you need to rollback to a specific commit:

```bash
# Create a backup branch first
git checkout main
git checkout -b backup/main-$(date +%Y-%m-%d)
git push origin backup/main-$(date +%Y-%m-%d)

# Reset to a known good commit
git reset --hard <commit-sha>
git push --force origin main
```

### Backup Branch

A backup branch `backup/main-2025-07-26-production` was created during the November 2025 deployment as a fallback point.

## Common Issues & Solutions

### Build Failures

#### "Missing API key" Error
**Cause**: Server-side code instantiating API clients at module top-level runs during build.

**Solution**: Move client instantiation inside request handlers:

```typescript
// ❌ Bad - runs at build time
const resend = new Resend(process.env.RESEND_API_KEY);

// ✅ Good - runs at request time
export async function POST(req) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  // ...
}
```

#### pnpm Lockfile Mismatch
**Cause**: `pnpm-lock.yaml` out of sync with `package.json`.

**Solution**: Remove `pnpm-lock.yaml` to use npm, or update the lockfile:
```bash
# Option 1: Remove pnpm lockfile
git rm pnpm-lock.yaml
git commit -m "Remove pnpm-lock.yaml to use npm for CI"

# Option 2: Update pnpm lockfile
pnpm install
git add pnpm-lock.yaml
git commit -m "Update pnpm-lock.yaml"
```

### Runtime Errors

#### Email Links Point to localhost
**Cause**: `NEXT_PUBLIC_APP_URL` not set in Netlify.

**Solution**: Add `NEXT_PUBLIC_APP_URL=https://unity-erp.windsurf.build` to Netlify environment variables.

#### 500 Errors on API Routes
**Cause**: Missing environment variables for server-side operations.

**Solution**: Ensure all required env vars are set in Netlify (especially `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY`).

## Monitoring

### Netlify Logs

- **Build logs**: Deploys → Select deploy → Build log
- **Function logs**: Functions → Select function → Logs

### Checking Deploy Status

Via Netlify MCP:
```
netlify-deploy-services-reader: get-deploy with deployId
```

## Security Considerations

1. **Never expose service role keys** - Only use `SUPABASE_SERVICE_ROLE_KEY` in server-side code
2. **Use secret env vars** - Mark API keys as secrets in Netlify
3. **Verify email domains** - Ensure `EMAIL_FROM` uses a verified domain in Resend
4. **Review RLS policies** - Supabase Row Level Security should be enabled on all tables

## Related Documentation

- [Email Integration](./email-integration.md) - Email system setup and templates
- [Supabase Query Patterns](../technical/supabase-query-patterns.md) - Database query best practices
- [November 2025 Deployment Changelog](../changelogs/november-2025-deployment-20251130.md) - Initial production deployment details
