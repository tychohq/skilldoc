# Bird — Troubleshooting

## Authentication Required

**Symptom:** "Unauthorized" or empty results
**Fix:** Provide valid cookies:
```
bird --auth-token $TOKEN --ct0 $CT0 <command>
# Or use browser profile:
bird --chrome-profile "Default" <command>
```

## Media Upload Fails

**Symptom:** "Invalid media" or request timeout
**Facts:** Max 4 images OR 1 video per tweet
**Fix:** Verify file exists, use `--timeout 30000` for slow uploads

## URL vs ID Confusion

**Symptom:** Command fails silently
**Mistake:** Both URLs and IDs work fine—bird handles both
```
bird read 123456
bird read https://x.com/user/status/123456
```

## Output Parsing Issues

**Symptom:** Emoji/ANSI codes break parsing
**Fix:** Always use `--plain` for automation
```
bird search "query" --plain
```

## Cookie Extraction Hangs

**Symptom:** `--chrome-profile` takes 10+ seconds
**Fix:** Use `--cookie-timeout 5000` (milliseconds)
```
bird --chrome-profile "Default" --cookie-timeout 5000 tweet "test"
```