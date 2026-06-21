let attachedTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "god_click" && sender.tab) {
        let tabId = sender.tab.id;
        
        // Attach the debugger if it isn't attached yet
        if (!attachedTabs.has(tabId)) {
            chrome.debugger.attach({tabId: tabId}, "1.3", () => {
                if (chrome.runtime.lastError) return; // Ignore errors if already attached
                attachedTabs.add(tabId);
                fireHardwareClick(tabId, message.x, message.y);
            });
        } else {
            fireHardwareClick(tabId, message.x, message.y);
        }
    }

    if (message.action === "ad_skipped" && sender.tab) {
        let tabId = sender.tab.id;
        let sessionKey = "session_" + tabId;

        // Per-tab session count (lives in storage.session, cleared automatically per browser session)
        chrome.storage.session.get([sessionKey], (result) => {
            let current = result[sessionKey] || 0;
            chrome.storage.session.set({ [sessionKey]: current + 1 });
        });

        // All-time total (lives in storage.local, never resets on its own)
        chrome.storage.local.get(["totalSkipped"], (result) => {
            let total = result.totalSkipped || 0;
            chrome.storage.local.set({ totalSkipped: total + 1 });
        });
    }
});

function fireHardwareClick(tabId, x, y) {
    // 1. Press the mouse down
    chrome.debugger.sendCommand({tabId: tabId}, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: x,
        y: y,
        button: "left",
        clickCount: 1
    }, () => {
        // 2. Release the mouse (Completes the hardware click)
        chrome.debugger.sendCommand({tabId: tabId}, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: x,
            y: y,
            button: "left",
            clickCount: 1
        });
    });
}

// Clean up if the tab closes
chrome.debugger.onDetach.addListener((source) => {
    attachedTabs.delete(source.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    attachedTabs.delete(tabId);
    chrome.storage.session.remove("session_" + tabId);
});