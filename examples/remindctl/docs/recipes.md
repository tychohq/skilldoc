# remindctl — Recipes

## Create a reminder

```
remindctl add "Call dentist Monday"
```

## Create reminder in specific list

```
remindctl add "Team meeting" --list Work
```

## View all reminders

```
remindctl show
```

## View specific reminder list

```
remindctl list "Work"
```

## Mark reminders complete

```
remindctl complete id-1 id-2 id-3
```

## Delete and verify authorization

```
remindctl delete id-123
remindctl status
```