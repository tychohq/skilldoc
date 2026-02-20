# ripgrep — Troubleshooting

## Pattern not matching
**Symptom:** Search returns no results but pattern exists in file
**Fix:** 
- Check if pattern uses regex syntax. Use `-F` for literal string matching
- Try `-i` flag if case mismatch
- Verify file type is not being excluded (use `--no-ignore`)
- Check encoding with `--encoding none`

## Files being skipped unexpectedly
**Symptom:** Files exist but aren't being searched
**Fix:**
- Use `--no-ignore` to bypass .gitignore rules
- Use `--hidden` to search dot files
- Check `--type-list` for file type filtering
- Use `rg --debug pattern` to see what's being skipped

## Common LLM Mistakes

- **Wrong arg order:** `rg PATTERN path` ✓ not `rg path PATTERN` ✗
- **Pattern with dash:** `rg -e -foo pattern` ✓ or `rg -- -foo pattern` ✓
- **Unquoted regex:** `rg 'foo|bar'` ✓ not `rg foo|bar` ✗ (shell interprets pipe)
- **-l behavior:** `-l` shows filenames, not content. Use without flags to see matches
- **Glob not working:** `-g 'path/**'` ✓ not `-g 'path'` ✗ (won't match subdirs)
- **Excluding dotfiles:** Use `--no-hidden` (default), not `--ignore-dot`