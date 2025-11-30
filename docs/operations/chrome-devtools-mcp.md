# Chrome DevTools MCP Setup

This guide covers how we enable the Chrome DevTools Model Context Protocol (MCP)
server for Unity ERP agents.

## Requirements

- Node.js 20.19+ (our project toolchain already uses this version).
- Google Chrome (stable channel) installed locally.
- `npx` available via the Node.js installation.

## Configuration files

We keep three configuration surfaces in sync so that repo-local tooling,
Claude, and Codex CLI share the same server definition:

- Project scope: `.mcp.json`
- Global Claude scope: `~/Library/Application Support/Claude/mcp.json`
- Codex CLI: `~/.codex/config.toml`

Ensure both files contain the following server entry:

```json
"chrome-devtools": {
  "command": "npx",
  "args": [
    "-y",
    "chrome-devtools-mcp@latest",
    "--headless=true",
    "--isolated=true"
  ]
}
```

When working inside Codex, add the same `chrome-devtools` block to your
`~/.codex/config.toml` under `[mcp_servers.chrome-devtools]` so the CLI can
launch the MCP server directly.

```toml
[mcp_servers.chrome-devtools]
command = "npx"
args = [
  "-y",
  "chrome-devtools-mcp@latest",
  "--headless=true",
  "--isolated=true"
]
```

`config.toml` mirrors these settings for Codex CLI usage. Update all three
locations together when changing launch flags.

## Verifying the server

Run the following command from the project root to confirm that the MCP server
installs and exposes its CLI:

```bash
npx -y chrome-devtools-mcp@latest --headless=true --isolated=true --version
```

The command should print the current package version (for example `0.6.0`).

## Notes

- `--headless=true` prevents the Chrome window from opening during automated
  sessions. Remove it temporarily if you need to see the UI for manual debugging.
- `--isolated=true` launches Chrome with a disposable profile so automated
  sessions do not pollute your main profile state.
- Avoid storing sensitive content in the automated browser session; MCP clients
  have full access to the pages they open.
