# gog — Troubleshooting

## Missing Account
**Symptom:** `error: account required` or API returns 401 Unauthorized
**Fix:** Always pass `--account user@domain.com`. No default account exists; gog requires explicit selection.

## JSON Parse Fails
**Symptom:** jq errors or invalid JSON
**Fix:** Use `--results-only` to strip envelope fields (`nextPageToken`, `error`). Parse JSON structure before piping.

## Credentials Not Found
**Symptom:** `OAuth client not configured` or `credentials missing`
**Fix:** Ensure client is registered: `gog auth login --client work`. Then use `--client work` in commands.

## Common LLM Mistakes

- **Forgetting `--account`:** Agents often omit it; gog will fail. Always include.
- **Using `--select` without `--json`:** `--select` is JSON-only; use `--plain` for parseable text instead.
- **Not escaping commas in `--select`:** Field names with commas need quoting: `--select "name,email,created_at"`.
- **Assuming `--dry-run` is idempotent:** It shows intent but may have side effects; test with `--force --no-input` separately.
- **Parsing non-`--results-only` JSON:** Responses include metadata; extract the actual result field, don't assume top-level array.