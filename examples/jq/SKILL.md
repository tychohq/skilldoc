---
name: jq
description: JSON processor for filtering, transforming, and extracting data
generated-from: skilldoc
tool-id: jq
tool-binary: jq
tool-version: jq-1.8.1
generated-at: 2026-02-20T05:22:43.996Z
---
# jq

JSON processor for filtering, transforming, and extracting data.

## Quick Reference
```
jq '.field' file.json           # Extract field
jq '.[] | .name' file.json      # Extract from array
jq -r '.email' file.json        # Raw output (unquoted strings)
jq -s 'add' file1.json file2.json  # Merge arrays/objects
jq '.[] | select(.active)' file.json  # Filter elements
jq '.[] | {id, name}' file.json    # Pick fields
```

## Key Flags
| Flag | Purpose |
|------|----------|
| `-r` | Output strings without quotes (raw mode) |
| `-R` | Read input as plain text lines, not JSON |
| `-s` | Slurp: read all inputs into single array |
| `-n` | Start with null input (no file reading) |
| `-c` | Compact output (single line) |
| `-e` | Set exit status based on output |
| `--arg x v` | Bind `$x` to string value `v` |
| `--argjson x j` | Bind `$x` to JSON value `j` |
| `--sort-keys` / `-S` | Sort object keys |

## Common Patterns

**Extract nested field:** `jq '.user.address.city'`

**Map over array:** `jq '.[] | {id, status}'`

**Filter + transform:** `jq '.items[] | select(.qty > 0) | .name'`

**Use variables:** `jq --arg role admin '.users[] | select(.role == $role)'`

**Pretty-print:** `jq '.' messy.json` (3-space indent by default)