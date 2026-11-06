(() => {
  "use strict";

  const ACTIVE_TEXT = "Active: muting and skipping YouTube ads";
  const PAUSED_TEXT = "Paused";

  // Current known state (used as fallback in onChanged)
  let currentEnabled = true;
  let currentStats = { adsSkipped: 0, adsMuted: 0 };

  function normalizeEnabled(v) {
    return v === undefined || v === null ? true : !!v;
  }

  function normalizeStats(s) {
    const src = s && typeof s === "object" ? s : {};
    const skipped = Number(src.adsSkipped);
    const muted = Number(src.adsMuted);
    return {
      adsSkipped: Number.isFinite(skipped) && skipped > 0 ? skipped : 0,
      adsMuted: Number.isFinite(muted) && muted > 0 ? muted : 0
    };
  }

  function render(enabled, stats) {
    currentEnabled = normalizeEnabled(enabled);
    currentStats = normalizeStats(stats);

    const toggle = document.getElementById("toggle-enabled");
    const status = document.getElementById("status-text");
    const skipped = document.getElementById("stat-skipped");
    const muted = document.getElementById("stat-muted");

    if (toggle) toggle.checked = currentEnabled;
    if (status) status.textContent = currentEnabled ? ACTIVE_TEXT : PAUSED_TEXT;
    if (skipped) skipped.textContent = String(currentStats.adsSkipped);
    if (muted) muted.textContent = String(currentStats.adsMuted);

    document.body.classList.toggle("paused", !currentEnabled);
  }

  function init() {
    const toggle = document.getElementById("toggle-enabled");
    const resetBtn = document.getElementById("btn-reset");

    try {
      chrome.storage.local.get(["enabled", "stats"], (res) => {
        if (chrome.runtime.lastError) {
          render(true, null);
          return;
        }
        render(res && res.enabled, res && res.stats);
      });
    } catch (e) {
      render(true, null);
    }

    if (toggle) {
      toggle.addEventListener("change", () => {
        const checked = !!toggle.checked;
        try {
          chrome.storage.local.set({ enabled: checked }, () => {
            void chrome.runtime.lastError;
          });
        } catch (e) { /* ignore */ }
        render(checked, currentStats);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const zero = { adsSkipped: 0, adsMuted: 0 };
        try {
          chrome.storage.local.set({ stats: zero }, () => {
            void chrome.runtime.lastError;
          });
        } catch (e) { /* ignore */ }
        render(currentEnabled, zero);
      });
    }

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes) return;
        if (!changes.enabled && !changes.stats) return;

        const nextEnabled = changes.enabled
          ? changes.enabled.newValue
          : currentEnabled;
        const nextStats = changes.stats
          ? changes.stats.newValue
          : currentStats;

        render(nextEnabled, nextStats);
      });
    } catch (e) { /* ignore */ }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
