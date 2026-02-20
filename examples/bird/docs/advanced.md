# Bird — Advanced Usage

## Authentication Methods

**Cookie environment variables:**
```
export BIRD_AUTH_TOKEN="your_token"
export BIRD_CT0="your_ct0"
bird tweet "Auto-authenticated"
```

**Browser profile extraction:**
```
bird --chrome-profile "Profile 1" read <tweet-id>
bird --firefox-profile "default" search "query"
bird --chrome-profile-dir "/path/to/cookies.db" tweet "test"
```

**Timeout & request control:**
```
bird --timeout 30000 search "slow-query"
bird --cookie-timeout 5000 --chrome-profile "Default" tweet "test"
```

## Output Formatting

| Flag | Effect |
|------|--------|
| `--plain` | Stable output, no ANSI codes (best for parsing) |
| `--no-emoji` | Remove emoji, keep color |
| `--no-color` | Remove color, keep emoji |

**For automation, always use `--plain`.**

## Quote Depth

```
bird read <tweet-id> --quote-depth 0   # Don't expand quoted tweets
bird read <tweet-id> --quote-depth 3   # Expand up to 3 levels
```

Default is 1 level. Increase for full context chains, decrease to reduce API calls.