---
name: remindctl
description: Command-line interface to Apple Reminders app for creating, editing, and managing reminders
generated-from: skilldoc
tool-id: remindctl
tool-binary: remindctl
tool-version: 0.1.1
generated-at: 2026-02-20T14:24:52.580Z
---
# remindctl

Command-line interface to Apple Reminders app for creating, editing, and managing reminders.

## Quick Reference

```
remindctl show              # Show reminders
remindctl list             # List reminder lists
remindctl add "Task"       # Add reminder
remindctl complete <id>    # Mark complete
remindctl delete <id>      # Delete reminder
```

## Key Commands

| Command | Purpose |
|---------|----------|
| `show` | Display reminders |
| `list` | List all reminder lists or show list contents |
| `add` | Create a new reminder (text required) |
| `edit` | Modify an existing reminder |
| `complete` | Mark one or more reminders as done |
| `delete` | Remove reminders |
| `status` | Check Reminders app authorization status |
| `authorize` | Grant CLI access to Reminders (one-time setup) |

## Common Patterns

**Show all reminders:**
```
remindctl show
```

**Add a reminder:**
```
remindctl add "Buy groceries"
```

**List all reminder lists:**
```
remindctl list
```

**Mark reminder complete:**
```
remindctl complete <reminder-id>
```

**Delete a reminder:**
```
remindctl delete <reminder-id>
```