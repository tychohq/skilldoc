---
name: rg
description: Fast, parallel grep-like search tool with regex support
generated-from: agent-tool-docs
tool-id: rg
tool-binary: rg
tool-version: ripgrep 15.1.0
generated-at: 2026-02-20T14:25:20.282Z
---
# ripgrep

Fast parallel search with regex, respects .gitignore by default.

## Quick Reference

```
rg PATTERN              # Search current directory
rg PATTERN path/        # Search specific path
rg -i PATTERN           # Case-insensitive
rg -w PATTERN           # Whole word only
rg -l PATTERN           # List matching files only
rg -c PATTERN           # Count matches per file
```

## Key Flags

| Flag | Purpose |
|------|----------|
| `-i` / `--ignore-case` | Case-insensitive search |
| `-w` / `--word-regexp` | Match whole words only |
| `-l` / `--files-with-matches` | Show only filenames |
| `-c` / `--count` | Count matches per file |
| `-A NUM` / `--after-context NUM` | Show N lines after match |
| `-B NUM` / `--before-context NUM` | Show N lines before match |
| `-C NUM` / `--context NUM` | Show N lines before and after |
| `--type TYPE` | Search only specific file type |
| `-g GLOB` / `--glob GLOB` | Include/exclude by glob (prepend `!` to exclude) |
| `-F` / `--fixed-strings` | Treat PATTERN as literal string, not regex |
| `--no-ignore` | Ignore .gitignore rules |

## Common Patterns

```
# Find in Python files only
rg --type py 'class Foo'

# Search excluding a directory
rg -g '!node_modules' PATTERN

# Show matches with context
rg -C3 'error'

# Case-insensitive, whole-word match
rg -iw 'TODO'

# Count total matches
rg -c 'pattern' | awk -F: '{sum+=$2} END {print sum}'
```