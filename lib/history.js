const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');
const MAX_ENTRIES = 1000;

function load() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    return JSON.parse(raw);
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
  entries.push(entry);
  save(entries);
}

module.exports = { load, add };
