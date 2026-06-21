const toggle = document.getElementById('toggle');
const statusLabel = document.getElementById('statusLabel');
const sessionCountEl = document.getElementById('sessionCount');
const totalCountEl = document.getElementById('totalCount');

let currentTabId = null;

function updateLabel(isOn) {
  statusLabel.textContent = isOn ? 'ON' : 'OFF';
  statusLabel.className = 'status-label ' + (isOn ? 'status-on' : 'status-off');
}

// Load saved on/off state
chrome.storage.sync.get(['extensionEnabled'], (result) => {
  const isOn = result.extensionEnabled !== false;
  toggle.checked = isOn;
  updateLabel(isOn);
});

// Save state whenever the switch is flipped
toggle.addEventListener('change', () => {
  const isOn = toggle.checked;
  chrome.storage.sync.set({ extensionEnabled: isOn });
  updateLabel(isOn);
});

// Figure out which tab the popup belongs to, then load its session count
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs && tabs[0]) {
    currentTabId = tabs[0].id;
    const sessionKey = "session_" + currentTabId;
    chrome.storage.session.get([sessionKey], (result) => {
      sessionCountEl.textContent = result[sessionKey] || 0;
    });
  }
});

// All-time total
chrome.storage.local.get(['totalSkipped'], (result) => {
  totalCountEl.textContent = result.totalSkipped || 0;
});

// Live refresh: update counters the instant a new ad is skipped, no reopen needed
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && currentTabId !== null) {
    const sessionKey = "session_" + currentTabId;
    if (changes[sessionKey]) {
      sessionCountEl.textContent = changes[sessionKey].newValue || 0;
    }
  }
  if (areaName === 'local' && changes.totalSkipped) {
    totalCountEl.textContent = changes.totalSkipped.newValue || 0;
  }
});
