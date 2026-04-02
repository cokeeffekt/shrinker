const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let _nvencAvailable = null;
const GPU_CONCURRENCY = 3;
const CPU_CONCURRENCY = 1;

function detectNvenc() {
  return new Promise((resolve) => {
    if (_nvencAvailable !== null) return resolve(_nvencAvailable);
    execFile('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'nullsrc=s=256x256:d=0.1',
      '-c:v', 'hevc_nvenc', '-f', 'null', '-',
    ], { timeout: 10000 }, (err) => {
      _nvencAvailable = !err;
      console.log(`NVENC hardware encoding: ${_nvencAvailable ? 'available' : 'not available, using libx265'}`);
      console.log(`Concurrency: ${_nvencAvailable ? GPU_CONCURRENCY : CPU_CONCURRENCY} parallel encode(s)`);
      resolve(_nvencAvailable);
    });
  });
}

function getConcurrency() {
  return _nvencAvailable ? GPU_CONCURRENCY : CPU_CONCURRENCY;
}

// Audio codecs that can be stream-copied into MKV
const MKV_AUDIO_COPY = new Set([
  'aac', 'mp3', 'ac3', 'eac3', 'dts', 'flac', 'opus', 'vorbis', 'truehd', 'pcm_s16le', 'pcm_s24le',
]);

// Codecs with known CUDA hw decoding support
const CUDA_CODECS = new Set([
  'h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg1video', 'mpeg2video', 'vc1',
]);

function buildFFmpegArgs(inputPath, outputPath, preset, useNvenc, sourceHeight, audioCodec, sourceCodec) {
  const canHwDecode = useNvenc && CUDA_CODECS.has(sourceCodec);
  const needsScale = sourceHeight && sourceHeight > preset.height;
  const scaleExpr = `'min(${preset.width},iw)':'min(${preset.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;

  const args = canHwDecode
    ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', inputPath]
    : ['-i', inputPath];

  if (useNvenc) {
    args.push(
      '-c:v', 'hevc_nvenc',
      '-preset', 'p5',
      '-rc', 'vbr',
      '-cq', String(preset.crf),
    );
  } else {
    args.push(
      '-c:v', 'libx265',
      '-preset', 'medium',
      '-crf', String(preset.crf),
    );
  }

  if (canHwDecode) {
    // Full GPU path: CUDA decode → scale_cuda → NVENC encode
    args.push('-vf', needsScale
      ? `scale_cuda=${scaleExpr}:format=nv12`
      : 'scale_cuda=format=nv12');
  } else if (useNvenc) {
    // CPU decode → format for NVENC upload → NVENC encode
    const filters = needsScale
      ? `scale=${scaleExpr},format=nv12`
      : 'format=nv12';
    args.push('-vf', filters);
  } else {
    // Full CPU path
    if (needsScale) {
      args.push('-vf', `scale=${scaleExpr}`);
    }
    args.push('-pix_fmt', 'yuv420p');
  }

  if (audioCodec && MKV_AUDIO_COPY.has(audioCodec)) {
    args.push('-c:a', 'copy');
  } else {
    args.push('-c:a', 'aac', '-b:a', '128k');
  }

  args.push(
    '-progress', 'pipe:1',
    '-y',
    outputPath,
  );

  return args;
}

function getTempPath(inputPath) {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  return path.join(dir, `${base}_shrinker_tmp.mkv`);
}

function getFinalPath(inputPath) {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  return path.join(dir, `${base}.mkv`);
}

// Track all active processes for cancellation
const activeProcesses = new Map();

function runFFmpeg(inputPath, tempPath, args, onProgress) {
  return new Promise((resolve, reject) => {
    let stderrBuf = '';
    let proc;
    try {
      proc = execFile('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 }, (err) => {
        activeProcesses.delete(inputPath);
        if (err && err.killed) {
          try { fs.unlinkSync(tempPath); } catch {}
          return reject(new Error('cancelled'));
        }
        if (err) {
          console.error('[ffmpeg stderr]', stderrBuf.slice(-2000));
          try { fs.unlinkSync(tempPath); } catch {}
          const lines = stderrBuf.trim().split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .map(l => l.replace(/^\[.*?\]\s*/, '')); // strip ffmpeg tags like [h264 @ 0x...]
          const tail = lines.slice(-5);
          const meaningful = tail.filter(l => !/^Conversion failed/.test(l));
          const msg = (meaningful.length > 0 ? meaningful.pop() : tail.pop()) || err.message;
          const wrapped = new Error(msg);
          wrapped.ffmpeg = true;
          return reject(wrapped);
        }
        resolve();
      });
    } catch (e) {
      return reject(new Error(`Failed to start ffmpeg: ${e.message}`));
    }

    activeProcesses.set(inputPath, proc);

    proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

    let progressData = {};
    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key && value) {
          progressData[key.trim()] = value.trim();
        }
      }
      if (onProgress) onProgress({ ...progressData });
    });
  });
}

async function convert(inputPath, preset, onProgress, sourceHeight, audioCodec, sourceCodec) {
  const useNvenc = await detectNvenc();
  const canHwDecode = useNvenc && CUDA_CODECS.has(sourceCodec);
  const tempPath = getTempPath(inputPath);
  const finalPath = getFinalPath(inputPath);
  const args = buildFFmpegArgs(inputPath, tempPath, preset, useNvenc, sourceHeight, audioCodec, sourceCodec);

  let encoder = useNvenc
    ? (canHwDecode ? 'nvenc-gpu' : 'nvenc-cpu')
    : 'cpu';
  if (onProgress) onProgress({ encoder });

  try {
    await runFFmpeg(inputPath, tempPath, args, onProgress);
  } catch (err) {
    if (err.message === 'cancelled') throw err;
    // If NVENC was used, retry with CPU encoding
    if (useNvenc) {
      const name = inputPath.split('/').pop();
      console.log(`[converter] NVENC failed for "${name}", retrying with CPU: ${err.message}`);
      encoder = 'cpu-fallback';
      if (onProgress) onProgress({ encoder });
      const cpuArgs = buildFFmpegArgs(inputPath, tempPath, preset, false, sourceHeight, audioCodec, sourceCodec);
      await runFFmpeg(inputPath, tempPath, cpuArgs, onProgress);
    } else {
      throw err;
    }
  }

  try {
    fs.unlinkSync(inputPath);
    fs.renameSync(tempPath, finalPath);
  } catch (e) {
    throw new Error(`Failed to replace original: ${e.message}`);
  }
  return finalPath;
}

function cancelAll() {
  let count = 0;
  for (const [, proc] of activeProcesses) {
    proc.kill('SIGTERM');
    count++;
  }
  activeProcesses.clear();
  return count > 0;
}

module.exports = { convert, cancelAll, getFinalPath, detectNvenc, getConcurrency };
