# ripgrep — Advanced Usage

## Power-User Flags

**Type Customization:**
```
rg --type-list              # List all available types
rg --type-add 'rust:*.rs'   # Add glob rule to type
rg --type-clear rust        # Remove all rules for type
--type-add 'src:include:cpp,py,md'  # Include rules from other types
```

**File Filtering:**
- `--hidden` — Search hidden files (. prefix)
- `-L` / `--follow` — Follow symlinks
- `--max-depth N` — Limit directory traversal depth
- `--max-filesize NUM[K|M|G]` — Skip large files
- `-u` / `--unrestricted` — Reduce filtering (use up to 3 times: `-uuu`)

**Ignore Control:**
- `--no-ignore-vcs` — Skip .gitignore but respect .ignore
- `--ignore-file PATH` — Load custom ignore rules
- `--one-file-system` — Don't cross filesystem boundaries

**Advanced Patterns:**
- `-e PATTERN` — Specify pattern explicitly (useful for patterns starting with `-`)
- `-f FILE` — Read patterns from file, one per line
- `--pre COMMAND` — Preprocess files (e.g., search PDFs: `--pre pdftotext`)
- `-z` / `--search-zip` — Search compressed files (gzip, bzip2, xz, zstd)

**Output Control:**
- `--json` — JSON output format
- `--vimgrep` — Vim-compatible output format
- `--passthru` — Show all lines, highlight matches
- `--replace TEXT` — Replace matches (use `$0`, `$1`, etc. for capture groups)