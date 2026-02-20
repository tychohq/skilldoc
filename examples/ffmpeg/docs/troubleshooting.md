# FFmpeg — Troubleshooting

## Unknown Encoder
**Symptom:** `Unknown encoder 'libx264'`
**Fix:** Run `ffmpeg -codecs` to check available codecs. Install ffmpeg with full support: `brew install ffmpeg` or equivalent.

## Input File Not Found
**Symptom:** `No such file or directory`
**Fix:** Quote paths with spaces: `ffmpeg -i "my file.mp4"` not `ffmpeg -i my file.mp4`

## Invalid Filter Syntax
**Symptom:** `Invalid characters in option` or `Filter not found`
**Fix:** Quote filter chains: `-vf "scale=1280:720,crop=640:480"` not `-vf scale=1280:720,crop=640:480`

## Common LLM Mistakes

- **Wrong bitrate format:** Use `-b:v 5000k` or `-b:v 5M`, not `-b:v 5000`
- **Unquoted filters:** Always quote: `-vf "filter1,filter2"`
- **Forgetting `-c copy`:** For trimming/remuxing without re-encoding, use it (much faster)
- **Mixing quality modes:** Don't use `-q:v` and `-crf` together