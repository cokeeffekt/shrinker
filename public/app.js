let scannedFiles = [];
let pollTimer = null;

const $ = (id) => document.getElementById(id);

// Restore last preset from localStorage
const saved = localStorage.getItem('shrinker_preset');
if (saved) $('presetSelect').value = saved;

$('presetSelect').addEventListener('change', () => {
  localStorage.setItem('shrinker_preset', $('presetSelect').value);
});

// --- Directory Picker ---

function createDirPicker(breadcrumbEl, listEl) {
  const state = { path: null, name: null, ancestors: [] };
  // ancestors: [{ path, name }] — does not include current

  async function navigate(dirPath, dirName) {
    if (dirPath && state.path) {
      state.ancestors.push({ path: state.path, name: state.name });
    }
    if (!dirPath) {
      state.ancestors = [];
    }
    state.path = dirPath;
    state.name = dirName;
    await render();
  }

  function goTo(index) {
    // index -1 = root, 0..n = ancestor index
    if (index === -1) {
      state.path = null;
      state.name = null;
      state.ancestors = [];
    } else {
      const target = state.ancestors[index];
      state.path = target.path;
      state.name = target.name;
      state.ancestors = state.ancestors.slice(0, index);
    }
    render();
  }

  async function render() {
    // Breadcrumb
    breadcrumbEl.innerHTML = '';
    const root = document.createElement('span');
    root.textContent = 'Media';
    if (state.path) {
      root.addEventListener('click', () => goTo(-1));
    } else {
      root.className = 'current';
    }
    breadcrumbEl.appendChild(root);

    for (let i = 0; i < state.ancestors.length; i++) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = ' / ';
      breadcrumbEl.appendChild(sep);
      const crumb = document.createElement('span');
      crumb.textContent = state.ancestors[i].name;
      crumb.addEventListener('click', () => goTo(i));
      breadcrumbEl.appendChild(crumb);
    }

    if (state.path) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = ' / ';
      breadcrumbEl.appendChild(sep);
      const current = document.createElement('span');
      current.className = 'current';
      current.textContent = state.name;
      breadcrumbEl.appendChild(current);
    }

    // Subdirectory list
    const url = state.path
      ? `/api/directories?parent=${encodeURIComponent(state.path)}`
      : '/api/directories';
    try {
      const dirs = await api(url);
      listEl.innerHTML = '';
      if (dirs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dir-empty';
        empty.textContent = 'No subdirectories';
        listEl.appendChild(empty);
      } else {
        dirs.forEach(d => {
          const entry = document.createElement('div');
          entry.className = 'dir-entry';
          entry.innerHTML = `<span class="folder-icon">&#128193;</span> ${escapeHtml(d.name)}`;
          entry.addEventListener('click', () => navigate(d.path, d.name));
          listEl.appendChild(entry);
        });
      }
    } catch (e) {
      console.error('Failed to load directories:', e);
    }
  }

  render();
  return { getPath: () => state.path, render };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const scanPicker = createDirPicker($('scanBreadcrumb'), $('scanDirList'));
const schedPicker = createDirPicker($('schedBreadcrumb'), $('schedDirList'));

// Load on startup
(async function init() {
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
  const dir = scanPicker.getPath();
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
    const summary = $('historySummary');
    tbody.innerHTML = '';

    if (entries.length === 0) {
      $('historyEmpty').classList.remove('hidden');
      summary.classList.add('hidden');
      return;
    }

    $('historyEmpty').classList.add('hidden');

    // Compute summary
    const successful = entries.filter(e => e.status === 'success');
    const totalDuration = entries.reduce((sum, e) => sum + parseFloat(e.duration || 0), 0);
    const totalInput = successful.reduce((sum, e) => sum + (e.inputSize || 0), 0);
    const totalOutput = successful.reduce((sum, e) => sum + (e.outputSize || 0), 0);
    const saved = totalInput - totalOutput;

    summary.classList.remove('hidden');
    summary.innerHTML = `
      <span><span class="stat-label">Converted:</span><span class="stat-value">${successful.length} / ${entries.length} files</span></span>
      <span><span class="stat-label">Total time:</span><span class="stat-value">${formatDuration(totalDuration)}</span></span>
      <span><span class="stat-label">Saved:</span><span class="stat-value positive">${formatSize(saved)}</span></span>
      <span><span class="stat-label">Size:</span><span class="stat-value">${formatSize(totalInput)} → ${formatSize(totalOutput)}</span></span>
    `;

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
        <td class="${statusClass}" ${e.error ? `title="${escapeHtml(e.error)}"` : ''}>${e.status}${e.error ? ' *' : ''}</td>
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
  const directory = schedPicker.getPath();
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
