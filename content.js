// content.js — ISOLATED world: Image extraction from Shopee product detail pages (Tab2)
// Extract product images from gallery section + product name
// Also listens for extractImages message from sidepanel
(function() {
  'use strict';

  if (window.__shopeeExtLoaded) return;
  window.__shopeeExtLoaded = true;

  function extractImages() {
    try {
      var images = [];
      var seen = new Set();

      // Try XPath to gallery section first
      var gallery = null;
      try {
        var xpath = '/html/body/div[1]/div/div[2]/div/div/div[1]/div/div/div/div[2]/section/section[1]';
        var result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        gallery = result.singleNodeValue;
      } catch(e) {}

      // If XPath failed, search whole document
      var container = gallery || document;

      // Find all images
      var imgs = container.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].src || imgs[i].getAttribute('data-src') || '';
        if (!src) continue;

        // Only images from Shopee CDN
        if (src.indexOf('susercontent.com/file/') === -1) continue;

        // Clean URL: remove _tn suffix, _NxN size, query params
        var clean = src
          .replace(/_tn$/, '')
          .replace(/_\d+x\d+/, '')
          .split('?')[0];

        if (!seen.has(clean)) {
          seen.add(clean);
          images.push(clean);
        }
      }

      // Extract product name from h1
      var name = '';
      var h1 = document.querySelector('h1');
      if (h1) {
        name = (h1.textContent || '').trim();
        // Remove "Shopee Việt Nam" suffix
        name = name.replace(/\s*\|\s*Shopee\s+Việt\s+Nam\s*$/i, '').trim();
        name = name.substring(0, 80);
      }

      return {
        success: images.length > 0,
        images: images,
        name: name || 'unknown-product'
      };
    } catch(e) {
      return { success: false, images: [], name: '', error: e.message };
    }
  }

  // Listen for extract request from sidepanel
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg && msg.action === 'extractImages') {
      var result = extractImages();
      sendResponse(result);
      return true; // Keep channel open for async
    }
  });
})();
