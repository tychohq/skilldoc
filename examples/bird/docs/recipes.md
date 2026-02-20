# Bird — Recipes

## Post a Tweet with Image

```
bird --auth-token $TOKEN --media photo.jpg --alt "Sunset" tweet "Beautiful evening"
```

## Reply with Multiple Images

```
bird --auth-token $TOKEN \
  --media img1.png --alt "Chart" \
  --media img2.png --alt "Data" \
  reply "https://x.com/user/status/123" "Great analysis!"
```

## Search & Filter Tweets

```
bird search "typescript" --plain    # Basic search
bird search "from:torvalds" --plain # From specific user
bird search "#nodejs since:2024"    # With filters
```

## Get Your Mentions and Bookmarks

```
bird --auth-token $TOKEN mentions --plain
bird --auth-token $TOKEN bookmarks --plain
```

## Get User's Tweet History

```
bird --auth-token $TOKEN user-tweets @username --plain
```

## Read Full Conversation Thread

```
bird thread "https://x.com/user/status/123" --plain
```