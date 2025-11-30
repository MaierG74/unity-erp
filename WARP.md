# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project type and tooling
- Framework: Next.js 14 (App Router)
- Language: TypeScript
- Package manager: pnpm (see packageManager in package.json)
- UI: Radix UI + shadcn/ui + Tailwind CSS
- Data/client: Supabase (PostgreSQL, RLS), TanStack Query, React Hook Form + Zod
- Scripts: tsx for TypeScript utilities under scripts/

Common commands
- Install dependencies
  ```bash path=null start=null
  pnpm install
  ```
- Start dev server (http://localhost:3000)
  ```bash path=null start=null
  pnpm dev
  ```
- Build production artifact
  ```bash path=null start=null
  pnpm build
  ```
  Notes: next.config.mjs is configured to ignore TypeScript and ESLint errors during builds to unblock UI verification.
- Start production server (after build)
  ```bash path=null start=null
  pnpm start
  ```
- Lint
  ```bash path=null start=null
  pnpm lint
  ```
- Run a single utility script (examples)
  ```bash path=null start=null
  # Database schema snapshot
  pnpm schema

  # Seed test data
  pnpm seed

  # Any one-off script directly via tsx
  pnpm dlx tsx scripts/get-schema.ts
  ```

Domain scripts (from package.json)
- Schema: pnpm schema → tsx scripts/get-schema.ts
- Seed test data: pnpm seed → tsx scripts/seed-test-data.ts
- Initialize purchasing data: pnpm init-purchasing → tsx scripts/init-purchasing-data.ts
- Check supplier components: pnpm check-components → tsx scripts/check-supplier-components.ts
- Create supplier components: pnpm create-supplier-components → tsx scripts/create-supplier-components.ts
- Check database tables: pnpm check-tables → tsx scripts/check-tables.ts
- Create database function: pnpm create-db-function → tsx scripts/create-db-function.ts

Notes on tests
- There is no configured test runner in package.json. If you need to validate specific logic, run the relevant script via tsx (see “Run a single utility script”).

Architecture and structure (high-level)
- App Router: The app/ directory hosts pages and API routes. API endpoints live under app/api/.
- Supabase: Application data resides in Postgres with Row Level Security (RLS) enabled. Supabase client configuration is referenced in CLAUDE.md as lib/supabase.ts.
- State/query: TanStack Query centralizes server-state fetching and caching.
- Forms/validation: React Hook Form with Zod schemas for input safety.
- UI composition: shadcn/ui primitives with Radix UI; Tailwind CSS for styling.
- Scripts: Operational DB and utility workflows are implemented under scripts/ and executed with tsx.

Key configuration details
- Next config
  - Active file: next.config.mjs (exports NextConfig)
  - Typescript: ignoreBuildErrors: true; ESLint: ignoreDuringBuilds: true
  - images.remotePatterns allows Supabase Storage assets (ttlyfhkrsjjrzxiagzpb.supabase.co)
  - transpilePackages: ["tailwind-merge"]
- TypeScript config (tsconfig.json)
  - Not strict ("strict": false), noEmit, moduleResolution: "bundler"
  - Path alias: "@/*" → project root
- ESLint (.eslintrc.json)
  - Extends: next/core-web-vitals
  - Several strict TypeScript and React rules disabled for iteration velocity

Useful documentation inside this repo
- docs/README.md: Entry point to the knowledge base, with links to:
  - docs/overview/master-plan.md – high-level roadmap
  - docs/overview/STYLE_GUIDE.md – platform style guide
  - docs/overview/auth.md – authentication overview
  - docs/overview/AI Assistant.md – AI assistant vision
  - Domain references under docs/domains/ (orders, purchasing, components, timekeeping, suppliers)
  - Operations under docs/operations/
  - Plans under docs/plans/
  - Changelogs under docs/changelogs/

Interoperability with other AI rules in this repo
- CLAUDE.md includes overlapping guidance (commands and architecture). Where differences exist, prefer concrete configuration in this file and repository configs (package.json, next.config.*) at execution time.
