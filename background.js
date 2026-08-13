// background.js — Unified Service Worker for Ext-Shopee
// Tab1 (Top10): scan management, API/DOM capture, picker enrichment
// Tab2 (Ảnh & Drive): Drive upload, affiliate link generation

// ============ Debug Log ============
var MAX_LOG = 50;

function dbg(msg) {
  chrome.storage.local.get(['debugLog'], function(r) {
    var log = r.debugLog || [];
    var ts = new Date().toISOString().slice(11, 23);
    log.push(ts + ' ' + msg);
    if (log.length > MAX_LOG) log = log.slice(-MAX_LOG);
    chrome.storage.local.set({ debugLog: log });
  });
}

// ============ mapRaw (shared with features.js — must stay in sync) ============
// Normalize a sold count that may be a number or a formatted string ("1,2k", "1.2tr")
function parseSoldValue(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Math.round(v);
  var m = String(v).trim().match(/([\d\.,]+)\s*([kKmM]|[tT][rR])?/);
  if (!m) return 0;
  var n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  var u = (m[2] || '').toLowerCase();
  if (u === 'k') n *= 1000;
  else if (u === 'm' || u === 'tr') n *= 1000000;
  return Math.round(n);
}

// Build image URL without double-prefixing already-absolute URLs
function buildImageUrl(img) {
  if (!img) return '';
  var s = String(img);
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://cf.shopee.vn/file/' + s;
}

function mapRaw(it) {
  if (!it || typeof it !== 'object') return { id: '', name: '', price: 0, sold: 0, shop: '', rating: 0, image: '', url: '' };
  var a = it.item_card_displayed_asset || {};
  var d = it.item_data || {};
  var b = it.item_basic || it.item || {};
  var isNew = !!(a.name || d.itemid != null);

  var name = a.name || b.name || it.name || it.title || '';

  var price;
  if (isNew) {
    price = Math.round(Number((a.display_price && a.display_price.price) ||
      (d.item_card_display_price && d.item_card_display_price.price) || 0) / 100000);
  } else {
    price = Math.round(Number(b.price != null ? b.price : 0) / 100);
  }

  var itemid = isNew ? d.itemid : (b.itemid || it.itemid);
  var shopid = isNew ? d.shopid : (b.shopid || it.shopid);

  // rating — try every known location regardless of format
  var rating = (d.item_rating && d.item_rating.rating_star) ||
    (b.item_rating && b.item_rating.rating_star) ||
    b.rating_star || it.rating_star || 0;
  rating = parseFloat(rating) || 0;
  if (rating > 5 && rating <= 50) rating = rating / 10; // some endpoints return 48 for 4.8

  // sold — prefer the exact text Shopee shows on the card ("11 đã bán/tháng"),
  // not the all-time historical_sold_count which the UI no longer surfaces
  var sold = parseSoldValue(a.sold_count && a.sold_count.text);
  if (!sold) {
    var sc = d.item_card_display_sold_count;
    var soldRaw = (sc && (sc.monthly_sold_count || sc.historical_sold_count)) ||
      (b.historical_sold != null ? b.historical_sold : b.sold) ||
      it.sold || 0;
    sold = parseSoldValue(soldRaw);
  }

  var shop = (d.shop_data && d.shop_data.shop_name) || b.shop_name || '';
  var image = buildImageUrl(a.image || b.image || it.image);

  return {
    id: itemid || '',
    name: name,
    price: price,
    sold: sold,
    shop: shop,
    rating: rating,
    image: image,
    url: (itemid && shopid)
      ? ('https://shopee.vn/' + encodeURIComponent(String(name).replace(/\s+/g, '-')) + '-i.' + shopid + '.' + itemid)
      : ''
  };
}

// ============ Tab1: Scan Management ============
var pending = null;

function finalize() {
  if (!pending) return;
  var p = pending;
  pending = null;

  var status, items;
  if (p.best) {
    items = p.best.items;
    status = 'XONG: ' + items.length + ' sản phẩm';
  } else {
    items = [];
    status = 'LỖI: không bắt được dữ liệu (xem Debug log)';
  }

  var result = {
    feature: p.feature,
    keyword: p.keyword,
    items: items,
    ts: Date.now(),
    source: p.best ? p.best.source : 'none'
  };

  chrome.storage.local.set({
    lastResult: result,
    scanStatus: status,
    pendingScan: false,
    pendingKeyword: ''
  });
  dbg('finalize: ' + status + ' source=' + result.source);
}

function processItems(raw, source, kind) {
  // Find items array at multiple possible locations (Shopee keeps changing the structure)
  var items = null;

  // Direct paths
  if (raw.items && Array.isArray(raw.items)) items = raw.items;
  else if (raw.data && raw.data.items && Array.isArray(raw.data.items)) items = raw.data.items;
  else if (raw.response && raw.response.items && Array.isArray(raw.response.items)) items = raw.response.items;
  // Nested: data.sections[].data.item[] (Shopee's newer paginated format)
  else if (raw.data && raw.data.sections && Array.isArray(raw.data.sections)) {
    for (var i = 0; i < raw.data.sections.length; i++) {
      var sec = raw.data.sections[i];
      if (sec && sec.data && sec.data.item && Array.isArray(sec.data.item)) {
        items = sec.data.item; break;
      }
      if (sec && sec.data && sec.data.items && Array.isArray(sec.data.items)) {
        items = sec.data.items; break;
      }
    }
  }

  if (!items || items.length === 0) {
    dbg(kind + ': no items array found. raw keys: ' + Object.keys(raw || {}).join(', '));
    return;
  }

  // Always store raw for debug & picker enrichment (keep API/DOM separate so
  // the DOM scrape running in the background doesn't overwrite the API payload)
  if (source === 'api') {
    chrome.storage.local.set({ lastRaw: raw });
  } else {
    chrome.storage.local.set({ lastRawDom: raw });
  }

  // Log structure of first item for debugging
  if (items[0]) {
    dbg(kind + ': ' + items.length + ' items. item[0] keys: ' + Object.keys(items[0]).join(', '));
  }

  var mapped = items.map(mapRaw).filter(function(it) { return it && it.name; });
  dbg(kind + ': mapRaw → ' + mapped.length + ' items (filtered from ' + items.length + ')');

  // Update pending best result
  if (pending && Date.now() < pending.until) {
    var isBetter = !pending.best
      || mapped.length > pending.best.items.length
      || (mapped.length === pending.best.items.length && source === 'api' && pending.best.source !== 'api');

    if (isBetter) {
      pending.best = { items: mapped, source: source };
      var result = {
        feature: pending.feature,
        keyword: pending.keyword,
        items: mapped,
        ts: Date.now(),
        source: source
      };
      chrome.storage.local.set({ lastResult: result, scanStatus: 'Đã bắt: ' + mapped.length + ' SP (từ ' + source + ')' });
      dbg('best updated: ' + mapped.length + ' items from ' + source);
    }
  }
}

// ============ Tab2: Affiliate Link ============
function waitForTabLoad(tabId) {
  return new Promise(function(resolve, reject) {
    chrome.tabs.get(tabId, function(tab) {
      if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
      if (tab.status === 'complete') { resolve(); return; }

      var listener = function(updatedId, info) {
        if (updatedId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Timeout after 15s
      setTimeout(function() {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Timeout waiting for tab load'));
      }, 15000);
    });
  });
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// The function that runs in MAIN world of affiliate tab
function fetchAffiliateLinkInTab(originUrl) {
  var capturedLink = null;
  var timeout = null;

  function cleanup() {
    if (timeout) clearTimeout(timeout);
  }

  // Hook clipboard
  var origWriteText = navigator.clipboard.writeText;
  navigator.clipboard.writeText = function(text) {
    var m = text.match(/https?:\/\/s\.shopee\.vn\/[\w-]+/);
    if (m) capturedLink = m[0];
    return origWriteText.call(navigator.clipboard, text);
  };

  // Hook execCommand
  var origExec = document.execCommand;
  document.execCommand = function(cmd) {
    if (cmd === 'copy') {
      var sel = document.getSelection();
      if (sel) {
        var m = (sel.toString() || '').match(/https?:\/\/s\.shopee\.vn\/[\w-]+/);
        if (m) capturedLink = m[0];
      }
    }
    return origExec.call(document, cmd);
  };

  // Find URL textarea and fill
  var textareas = document.querySelectorAll('textarea');
  for (var i = 0; i < textareas.length; i++) {
    if (textareas[i].offsetParent !== null && !textareas[i].disabled) {
      // Use native setter
      var desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (desc && desc.set) {
        desc.set.call(textareas[i], originUrl);
      } else {
        textareas[i].value = originUrl;
      }
      textareas[i].dispatchEvent(new Event('input', { bubbles: true }));
      textareas[i].dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
  }

  // Click "Lấy link" button
  var buttons = document.querySelectorAll('button');
  for (var j = 0; j < buttons.length; j++) {
    if (buttons[j].offsetParent !== null && !buttons[j].disabled) {
      var txt = (buttons[j].textContent || '').trim();
      if (/lấy\s*link/i.test(txt)) {
        buttons[j].click();
        break;
      }
    }
  }

  // MutationObserver to find "Sao chép Link" button when popup appears
  return new Promise(function(resolve) {
    var observer = new MutationObserver(function() {
      var btns = document.querySelectorAll('button');
      for (var k = 0; k < btns.length; k++) {
        var t = (btns[k].textContent || '').trim();
        if (/sao\s*chép\s*link/i.test(t) && btns[k].offsetParent !== null) {
          btns[k].click();
        }
      }
      if (capturedLink) {
        observer.disconnect();
        cleanup();
        resolve({ link: capturedLink });
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    timeout = setTimeout(function() {
      observer.disconnect();
      cleanup();
      resolve({ link: null, error: 'Timeout: không tìm thấy nút "Sao chép Link"' });
    }, 15000);
  });
}

async function shopeeAffiliateLink(originUrl) {
  var tab;
  try {
    tab = await chrome.tabs.create({
      url: 'https://affiliate.shopee.vn/offer/custom_link',
      active: false
    });
    await waitForTabLoad(tab.id);
    await sleep(3000);

    var results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchAffiliateLinkInTab,
      args: [originUrl],
      world: 'MAIN'
    });

    var result = (results && results[0] && results[0].result) || {};
    return result;
  } catch (e) {
    return { link: null, error: e.message || 'Lỗi affiliate' };
  } finally {
    if (tab) {
      try { chrome.tabs.remove(tab.id); } catch(e) {}
    }
  }
}

// ============ Message Router ============
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  // Tab1 messages
  if (msg.type === 'HOOK_ITEMS' || msg.type === 'DOM_ITEMS') {
    var source = msg.type === 'HOOK_ITEMS' ? 'api' : 'dom';
    processItems(msg.raw, source, msg.type);
    return false;
  }

  if (msg.type === 'START_SCAN') {
    pending = {
      feature: msg.feature || 'product_top10',
      keyword: msg.keyword || '',
      until: Date.now() + 20000,
      best: null
    };
    chrome.storage.local.set({
      pendingScan: true,
      pendingKeyword: msg.keyword || '',
      activeFeature: pending.feature,
      scanStatus: 'Đang quét...',
      lastResult: null,
      lastRaw: null,
      lastRawDom: null
    });
    dbg('START_SCAN: feature=' + pending.feature + ' keyword=' + pending.keyword);
    setTimeout(finalize, 20000);
    return false;
  }

  if (msg.type === 'PICKER_ITEM') {
    var it = msg.item;
    if (!it || !it.id) return false;

    dbg('PICKER_ITEM: id=' + it.id + ' name=' + (it.name || '?').slice(0, 40));

    // Cross-reference with API data
    chrome.storage.local.get(['pickedItems', 'lastRaw'], function(r) {
      if (r.lastRaw && r.lastRaw.items) {
        // Find matching API items
        var rawItems = r.lastRaw.items;
        for (var i = 0; i < rawItems.length; i++) {
          var ri = rawItems[i];
          var apiId = (ri.item_data && ri.item_data.itemid)
            || (ri.item_basic && ri.item_basic.itemid)
            || (ri.item && ri.item.itemid) || '';
          if (String(apiId) === String(it.id)) {
            var apiMapped = mapRaw(ri);
            if (apiMapped && apiMapped.name) {
              it.name = apiMapped.name;
              it.price = apiMapped.price;
              it.sold = apiMapped.sold;
              it.shop = apiMapped.shop || it.shop;
              it.rating = apiMapped.rating || it.rating;
              if (apiMapped.image) it.image = apiMapped.image;
              if (apiMapped.url) it.url = apiMapped.url;
              dbg('PICKER_ITEM enriched: shop=' + it.shop + ' rating=' + it.rating);
            }
            break;
          }
        }
      }

      var arr = (r.pickedItems || []).filter(function(x) { return String(x.id) !== String(it.id); });
      arr.push(it);
      chrome.storage.local.set({ pickedItems: arr });
    });
    return false;
  }

  if (msg.type === 'PICKER_UNSELECT') {
    chrome.storage.local.get(['pickedItems'], function(r) {
      var arr = (r.pickedItems || []).filter(function(x) { return String(x.id) !== String(msg.item.id); });
      chrome.storage.local.set({ pickedItems: arr });
    });
    return false;
  }

  if (msg.type === 'DBG') {
    dbg('[page] ' + msg.msg);
    return false;
  }

  // Tab2: Affiliate link
  if (msg.type === 'GENERATE_AFFILIATE') {
    shopeeAffiliateLink(msg.url).then(function(result) {
      sendResponse(result);
    }).catch(function(e) {
      sendResponse({ link: null, error: e.message });
    });
    return true; // Async
  }

  // Tab2: Drive upload (handled via sidepanel directly calling Drive lib)
  // The sidepanel has sheets.js which can getToken, and Drive lib for upload

  return false;
});

// ============ Side panel setup ============
chrome.runtime.onInstalled.addListener(function() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function() {});
  dbg('Ext-Shopee installed');
});
