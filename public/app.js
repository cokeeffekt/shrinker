let scannedFiles = [];
let pollTimer = null;

const $ = (id) => document.getElementById(id);

// Restore last preset from localStorage
const saved = localStorage.getItem('shrinker_preset');
if (saved) $('presetSelect').value = saved;

$('presetSelect').addEventListener('change', () => {
  localStorage.setItem('shrinker_preset', $('presetSelect').value);
});

// Load directories on startup
(async function init() {
  try {
    const dirs = await api('/api/directories');
    const sel = $('dirSelect');
    const schedSel = $('schedDirSelect');
    dirs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.path;
      opt.textContent = d.name;
      sel.appendChild(opt);
      schedSel.appendChild(opt.cloneNode(true));
    });
  } catch (e) {
    console.error('Failed to load directories:', e);
  }
  loadHistory();
  checkStatus();
  loadEncoder();
  loadSchedules();
})();

async function loadEncoder() {
  try {
    const info = await api('/api/encoder');
    const badge = $('encoderBadge');
    badge.textContent = info.hwaccel ? `GPU: hevc_nvenc (${info.concurrency}x)` : 'CPU: libx265';
    badge.className = 'encoder-badge ' + (info.hwaccel ? 'hw' : 'sw');
  } catch (e) {
    console.error('Failed to load encoder info:', e);
  }
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

function formatSize(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function scan() {
  const dir = $('dirSelect').value;
  const preset = $('presetSelect').value;
  if (!dir) return;

  $('scanBtn').disabled = true;
  $('scanBtn').textContent = 'Scanning...';

  try {
    const result = await api(`/api/scan?dir=${encodeURIComponent(dir)}&preset=${preset}`);
    if (result.error) {
      alert('Scan error: ' + result.error);
      return;
    }
    scannedFiles = Array.isArray(result) ? result : [];
    renderFiles();
    $('fileList').classList.remove('hidden');
  } catch (e) {
    console.error('Scan error:', e);
  }

  $('scanBtn').disabled = false;
  $('scanBtn').textContent = 'Scan';
}

function renderFiles() {
  const tbody = $('fileTable').querySelector('tbody');
  tbody.innerHTML = '';

  scannedFiles.forEach((f, i) => {
    const tr = document.createElement('tr');
    if (f.skip) tr.className = 'skip';
    tr.innerHTML = `
      <td><input type="checkbox" data-index="${i}" ${f.skip ? '' : 'checked'}></td>
      <td title="${f.path}">${f.name}</td>
      <td>${formatSize(f.size)}</td>
      <td>${f.width}x${f.height}</td>
      <td>${f.codec}</td>
      <td>${formatDuration(f.duration)}</td>
      <td>${f.skip ? 'skip' : 'ready'}</td>
    `;
    tbody.appendChild(tr);
  });

  updateFileCount();
}

function toggleAll(checked) {
  document.querySelectorAll('#fileTable tbody input[type=checkbox]').forEach(cb => {
    cb.checked = checked;
  });
  updateFileCount();
}

function updateFileCount() {
  const selected = document.querySelectorAll('#fileTable tbody input:checked').length;
  $('fileCount').textContent = `${selected} of ${scannedFiles.length} selected`;
}

// Listen for checkbox changes
document.addEventListener('change', (e) => {
  if (e.target.closest('#fileTable tbody')) updateFileCount();
});

async function startConvert() {
  const checkboxes = document.querySelectorAll('#fileTable tbody input:checked');
  const files = [];
  checkboxes.forEach(cb => {
    const idx = parseInt(cb.dataset.index, 10);
    files.push(scannedFiles[idx]);
  });

  if (files.length === 0) return;

  const preset = $('presetSelect').value;
  $('convertBtn').disabled = true;

  await api('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, preset }),
  });

  $('progress').classList.remove('hidden');
  startPolling();
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(checkStatus, 1000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function checkStatus() {
  try {
    const status = await api('/api/status');

    if (status.active) {
      $('progress').classList.remove('hidden');
      startPolling();

      const parallel = status.concurrency > 1 ? ` (${status.concurrency} parallel)` : '';
      $('progressOverall').textContent =
        `${status.completedFiles} of ${status.totalFiles} done, ${status.pendingFiles} queued${parallel}`;

      const jobList = $('jobList');
      jobList.innerHTML = '';

      for (const job of status.jobs) {
        const pct = (job.progress.percent || 0).toFixed(1);
        const div = document.createElement('div');
        div.className = 'job-card';
        div.innerHTML = `
          <div class="job-name" title="${job.file}">${job.name}</div>
          <div class="job-bar-container">
            <div class="job-bar" style="width:${pct}%"></div>
            <span class="job-bar-pct">${pct}%</span>
          </div>
          <div class="job-stats">
            <span>${job.progress.speed ? job.progress.speed + 'x' : ''}</span>
            <span>${job.progress.fps ? job.progress.fps + ' fps' : ''}</span>
            <span>${job.progress.eta != null ? 'ETA: ' + formatDuration(job.progress.eta) : ''}</span>
          </div>
        `;
        jobList.appendChild(div);
      }
    } else {
      if (pollTimer) {
        stopPolling();
        $('convertBtn').disabled = false;
        $('progressOverall').textContent = 'Done';
        $('jobList').innerHTML = '';
        loadHistory();
      }
    }
  } catch (e) {
    console.error('Status check error:', e);
  }
}

async function cancelConvert() {
  await api('/api/cancel', { method: 'DELETE' });
  stopPolling();
  $('convertBtn').disabled = false;
  $('progressOverall').textContent = 'Cancelled';
  $('jobList').innerHTML = '';
  loadHistory();
}

async function loadHistory() {
  try {
    const entries = await api('/api/history');
    const tbody = $('historyTable').querySelector('tbody');
    tbody.innerHTML = '';

    if (entries.length === 0) {
      $('historyEmpty').classList.remove('hidden');
      return;
    }

    $('historyEmpty').classList.add('hidden');

    // Show newest first
    entries.reverse().forEach(e => {
      const tr = document.createElement('tr');
      const statusClass = `status-${e.status}`;
      tr.innerHTML = `
        <td>${new Date(e.timestamp).toLocaleString()}</td>
        <td title="${e.input}">${e.input ? e.input.split('/').pop() : '—'}</td>
        <td>${formatSize(e.inputSize)}</td>
        <td>${formatSize(e.outputSize)}</td>
        <td>${e.ratio !== 'N/A' ? (e.ratio * 100).toFixed(0) + '%' : '—'}</td>
        <td>${e.preset}</td>
        <td class="${statusClass}">${e.status}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

// --- Schedules ---

function formatInterval(minutes) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${minutes / 60}h`;
  return `${minutes / 1440}d`;
}

async function loadSchedules() {
  try {
    const schedules = await api('/api/schedules');
    const tbody = $('schedTable').querySelector('tbody');
    tbody.innerHTML = '';

    if (!Array.isArray(schedules) || schedules.length === 0) {
      $('schedTable').classList.add('hidden');
      $('schedEmpty').classList.remove('hidden');
      return;
    }

    $('schedTable').classList.remove('hidden');
    $('schedEmpty').classList.add('hidden');

    schedules.forEach(s => {
      const tr = document.createElement('tr');
      if (!s.enabled) tr.className = 'sched-disabled';
      tr.innerHTML = `
        <td>${s.directoryName}</td>
        <td>${s.preset}</td>
        <td>${formatInterval(s.intervalMinutes)}</td>
        <td>${s.lastRun ? new Date(s.lastRun).toLocaleString() : '—'}</td>
        <td>${s.lastFileCount || '—'}</td>
        <td>
          <button class="btn-sm btn-toggle ${s.enabled ? 'active' : ''}" onclick="toggleSchedule('${s.id}')">${s.enabled ? 'On' : 'Off'}</button>
        </td>
        <td>
          <button class="btn-sm btn-remove" onclick="removeSchedule('${s.id}')">Remove</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('Failed to load schedules:', e);
  }
}

async function addSchedule() {
  const directory = $('schedDirSelect').value;
  const preset = $('schedPresetSelect').value;
  const intervalMinutes = parseInt($('schedInterval').value, 10);

  if (!directory) return;

  const result = await api('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory, preset, intervalMinutes }),
  });

  if (result.error) {
    alert('Error: ' + result.error);
    return;
  }

  loadSchedules();
}

async function toggleSchedule(id) {
  await api(`/api/schedules/${id}`, { method: 'PATCH' });
  loadSchedules();
}

async function removeSchedule(id) {
  await api(`/api/schedules/${id}`, { method: 'DELETE' });
  loadSchedules();
}
