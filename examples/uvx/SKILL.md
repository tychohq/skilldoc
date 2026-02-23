---
name: uvx
description: Run Python tools without installing them permanently
generated-from: skilldoc
tool-id: uvx
tool-binary: uvx
tool-version: uvx 0.10.1 (Homebrew 2026-02-10)
generated-at: 2026-02-20T05:24:05.643Z
---
# uvx

Run Python CLI tools in isolated, temporary environments — like `npx` for Python.

## Quick Reference

```bash
uvx TOOL_NAME [args]                    # Run a tool
uvx --from PACKAGE COMMAND [args]       # Run command from specific package
uvx --with PACKAGES TOOL [args]         # Add packages to environment
uvx --python 3.11 TOOL [args]           # Use specific Python version
uvx --isolated TOOL [args]              # Fresh environment, ignore installed tools
```

## Key Flags

| Flag | Purpose |
|------|----------|
| `--from PACKAGE` | Specify which package provides the command |
| `--with PACKAGES` | Add comma-separated packages to the environment |
| `--with-requirements FILE` | Install packages from requirements.txt-style file |
| `--with-editable PKG` | Install package in editable/development mode |
| `--python VERSION` | Use specific Python version (e.g., `3.11`, `3.12`) |
| `--isolated` | Run in completely fresh environment |
| `--env-file .env` | Load environment variables from file |
| `--index URL` | Use additional package index alongside PyPI |

## Common Patterns

```bash
# Simple tool execution
uvx ruff check src/

# Tool with additional packages
uvx --with pandas,numpy pandas-stubs mypy

# Specific package version
uvx --from black==24.1.0 black .

# With requirements file
uvx --with-requirements requirements.txt jupyter

# Force clean environment
uvx --isolated --python 3.12 poetry --version
```