(() => {
  "use strict";

  if (window.__ytAdSkipLoaded) return;
  window.__ytAdSkipLoaded = true;

  const LOG = "[YT-AdSkip][content]";

  // ---------- Module state ----------
  let enabled = true;
  let inAd = false;
  let savedMuted = null;
  let lastClickAt = 0;
  let stopped = false;
  let rafScheduled = false;
  let intervalId = null;
  let observer = null;
  let skipping = false; // guards against overlapping async skip attempts

  // ---------- Helpers ----------
  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function shutdown() {
    if (stopped) return;
    stopped = true;
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (observer) {
      try { observer.disconnect(); } catch (e) { /* ignore */ }
      observer = null;
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    return true;
  }

  function hasClientRects(el) {
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  // ---------- Detection ----------
  function isAdPlaying() {
    if (document.querySelector(".html5-video-player.ad-showing")) return true;
    if (document.querySelector(".html5-video-player.ad-interrupting")) return true;
    const nodes = document.querySelectorAll(
      ".ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-text, .ytp-ad-preview-text, .ytp-ad-simple-ad-badge"
    );
    for (const n of nodes) {
      if (hasClientRects(n)) return true;
    }
    return false;
  }

  function getVideo() {
    return (
      document.querySelector("#movie_player video.html5-main-video") ||
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video")
    );
  }

  const SKIP_SELECTORS = [
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-container button",
    "button.ytp-ad-skip-button-modern",
    ".ytp-skip-ad button"
  ];

  function findSkipButton() {
    for (const sel of SKIP_SELECTORS) {
      const list = document.querySelectorAll(sel);
      for (const el of list) {
        if (isVisible(el)) return el;
      }
    }
    // Text fallback
    const player = document.querySelector("#movie_player");
    if (player) {
      const buttons = player.querySelectorAll("button");
      for (const b of buttons) {
        const text = (b.textContent || "").trim().toLowerCase();
        if (text.startsWith("skip") && isVisible(b)) return b;
      }
    }
    return null;
  }

  // ---------- Storage ----------
  function incrementStat(key) {
    try {
      if (!contextAlive()) return;
      chrome.storage.local.get("stats", (res) => {
        try {
          if (chrome.runtime.lastError || !contextAlive()) return;
          const stats = Object.assign(
            { adsSkipped: 0, adsMuted: 0 },
            (res && res.stats) || {}
          );
          stats[key] = (Number(stats[key]) || 0) + 1;
          chrome.storage.local.set({ stats }, () => {
            void chrome.runtime.lastError; // swallow
          });
        } catch (e) { /* ignore */ }
      });
    } catch (e) {
      /* context invalidated or storage unavailable: ignore silently */
    }
  }

  function loadEnabled() {
    try {
      chrome.storage.local.get("enabled", (res) => {
        try {
          if (chrome.runtime.lastError) return;
          enabled = !res || res.enabled === undefined ? true : !!res.enabled;
          tick();
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.enabled) return;
      const v = changes.enabled.newValue;
      enabled = v === undefined ? true : !!v;
      tick();
    });
  } catch (e) { /* ignore */ }

  // ---------- Mute / restore ----------
  function restoreMute() {
    if (savedMuted !== null) {
      const video = getVideo();
      if (video) video.muted = savedMuted;
    }
    savedMuted = null;
    inAd = false;
  }

  // ---------- Skip ----------
  function pressSkip(button) {
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    let settled = false;
    const fallbackClick = () => {
      if (settled) return;
      settled = true;
      skipping = false;
      try {
        button.click();
        console.log(LOG, "skip via button.click() fallback");
        incrementStat("adsSkipped");
      } catch (e) { /* ignore */ }
    };
    const success = () => {
      if (settled) return;
      settled = true;
      skipping = false;
      console.log(LOG, "skip click sent", Math.round(x), Math.round(y));
      incrementStat("adsSkipped");
    };

    try {
      chrome.runtime.sendMessage({ type: "YT_SKIP_CLICK", x, y }, (reply) => {
        try {
          if (chrome.runtime.lastError) return fallbackClick();
          if (reply && reply.ok === true) return success();
          return fallbackClick();
        } catch (e) {
          fallbackClick();
        }
      });
    } catch (e) {
      if (!contextAlive()) {
        skipping = false;
        shutdown();
        return;
      }
      fallbackClick();
    }
  }

  // ---------- Main loop ----------
  function tick() {
    try {
      if (stopped) return;
      if (!contextAlive()) {
        shutdown();
        return;
      }

      if (!enabled) {
        if (inAd || savedMuted !== null) {
          console.log(LOG, "disabled mid-ad, restoring mute state");
          restoreMute();
        }
        return;
      }

      const adNow = isAdPlaying();
      const video = getVideo();

      if (adNow && !inAd) {
        // not-in-ad -> in-ad
        inAd = true;
        if (video) {
          if (savedMuted === null) savedMuted = video.muted;
          video.muted = true;
        }
        console.log(LOG, "ad started");
        incrementStat("adsMuted");
      } else if (adNow && inAd) {
        if (video) {
          if (savedMuted === null) savedMuted = video.muted; // video appeared late
          if (!video.muted) video.muted = true;
        }
      } else if (!adNow && inAd) {
        restoreMute();
        console.log(LOG, "ad ended");
      }

      if (inAd && !skipping) {
        const btn = findSkipButton();
        if (btn && Date.now() - lastClickAt > 800) {
          lastClickAt = Date.now();
          skipping = true;
          pressSkip(btn);
          // Safety release in case no callback ever fires
          setTimeout(() => { skipping = false; }, 2000);
        }
      }
    } catch (e) {
      if (!contextAlive()) shutdown();
      // otherwise swallow to keep the loop alive
    }
  }

  function scheduleTick() {
    if (rafScheduled || stopped) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      tick();
    });
  }

  function startObserver() {
    if (observer || stopped) return;
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", startObserver, { once: true });
      return;
    }
    observer = new MutationObserver(scheduleTick);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  }

  // ---------- Init ----------
  loadEnabled();
  startObserver();
  intervalId = setInterval(tick, 250);
  window.addEventListener("yt-navigate-finish", tick);
  document.addEventListener("visibilitychange", tick);
  tick();
})();
