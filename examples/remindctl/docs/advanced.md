# remindctl — Advanced Usage

## Authorization

First-time use requires explicit authorization:
```
remindctl authorize
```
Grants persistent CLI access to Reminders app. Required once per user account.

## Status Check

**Check current authorization and app status:**
```
remindctl status
```

## Edge Cases

- **Authorization required:** macOS may prompt for Reminders access on first run
- **List names with spaces:** May require quoting when used as arguments
- **Reminder IDs:** Always use IDs returned by `show` or `list` commands
- **Local database only:** No network sync during command execution
- **Edit command limitations:** Not all reminder properties may be editable via CLI