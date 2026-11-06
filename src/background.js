// YT Ad Mute & Skip - service worker (MV3, no ES modules)
// Performs trusted mouse clicks via chrome.debugger (CDP).

const attachedTabs = new Set();
const detachTimers = new Map();

const IDLE_DETACH_MS = 8000;
const EVENT_DELAY_MS = 30;

function warn(...args) {
  console.warn("[YT-AdSkip][bg]", ...args);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureAttached(tabId) {
  return new Promise((resolve, reject) => {
    if (attachedTabs.has(tabId)) {
      resolve();
      return;
    }
    chrome.debugger.attach({ tabId }, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        const msg = err.message || String(err);
        if (msg.indexOf("already attached") !== -1) {
          attachedTabs.add(tabId);
          resolve();
          return;
        }
        reject(new Error(msg));
        return;
      }
      attachedTabs.add(tabId);
      resolve();
    });
  });
}

function sendCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      resolve(result);
    });
  });
}

function clearTabState(tabId) {
  attachedTabs.delete(tabId);
  const timer = detachTimers.get(tabId);
  if (timer !== undefined) {
    clearTimeout(timer);
    detachTimers.delete(tabId);
  }
}

function scheduleIdleDetach(tabId) {
  const existing = detachTimers.get(tabId);
  if (existing !== undefined) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    detachTimers.delete(tabId);
    try {
      chrome.debugger.detach({ tabId }, () => {
        // Read lastError to suppress "unchecked runtime.lastError" noise.
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // Ignore detach errors.
    }
    attachedTabs.delete(tabId);
  }, IDLE_DETACH_MS);
  detachTimers.set(tabId, timer);
}

async function clickAt(tabId, x, y) {
  await ensureAttached(tabId);

  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y
  });
  await delay(EVENT_DELAY_MS);

  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await delay(EVENT_DELAY_MS);

  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1
  });

  scheduleIdleDetach(tabId);
}

chrome.debugger.onDetach.addListener((source) => {
  if (source && typeof source.tabId === "number") {
    clearTabState(source.tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "YT_SKIP_CLICK") {
    return false;
  }
  if (!sender || !sender.tab || typeof sender.tab.id !== "number") {
    return false;
  }

  const tabId = sender.tab.id;
  const x = message.x;
  const y = message.y;

  if (typeof x !== "number" || typeof y !== "number" ||
      !Number.isFinite(x) || !Number.isFinite(y)) {
    sendResponse({ ok: false, error: "bad coordinates" });
    return false;
  }

  clickAt(tabId, x, y)
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((err) => {
      const msg = err && err.message ? err.message : String(err);
      warn("click failed:", msg);
      // A failed command may mean the debugger session is gone; force re-attach next time.
      clearTabState(tabId);
      sendResponse({ ok: false, error: msg });
    });

  return true; // async response
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["enabled", "stats"], (items) => {
    if (chrome.runtime.lastError) {
      warn("storage get failed:", chrome.runtime.lastError.message);
      return;
    }
    const toSet = {};
    if (typeof items.enabled === "undefined") {
      toSet.enabled = true;
    }
    if (typeof items.stats === "undefined") {
      toSet.stats = { adsSkipped: 0, adsMuted: 0 };
    }
    if (Object.keys(toSet).length > 0) {
      chrome.storage.local.set(toSet, () => {
        if (chrome.runtime.lastError) {
          warn("storage set failed:", chrome.runtime.lastError.message);
        }
      });
    }
  });
});
