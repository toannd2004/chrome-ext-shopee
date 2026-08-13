# Ext-Shopee

Extension Chrome (Manifest V3) dùng để **tìm kiếm sản phẩm trên Shopee**, **lưu dữ liệu sản phẩm vào Google Sheet**, **trích xuất ảnh sản phẩm lên Google Drive** và **tạo link Affiliate**.

> Công cụ phục vụ quy trình khai thác sản phẩm Shopee của NetB/Timn.

---

## 1. Tính năng

Side panel gồm 3 tab:

| Tab | Tên | Chức năng |
|-----|-----|-----------|
| Tab 1 | 🛒 Top10 | Tìm kiếm sản phẩm, bắt dữ liệu (tên, giá, số bán, shop, rating, URL), lưu vào Google Sheet |
| Tab 2 | 📸 Ảnh & Drive | Trích xuất ảnh từ trang chi tiết sản phẩm, upload lên Google Drive, lấy link Affiliate |
| Tab 3 | ⚙ Cấu hình | Đăng nhập Google (OAuth), cấu hình tên Sheet / thư mục Drive |

---

## 2. Kiến trúc

Extension dùng cơ chế **3 tầng giao tiếp** đặc trưng của Chrome MV3:

```
MAIN world (trang Shopee)            ISOLATED world (content script)        Service Worker
─────────────────────────            ────────────────────────────────        ────────────────
inject.js  ── postMessage ──────▶    relay.js ── chrome.runtime ─────▶    background.js
dom.js     ── postMessage ──────▶         │                                  (mapRaw, scan,
                                          │                                  affiliate, router)
content.js (Tab2 ảnh) ◀── chrome.runtime.sendMessage ──────────────────▶
```

Lý do tách `MAIN world` và `ISOLATED world`:

- Shopee ghi đè `window.fetch` / `XMLHttpRequest`. Muốn chặn API phải chạy trong **MAIN world** (`inject.js`, `dom.js`).
- Content script không truy cập được `window` của trang; phải có `relay.js` (ISOLATED world) để **bắc cầu** bằng `window.postMessage` → `chrome.runtime.sendMessage`.

### 2.1. Các file chính

| File | World | Vai trò |
|------|-------|---------|
| `manifest.json` | — | Khai báo MV3, content scripts, permissions, side panel |
| `background.js` | Service Worker | `mapRaw()` (ánh xạ dữ liệu), quản lý scan, Picker enrich, tạo link Affiliate, message router |
| `inject.js` | MAIN | Proxy `fetch` + `XMLHttpRequest` để chặn mọi response API Shopee |
| `dom.js` | MAIN | Scrape DOM (fallback khi API không bắt được) + overlay click-chọn sản phẩm (Picker) |
| `relay.js` | ISOLATED | Bắc cầu `postMessage` (MAIN world) ↔ `chrome.runtime` (background) |
| `content.js` | ISOLATED | Trích xuất ảnh + tên sản phẩm từ trang chi tiết (Tab 2) |
| `features.js` | — | Registry tính năng Tab 1 (`sheetHeader`, `toRow`, `mapRaw`) |
| `sidepanel.html/.js/.css` | — | UI side panel |
| `lib/sheet.js` | — | OAuth Google + ghi Google Sheets |
| `lib/drive.js` | — | Upload/quản lý ảnh trên Google Drive |
| `tests/` | — | Test đơn vị (`test_mapRaw.js`, `test_manifest.js`, `test_dom_scrape.js`) |

### 2.2. Cơ chế bắt dữ liệu (2 nguồn, ưu tiên API)

Extension có **2 nguồn dữ liệu song song**, luôn chọn kết quả tốt hơn (ưu tiên API khi số lượng bằng nhau):

1. **API capture (chính)** — `inject.js` proxy `fetch`/`XHR`, chặn mọi response có chứa URL `shopee` + `/api/`, parse JSON và kiểm tra `hasItems()`, rồi đẩy qua `relay.js` → `background.js` (message `HOOK_ITEMS`).

2. **DOM scrape (fallback)** — `dom.js` quét `a[href*="-i."]`, tìm card chứa ký hiệu `₫`, trích tên/giá/số bán/shop/rating bằng regex + `data-sqe` attributes, đẩy qua `relay.js` → `background.js` (message `DOM_ITEMS`). Chạy bằng `MutationObserver` + `setInterval` để theo dõi trang render.

`background.js` nhận cả hai, tìm mảng `items` ở nhiều vị trí có thể (`raw.items`, `raw.data.items`, `raw.data.sections[].data.item/items`, `raw.response.items`), ánh xạ qua `mapRaw()` và giữ kết quả "best" trong cửa sổ 20 giây.

### 2.3. Cấu trúc API Shopee (đã khớp với format hiện tại)

Mỗi item trong response `search_items` có dạng:

```jsonc
{
  "item_card_displayed_asset": {
    "name": "Tên sản phẩm",
    "image": "vn-11134207-...",                    // hash file, không có domain
    "display_price": { "price": 140800000000 },    // giá × 100000
    "sold_count": { "text": "11 đã bán/tháng" },   // ⭐ text hiển thị trên card
    "rating": { "rating_text": "5.0" }
  },
  "item_data": {
    "itemid": 10022249457,
    "shopid": 19435042,
    "shop_data": { "shop_name": "KiwiKey.vn" },
    "item_rating": { "rating_star": 4.989583333333333 },
    "item_card_display_sold_count": {
      "historical_sold_count": 304,   // tổng đã bán (UI KHÔNG hiển thị nữa)
      "monthly_sold_count": 11        // bán/tháng (UI hiển thị)
    }
  }
}
```

### 2.4. Hàm `mapRaw()` — ánh xạ dữ liệu

`mapRaw(it)` nằm ở `background.js` (bản chính), đồng bộ với `features.js` và `tests/test_mapRaw.js`. Logic:

| Trường | Nguồn (format mới) | Ghi chú |
|--------|--------------------|---------|
| `name` | `item_card_displayed_asset.name` | fallback về `item_basic.name` |
| `price` | `display_price.price / 100000` | format cũ: `item_basic.price / 100` |
| `sold` | `sold_count.text` | ⭐ ưu tiên text hiển thị (`"11 đã bán/tháng"` → 11); fallback `monthly_sold_count` → `historical_sold_count` |
| `shop` | `item_data.shop_data.shop_name` | fallback `item_basic.shop_name` |
| `rating` | `item_data.item_rating.rating_star` | fallback `item_basic.rating_star`; chuẩn hóa `48` → `4.8` |
| `image` | `item_card_displayed_asset.image` | thêm prefix `https://cf.shopee.vn/file/`, không nhân đôi nếu đã là URL tuyệt đối |
| `url` | `-i.{shopid}.{itemid}` | tự build từ name + shopid + itemid |

`parseSoldValue()` chuẩn hóa chuỗi số bán: `"1,2k"` → 1200, `"1,2tr"` → 1.200.000, `"11 đã bán/tháng"` → 11.

---

## 3. Luồng dữ liệu chi tiết

### 3.1. Quét sản phẩm (Tab 1)

```
1. User nhập từ khoá → bấm "🔍 Quét"
2. sidepanel gửi START_SCAN { feature, keyword } → background
   background khởi tạo pending (cửa sổ 20s), xoá kết quả cũ
3. sidepanel điều hướng tab hiện tại tới:
   https://shopee.vn/search?keyword=...&sortBy=sales
4. inject.js chặn response search_items → postMessage → relay → background (HOOK_ITEMS)
   dom.js  scrape DOM card → postMessage → relay → background (DOM_ITEMS)
5. background processItems → mapRaw → so sánh → lưu "best" vào lastResult
6. sidepanel poll storage (700ms) → hiển thị danh sách + status
7. Sau 20s: finalize() → lastResult = best (API ưu tiên)
```

### 3.2. Chọn sản phẩm bằng tay (Picker)

```
1. Bấm "🔍 Chọn SP" → bật pickerMode
2. dom.js hiển thị banner + overlay
3. Click vào sản phẩm trên trang → pickerScrape() lấy id/name/price/sold/shop/rating
4. postMessage "picker" → relay → background (PICKER_ITEM)
5. background cross-reference với lastRaw (API) để enrich dữ liệu chính xác
6. Lưu vào pickedItems → sidepanel merge vào danh sách
```

### 3.3. Trích xuất ảnh & upload Drive (Tab 2)

```
1. Mở trang chi tiết sản phẩm Shopee
2. Bấm "🔍 Trích xuất ảnh" → sidepanel gửi "extractImages" → content.js
3. content.js quét ảnh CDN Shopee (susercontent.com) → trả images[] + tên sản phẩm
4. Bấm "📤 Upload lên Drive" → Drive.uploadImages()
   - Tạo/lấy folder gốc (mặc định "shopee-products")
   - Tạo/lấy folder con theo tên sản phẩm
   - Upload từng ảnh (01.jpg, 02.jpg, ...), set quyền public
   - Nếu folder đã có ảnh → trả kết quả cũ (alreadyExists)
5. Log vào Google Sheet "shopee_images"
```

### 3.4. Link Affiliate (Tab 2)

```
1. Bấm "🔗 Lấy link Affiliate"
2. background mở tab ẩn: https://affiliate.shopee.vn/offer/custom_link
3. fetchAffiliateLinkInTab() (MAIN world):
   - Hook clipboard + execCommand để bắt link s.shopee.vn/...
   - Điền URL gốc vào textarea, bấm nút "Lấy link"
   - Bấm "Sao chép Link" khi xuất hiện → bắt link
4. Trả link về sidepanel
```

### 3.5. Lưu Google Sheet (Tab 1)

```
1. Bấm "📤 Lưu Google Sheet"
2. Sheet.save() → getToken() (OAuth) → _ensureSpreadsheet() (tìm/tạo file)
3. feature.toRow() biến mỗi item thành 1 dòng theo sheetHeader
4. _append() ghi vào Sheet (giá trị USER_ENTERED)
5. Nếu lỗi → fallback tải CSV
```

---

## 4. Cấu hình cần có

### 4.1. Google Cloud (OAuth)

1. Vào [Google Cloud Console](https://console.cloud.google.com) → tạo project.
2. **Enable 2 API**: `Google Sheets API` và `Google Drive API`.
3. Tạo **OAuth Client** loại **Web Application**.
4. Copy **Client ID** → dán vào tab ⚙ Cấu hình (hoặc để dùng mặc định trong `lib/sheet.js`).
5. **Redirect URI** phải khớp với giá trị `chrome.identity.getRedirectURL()` (hiển thị sẵn trong tab ⚙ Cấu hình), dạng:
   ```
   https://<extension-id>.chromiumapp.org/
   ```

> `manifest.json` có sẵn field `key` giúp **cố định extension ID** — khi load unpacked, ID không đổi, thuận tiện đăng ký Redirect URI.

### 4.2. Quyền (Scopes)

Khai báo trong `lib/sheet.js`:

```
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/drive.file
```

### 4.3. Cấu hình lưu trữ (`chrome.storage.local`)

| Key | Ý nghĩa | Mặc định |
|-----|---------|----------|
| `gsConfig.clientId` | Client ID OAuth | giá trị trong `lib/sheet.js` |
| `gsConfig.sheet1Name` | Tên file Sheet Tab 1 | `shopee_top10` |
| `gsConfig.sheet2Name` | Tên file Sheet Tab 2 (log ảnh) | `shopee_images` |
| `gsConfig.driveRoot` | Thư mục Drive gốc | `shopee-products` |
| `gsToken` / `gsTokenExp` | Access token OAuth + hạn | — |
| `lastResult` | Kết quả scan mới nhất | — |
| `lastRaw` / `lastRawDom` | Raw API / DOM để debug | — |

### 4.4. Permissions (manifest)

```
storage, sidePanel, tabs, scripting, downloads, identity, clipboardWrite
host_permissions: shopee.vn, *.shopee.vn, sheets.googleapis.com,
                  www.googleapis.com, accounts.google.com,
                  *.susercontent.com, affiliate.shopee.vn
```

---

## 5. Hướng dẫn cài đặt

1. Clone repo (hoặc tải mã nguồn).
2. Mở Chrome → `chrome://extensions`.
3. Bật **Developer mode**.
4. **Load unpacked** → chọn thư mục `Ext-Shopee`.
5. Mở tab ⚙ Cấu hình → nhập Client ID (nếu cần) → bấm **Đăng nhập Google** → cấp quyền.
6. Bấm icon extension (hoặc mở Side Panel) để bắt đầu dùng.

---

## 6. Hướng dẫn sử dụng

### 6.1. Tab 1 — Top10 (lưu danh sách sản phẩm)

1. Chọn **Chọn SP** (chọn tay) hoặc **All** (tự lấy toàn bộ).
2. Nhập từ khoá → bấm **🔍 Quét**.
3. Tab hiện tại tự chuyển tới trang kết quả Shopee (sort theo bán chạy).
4. Đợi scan (~20s). Kết quả hiện trong danh sách: tên, giá, **đã bán**, shop, rating.
   - Mode **All**: tự điền toàn bộ kết quả.
   - Mode **Chọn SP**: bấm **🔍 Chọn SP** rồi click từng sản phẩm trên trang.
5. Bấm **📤 Lưu Google Sheet** → dữ liệu ghi vào Sheet, kèm link mở file.

Cột Sheet: `Thời gian | Keyword | STT | Tên sản phẩm | Giá (VNĐ) | Đã bán | Shop | Rating | URL`.

### 6.2. Tab 2 — Ảnh & Drive

1. Mở trang chi tiết sản phẩm Shopee.
2. Bấm **🔍 Trích xuất ảnh** → hiện số ảnh tìm được.
3. Bấm **📤 Upload lên Drive** → ảnh được tải lên, set public, hiện link.
   - **Cập nhật ảnh**: xoá ảnh cũ, upload lại.
   - **Copy All Links**: copy toàn bộ link ảnh.
4. Bấm **🔗 Lấy link Affiliate** (cần đã đăng nhập affiliate.shopee.vn).

### 6.3. Tab 3 — Cấu hình

- Nhập **Client ID** (nếu dùng client riêng).
- Đổi tên file Sheet / thư mục Drive nếu cần.
- Bấm **💾 Lưu cấu hình**.
- **Đăng nhập / Đăng xuất** Google.

---

## 7. Gỡ lỗi (Debug)

- Mở **🐞 Debug log** trong Tab 1 để xem log từ `inject.js` (`api hook #N: CAPTURED`), `dom.js`, `relay.js`, `background.js`.
- Nút **📋 Copy Raw JSON** copy payload đã bắt được, kèm nhãn nguồn **API** / **DOM** — dùng để kiểm tra cấu trúc API hiện tại.
  - `lastRaw` = payload API (chính xác).
  - `lastRawDom` = payload scrape DOM (fallback).

---

## 8. Kiểm thử (Tests)

```bash
node tests/test_mapRaw.js        # ánh xạ dữ liệu (mapRaw)
node tests/test_manifest.js      # validate manifest.json
node tests/test_dom_scrape.js    # scrape DOM (cần: npm install jsdom)
```

---

## 9. Cấu trúc thư mục

```
Ext-Shopee/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker
├── inject.js              # MAIN world: chặn fetch/XHR
├── dom.js                 # MAIN world: scrape DOM + Picker
├── relay.js               # ISOLATED world: cầu nối message
├── content.js             # ISOLATED world: trích xuất ảnh
├── features.js            # Registry tính năng Tab 1
├── sidepanel.html/.js/.css# UI side panel
├── lib/
│   ├── sheet.js           # OAuth + Google Sheets
│   └── drive.js           # Google Drive upload
├── icons/                 # Icon extension
└── tests/                 # Test đơn vị
```
