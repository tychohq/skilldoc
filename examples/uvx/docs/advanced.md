# uvx — Advanced Usage

## Power-User Flags

**PyTorch Backend Selection**
```bash
uvx --torch-backend cu126 TOOL  # CUDA 12.6
uvx --torch-backend rocm7.1 TOOL  # AMD GPU
uvx --torch-backend cpu TOOL  # CPU-only
```

**Resolution Strategies**
```bash
uvx --resolution highest TOOL  # Latest compatible versions (default)
uvx --resolution lowest TOOL  # Oldest compatible versions
uvx --resolution lowest-direct TOOL  # Lowest for direct deps only
```

**Pre-release Handling**
```bash
uvx --prerelease allow TOOL  # Accept pre-releases
uvx --prerelease if-necessary TOOL  # Pre-releases only if needed
```

**Platform-Specific Installation**
```bash
uvx --python-platform x86_64-unknown-linux-gnu TOOL
uvx --python-platform aarch64-apple-darwin TOOL
```

## Edge Cases

- **Caching:** uvx caches resolved environments by default. Use `--refresh` to update all packages, or `--refresh-package PKG` for single package.
- **Editable installs:** `--with-editable` requires the package to be a valid Python project with `setup.py`/`pyproject.toml`.
- **Keyring auth:** Use `--keyring-provider subprocess` for private package indexes requiring authentication.
- **Network issues:** `--offline` mode uses only cached packages; `--no-progress` suppresses output for CI environments.