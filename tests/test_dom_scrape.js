// test_dom_scrape.js — Test DOM scrape + picker logic with fixture HTML
// Run: node test_dom_scrape.js
// Requires: npm install jsdom (or skip if not installed)

try {
  var { JSDOM } = require('jsdom');

  // Fixture HTML simulating Shopee search results
  var html = '<!DOCTYPE html><html><body>' +
    // Product 1
    '<div class="shopee-search-item-result">' +
      '<a href="https://shopee.vn/M%C3%A1y-In-3D-Bambu-Lab-A1-i.123456789.26269889884" title="Máy In 3D Bambu Lab A1">' +
        '<img src="https://cf.shopee.vn/file/abc123" alt="">' +
      '</a>' +
      '<div class="item-info">' +
        '<span>Máy In 3D Bambu Lab A1</span>' +
        '<span class="price">10.263.000₫</span>' +
        '<span>Đã bán 4k</span>' +
        '<span class="shop-name">3DThinking</span>' +
        '<span class="rating">4.8</span>' +
      '</div>' +
    '</div>' +
    // Product 2
    '<div class="shopee-search-item-result">' +
      '<a href="https://shopee.vn/Kh%E1%BA%A9u-trang-3D-YOKI-i.111222333.987654321">' +
        '<img src="https://cf.shopee.vn/file/def456" alt="">' +
      '</a>' +
      '<div class="item-info">' +
        '<span>Khẩu trang 3D YOKI Mask</span>' +
        '<span class="price">25.700₫</span>' +
        '<span>Đã bán 15k</span>' +
        '<span class="shop-name">YOKI Official</span>' +
        '<span class="rating">4.9</span>' +
      '</div>' +
    '</div>' +
    // Product 3 — edge case: price with 2k+ đã bán/tháng
    '<div class="shopee-search-item-result">' +
      '<a href="https://shopee.vn/PETG-1.75mm-3D-i.333444555.111111111">' +
        '<img src="https://cf.shopee.vn/file/ghi789" alt="">' +
      '</a>' +
      '<div class="item-info">' +
        '<span>PETG 1.75mm 3D</span>' +
        '<span class="price">260.167₫</span>' +
        '<span>2k+ đã bán/tháng</span>' +
        '<span class="shop-name">Filament VN</span>' +
        '<span class="rating">4.7</span>' +
      '</div>' +
    '</div>' +
  '</body></html>';

  var dom = new JSDOM(html, { url: 'https://shopee.vn/search?keyword=3d&sortBy=sales' });
  var document = dom.window.document;

  // === Test DOM scrape functions ===
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

  var passed = 0, failed = 0;
  function assert(cond, msg) {
    if (cond) { passed++; }
    else { failed++; console.error('FAIL: ' + msg); }
  }

  // Test price parsing
  assert(parsePriceVNĐ('10.263.000₫') === 10263000, 'Price: 10.263.000₫ → 10263000');
  assert(parsePriceVNĐ('25.700₫') === 25700, 'Price: 25.700₫ → 25700');
  assert(parsePriceVNĐ('260.167₫') === 260167, 'Price: 260.167₫ → 260167');
  assert(parsePriceVNĐ('1.234.567.890₫') === 1234567890, 'Price: large number');
  assert(parsePriceVNĐ('no price') === 0, 'Price: no match → 0');

  // Test sold parsing
  assert(parseSold('Đã bán 4k') === 4000, 'Sold: Đã bán 4k → 4000');
  assert(parseSold('Đã bán 15k') === 15000, 'Sold: Đã bán 15k → 15000');
  assert(parseSold('2k+ đã bán/tháng') === 2000, 'Sold: 2k+ đã bán/tháng → 2000');
  assert(parseSold('Đã bán 587') === 587, 'Sold: Đã bán 587 → 587');
  assert(parseSold('Đã bán 1.200') === 1200, 'Sold: Đã bán 1.200 → 1200');
  assert(parseSold('no sold') === 0, 'Sold: no match → 0');

  // Test link regex
  var links = document.querySelectorAll('a[href*="-i."]');
  assert(links.length >= 3, 'Links: found ' + links.length + ' product links');

  // Test extract itemid/shopid from href
  var href1 = links[0].href;
  var m1 = href1.match(/[\/-]i\.(\d+)\.(\d+)/);
  assert(m1 !== null, 'Regex: matches /i.SHOP.ITEM');
  assert(m1[1] === '123456789', 'ShopID: ' + m1[1]);
  assert(m1[2] === '26269889884', 'ItemID: ' + m1[2]);

  console.log('\n=== DOM Scrape Tests: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);

} catch(e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('SKIP: jsdom not installed. Run: npm install jsdom');
    console.log('These tests verify DOM scraping logic offline.');
    process.exit(0);
  }
  throw e;
}
