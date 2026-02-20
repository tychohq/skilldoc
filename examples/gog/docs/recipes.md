# gog — Recipes

## Switch Account and List Mail
```bash
gog gmail list --account alice@company.com --json --results-only
```

## Fetch Drive Files with Specific Fields
```bash
gog drive ls / --account user@domain.com --json --select name,id,mimeType,webViewLink
```

## Dry-Run Before Deleting
```bash
gog docs delete abc123 --account user@domain.com --dry-run
```

## Bulk Operation with No Prompts
```bash
gog calendar delete-event event-id --account user@domain.com --force --no-input
```

## Parse JSON in Scripts
```bash
gog sheets values get sheet-id A1:B10 --account user@domain.com --json | jq '.values[]'
```