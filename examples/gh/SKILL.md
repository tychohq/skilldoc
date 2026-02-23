---
name: gh
description: GitHub CLI for managing repositories, issues, pull requests, and workflows
generated-from: skilldoc
tool-id: gh
tool-binary: gh
tool-version: gh version 2.86.0 (2026-01-21)
generated-at: 2026-02-20T05:29:06.250Z
---
# GitHub CLI

Command-line interface for GitHub operations.

## Quick Reference
```
gh auth login                    # Authenticate
gh pr create --title "Title"     # Create PR
gh pr view 123                   # View PR
gh issue create --title "Title"  # Create issue
gh api /repos/owner/repo/issues  # Raw API call
```

## Key Commands

| Command | Purpose |
|---------|----------|
| `gh auth login` | Authenticate with GitHub |
| `gh pr create` | Create pull request |
| `gh pr view [NUM]` | View PR details |
| `gh pr list` | List PRs |
| `gh issue create` | Create issue |
| `gh issue view [NUM]` | View issue |
| `gh api PATH` | Make REST API calls |
| `gh repo clone OWNER/REPO` | Clone repo |
| `gh release create TAG` | Create release |
| `gh workflow list` | List workflows |

## Common Patterns

```bash
# Create PR with body from file
gh pr create --title "Fix" --body-file description.md

# Get JSON output for parsing
gh pr list --json number,title,author

# Merge PR with squash and cleanup
gh pr merge 123 --squash --delete-branch

# Create issue with labels
gh issue create --title "Bug" --label bug,urgent

# Query API with JSON selector
gh api /repos/owner/repo/issues --jq '.[] | .title'
```