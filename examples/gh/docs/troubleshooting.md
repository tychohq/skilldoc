# GitHub CLI — Troubleshooting

## Not Authenticated
**Symptom:** `gh: not authenticated`
**Fix:** Run `gh auth login` and follow prompts

## API JSON Parse Error
**Symptom:** Error with `-f` flag in `gh api`
**Fix:** Use `-f key=value` syntax; don't pass pre-quoted JSON
```bash
# Wrong: -f '{"title": "foo"}'
# Right: -f title='foo'
```

## PR Body Not Formatted Correctly
**Symptom:** Markdown appears as plain text
**Fix:** Avoid over-escaping; use `--body-file` or `-f body='text'`

## Common LLM Mistakes
- Forgetting to authenticate first
- Using wrong output flag (correct: `--json`, not `--format json`)
- Passing hand-quoted JSON instead of `-f key=value` flags
- Incorrect `--json field1,field2` syntax (no spaces)
- Assuming all API fields available; check with `gh COMMAND -h`