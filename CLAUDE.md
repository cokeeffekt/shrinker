# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Shrinker is a Dockerized batch video converter with a web UI. It scans mounted media directories, identifies videos that can be re-encoded to HEVC (H.265) in MKV containers, and converts them using ffmpeg. It auto-detects NVIDIA NVENC for GPU-accelerated encoding and falls back to CPU (libx265).

## Running

```bash
docker compose up --build        # Build and run (exposes on port 3001)
node server.js                   # Run directly (requires ffmpeg/ffprobe in PATH)
```

The app serves on port 3000 (mapped to 3001 in docker-compose). Media directories are mounted under `MEDIA_ROOT` (default `/media`).

There are no tests, no linter, and no build step. The frontend is vanilla JS/HTML/CSS served as static files.

## Architecture

**Express server** (`server.js`) — REST API + static file serving. All state is in-memory (queue) or JSON files (`data/`).

**Key modules in `lib/`:**
- `converter.js` — Wraps ffmpeg. Detects NVENC at startup, builds ffmpeg args per preset, manages active child processes. Converts to a `_shrinker_tmp.mkv` temp file, then replaces the original on success.
- `scanner.js` — Walks directories under `MEDIA_ROOT`, probes files with ffprobe. `shouldSkip()` skips files already in HEVC/MKV at or below preset resolution. `validatePath()` prevents path traversal.
- `queue.js` — Manages conversion state. Worker pool pattern: spawns N concurrent workers (3 for GPU, 1 for CPU) that pull from a pending array. Tracks per-file progress via ffmpeg's `-progress pipe:1` output.
- `scheduler.js` — Persisted scheduled scans (`data/schedules.json`). Uses `setInterval` timers. Runs scan + auto-convert on interval, skips if a conversion is already active.
- `presets.js` — Resolution/CRF preset definitions (480p through 4K).
- `history.js` — Append-only conversion log (`data/history.json`), capped at 1000 entries.

**Frontend** (`public/`) — Single-page app. Polls `/api/status` every 1s during conversions. No framework, no bundler.

## Key Behaviors

- Converted files always become `.mkv` regardless of input format. Originals are deleted after successful conversion.
- Audio is copied (`-c:a copy`), never re-encoded.
- Only one batch conversion can run at a time (enforced by `queue.js`).
- Scheduler skips its run if a conversion is already in progress.
