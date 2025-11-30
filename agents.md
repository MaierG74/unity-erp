# Agents Playbook

This file is a quick reference for anyone building or updating Unity ERP agents or workflows.

- `docs/README.md` is the canonical index for all project documentation. Start there when kicking off a new chat, feature area, or research spike that lacks current context.
- Review the consolidated TODO tracker in `docs/overview/todo-index.md` to confirm outstanding work items and locate their authoritative source docs before you start implementation.
- If you already validated the relevant docs for the current thread or task, rely on that knowledge—don't re-read the same pages unless something changes or you uncover gaps.
- Every update or change to the application must be reflected somewhere in the documentation set. Use `docs/README.md` to decide where the update belongs and add or update the appropriate doc.
- When working on a new area of the app, consult the existing documentation first. If coverage is missing, create the necessary docs and ensure `docs/README.md` points to them so the index remains complete.
- The Supabase MCP connection used by `gpt-5-codex` lives in `.codex/config.toml` under `[mcp_servers.supabase]`; update that file if credentials or features change.

Keep the knowledge base current—treat documentation updates as part of the definition of done for any agent-related change.
