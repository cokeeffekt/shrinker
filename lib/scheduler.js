const fs = require('fs');
const path = require('path');
const { scanDirectory, validatePath } = require('./scanner');
const { getPreset } = require('./presets');
const { enqueue } = require('./queue');

const SCHEDULES_PATH = path.join(__dirname, '..', 'data', 'schedules.json');

const timers = {};

function load() {
  try {
    const raw = fs.readFileSync(SCHEDULES_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function save(schedules) {
  fs.writeFileSync(SCHEDULES_PATH, JSON.stringify(schedules, null, 2));
}

function add(schedule) {
  validatePath(schedule.directory);
  const preset = getPreset(schedule.preset);
  if (!preset) throw new Error('Invalid preset');

  const minutes = parseInt(schedule.intervalMinutes, 10);
  if (!minutes || minutes < 1) throw new Error('Interval must be at least 1 minute');

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    directory: schedule.directory,
    directoryName: path.basename(schedule.directory),
    preset: schedule.preset,
    intervalMinutes: minutes,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastRun: null,
    lastFileCount: 0,
  };

  const schedules = load();
  schedules.push(entry);
  save(schedules);
  startTimer(entry);
  return entry;
}

function remove(id) {
  stopTimer(id);
  const schedules = load().filter(s => s.id !== id);
  save(schedules);
}

function toggle(id) {
  const schedules = load();
  const entry = schedules.find(s => s.id === id);
  if (!entry) throw new Error('Schedule not found');

  entry.enabled = !entry.enabled;
  save(schedules);

  if (entry.enabled) {
    startTimer(entry);
  } else {
    stopTimer(id);
  }

  return entry;
}

async function runSchedule(entry) {
  const preset = getPreset(entry.preset);
  if (!preset) return;

  console.log(`[scheduler] Scanning "${entry.directoryName}" (${entry.preset})`);

  try {
    const files = await scanDirectory(entry.directory, preset);
    const eligible = files.filter(f => !f.skip);

    // Update last run info
    const schedules = load();
    const stored = schedules.find(s => s.id === entry.id);
    if (stored) {
      stored.lastRun = new Date().toISOString();
      stored.lastFileCount = eligible.length;
      save(schedules);
    }

    if (eligible.length === 0) {
      console.log(`[scheduler] No new files to convert in "${entry.directoryName}"`);
      return;
    }

    console.log(`[scheduler] Auto-queuing ${eligible.length} files in "${entry.directoryName}"`);
    enqueue(eligible, preset).catch(err => {
      console.error(`[scheduler] Conversion error:`, err.message);
    });
  } catch (err) {
    console.error(`[scheduler] Scan error for "${entry.directoryName}":`, err.message);
  }
}

function startTimer(entry) {
  stopTimer(entry.id);
  if (!entry.enabled) return;

  const ms = entry.intervalMinutes * 60 * 1000;
  console.log(`[scheduler] Started: "${entry.directoryName}" every ${entry.intervalMinutes}m (${entry.preset})`);

  // Run immediately on first start, then on interval
  runSchedule(entry);
  timers[entry.id] = setInterval(() => runSchedule(entry), ms);
}

function stopTimer(id) {
  if (timers[id]) {
    clearInterval(timers[id]);
    delete timers[id];
  }
}

function initAll() {
  const schedules = load();
  let count = 0;
  for (const entry of schedules) {
    if (entry.enabled) {
      startTimer(entry);
      count++;
    }
  }
  if (count > 0) {
    console.log(`[scheduler] Loaded ${count} active schedule(s)`);
  }
}

module.exports = { load, add, remove, toggle, initAll };
