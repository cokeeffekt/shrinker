const fs = require('fs');
const { convert, cancelAll, getConcurrency } = require('./converter');
const history = require('./history');

const state = {
  active: false,
  totalFiles: 0,
  completedFiles: 0,
  preset: null,
  jobs: {},     // keyed by input path: { file, progress, startTime }
  pending: [],  // files waiting to start
  cancelled: false,
  lastCompletedAt: 0, // timestamp of last job completion
};

function getStatus() {
  const jobList = Object.entries(state.jobs).map(([inputPath, job]) => ({
    file: inputPath,
    name: inputPath.split('/').pop(),
    progress: job.progress,
  }));

  return {
    active: state.active,
    totalFiles: state.totalFiles,
    completedFiles: state.completedFiles,
    pendingFiles: state.pending.length,
    concurrency: state.active ? getConcurrency() : 0,
    preset: state.preset,
    jobs: jobList,
    lastCompletedAt: state.lastCompletedAt,
  };
}

function recordHistory(inputPath, file, preset, startTime, outputPath, status, errorMsg) {
  let outputSize = 0;
  if (outputPath) {
    try { outputSize = fs.statSync(outputPath).size; } catch {}
  }

  const entry = {
    timestamp: new Date().toISOString(),
    input: inputPath,
    output: outputPath,
    inputSize: file.size || 0,
    outputSize,
    ratio: file.size > 0 ? (outputSize / file.size).toFixed(2) : 'N/A',
    preset: preset.label,
    duration: ((Date.now() - startTime) / 1000).toFixed(1),
    status,
  };
  if (errorMsg) entry.error = errorMsg;
  history.add(entry);
}

async function convertOne(file, preset) {
  const inputPath = file.path || file;
  const startTime = Date.now();
  const totalDurationUs = (file.duration || 0) * 1000000;
  const name = inputPath.split('/').pop();

  // Validate the file exists before starting
  if (!fs.existsSync(inputPath)) {
    console.error(`[queue] Skipping "${name}" — file not found`);
    state.completedFiles++;
    state.lastCompletedAt = Date.now();
    recordHistory(inputPath, file, preset, startTime, null, 'error', 'File not found');
    return;
  }

  state.jobs[inputPath] = { file, progress: {}, startTime };
  console.log(`[queue] Converting: ${name} (${file.codec || '?'}/${file.audioCodec || '?'})`);

  try {
    const outputPath = await convert(inputPath, preset, (prog) => {
      const outTimeUs = parseInt(prog.out_time_us || '0', 10);
      const speed = parseFloat(prog.speed || '0');
      const fps = parseFloat(prog.fps || '0');

      let percent = 0;
      let eta = null;

      if (totalDurationUs > 0 && outTimeUs > 0) {
        percent = Math.min(100, (outTimeUs / totalDurationUs) * 100);
        if (speed > 0) {
          const remainingUs = totalDurationUs - outTimeUs;
          eta = Math.round(remainingUs / (speed * 1000000));
        }
      }

      const encoder = prog.encoder || state.jobs[inputPath].progress.encoder;
      state.jobs[inputPath].progress = { percent, speed, fps, eta, encoder };
    }, file.height || 0, file.audioCodec, file.codec);

    delete state.jobs[inputPath];
    state.completedFiles++;
    state.lastCompletedAt = Date.now();
    console.log(`[queue] Done: ${name}`);
    recordHistory(inputPath, file, preset, startTime, outputPath, 'success');
  } catch (err) {
    delete state.jobs[inputPath];
    state.completedFiles++;
    state.lastCompletedAt = Date.now();
    const status = err.message === 'cancelled' ? 'cancelled' : 'error';
    const errorMsg = status === 'error' ? err.message : null;
    console.error(`[queue] Failed: ${name} — ${err.message}`);
    recordHistory(inputPath, file, preset, startTime, null, status, errorMsg);
  }
}

async function start(files, preset) {
  if (state.active) throw new Error('Conversion already in progress');

  state.active = true;
  state.totalFiles = files.length;
  state.completedFiles = 0;
  state.preset = preset;
  state.jobs = {};
  state.pending = [...files];
  state.cancelled = false;

  const concurrency = getConcurrency();
  console.log(`Starting conversion of ${files.length} file(s), concurrency: ${concurrency}`);

  // Worker loop — each worker pulls from pending
  async function worker() {
    while (state.pending.length > 0 && !state.cancelled) {
      const file = state.pending.shift();
      await convertOne(file, preset);
    }
  }

  // Launch workers up to concurrency limit
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, files.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  state.active = false;
  state.jobs = {};
  state.pending = [];
}

function enqueue(files, preset) {
  if (!state.active) {
    return start(files, preset);
  }
  state.pending.push(...files);
  state.totalFiles += files.length;
  console.log(`Enqueued ${files.length} file(s), ${state.pending.length} now pending`);
  return Promise.resolve();
}

function cancelActive() {
  state.cancelled = true;
  state.pending = [];
  const result = cancelAll();
  state.active = false;
  state.jobs = {};
  return result;
}

module.exports = { start, enqueue, getStatus, cancelActive };
