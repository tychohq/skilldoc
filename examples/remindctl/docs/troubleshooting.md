# remindctl — Troubleshooting

## Authorization Denied

**Symptom:** "Not authorized" or permission denied error
**Fix:** Run `remindctl authorize` once to grant access

## List Not Found

**Symptom:** "List not found" when querying specific list
**Fix:** Use `remindctl list` to see available lists; names are case-sensitive

## Common LLM Mistakes

- **Inventing flags:** remindctl is minimal; few flags exist beyond command arguments
- **Unquoted text with spaces:** Always quote reminder text containing spaces or special characters
- **Made-up reminder IDs:** Only use IDs returned by `show` or `list` commands
- **Assuming pre-authorization:** First use always requires `remindctl authorize`
- **Wrong command names:** Use `authorize` not `auth`, `complete` not `mark-complete`