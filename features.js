// features.js — Feature Registry for Tab1 (Top10)
// Each feature defines: id, label, sort, limit, apiPattern, mapRaw, sheetHeader, toRow

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

function buildImageUrl(img) {
  if (!img) return '';
  var s = String(img);
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://cf.shopee.vn/file/' + s;
}

window.ShopeeFeatures = {
  product_top10: {
    id: 'product_top10',
    label: '🛒 Sản phẩm Bán chạy',
    sort: 'sales',
    limit: 60,
    apiPattern: 'search_items',

    mapRaw: function(it) {
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
    },

    sheetHeader: ['Thời gian', 'Keyword', 'STT', 'Tên sản phẩm', 'Giá (VNĐ)', 'Đã bán', 'Shop', 'Rating', 'URL'],

    toRow: function(item, idx, ctx) {
      return [
        ctx.ts || '',
        ctx.keyword || '',
        idx + 1,
        item.name || '',
        item.price || 0,
        item.sold || 0,
        item.shop || '',
        Math.round((item.rating || 0) * 10) / 10,
        item.url || ''
      ];
    },

    columns: [
      {key:'name', label:'Tên sản phẩm'},
      {key:'price', label:'Giá'},
      {key:'sold', label:'Đã bán'},
      {key:'shop', label:'Shop'},
      {key:'rating', label:'Rating'},
      {key:'url', label:'URL'}
    ]
  }
};
