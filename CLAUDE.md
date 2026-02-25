# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Multi-Tenancy

- Any new table holding org-specific data **must** include an `org_id` column with org-scoped RLS.
- Nested relations in Supabase queries can be `null` due to RLS — UI code must never assume embedded objects exist.
- For tenancy migrations, RLS work, or debugging, use the `unity-erp-tenancy` skill.

## MCP Tools

Two MCP servers are available. For setup/troubleshooting, see `docs/technical/mcp-setup.md`.

- **Supabase MCP** - Use for database migrations (`apply_migration`), running SQL queries (`execute_sql`), storage operations, edge functions, and documentation lookups. Prefer this over raw SQL in scripts.
- **Claude in Chrome** - Browser automation for the user's Chrome. Use `tabs_context_mcp` first, then navigate/interact. Cannot access authenticated pages (isolated profile).

## Development Commands

### Core Commands
- `npm run dev` - Start development server at http://localhost:3000
- `npm run build` - Build production version  
- `npm run lint` - Run ESLint code quality checks
- `npm start` - Start production server

### Database & Scripts
- `npm run schema` - Get database schema via `tsx scripts/get-schema.ts`
- `npm run seed` - Seed test data via `tsx scripts/seed-test-data.ts`
- For database migrations, use the `migration-hygiene` skill.

## Documentation

- **TODO Overview**: Consult [docs/overview/todo-index.md](docs/overview/todo-index.md) for outstanding work.
- **Index**: [docs/README.md](docs/README.md) is the reference index for all documentation — consult before working on unfamiliar areas.

## Architecture Overview

### Tech Stack
- **Framework**: Next.js 14 with App Router
- **Database**: Supabase (PostgreSQL) with Row Level Security (RLS)
- **UI Components**: Radix UI + shadcn/ui + Tailwind CSS
- **State Management**: TanStack Query (React Query)
- **Forms**: React Hook Form + Zod validation
- **Authentication**: Supabase Auth

### Project Structure
- `app/` - Next.js App Router pages and API routes
- `components/` - React components organized by:
  - `common/` - Shared providers, auth, theme
  - `features/` - Domain-specific components (inventory, purchasing, staff, etc.)
  - `layout/` - Navigation, sidebar, root layout
  - `ui/` - Base UI components (shadcn/ui)
- `lib/` - Utilities, database functions, API clients
- `types/` - TypeScript type definitions
- `hooks/` - Custom React hooks
- `scripts/` - Database and utility scripts

### Business Rules

**Staff & Attendance** (non-obvious logic — do not guess):
- Tea break deductions: Mon-Thu 30min automatic, Friday none
- Pay rates: first 9hrs regular, after 9hrs overtime (1.5x), Sunday all double-time (2x)
- Source of truth: `time_clock_events` table

**File Storage**: Supabase storage, bucket `QButton`, path `Price List/{filename}`

### Development Notes
- Dark theme is default; font is Inter
- `@react-pdf/renderer` must be lazy/dynamically imported (causes build timeouts)

