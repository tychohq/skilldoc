---
name: uv
description: Fast Python package manager and script runner with built-in dependency resolution
generated-from: skilldoc
tool-id: uv
tool-binary: uv
tool-version: uv 0.10.1 (Homebrew 2026-02-10)
generated-at: 2026-02-20T05:23:39.561Z
---
# uv

Fast Python package manager and script runner with built-in dependency resolution

## Quick Reference
```
uv run script.py           # Run script with auto-dependency management
uv pip install package    # Install package(s)
uv python list            # List available Python versions
uv add package            # Add dependency to project (updates lockfile)
uv sync                   # Install all project dependencies
```

## Key Commands / Flags

| Command/Flag | Purpose |
| --- | --- |
| `run` | Execute Python scripts or commands with automatic dependency resolution |
| `pip` | Install/uninstall packages (pip-compatible interface) |
| `python` | Download/list/use Python versions |
| `add` | Add dependencies to project (creates/updates pyproject.toml & uv.lock) |
| `sync` | Install dependencies from uv.lock |
| `--project <dir>` | Specify project directory (auto-discovers pyproject.toml) |
| `--python <ver>` | Use specific Python version (3.11, 3.10, /path/to/bin/python) |
| `--offline` | Disable network access; use only cached packages |

## Common Patterns

**Run script with inline dependencies:**
```
uv run --with requests script.py
```

**Manage project dependencies:**
```
uv add numpy pandas      # Add packages
uv sync                  # Install from lockfile
uv remove numpy          # Remove package
```

**Use specific Python version:**
```
uv python install 3.11   # Download if needed
uv run --python 3.11 script.py
```

**One-off command with tool:**
```
uv run uvx black src/    # Run tool without installing
```

**CI with offline mode:**
```
UV_OFFLINE=1 uv sync    # Use only locked packages
```