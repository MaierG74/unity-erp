# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## MCP Configuration

**IMPORTANT**: This project uses MCP servers for browser automation.

### MCP Servers Overview

- **Chrome DevTools** – Live browser automation/debugging with visible Chrome window
- **Supabase** – Official Supabase MCP with database CRUD, storage, functions, branching, and debugging

### MCP Files Location

MCP servers are configured in **two locations** (both must be updated):
- **Global**: `~/Library/Application Support/Claude/mcp.json`
- **Project**: `/Users/gregorymaier/Documents/Projects/unity-erp/.mcp.json`

### Current Working Configuration

Both files should contain the following configuration:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest"
      ],
      "autoapprove": [
        "navigate_page",
        "take_snapshot",
        "take_screenshot",
        "click",
        "fill",
        "fill_form",
        "press_key",
        "hover",
        "drag",
        "evaluate_script",
        "get_console_message",
        "list_console_messages",
        "get_network_request",
        "list_network_requests",
        "list_pages",
        "select_page",
        "new_page",
        "close_page",
        "resize_page",
        "emulate",
        "wait_for",
        "upload_file",
        "handle_dialog",
        "performance_start_trace",
        "performance_stop_trace",
        "performance_analyze_insight"
      ]
    },
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=ttlyfhkrsjjrzxiagzpb&features=storage%2Cbranching%2Cfunctions%2Cdevelopment%2Cdebugging%2Cdatabase%2Caccount%2Cdocs"
    }
  }
}
```

### Claude Code Auto-Approval Settings

In addition to MCP config, you must also configure `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Edit",
      "Write",
      "MultiEdit",
      "Read",
      "Glob",
      "Grep",
      "LS",
      "Bash",
      "TodoWrite",
      "NotebookEdit",
      "WebFetch",
      "WebSearch",
      "Task",
      "ExitPlanMode",
      "BashOutput",
      "KillBash",
      "mcp__chrome-devtools",
      "mcp__supabase"
    ]
  }
}
```

### Configuration Details

**Chrome DevTools:**
- Launches visible Chrome browser window (no `--headless` flag)
- Uses separate profile at `~/.cache/chrome-devtools-mcp/chrome-profile`
- **Does NOT inherit authentication** from your default Chrome profile
- Useful for visual debugging, screenshots, and performance analysis
- Auto-approves all 23 Chrome DevTools tools

**Supabase (Official HTTP MCP):**
- Official Supabase MCP server via HTTP
- Connects to project `ttlyfhkrsjjrzxiagzpb`
- **Enabled features:**
  - `database` - Full CRUD operations on all tables
  - `storage` - File upload/download/management
  - `functions` - Edge function management
  - `branching` - Database branch operations
  - `development` - Development tools
  - `debugging` - Debug capabilities
  - `account` - Account management
  - `docs` - Documentation access
- No connection string needed (uses HTTP API)

### Authentication Limitations

⚠️ **Important**: Chrome DevTools MCP uses an isolated browser profile without authentication cookies. This means:

- Cannot access authenticated pages (will redirect to login)
- Cannot test features requiring user sessions
- For authenticated testing, use your regular browser manually

**Workaround**: Test authenticated flows in your regular Chrome browser at `http://localhost:3000`

### Troubleshooting Chrome DevTools

**Problem: "Browser already running for /Users/gregorymaier/.cache/chrome-devtools-mcp/chrome-profile"**

This error occurs when trying to use `new_page` or navigate to a URL when a Chrome instance is already running.

**Solution:** Use the existing Chrome instance instead of creating a new one:
1. Use `navigate_page` instead of `new_page` to navigate within the existing browser
2. Use `list_pages` to see what's currently open
3. If needed, close the existing page with `close_page` before opening a new one

**DO NOT kill the Chrome process** - this will disconnect the MCP server and require a full Claude Code restart.

**Correct workflow:**
```
1. list_pages (see what's open)
2. navigate_page to change the current page
3. take_snapshot or take_screenshot
```

**Problem: "Not connected" error**

This happens after killing Chrome processes or when MCP server fails to start.

```bash
# Only do this if you're prepared to restart Claude Code
pkill -f "chrome-devtools-mcp"

# Then restart Claude Code to reconnect
```

**⚠️ Important:** Once Chrome DevTools MCP connects, it maintains a persistent Chrome instance. Don't kill it unless you're restarting Claude Code.

**Problem: Starting a new chat/prompt and getting "Browser already running" error**

Each new chat in Claude Code gets its own isolated MCP connection, but all chats try to use the **same Chrome profile directory** (`~/.cache/chrome-devtools-mcp/chrome-profile`). If a previous chat's Chrome instance is still running, new chats cannot connect.

**Solutions:**
1. **Close the Chrome window** from the previous chat before starting a new chat
2. **Restart Claude Code** to cleanly shut down all MCP connections
3. **Continue in the same chat** if doing related work (Chrome instance stays available)

**How to identify the Chrome DevTools browser:**
- Look for a Chrome window that opened when Chrome DevTools first connected
- It will be using a separate profile (different from your main Chrome)
- Close this window when switching to a new chat

**Problem: Chrome DevTools prompts for approval**
- Check `.claude/settings.json` includes `"mcp__chrome-devtools"`
- Check MCP config includes `"autoapprove"` array
- Restart Claude Code after config changes

**Problem: Need to see Chrome browser visibly**
- Remove `--headless=true` from MCP config (already removed in current config)
- Restart Claude Code

**Problem: Changes to MCP config not taking effect**
- **Always update BOTH files** (global and project `.mcp.json`)
- **Always restart Claude Code** after MCP config changes
- Verify changes with: `cat ~/Library/Application\ Support/Claude/mcp.json`

### When to Use Chrome DevTools

✅ **Good use cases:**
- Taking screenshots of unauthenticated pages
- Performance analysis and traces
- Visual inspection of public pages
- Testing responsive layouts

❌ **Not suitable for:**
- Testing authenticated user flows
- Accessing protected routes
- End-to-end testing requiring login

For authenticated testing, always test manually in your regular browser.

### Important Notes

- **Always update both** global and project MCP config files
- **Always restart Claude Code** after MCP configuration changes

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

## Documentation

### Documentation Structure
- **TODO Overview**: Always consult [docs/overview/todo-index.md](docs/overview/todo-index.md) to see consolidated outstanding work and trace each item back to its source documentation before diving in.
- **Index**: [docs/README.md](docs/README.md) serves as the reference and index file for all documentation
- **Workflow**: All app updates must be documented in the appropriate documentation files
- **Working on New Areas**: When starting a new chat or working on a new area of the app without existing context, consult the existing documentation first. If coverage is missing, create the necessary docs and ensure [docs/README.md](docs/README.md) points to them so the index remains complete.

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

### Known Issues

**@react-pdf/renderer build issues**
- This package causes build timeouts due to its `jay-peg` dependency making network requests during compilation
- **Interim fix**: Use lazy/dynamic imports inside handler functions instead of static imports at the top of files
- **Long-term solution**: Move PDF generation to server-side API routes
- See `docs/technical/dev-server-troubleshooting.md` and `startupissue.md` for full history
