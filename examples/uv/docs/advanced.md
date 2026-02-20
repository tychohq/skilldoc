# uv — Advanced Usage

## Power-User Flags

**`--offline`** / `UV_OFFLINE=1`: Disable network entirely; rely on cache and lockfile only
```
uv sync --offline
UV_OFFLINE=1 uv run script.py
```

**`--no-cache`** / `UV_NO_CACHE=1`: Skip cache (useful for testing or when cache is suspect)

**`--managed-python`** / `UV_MANAGED_PYTHON=1`: Require uv-managed Python; fail if system Python used

**`--native-tls`**: Use system TLS certificate store instead of bundled certs (fixes SSL issues on some systems)

**`UV_PYTHON_DOWNLOADS=never`**: Never auto-download Python; useful for restricted environments

## Edge Cases

**Python version discovery:** `uv run --python 3.11` searches managed + system; `--python /path/to/python` uses explicit path only

**Cache location:** Default `~/.cache/uv/`; override with `UV_CACHE_DIR=/custom/path` or `--cache-dir`

**Lockfile handling:** `uv.lock` is uv-specific format (not pip-compatible); commit it to repo

**Environment variables:** Most flags can be set via `UV_*` env vars for CI/containers

**`uv add` vs `uv pip install`:** `uv add` updates pyproject.toml + lockfile; `uv pip` manages only current environment