// The Ultimate YT Brain
let wasMutedByScript = false;
let extensionEnabled = true; // default ON
let wasAdPlaying = false; // tracks ad state transitions for the skip counter

// Load saved on/off state
chrome.storage.sync.get(['extensionEnabled'], (result) => {
    extensionEnabled = result.extensionEnabled !== false;
});

// React instantly when the popup toggle is flipped
chrome.storage.onChanged.addListener((changes) => {
    if (changes.extensionEnabled) {
        extensionEnabled = changes.extensionEnabled.newValue;
    }
});

// Bridge to background.js for hardware-level clicks
function godClick(element) {
    const rect = element.getBoundingClientRect();
    chrome.runtime.sendMessage({
        action: "god_click",
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2)
    });
}

setInterval(() => {
    if (!extensionEnabled) return; // OFF switch — do nothing

    let video = document.querySelector('video');
    let skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
    let xBtn = document.querySelector('.ytp-ad-overlay-close-button');
    let moviePlayer = document.getElementById('movie_player');

    // The Golden Rule: This detects 100% of YouTube ads
    let isAdPlaying = moviePlayer && moviePlayer.classList.contains('ad-showing');

    // PRIORITY 1: Always snipe the 'X' banner
    if (xBtn) godClick(xBtn);

    if (isAdPlaying) {
        wasAdPlaying = true; // remember we were in an ad, for the skip counter

        // PRIORITY 2: Press the Skip button the exact millisecond it exists
        if (skipBtn) {
            godClick(skipBtn);
        }

        // PRIORITY 3: Mute and Fast-Forward
        if (video) {
            // Drop volume to 0 and remember that the script did it
            if (!video.muted) {
                video.muted = true;      
                wasMutedByScript = true; 
            }
            // Blast through unskippable ads at maximum browser speed
            video.playbackRate = 16;     
        }

    } else {
        
        // The ad just ended — log one skip for the counters
        if (wasAdPlaying) {
            chrome.runtime.sendMessage({ action: "ad_skipped" });
            wasAdPlaying = false;
        }

        // PRIORITY 4: Ad is completely gone. Restore Video & Audio!
        if (video) {
            // Return video to normal 1x speed
            if (video.playbackRate > 1) {
                video.playbackRate = 1;  
            }
            // Un-mute the video (ONLY if our script was the one that muted it)
            if (wasMutedByScript) {
                video.muted = false;     
                wasMutedByScript = false;
            }
        }
    }
}, 100); // Lightning fast: Scans the screen 10 times every single second
