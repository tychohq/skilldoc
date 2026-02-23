---
name: bird
description: X/Twitter CLI for posting, reading, searching, and interacting with tweets
generated-from: skilldoc
tool-id: bird
tool-binary: bird
tool-version: 0.8.0
generated-at: 2026-02-20T05:16:45.817Z
---
# Bird

X/Twitter CLI for posting, reading, and searching tweets

## Quick Reference

```
bird tweet "Hello world"
bird read <tweet-id-or-url>
bird search <query>
```

## Key Commands

| Command | Purpose |
|---------|----------|
| `tweet <text>` | Post a new tweet |
| `reply <tweet-id> <text>` | Reply to a tweet |
| `read <tweet-id-or-url>` | Fetch a single tweet |
| `search <query>` | Search for tweets |
| `mentions` | Get tweets mentioning you |
| `bookmarks` | Get your bookmarked tweets |
| `follow <username>` | Follow a user |
| `home` | Get home timeline |

## Key Flags

| Flag | Purpose |
|------|----------|
| `--auth-token <token>` | X auth_token cookie (required for authenticated actions) |
| `--ct0 <token>` | X ct0 cookie (required for authenticated actions) |
| `--media <path>` | Attach image/video (repeatable: up to 4 images or 1 video) |
| `--alt <text>` | Alt text for media (repeatable, one per --media) |
| `--plain` | Stable output format (no emoji/color) |
| `--chrome-profile <name>` | Auto-extract cookies from Chrome profile |

## Common Patterns

**Post a tweet:**
```
bird --auth-token $TOKEN tweet "Hello from bird!"
```

**Reply with alt text:**
```
bird --auth-token $TOKEN --media image.png --alt "description" reply <tweet-id> "Great point!"
```

**Search tweets:**
```
bird search "keyword" --plain
```

**Get mentions:**
```
bird --auth-token $TOKEN mentions --plain
```

**Extract cookies from Chrome:**
```
bird --chrome-profile "Default" tweet "Test"
```