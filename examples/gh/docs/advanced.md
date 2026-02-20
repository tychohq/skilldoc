# GitHub CLI — Advanced Usage

## Power-User Flags

```bash
# JSON output with field selection
gh pr list --json number,title,author,state,updatedAt

# Filtering queries
gh pr list --state draft --author @me --base main
gh issue list --label bug --sort updated --limit 50

# Using stdin for body content
gh pr create --title "Title" --body "$(cat file.md)"

# Raw API with proper escaping
gh api --method POST /repos/OWNER/REPO/issues \
  -f title='My title' -f body='My body' -f labels='[]'

# Pagination for large results
gh api /user/repos --paginate --jq '.[] | .name'
```

## Edge Cases

- **Auth state**: Credentials cached per machine; `gh auth login` needed once
- **JSON fields**: Must specify fields explicitly with `--json field1,field2`
- **Body escaping**: Use `-f` flag, not shell quotes; avoid hand-quoted JSON
- **Default branch**: May infer from current branch; specify explicitly in scripts
- **Rate limits**: `gh api` respects GitHub rate limits; check with `gh api /rate_limit`