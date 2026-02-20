# GitHub CLI — Recipes

## Create PR and Request Review
```bash
gh pr create --title "Feature" --body "Fixes #42" --base main --reviewer user1,user2
```

## List and Merge Own Draft PRs
```bash
gh pr list --state draft --author @me --json number | gh pr merge --auto --squash
```

## Create Issue from Template
```bash
gh issue create --title "Bug Report" --body-file templates/bug-report.md
```

## Get Latest Release Version
```bash
gh release list --limit 1 --json tagName | jq -r '.[0].tagName'
```

## Check Workflow Run Status
```bash
gh run list --limit 5 --json number,name,status,conclusion
```

## Add Labels to Existing Issue
```bash
gh issue edit 123 --add-label bug,enhancement
```