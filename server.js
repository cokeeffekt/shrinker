const express = require('express');
const path = require('path');
const { listDirectories, scanDirectory, validatePath, MEDIA_ROOT } = require('./lib/scanner');
const { PRESETS, getPreset } = require('./lib/presets');
const { start, getStatus, cancelActive } = require('./lib/queue');
const history = require('./lib/history');
const { detectNvenc, getConcurrency } = require('./lib/converter');
const scheduler = require('./lib/scheduler');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Encoder info
app.get('/api/encoder', async (req, res) => {
  const nvenc = await detectNvenc();
  res.json({ encoder: nvenc ? 'hevc_nvenc' : 'libx265', hwaccel: nvenc, concurrency: getConcurrency() });
});

// List directories (optionally within a parent)
app.get('/api/directories', (req, res) => {
  try {
    res.json(listDirectories(req.query.parent || null));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Return preset definitions
app.get('/api/presets', (req, res) => {
  res.json(PRESETS);
});

// Scan a directory for video files
app.get('/api/scan', async (req, res) => {
  const { dir, preset: presetName } = req.query;
  if (!dir) return res.status(400).json({ error: 'dir parameter required' });

  const preset = getPreset(presetName || '1080p');
  if (!preset) return res.status(400).json({ error: 'Invalid preset' });

  try {
    validatePath(dir);
    const files = await scanDirectory(dir, preset);
    res.json(files);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Start conversion
app.post('/api/convert', (req, res) => {
  const { files, preset: presetName } = req.body;
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files array required' });
  }

  const preset = getPreset(presetName || '1080p');
  if (!preset) return res.status(400).json({ error: 'Invalid preset' });

  // Validate all paths
  try {
    for (const f of files) {
      validatePath(f.path || f);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  start(files, preset).catch(err => {
    console.error('Conversion error:', err.message);
  });

  res.json({ message: 'Conversion started', count: files.length });
});

// Current status
app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

// Cancel active conversion
app.delete('/api/cancel', (req, res) => {
  const cancelled = cancelActive();
  res.json({ cancelled });
});

// History
app.get('/api/history', (req, res) => {
  res.json(history.load());
});

// Schedules
app.get('/api/schedules', (req, res) => {
  res.json(scheduler.load());
});

app.post('/api/schedules', (req, res) => {
  try {
    const entry = scheduler.add(req.body);
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/schedules/:id', (req, res) => {
  try {
    const entry = scheduler.toggle(req.params.id);
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/schedules/:id', (req, res) => {
  scheduler.remove(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Shrinker listening on http://0.0.0.0:${PORT}`);
  console.log(`Media root: ${path.resolve(MEDIA_ROOT)}`);
  console.log(`Directories found: ${listDirectories().map(d => d.name).join(', ') || 'none'}`);
  await detectNvenc();
  scheduler.initAll();
});
