# Shrinker

Dockerized batch video converter. Scans directories for video files and converts them to compressed H.265 (HEVC) MKV. Simple web UI for picking directories, choosing quality presets, monitoring progress, scheduling automatic scans, and viewing conversion history.

## Quick Start

1. Clone the repo:
   ```bash
   git clone git@github.com:cokeeffekt/shrinker.git
   cd shrinker
   ```

2. Edit `docker-compose.yml` — mount your media directories:
   ```yaml
   volumes:
     - ./data:/app/data
     - /path/to/videos:/media/Videos
     - /path/to/movies:/media/Movies
   ```

3. Build and run:
   ```bash
   docker compose up --build -d
   ```

4. Open `http://localhost:3000` in your browser.

## Features

- Scan mounted directories for video files (recursive)
- Batch convert to H.265/HEVC in MKV container
- Quality presets from 480p to 4K
- NVIDIA GPU acceleration (auto-detected, falls back to CPU)
- Real-time progress with speed, FPS, and ETA
- Scheduled automatic scans and conversions
- Conversion history with file sizes and compression ratios
- Skip logic — already converted or matching files are flagged
- Audio passthrough (original audio is preserved, not re-encoded)
- Aspect ratio preserved on downscale, never upscales

## Quality Presets

| Preset | Resolution | CRF |
|--------|-----------|-----|
| 480p   | 854x480   | 28  |
| 720p   | 1280x720  | 23  |
| 1080p  | 1920x1080 | 23  |
| 1440p  | 2560x1440 | 22  |
| 4K     | 3840x2160 | 20  |

Lower CRF = higher quality / larger file. The scale filter only downscales — if the source is smaller than the target preset, it encodes at the original resolution.

## NVIDIA GPU Acceleration

The Docker image is based on `nvidia/cuda` and includes ffmpeg with `hevc_nvenc` support. To enable GPU encoding:

1. Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) on the host.

2. Uncomment the GPU section in `docker-compose.yml`:
   ```yaml
   deploy:
     resources:
       reservations:
         devices:
           - driver: nvidia
             count: all
             capabilities: [gpu]
   ```

3. Rebuild and restart.

The app tests the GPU at startup. If NVENC is available, it uses `hevc_nvenc` (hardware). Otherwise, it falls back to `libx265` (software). The active encoder is shown in the web UI header.

## Scheduled Scans

Directories can be enrolled for automatic periodic scanning and conversion via the **Scheduled Scans** section in the UI. Each schedule has:

- **Directory** — which mounted media directory to watch
- **Preset** — quality preset to use
- **Interval** — how often to scan (5 minutes to 24 hours)

Schedules are persisted in `data/schedules.json` and restored on container restart. If a conversion is already in progress when a scheduled scan triggers, it skips that run.

## Conversion Details

| Setting   | Value                     |
|-----------|---------------------------|
| Codec     | H.265 / HEVC (libx265 or hevc_nvenc) |
| Container | MKV                       |
| Preset    | `medium` (CPU) / `p5` (GPU) |
| Audio     | Copy (passthrough)        |
| Output    | `{name}.mkv` (replaces original) |

After a successful conversion, the original file is deleted and replaced with the converted MKV. Conversion writes to a temporary file first (`{name}_shrinker_tmp.mkv`) so originals are only removed after a successful encode.

## Skip Logic

Files are flagged as "skip" (shown but deselected in the UI) when:
- The file is already MKV + HEVC and height is at or below the selected preset
- The filename contains `_shrinker_tmp` (in-progress conversion)

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/directories`     | List mounted media directories |
| `GET`    | `/api/scan?dir=<path>&preset=720p` | Scan directory, returns files with metadata and skip flags |
| `GET`    | `/api/presets`         | Quality preset definitions |
| `GET`    | `/api/encoder`         | Active encoder info (GPU or CPU) |
| `POST`   | `/api/convert`         | Start conversion — body: `{ files: [...], preset: "720p" }` |
| `GET`    | `/api/status`          | Current conversion progress and queue |
| `DELETE` | `/api/cancel`          | Cancel active conversion |
| `GET`    | `/api/history`         | Conversion history log |
| `GET`    | `/api/schedules`       | List scheduled scans |
| `POST`   | `/api/schedules`       | Add schedule — body: `{ directory, preset, intervalMinutes }` |
| `PATCH`  | `/api/schedules/:id`   | Toggle schedule on/off |
| `DELETE` | `/api/schedules/:id`   | Remove schedule |

## Project Structure

```
shrinker/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── package.json
├── server.js               # Express app, API routes, static serving
├── lib/
│   ├── presets.js           # Quality preset definitions
│   ├── scanner.js           # Recursive directory walk + ffprobe metadata
│   ├── converter.js         # ffmpeg process, progress parsing, NVENC detection
│   ├── queue.js             # In-memory job queue (one at a time)
│   ├── history.js           # JSON file read/write for history log
│   └── scheduler.js         # Periodic scan scheduling and auto-conversion
├── data/
│   ├── .gitkeep
│   ├── history.json         # Created at runtime
│   └── schedules.json       # Created at runtime
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## Configuration

| Environment Variable | Default  | Description |
|---------------------|----------|-------------|
| `PORT`              | `3000`   | Server listen port |
| `MEDIA_ROOT`        | `/media` | Root directory for mounted media |

## Supported Input Formats

`.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.webm`, `.m4v`, `.mpg`, `.mpeg`, `.ts`

## Data Persistence

- `data/history.json` — conversion history (capped at 1000 entries)
- `data/schedules.json` — scheduled scan definitions

Both are persisted via the `./data:/app/data` volume mount.

## License

MIT
