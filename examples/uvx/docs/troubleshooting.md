# uvx — Troubleshooting

## "command not found" after uvx completes
**Symptom:** Tool runs fine during `uvx`, but package isn't available afterward.
**Fix:** This is normal — `uvx` is ephemeral like `npx`. It runs in an isolated env that's cleaned up. If you need persistent install, use `uv pip install` instead.

## Package resolution fails with version conflicts
**Symptom:** `Conflict: package X requires Y, but you installed Z`
**Fix:** Use `--resolution lowest` to try older compatible versions, or `--with-requirements` with a pre-made lock file.

## Wrong Python version used
**Symptom:** Tool runs but uses Python 3.8 instead of 3.12.
**Fix:** Explicitly specify with `--python 3.12`. Environment's system Python takes precedence without this flag.

## Private PyPI authentication fails
**Symptom:** `401 Unauthorized` when fetching from private index.
**Fix:** Use `--keyring-provider subprocess` if credentials are in system keyring, or set `UV_INDEX` env var with embedded credentials (cautiously).

## Common LLM Mistakes

- **Forgetting `--from`:** Confusing `--from black black .` (correct) with just `black .` — need `--from` when package name differs from command name.
- **Quoting issues:** Arguments with spaces must be quoted: `--with "package with-dash"` not `--with package with-dash`.
- **Assuming persistence:** Thinking tools installed via `uvx` remain available next session — they don't.
- **Wrong flag for editable:** Using `--with-editable` with a published package — it only works with local paths/repos.
- **Not isolating:** Inheriting stale tool versions from system cache instead of using `--isolated` for reproducible runs.