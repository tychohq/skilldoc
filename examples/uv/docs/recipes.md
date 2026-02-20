# uv — Recipes

## Run Python script with dependencies
```
uv run --with requests script.py
```

## Install global command-line tool
```
uv pip install --global black
black --version
```

## Setup and initialize new project
```
uv init myapp
cd myapp
uv add flask sqlalchemy
uv sync
uv run flask run
```

## Run tests with specific Python version
```
uv run --python 3.11 pytest tests/
```

## Use tool without global install (one-off)
```
uv run uvx ruff check .
uv run uvx pytest
```

## CI/CD: Offline installation with lockfile
```
uv lock          # Generate lockfile locally before commit
# In CI:
UV_OFFLINE=1 uv sync
UV_OFFLINE=1 uv run python script.py
```