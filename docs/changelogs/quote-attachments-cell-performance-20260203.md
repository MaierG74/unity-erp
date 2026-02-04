---
title: Quote Attachments Cell Performance Cleanup
published: 2026-02-03
---

## Summary
- Removed redundant per-row attachment fetches in the Quote Line Items table.

## Details
- The inline attachments cell is now the single source of attachment fetching for each item row, avoiding duplicate Supabase calls on initial render and refresh.
