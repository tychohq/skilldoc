# uvx — Recipes

## Run a Linter/Formatter
```bash
uvx ruff check --fix src/
uvx black --line-length 88 .
```

## Run with Multiple Additional Packages
```bash
uvx --with pandas numpy scipy jupyter notebook
```

## Use Specific Package Version
```bash
uvx --from "black==24.1.0" black .
```

## Run with Development Dependencies
```bash
uvx --with-requirements dev-requirements.txt pytest -v tests/
```

## Specific Python Version
```bash
uvx --python 3.9 python -c "import sys; print(sys.version)"
```

## Private Package Index
```bash
uvx --index https://private.pypi.org/simple --with mypackage mytool
```

## Refresh Cached Packages
```bash
uvx --refresh ruff  # Update all dependencies
uvx --refresh-package urllib3 myapp  # Update one package
```