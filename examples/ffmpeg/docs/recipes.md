# FFmpeg — Recipes

## MP4 to MP3 (Audio Extraction)
```
ffmpeg -i video.mp4 -q:a 0 -map a output.mp3
```

## Reduce File Size
```
ffmpeg -i input.mp4 -c:v libx264 -crf 28 -preset slow -c:a aac -b:a 128k output.mp4
```

## Resize to 720p
```
ffmpeg -i input.mp4 -vf "scale=1280:720" -c:v libx264 -crf 23 output.mp4
```

## Trim Video (10 seconds from 5s mark)
```
ffmpeg -i input.mp4 -ss 5 -t 10 -c copy output.mp4
```

## WebM to MP4
```
ffmpeg -i input.webm -c:v libx264 -crf 23 -c:a aac output.mp4
```

## Add Letterbox to 1920x1080
```
ffmpeg -i input.mp4 -vf "pad=1920:1080:(ow-iw)/2:(oh-ih)/2" output.mp4
```