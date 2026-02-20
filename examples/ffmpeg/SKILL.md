---
name: ffmpeg
description: Powerful multimedia framework for converting, streaming, and processing audio/video files
generated-from: agent-tool-docs
tool-id: ffmpeg
tool-binary: ffmpeg
generated-at: 2026-02-20T05:29:48.133Z
---
# FFmpeg

Powerful multimedia framework for converting, streaming, and processing audio/video files

## Quick Reference
```
ffmpeg -i input.mp4 output.mp3
ffmpeg -i input.mp4 -c:v libx264 -crf 23 output.mp4
ffmpeg -i input.mp4 -vf "scale=1280:720" output.mp4
```

## Key Commands / Flags

| Flag | Purpose |
|------|----------|
| `-i <file>` | Input file |
| `-c:v <codec>` | Video codec (libx264, libvpx, mpeg4, etc.) |
| `-c:a <codec>` | Audio codec (aac, libmp3lame, opus, etc.) |
| `-b:v <bitrate>` | Video bitrate (1M, 5000k, etc.) |
| `-crf <0-51>` | Quality (lower = better, 23 is default) |
| `-vf <filter>` | Video filter chain |
| `-t <duration>` | Duration (00:05:30 or 330 seconds) |
| `-ss <time>` | Seek/start position |
| `-preset <speed>` | Encoding speed (ultrafast to veryslow) |
| `-c copy` | Skip re-encoding (fastest) |

## Common Patterns

**Convert format**:
```
ffmpeg -i input.mov output.mp4
```

**Compress video**:
```
ffmpeg -i input.mp4 -c:v libx264 -crf 28 -preset slow output.mp4
```

**Extract audio**:
```
ffmpeg -i video.mp4 -q:a 0 -map a audio.mp3
```

**Resize video**:
```
ffmpeg -i input.mp4 -vf "scale=1280:720" output.mp4
```

**Trim video** (10 seconds starting at 5s):
```
ffmpeg -i input.mp4 -ss 5 -t 10 -c copy output.mp4
```