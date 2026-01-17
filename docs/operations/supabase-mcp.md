## Supabase MCP Configuration (Claude Code, Cursor, Windsurf)

Single source of truth for Supabase MCP across tools. Use the session pooler port **6543** consistently.

### Connection string (reuse everywhere)

Get the **Session pooler** string from Supabase (Project Settings → Database → Connection Info → Session pooler):

```
POSTGRES_CONNECTION_STRING=postgresql://postgres.<project_ref>:<db_password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

`DATABASE_URL` in `.env.local` should match this; point `${POSTGRES_CONNECTION_STRING}` to `${DATABASE_URL}` in MCP configs to avoid drift.

### MCP server block (shared pattern)

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "--connection-string=${POSTGRES_CONNECTION_STRING}"
      ],
      "env": {
        "POSTGRES_CONNECTION_STRING": "${DATABASE_URL}"
      },
      "autoapprove": ["query"]
    }
  }
}
```

### File locations to keep in sync
- **Project (Cursor/Windsurf aware):** `.mcp.json`
- **Cursor project:** `.cursor/mcp.json`
- **Claude Code global:** `~/Library/Application Support/Claude/mcp.json`
- **Windsurf MCP config:** add the same Supabase block in its MCP config file (mirror the JSON above).

### Why 6543?
- Session pooler port; matches current `DATABASE_URL`.
- Keep a single port across all tools to avoid connection mismatches.

### Read/write behavior
- `server-postgres` with the connection string above is full read/write.
- `autoapprove: ["query"]` allows running SQL without prompts. Add more methods only if desired.

### Windsurf note (HTTP MCP)
Windsurf does not support HTTP MCP directly. If you **must** use the Supabase HTTP MCP endpoint, wrap it with `mcp-remote` and a **Supabase Personal Access Token** (PAT). The service role key will not work here.

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.supabase.com/mcp?project_ref=ttlyfhkrsjjrzxiagzpb&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cstorage"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}"
      }
    }
  }
}
```

### Verification checklist
1) Ensure `DATABASE_URL` is set in the environment (or substitute the full string in each config).
2) Open your MCP-enabled tool and run a simple query via the Supabase MCP, e.g. `select 1;` or `select version();`.
3) If it returns rows, MCP is wired correctly.

### Concurrency (Claude, Cursor, Windsurf)
- Each tool launches its own MCP server process but they share the same database. No conflict as long as configs are identical.
- Risk is *config drift*; keep the Supabase block identical everywhere and restart tools after edits.

### Troubleshooting
- Connection refused/timeout: confirm port 6543 and that `POSTGRES_CONNECTION_STRING` is set.
- Permission errors: verify you are using the full RW connection string (not anon/readonly).
- Unexpected prompts: expand `autoapprove` as needed or confirm the tool picked up the updated config (restart).
