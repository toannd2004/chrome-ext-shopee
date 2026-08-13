// test_mapRaw.js — Test mapRaw function with sample Shopee API data
// Run: node test_mapRaw.js

// Copy of mapRaw from background.js (must match exactly)
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

  var rating = (d.item_rating && d.item_rating.rating_star) ||
    (b.item_rating && b.item_rating.rating_star) ||
    b.rating_star || it.rating_star || 0;
  rating = parseFloat(rating) || 0;
  if (rating > 5 && rating <= 50) rating = rating / 10;

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

var passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + msg); }
}

// === TEST 1: New API format (item_card_displayed_asset) ===
var newApiItem = {
  item_card_displayed_asset: {
    name: 'Máy In 3D Bambu Lab A1',
    display_price: { price: 10263000000 },
    image: 'abc123hash'
  },
  item_data: {
    itemid: 26269889884,
    shopid: 123456789,
    shop_data: { shop_name: '3DThinking Store' },
    item_rating: { rating_star: 4.82 },
    item_card_display_sold_count: { historical_sold_count: 4000 }
  }
};

var r1 = mapRaw(newApiItem);
assert(r1.id === 26269889884, 'T1: id từ item_data');
assert(r1.name === 'Máy In 3D Bambu Lab A1', 'T1: name từ asset');
assert(r1.price === 102630, 'T1: price / 100000 = ' + r1.price);
assert(r1.sold === 4000, 'T1: sold từ historical_sold_count');
assert(r1.shop === '3DThinking Store', 'T1: shop từ shop_data');
assert(r1.rating === 4.82, 'T1: rating từ item_rating');
assert(r1.image === 'https://cf.shopee.vn/file/abc123hash', 'T1: image URL');
assert(r1.url.indexOf('shopee.vn/') > -1 && r1.url.indexOf('-i.123456789.26269889884') > -1, 'T1: URL format');
console.log('  T1 result:', JSON.stringify(r1));

// === TEST 2: Old API format (item_basic) ===
var oldApiItem = {
  item_basic: {
    itemid: 987654321,
    shopid: 111222333,
    name: 'Khẩu trang 3D YOKI',
    price: 2590000,  // xu → 25900 VNĐ
    historical_sold: 15000,
    shop_name: 'YOKI Official',
    rating_star: 4.75,
    image: 'def456hash'
  }
};

var r2 = mapRaw(oldApiItem);
assert(r2.id === 987654321, 'T2: id từ item_basic');
assert(r2.name === 'Khẩu trang 3D YOKI', 'T2: name từ item_basic');
assert(r2.price === 25900, 'T2: price / 100 = ' + r2.price);
assert(r2.sold === 15000, 'T2: sold từ historical_sold');
assert(r2.shop === 'YOKI Official', 'T2: shop từ shop_name');
assert(r2.rating === 4.75, 'T2: rating từ rating_star');
assert(r2.image === 'https://cf.shopee.vn/file/def456hash', 'T2: image URL');
console.log('  T2 result:', JSON.stringify(r2));

// === TEST 3: DOM scrape format (item_basic wrapper) ===
var domItem = {
  item_basic: {
    itemid: 555,
    shopid: 666,
    name: 'Sản phẩm test DOM',
    price: 15500000,  // VNĐ*100 (xu)
    historical_sold: 2500,
    shop_name: '',
    rating_star: 0,
    image: ''
  }
};

var r3 = mapRaw(domItem);
assert(r3.id === 555, 'T3: id từ DOM item');
assert(r3.name === 'Sản phẩm test DOM', 'T3: name');
assert(r3.price === 155000, 'T3: price VNĐ');
assert(r3.sold === 2500, 'T3: sold');
assert(r3.shop === '', 'T3: empty shop');
assert(r3.rating === 0, 'T3: rating 0');
assert(r3.image === '', 'T3: empty image');
console.log('  T3 result:', JSON.stringify(r3));

// === TEST 4: Edge case — missing name ===
var noName = {
  item_data: { itemid: 1, shopid: 2 },
  item_card_displayed_asset: {}
};
var r4 = mapRaw(noName);
assert(r4.name === '', 'T4: empty name when missing');

// === TEST 5: Edge case — null/undefined ===
var r5 = mapRaw(null);
assert(r5.name === '', 'T5: handles null');
var r6 = mapRaw({});
assert(r6.name === '', 'T6: handles empty object');

// === TEST 6: URL encoding ===
var urlItem = {
  item_card_displayed_asset: { name: 'Sản Phẩm & Đặc Biệt', display_price: { price: 10000000 }, image: 'x' },
  item_data: { itemid: 100, shopid: 200, item_card_display_sold_count: { historical_sold_count: 100 } }
};
var r7 = mapRaw(urlItem);
assert(r7.url.indexOf('S%E1%BA%A3n-Ph%E1%BA%A9m-%26-%C4%90%E1%BA%B7c-Bi%E1%BB%87t') > -1, 'T7: URL encoded Vietnamese');

// === TEST 7: rating/sold still in item_basic while name/price in new format ===
var hybridItem = {
  item_card_displayed_asset: { name: 'Sản phẩm lai', display_price: { price: 5000000 }, image: 'hashA' },
  item_data: { itemid: 111, shopid: 222, shop_data: { shop_name: 'Shop Lai' } },
  item_basic: { rating_star: 4.7, historical_sold: 3200 }
};
var r8 = mapRaw(hybridItem);
assert(r8.rating === 4.7, 'T7: rating falls back to item_basic when new format has none');
assert(r8.sold === 3200, 'T7: sold falls back to item_basic');

// === TEST 8: sold as formatted string ===
var stringSoldItem = {
  item_basic: { itemid: 333, shopid: 444, name: 'SP chuỗi', price: 100000, historical_sold: '1,2k' }
};
var r9 = mapRaw(stringSoldItem);
assert(r9.sold === 1200, 'T8: sold "1,2k" → 1200');
var r9b = mapRaw({ item_basic: { itemid: 333, shopid: 444, name: 'SP', price: 100000, historical_sold: '1,2tr' } });
assert(r9b.sold === 1200000, 'T8: sold "1,2tr" → 1200000');

// === TEST 9: image already absolute (DOM scrape) must not be double-prefixed ===
var domImageItem = {
  item_basic: {
    itemid: 555, shopid: 666, name: 'SP ảnh', price: 6270000,
    historical_sold: 0, rating_star: 4.8,
    image: 'https://down-vn.img.susercontent.com/file/sg-11134201-abc'
  }
};
var r10 = mapRaw(domImageItem);
assert(r10.image === 'https://down-vn.img.susercontent.com/file/sg-11134201-abc', 'T9: absolute image URL kept as-is');
assert(r10.price === 62700, 'T9: DOM price 6270000 → 62700 VNĐ');

// === TEST 10: integer rating normalized (48 → 4.8) ===
var intRatingItem = {
  item_basic: { itemid: 777, shopid: 888, name: 'SP rating', price: 100000, rating_star: 48 }
};
var r11 = mapRaw(intRatingItem);
assert(r11.rating === 4.8, 'T10: integer rating 48 → 4.8');

// === TEST 11: sold uses displayed text ("11 đã bán/tháng"), not historical 304 ===
var displayedSoldItem = {
  item_card_displayed_asset: {
    name: 'SP sold display', display_price: { price: 140800000000 }, image: 'h',
    sold_count: { text: '11 đã bán/tháng' }
  },
  item_data: {
    itemid: 111, shopid: 222, shop_data: { shop_name: 'KiwiKey.vn' },
    item_rating: { rating_star: 5 },
    item_card_display_sold_count: { historical_sold_count: 304, monthly_sold_count: 11 }
  }
};
var r12 = mapRaw(displayedSoldItem);
assert(r12.sold === 11, 'T11: sold from "11 đã bán/tháng" → 11 (not 304)');

// === TEST 12: "4k+ đã bán" display text ===
var kSoldItem = {
  item_card_displayed_asset: {
    name: 'SP k', display_price: { price: 10000000 }, image: 'h',
    sold_count: { text: '4k+ đã bán' }
  },
  item_data: { itemid: 222, shopid: 333, item_card_display_sold_count: { historical_sold_count: 4000 } }
};
var r13 = mapRaw(kSoldItem);
assert(r13.sold === 4000, 'T12: sold from "4k+ đã bán" → 4000');

// === SUMMARY ===
console.log('\n=== mapRaw Tests: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
