// dom.js — MAIN world: DOM scrape fallback + Picker overlay (click-to-select on page)
(function() {
  'use strict';

  var KEY = '__shopeeScrape';
  var DBG_KEY = '__shopeeDbg';

  function dbg(msg) {
    try { window.postMessage({ __tag: DBG_KEY, msg: String(msg) }, '*'); } catch(e) {}
  }

  function emit(items, kind) {
    if (!items || items.length === 0) return;
    try {
      window.postMessage({ __tag: KEY, kind: kind, raw: { items: items } }, '*');
    } catch(e) {}
  }

  // ============ Helpers ============
  function parsePriceVNĐ(txt) {
    var m = String(txt || '').match(/(\d[\d.,]*)\s*₫/);
    if (!m) return 0;
    return parseInt(m[1].replace(/\./g, ''), 10) || 0;
  }

  function parseSold(txt) {
    var t = String(txt || '');
    var m = t.match(/Đã\s*bán\s*([\d\.,]+)\s*([kK])?\+?/i);
    if (m) { var v = parseFloat(m[1].replace(/\./g,'').replace(',','.'))||0; return Math.round(m[2]?v*1000:v); }
    var m2 = t.match(/([\d\.,]+)\s*([kK])?\+?\s*đã\s*bán/i);
    if (m2) { var v2 = parseFloat(m2[1].replace(/\./g,'').replace(',','.'))||0; return Math.round(m2[2]?v2*1000:v2); }
    return 0;
  }

  // Extract itemid+shopid from href — supports multiple Shopee URL formats
  function extractIds(href) {
    if (!href) return null;
    // Format: /i.SHOPID.ITEMID or -i.SHOPID.ITEMID
    var m = href.match(/[\/-]i\.(\d+)\.(\d+)/);
    if (m) return { shopid: m[1], itemid: m[2] };
    // Format: /product/SHOPID/ITEMID (newer Shopee format)
    m = href.match(/\/product\/(\d+)\/(\d+)/);
    if (m) return { shopid: m[1], itemid: m[2] };
    // Format: ?sp_atk=... or any URL with two consecutive numeric IDs
    return null;
  }

  // Check if this element or its ancestors is a product link
  function findProductAnchor(el) {
    var a = el;
    while (a && a !== document.body && a !== document.documentElement) {
      if (a.tagName === 'A') {
        var href = a.href || a.getAttribute('href') || '';
        if (href) {
          var ids = extractIds(href);
          if (ids) { a._pk_ids = ids; return a; }
        }
      }
      a = a.parentElement;
    }
    return null;
  }

  // Find card container (ancestor with ₫ price text)
  function findCard(a) {
    var el = a;
    for (var up = 0; up < 8; up++) {
      if (!el.parentElement) break;
      el = el.parentElement;
      var txt = el.textContent || '';
      if (txt.indexOf('₫') > -1) return el;
    }
    return a; // fallback to a itself
  }

  // Extract clean product name: prefer anchor title / image alt / data-sqe,
  // fallback to card text minus junk (price, sold, rating, shop name, location)
  function pickName(a, card) {
    var name = ((a && (a.title || a.getAttribute('title'))) || '').trim();
    if (name.length < 3 && card) {
      var img = card.querySelector('img');
      if (img) name = (img.getAttribute('alt') || '').trim();
    }
    if (name.length < 3 && card) {
      var nameEl = card.querySelector('[data-sqe="name"]');
      if (nameEl) name = (nameEl.textContent || '').trim();
    }
    if (name.length >= 3) return name;

    var txt = card ? (card.textContent || '') : '';
    var clean = txt
      .replace(/[\d.,]+\s*₫/g, ' ')
      .replace(/Đã\s*bán\s*[\d.,kK]+\+?/gi, ' ')
      .replace(/[\d.,kK]+\+?\s*đã\s*bán(\s*\/?\s*tháng?)?/gi, ' ')
      .replace(/\d+(?:[.,]\d+)?\s*Đánh\s*giá\s*shop[\s\S]*?(?:Tìm\s*sản\s*phẩm\s*tương\s*tự|$)/gi, ' ')
      .replace(/\d+(?:[.,]\d+)?\s*Đánh\s*giá[\s\S]*?(?:Tìm\s*sản\s*phẩm\s*tương\s*tự|$)/gi, ' ')
      .replace(/Đánh\s*giá\s*shop/gi, ' ')
      .replace(/Tìm\s*sản\s*phẩm\s*tương\s*tự/gi, ' ')
      .replace(/\S+\.vn\b/gi, ' ')
      .replace(/\b(?:Thành\s*phố\s*Hồ\s*Chí\s*Minh|Hà\s*Nội|Đà\s*Nẵng|Hải\s*Phòng|Cần\s*Thơ|Nước\s*ngoài)\b/gi, ' ')
      .replace(/-\d{1,3}%/g, ' ')
      .replace(/Hàng\s*mới\s*về/gi, ' ')
      .replace(/Mua\s*\d+\s*&\s*giảm\s*\d+%/gi, ' ')
      .replace(/\s+\d[.,]\d\s*$/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (clean.length >= 3) return clean;
    return name;
  }

  // Shop name: only trust explicit data-sqe attribute (Shopee class names are obfuscated)
  function pickShop(card) {
    var el = card.querySelector('[data-sqe="shop-name"], [data-sqe="shop_name"]');
    return el ? (el.textContent || '').trim() : '';
  }

  // Rating: "4.7 Đánh giá", "★4.8", or standalone decimal
  function pickRating(card) {
    var allText = (card.textContent || '') + ' ';
    var rm = allText.match(/[★⭐]\s*(\d[.,]\d)/);
    if (!rm) rm = allText.match(/(\d[.,]\d)\s*[★⭐]/);
    if (!rm) rm = allText.match(/(\d+(?:[.,]\d+)?)\s*Đánh\s*giá/);
    if (!rm) rm = allText.match(/(?:^|\s)(\d[.,]\d)(?:\s|$|Đ)/);
    if (rm) {
      var rv = parseFloat(rm[1].replace(',', '.'));
      if (rv >= 0.1 && rv <= 5.0) return rv;
    }
    var stars = card.querySelectorAll('svg[class*="star"], svg[fill*="#ee"], .shopee-rating-stars svg, svg.star');
    if (stars.length >= 1 && stars.length <= 5) return stars.length;
    return 0;
  }

  // ============ DOM Scrape (fallback) ============
  function scrape() {
    var links = document.querySelectorAll('a[href*="-i."], a[href*="/i."]');
    if (links.length === 0) links = document.querySelectorAll('a[data-sqe="link"]');
    if (links.length === 0) return [];

    var seen = new Set();
    var items = [];

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var ids = extractIds(a.href || '');
      if (!ids) continue;
      var key = ids.shopid + '.' + ids.itemid;
      if (seen.has(key)) continue;
      seen.add(key);

      var card = findCard(a);
      var txt = card ? (card.textContent || '') : '';
      if (txt.indexOf('₫') === -1) continue;

      var name = pickName(a, card);
      var price = parsePriceVNĐ(txt);
      var sold = parseSold(txt);
      if (sold === 0 && card && card.parentElement) {
        sold = parseSold(card.parentElement.textContent || '');
      }
      var rating = pickRating(card);
      var shop = pickShop(card);

      var imgEl = card.querySelector('img');
      var image = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';

      items.push({
        item_basic: {
          itemid: parseInt(ids.itemid, 10),
          shopid: parseInt(ids.shopid, 10),
          name: name,
          price: price * 100,
          historical_sold: sold,
          shop_name: shop,
          rating_star: rating,
          image: image
        }
      });
    }

    return items;
  }

  // Batch scrape
  var _scrapeCount = 0;
  var _scrapeInterval = null;

  function startScrape() {
    _scrapeCount = 0;
    if (_scrapeInterval) clearInterval(_scrapeInterval);
    _scrapeInterval = setInterval(function() {
      _scrapeCount++;
      var items = scrape();
      if (items.length > 0) emit(items, 'dom');
      if (_scrapeCount >= 30) { clearInterval(_scrapeInterval); _scrapeInterval = null; }
    }, 800);
  }

  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function() {
      var items = scrape();
      if (items.length > 0) emit(items, 'dom');
    });
    try { observer.observe(document.documentElement, { childList: true, subtree: true }); } catch(e) {}
  }

  startScrape();

  // ============ Picker Mode ============
  var _pickerOverlay = null;
  var _pickerBanner = null;
  var _pickerActive = false;

  function pickerScrape(a) {
    var href = a.href || '';
    var ids = a._pk_ids || extractIds(href);
    if (!ids) { dbg('picker: no ids in href=' + href.slice(0, 80)); return null; }
    var itemid = ids.itemid, shopid = ids.shopid;

    var card = findCard(a);
    var txt = card ? (card.textContent || '') : '';

    // Parse name — use title attr first, then text parse
    var name = pickName(a, card);

    var price = parsePriceVNĐ(txt);
    var sold = parseSold(txt);
    if (sold === 0 && card && card.parentElement) {
      sold = parseSold(card.parentElement.textContent || '');
    }

    var shop = pickShop(card);
    var rating = pickRating(card);

    var imgEl = card.querySelector('img');
    var img = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';

    dbg('picker: scraped id=' + itemid + ' name=' + (name || '(empty)').slice(0, 50) + ' price=' + price);

    return {
      id: itemid,
      name: name || ('SP-' + itemid),  // NEVER return empty name
      price: price,
      sold: sold,
      shop: shop,
      rating: rating,
      image: img.startsWith('http') ? img : (img ? 'https://cf.shopee.vn/file/' + img : ''),
      url: href
    };
  }

  function toggleSelection(a) {
    var isSelected = a.getAttribute('data-pk-selected') === '1';

    if (isSelected) {
      a.style.outline = '';
      a.removeAttribute('data-pk-selected');
      var badge = a.querySelector('.pk-badge');
      if (badge) badge.remove();
      try {
        window.postMessage({ __tag: KEY, kind: 'picker', item: { id: a.getAttribute('data-pk-id') || '' }, selected: false }, '*');
      } catch(e) {}
      dbg('picker: unselected id=' + (a.getAttribute('data-pk-id') || '?'));
      return;
    }

    // Select
    var item = pickerScrape(a);
    if (!item) { dbg('picker: pickerScrape returned null'); return; }

    a.style.outline = '3px solid #2bb673';
    a.style.outlineOffset = '-3px';
    a.style.position = a.style.position || 'relative';
    a.setAttribute('data-pk-selected', '1');
    a.setAttribute('data-pk-id', item.id);

    var badge = document.createElement('div');
    badge.className = 'pk-badge';
    badge.style.cssText = 'position:absolute;top:2px;right:2px;width:22px;height:22px;background:#2bb673;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;z-index:999999;pointer-events:none;';
    badge.textContent = '✓';
    a.appendChild(badge);

    try {
      window.postMessage({ __tag: KEY, kind: 'picker', item: item, selected: true }, '*');
      dbg('picker: posted PICKER_ITEM id=' + item.id + ' name=' + item.name.slice(0, 40));
    } catch(e) { dbg('picker: postMessage error: ' + e.message); }
  }

  function activatePicker() {
    if (_pickerActive) { dbg('picker: already active, skip'); return; }
    _pickerActive = true;

    // Banner
    _pickerBanner = document.createElement('div');
    _pickerBanner.id = 'spk-banner';
    _pickerBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#2bb673;color:white;text-align:center;padding:8px;font-size:14px;font-weight:600;';
    _pickerBanner.textContent = '🟢 Click vào SP trên trang để thêm';
    (document.body || document.documentElement).insertBefore(_pickerBanner, (document.body || document.documentElement).firstChild);

    // Overlay
    _pickerOverlay = document.createElement('div');
    _pickerOverlay.id = 'spk-overlay';
    _pickerOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.05);cursor:pointer;';
    (document.body || document.documentElement).appendChild(_pickerOverlay);

    _pickerOverlay.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _pickerOverlay.style.display = 'none';

      // Try multiple times to handle lazy rendering
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) {
        // Retry after small delay
        _pickerOverlay.style.display = '';
        dbg('picker: elementFromPoint returned null at ' + e.clientX + ',' + e.clientY);
        return;
      }

      _pickerOverlay.style.display = '';

      var a = findProductAnchor(el);
      if (!a) {
        dbg('picker: no product anchor found under ' + (el.tagName || '?') + ' at ' + e.clientX + ',' + e.clientY);
        return;
      }

      dbg('picker: found anchor href=' + (a.href || '').slice(0, 80));
      toggleSelection(a);
    });

    dbg('Picker activated — overlay + banner ready');
  }

  function deactivatePicker() {
    if (_pickerOverlay) { _pickerOverlay.remove(); _pickerOverlay = null; }
    if (_pickerBanner) { _pickerBanner.remove(); _pickerBanner = null; }
    var selected = document.querySelectorAll('[data-pk-selected]');
    for (var i = 0; i < selected.length; i++) {
      selected[i].style.outline = '';
      selected[i].removeAttribute('data-pk-selected');
      var b = selected[i].querySelector('.pk-badge');
      if (b) b.remove();
    }
    _pickerActive = false;
    dbg('Picker deactivated');
  }

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'PICKER_MODE') {
      dbg('picker: received PICKER_MODE active=' + e.data.active);
      if (e.data.active) activatePicker();
      else deactivatePicker();
    }
  });

  dbg('dom.js loaded, scraper + picker ready');
})();
