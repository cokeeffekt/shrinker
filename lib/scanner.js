const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts',
]);

function validatePath(requestedPath) {
  const resolved = path.resolve(requestedPath);
  const root = path.resolve(MEDIA_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Path traversal denied');
  }
  return resolved;
}

function listDirectories(parentPath) {
  const dir = parentPath ? validatePath(parentPath) : path.resolve(MEDIA_ROOT);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, path: path.join(dir, d.name) }));
}

function walkDir(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

function probe(filePath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ], { timeout: 30000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const data = JSON.parse(stdout);
        const video = data.streams?.find(s => s.codec_type === 'video');
        const audio = data.streams?.find(s => s.codec_type === 'audio');
        resolve({
          path: filePath,
          name: path.basename(filePath),
          size: Number(data.format?.size || 0),
          duration: Number(data.format?.duration || 0),
          codec: video?.codec_name || 'unknown',
          audioCodec: audio?.codec_name || 'unknown',
          width: video?.width || 0,
          height: video?.height || 0,
          container: path.extname(filePath).slice(1).toLowerCase(),
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function shouldSkip(fileInfo, preset) {
  if (fileInfo.name.includes('_shrinker_tmp')) return true;
  if (
    fileInfo.container === 'mkv' &&
    fileInfo.codec === 'hevc' &&
    fileInfo.height <= preset.height
  ) {
    return true;
  }
  return false;
}

async function scanDirectory(dirPath, preset) {
  const validated = validatePath(dirPath);
  const files = walkDir(validated);
  const results = [];
  for (const f of files) {
    try {
      const info = await probe(f);
      info.skip = shouldSkip(info, preset);
      results.push(info);
    } catch {
      // skip files that can't be probed
    }
  }
  return results;
}

module.exports = { listDirectories, scanDirectory, validatePath, MEDIA_ROOT };
