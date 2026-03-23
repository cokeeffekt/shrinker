const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');
const MAX_ENTRIES = 1000;

function load() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const entries = JSON.parse(raw);
    // Dedupe by input path, keeping the latest entry
    const map = new Map();
    for (const e of entries) {
      map.set(e.input, e);
    }
    // Return newest first
    return [...map.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch {
    return [];
  }
}

function save(entries) {
  const trimmed = entries.slice(-MAX_ENTRIES);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2));
}

function add(entry) {
  const entries = load();
  const idx = entries.findIndex(e => e.input === entry.input);
  if (idx !== -1) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  save(entries);
}

module.exports = { load, add };
