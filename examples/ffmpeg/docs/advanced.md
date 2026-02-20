# FFmpeg — Advanced Usage

## Power-User Flags

- `-preset <ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow>` — Encoding speed/quality tradeoff
- `-vf <filter>` — Video filters: `scale`, `crop`, `pad`, `fps`, `reverse`, `hflip`, `vflip` (chain with commas)
- `-af <filter>` — Audio filters: `volume`, `atrim`, `loudnorm`, `highpass`, `lowpass`
- `-map <stream>` — Select specific streams (e.g., `-map 0:v:0 -map 0:a:1`)
- `-metadata <key=value>` — Add metadata tags
- `-f <format>` — Force output format (e.g., `-f mp3`, `-f h264`)
- `-pix_fmt <format>` — Pixel format (yuv420p, rgb24, etc.)
- `-r <fps>` — Frame rate (e.g., `-r 30`)

## Edge Cases

- **Hardware acceleration:** Add `-hwaccel cuda` before `-i` for GPU encoding
- **Lossless copy:** Use `-c copy` to skip re-encoding (much faster, no quality loss)
- **Multiple inputs:** Use `-filter_complex` for complex multi-input operations
- **Stdout output:** Use `-` as filename; requires `-f format` to specify type
- **Concatenation:** Use concat demuxer or filter with `concat=n=2:v=1:a=1`
- **Subtitle handling:** Use `-c:s copy` or `-c:s mov_text` for subtitle streams