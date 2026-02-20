---
name: claude
description: Claude Code command-line interface for AI-assisted development with session management, model selection, and tool control
generated-from: agent-tool-docs
tool-id: claude
tool-binary: claude
tool-version: 2.1.49 (Claude Code)
generated-at: 2026-02-20T05:17:34.917Z
---
# Claude Code CLI

Command-line interface for Claude AI development assistant with session persistence, model control, and fine-grained tool permissions.

## Quick Reference

```bash
claude                           # Start interactive session
claude --model sonnet            # Use Sonnet model (aliases: 'sonnet', 'opus', 'haiku')
claude --print                   # Non-interactive, print-friendly output
claude --resume                  # Continue most recent conversation
claude --permission-mode acceptEdits  # Auto-accept file edits
```

## Key Commands

| Command | Purpose |
|---------|----------|
| `auth` | Manage authentication |
| `install [target]` | Install native build (stable, latest, or version) |
| `update\|upgrade` | Check and install updates |
| `doctor` | Check auto-updater health |
| `mcp` | Configure MCP servers |
| `plugin` | Manage plugins |
| `setup-token` | Create long-lived auth token (requires subscription) |

## Key Flags

| Flag | Purpose |
|------|----------|
| `--model <alias or id>` | Model: 'sonnet', 'opus', 'haiku' or full ID |
| `--print` | Non-interactive output for pipes/scripts |
| `--permission-mode <mode>` | acceptEdits, bypassPermissions, default, dontAsk, plan |
| `--tools <list>` | Whitelist tools: 'Bash,Edit,Read' or 'default' |
| `--allowedTools <list>` | Whitelist with subcommand filter: 'Bash(git:*)' |
| `--disallowedTools <list>` | Blacklist tools |
| `--disable-slash-commands` | Disable all skills |
| `--system-prompt <text>` | Custom system prompt |
| `--resume [id]` | Resume by ID or pick recent |
| `--continue` | Resume in current directory |
| `--debug [filter]` | Enable debug; filter: 'api,hooks' or '!1p,!file' |

## Common Patterns

```bash
# Non-interactive (for pipes, automation)
echo 'analyze this' | claude --print --model sonnet

# Resume a conversation
claude --resume

# Restrict tools
claude --allowedTools 'Bash(git:*) Edit'

# Custom instructions
claude --system-prompt 'You are a Python expert'

# Debug specific subsystems
claude --debug api,hooks
```