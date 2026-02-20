# uv — Troubleshooting

## "Could not find Python version X.Y"
**Symptom:** `error: failed to locate Python 3.11`
**Fix:** Download managed Python: `uv python install 3.11`, or specify explicit path: `uv run --python /usr/bin/python3.11 script.py`

## Network errors in locked CI
**Symptom:** `error: failed to resolve` even with uv.lock present
**Fix:** Commit `uv.lock` to repo; use `UV_OFFLINE=1 uv sync` in CI to avoid re-resolving

## Cache stale/corrupted
**Symptom:** Old package versions, inconsistent installs
**Fix:** `rm -rf ~/.cache/uv/` or `UV_NO_CACHE=1 uv sync`

## Common LLM Mistakes
- **Confusing `uv pip install` with `uv add`:** `uv pip` doesn't update lockfile; use `uv add` for projects
- **Forgetting `--with`:** For inline deps: `uv run --with requests script.py`, not `uv run requests script.py`
- **Not quoting paths:** Paths with spaces need quotes: `uv run --python "C:\\Program Files\\python.exe"`
- **Assuming `--python` picks best version:** Specify exact version or path; `uv run --python 3.11` won't magically upgrade