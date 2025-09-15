# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `npm run dev` - Start development server at http://localhost:3000
- `npm run build` - Build production version  
- `npm run lint` - Run ESLint code quality checks
- `npm start` - Start production server

### Database & Scripts
- `npm run schema` - Get database schema via `tsx scripts/get-schema.ts`
- `npm run seed` - Seed test data via `tsx scripts/seed-test-data.ts`
- `npm run init-purchasing` - Initialize purchasing data
- `npm run check-components` - Check supplier components
- `npm run create-supplier-components` - Create supplier components
- `npm run check-tables` - Check database tables
- `npm run create-db-function` - Create database function

### Troubleshooting Development Setup
If encountering dependency issues:
1. `npm cache clean --force`
2. `rm -rf node_modules package-lock.json`
3. `npm install --verbose`
4. If React missing: `npm install react react-dom`

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

### Key Modules

**Staff & Attendance**
- Complex payroll logic with tea break deductions (Mon-Thu: 30min, Fri: none)
- Regular/overtime/double-time calculations based on day of week
- Time tracking via `time_clock_events` table as single source of truth

**Purchasing & Orders**
- Multi-order purchasing system
- Purchase order generation and email sending
- Integration with supplier management

**Quoting System**
- Quote creation with line items and attachments
- Quote-to-order conversion workflow
- File upload via Supabase storage

**Inventory Management**
- Component tracking and requirements
- Category management with drag-and-drop
- Transaction history

### Database Notes
- All tables use RLS (Row Level Security)
- Migrations in `db/migrations/` and `migrations/`
- Database functions and triggers handle business logic
- Supabase client configured in `lib/supabase.ts`

### Important Business Rules
- **Attendance**: Monday-Thursday have 30min automatic tea deduction, Friday has none, Sunday is all double-time
- **Payroll**: First 9 hours are regular time, after 9 hours is overtime (1.5x), Sunday is all double-time (2x)
- **File Storage**: Uses Supabase storage with QButton bucket for attachments

### Development Notes
- Uses TypeScript with strict mode
- ESLint configured for Next.js
- Dark theme as default
- Font: Inter (Google Fonts)
- All API routes are in `app/api/`
- Database schema available via `npm run schema`