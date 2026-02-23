---
name: gog
description: CLI for Google Workspace (Gmail, Calendar, Drive, Docs, Sheets, etc.) with account-based auth and JSON/text output
generated-from: skilldoc
tool-id: gog
tool-binary: gog
tool-version: v0.10.0 (a92bd63 2026-02-14T03:32:49Z)
generated-at: 2026-02-20T05:19:40.792Z
---
# gog

CLI for Google Workspace services with account-based authentication and flexible output formats.

## Quick Reference

```bash
gog <command> --account user@domain.com --json
```

## Key Commands / Flags

| Flag | Purpose | Example |
|------|---------|----------|
| `--account` | Set Google account email (required for most commands) | `--account alice@company.com` |
| `--client` | Select OAuth client/credential set | `--client work` |
| `--json` | Output JSON (best for scripting) | `gog ... --json` |
| `--plain` | Output TSV, no colors (parseable) | `gog ... --plain` |
| `--results-only` | In JSON mode, emit only the result (no envelope) | `gog ... --json --results-only` |
| `--select` | Pick comma-separated fields (JSON mode) | `--select id,name,email` |
| `--dry-run` | Preview changes without making them | `--dry-run` |
| `--force` | Skip confirmations (use in scripts) | `--force` |
| `--no-input` | Fail instead of prompting (CI-safe) | `--no-input` |

## Common Patterns

```bash
# List with authentication
gog gmail list --account user@domain.com --json

# Select specific fields for scripting
gog drive ls / --account user@domain.com --json --select name,id,mimeType

# Test changes safely
gog calendar create event --dry-run --account user@domain.com

# Destructive operation in CI without prompts
gog docs delete id --force --no-input --account user@domain.com
```