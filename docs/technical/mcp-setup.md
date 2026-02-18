# MCP Server Setup & Troubleshooting

This is a reference for **human developers** setting up or troubleshooting MCP servers. Claude Code does not need this file — it only needs the brief summary in `CLAUDE.md`.

## MCP Files Location

MCP servers are configured in **two locations** (both must be updated):
- **Global**: `~/Library/Application Support/Claude/mcp.json`
- **Project**: `/Users/gregorymaier/Developer/unity-erp/.mcp.json`

## Current Working Configuration

Both files should contain the following configuration:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"],
      "autoapprove": [
        "navigate_page", "take_snapshot", "take_screenshot", "click", "fill",
        "fill_form", "press_key", "hover", "drag", "evaluate_script",
        "get_console_message", "list_console_messages", "get_network_request",
        "list_network_requests", "list_pages", "select_page", "new_page",
        "close_page", "resize_page", "emulate", "wait_for", "upload_file",
        "handle_dialog", "performance_start_trace", "performance_stop_trace",
        "performance_analyze_insight"
      ]
    },
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=ttlyfhkrsjjrzxiagzpb&features=storage%2Cbranching%2Cfunctions%2Cdevelopment%2Cdebugging%2Cdatabase%2Caccount%2Cdocs",
      "autoapprove": [
        "select", "insert", "update", "delete", "query", "execute_sql",
        "create_table", "alter_table", "drop_table", "upload_file",
        "download_file", "delete_file", "list_files", "create_function",
        "update_function", "delete_function", "invoke_function"
      ]
    }
  }
}
```

## Claude Code Auto-Approval Settings

`.claude/settings.json` should include:

```json
{
  "permissions": {
    "allow": [
      "Edit", "Write", "MultiEdit", "Read", "Glob", "Grep", "LS", "Bash",
      "TodoWrite", "NotebookEdit", "WebFetch", "WebSearch", "Task",
      "ExitPlanMode", "BashOutput", "KillBash",
      "mcp__chrome-devtools", "mcp__supabase"
    ]
  }
}
```

## Chrome DevTools Details

- Launches a visible Chrome window (no `--headless` flag)
- Uses separate profile at `~/.cache/chrome-devtools-mcp/chrome-profile`
- **Does NOT inherit authentication** from your default Chrome profile
- For authenticated testing, use your regular browser at `http://localhost:3000`

## Troubleshooting Chrome DevTools

### "Browser already running" error

Use the existing Chrome instance instead of creating a new one:
1. Use `navigate_page` instead of `new_page`
2. Use `list_pages` to see what's currently open
3. Close the existing page with `close_page` before opening a new one

**DO NOT kill the Chrome process** — this disconnects MCP and requires a full Claude Code restart.

### "Not connected" error

```bash
# Only do this if you're prepared to restart Claude Code
pkill -f "chrome-devtools-mcp"
# Then restart Claude Code to reconnect
```

### New chat gets "Browser already running"

All chats share the same Chrome profile directory. Solutions:
1. Close the Chrome window from the previous chat before starting a new one
2. Restart Claude Code to cleanly shut down all MCP connections
3. Continue in the same chat if doing related work

### Config changes not taking effect

- Always update BOTH files (global and project `.mcp.json`)
- Always restart Claude Code after MCP config changes

## Troubleshooting Claude in Chrome Extension

### "Browser extension is not connected" error

The Chrome extension's native messaging host may point to Claude Desktop instead of Claude Code CLI.

**Diagnosis:**
```bash
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json
```

If `path` points to `/Applications/Claude.app/...`, it's configured for Desktop, not CLI.

**Fix:**
```bash
cp ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json \
   ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json.backup

cat > ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json << 'EOF'
{
  "name": "com.anthropic.claude_browser_extension",
  "description": "Claude Browser Extension Native Host",
  "path": "/Users/gregmaier/.claude/chrome/chrome-native-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://dihbgbndebgnbjfmelmegjepbnfkhlgni/",
    "chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/",
    "chrome-extension://dngcpimnedloihjnnfngkgjoidhnaolf/"
  ]
}
EOF
```

Then fully quit Chrome (Cmd+Q) and restart it.

**Note:** Reinstalling Claude Desktop may overwrite this config.

**Reference:** https://github.com/anthropics/claude-code/issues/20298
