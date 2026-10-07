// YouTube ad blocking for the desktop app, in three layers:
//  1. Network: ad servers and ad-tracking endpoints are cancelled before they load.
//  2. Player data: ad slots are stripped from YouTube's player responses, so the player
//     never schedules an ad (the same idea as uBlock Origin's json-prune scriptlet).
//  3. Fallback: if an ad still starts, it is muted, fast-forwarded and skipped.
// Plus cosmetic hiding of sponsored results in the YouTube search window.
'use strict';

const AD_URL_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.googletagservices.com/*',
  '*://*.moatads.com/*',
  '*://imasdk.googleapis.com/*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/get_midroll_*',
  '*://*.youtube.com/youtubei/v1/player/ad_break*',
  '*://*.youtube-nocookie.com/api/stats/ads*',
  '*://*.youtube-nocookie.com/pagead/*',
  '*://www.google.com/pagead/*',
  '*://www.google.com/adsense/*',
];

// The in-page part (layers 2 and 3) lives in preload.cjs, because sandboxed preloads
// can't require local files.

const COSMETIC_CSS = `
ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-search-pyv-renderer, ytd-banner-promo-renderer,
ytd-statement-banner-renderer, ytd-merch-shelf-renderer, ytd-player-legacy-desktop-watch-ads-renderer,
#masthead-ad, #player-ads, .ytp-ad-overlay-container, .ytp-ad-module, .ytd-companion-slot-renderer,
ytd-rich-item-renderer:has(ytd-ad-slot-renderer), ytd-reel-shelf-renderer:has([is-ad]) { display: none !important; }
`;

module.exports = { AD_URL_PATTERNS, COSMETIC_CSS };
