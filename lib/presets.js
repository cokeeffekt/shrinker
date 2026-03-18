const PRESETS = {
  '480p': { width: 854, height: 480, crf: 28, label: '480p' },
  '720p': { width: 1280, height: 720, crf: 23, label: '720p' },
  '1080p': { width: 1920, height: 1080, crf: 23, label: '1080p' },
  '1440p': { width: 2560, height: 1440, crf: 22, label: '1440p' },
  '4k': { width: 3840, height: 2160, crf: 20, label: '4K' },
};

function getPreset(name) {
  return PRESETS[name.toLowerCase()] || null;
}

module.exports = { PRESETS, getPreset };
