// lib/sheet.js — Google Sheets OAuth + Write (unified for Tab1 & Tab2)
// Uses chrome.identity.launchWebAuthFlow (Web OAuth client, works for unpacked extensions)

(function() {
  var SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

  // Default OAuth client ID — user can override in Tab3 config
  var DEFAULT_CLIENT_ID = '174199013226-qsf3nkm8b278k805hb0qvckr61d026qo.apps.googleusercontent.com';

  // Cache keys
  var TK = 'gsToken', TE = 'gsTokenExp', CFG = 'gsConfig';

  async function getToken(interactive) {
    var now = Date.now();
    var stash = await chrome.storage.local.get([TK, TE, CFG]);
    var cfg = stash[CFG] || {};

    // Return cached token if still valid (>60s remaining)
    if (stash[TK] && stash[TE] && stash[TE] > now + 60000) {
      return stash[TK];
    }

    var clientId = (cfg.clientId || '').trim() || DEFAULT_CLIENT_ID;
    if (!clientId) {
      throw new Error('NO_CLIENT_ID: Vui lòng nhập Client ID trong tab ⚙ Cấu hình');
    }

    var redirectUri = chrome.identity.getRedirectURL();
    var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
      '?client_id=' + encodeURIComponent(clientId) +
      '&response_type=token' +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&scope=' + encodeURIComponent(SCOPES) +
      '&prompt=consent';

    try {
      var resultUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: interactive !== false
      });

      if (!resultUrl) {
        throw new Error('AUTH_CANCELLED: Đăng nhập bị huỷ');
      }

      // Parse token from fragment
      var params = {};
      var fragment = resultUrl.split('#')[1] || '';
      fragment.split('&').forEach(function(p) {
        var parts = p.split('=');
        params[decodeURIComponent(parts[0])] = decodeURIComponent(parts.slice(1).join('='));
      });

      if (!params.access_token) {
        throw new Error('AUTH_FAILED: Không lấy được token');
      }

      var expiresIn = parseInt(params.expires_in, 10) || 3600;
      await chrome.storage.local.set({
        gsToken: params.access_token,
        gsTokenExp: now + expiresIn * 1000
      });

      return params.access_token;
    } catch (e) {
      if (e.message && e.message.indexOf('AUTH_') === 0) throw e;
      throw new Error('AUTH_ERROR: ' + (e.message || 'Lỗi không xác định'));
    }
  }

  async function _ensureSpreadsheet(fileName, token, cfg, cacheKey) {
    // Check cache
    if (cfg[cacheKey]) return cfg[cacheKey];

    // Search Drive for existing file
    var searchUrl = 'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent("name='" + fileName.replace(/'/g, "\\'") +
        "' and mimeType='application/vnd.google-apps.spreadsheet'") +
      '&fields=files(id,name)';

    var res = await fetch(searchUrl, { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) {
      var j = await res.json();
      if (j.files && j.files.length > 0) {
        cfg[cacheKey] = j.files[0].id;
        await chrome.storage.local.set({ gsConfig: cfg });
        return j.files[0].id;
      }
    }

    // Create new spreadsheet
    var createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: fileName } })
    });
    var createJ = await createRes.json();
    if (!createRes.ok) {
      throw new Error((createJ.error && createJ.error.message) || 'HTTP ' + createRes.status);
    }
    cfg[cacheKey] = createJ.spreadsheetId;
    await chrome.storage.local.set({ gsConfig: cfg });
    return createJ.spreadsheetId;
  }

  async function _hasData(spreadsheetId, sheetName, token) {
    var range = sheetName ? ("'" + sheetName.replace(/'/g, "''") + "'!A1:A1") : 'A1:A1';
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId +
      '/values/' + encodeURIComponent(range);
    try {
      var res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) return false;
      var j = await res.json();
      return !!(j.values && j.values.length > 0);
    } catch (e) { return false; }
  }

  async function _append(spreadsheetId, sheetName, header, rows, token) {
    var hasExisting = await _hasData(spreadsheetId, sheetName, token);
    var values = hasExisting ? rows : [header].concat(rows);

    var range = sheetName ? ("'" + sheetName.replace(/'/g, "''") + "'!A1") : 'A1';
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId +
      '/values/' + encodeURIComponent(range) +
      ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';

    var res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: values, majorDimension: 'ROWS' })
    });

    if (!res.ok) {
      var ej = await res.json();
      var msg = (ej.error && ej.error.message) || 'HTTP ' + res.status;
      if (/not been used|disabled|SERVICE_DISABLED/i.test(msg)) {
        var pid = (ej.error && ej.error.details && ej.error.details[0] &&
          ej.error.details[0].metadata && ej.error.details[0].metadata.consumerId) || '';
        var enableUrl = pid ? 'https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=' + pid : '';
        throw new Error('SERVICE_DISABLED: Google Sheets API chưa bật.\n→ ' + enableUrl);
      }
      throw new Error(msg);
    }

    var rj = await res.json();
    return rj.updates ? rj.updates.updatedRows : rows.length;
  }

  async function _getLastId() {
    var r = await chrome.storage.local.get([CFG]);
    return (r[CFG] && r[CFG].sheet1Id) || null;
  }

  async function _getLastId2() {
    var r = await chrome.storage.local.get([CFG]);
    return (r[CFG] && r[CFG].sheet2Id) || null;
  }

  // Save Tab1 data (Top10 product list)
  async function save(feature, items, ctx) {
    try {
      var token = await getToken(true);
      var stash = await chrome.storage.local.get([CFG]);
      var cfg = stash[CFG] || {};

      var fileName = (cfg.sheet1Name || '').trim() || 'shopee_top10';
      var spreadsheetId = await _ensureSpreadsheet(fileName, token, cfg, 'sheet1Id');

      var rows = items.map(function(it, i) {
        return feature.toRow(it, i, ctx);
      });

      var n = await _append(spreadsheetId, cfg.sheet1Tab || '', feature.sheetHeader, rows, token);
      return '✅ Đã ghi ' + n + ' dòng vào Google Sheet';
    } catch (e) {
      var msg = e.message || String(e);
      if (msg.indexOf('NO_CLIENT_ID') === 0) return '⚠ ' + msg;
      if (msg.indexOf('AUTH_CANCELLED') === 0) return '⚠ Đăng nhập bị huỷ. Thử lại.';
      if (msg.indexOf('AUTH_FAILED') === 0) return '⚠ ' + msg;
      if (msg.indexOf('SERVICE_DISABLED') === 0) return msg;
      if (msg.indexOf('401') > -1) {
        // Token expired, clear and retry once
        await chrome.storage.local.remove([TK, TE]);
        try {
          var token2 = await getToken(true);
          var stash2 = await chrome.storage.local.get([CFG]);
          var cfg2 = stash2[CFG] || {};
          var fileName2 = (cfg2.sheet1Name || '').trim() || 'shopee_top10';
          var spreadsheetId2 = await _ensureSpreadsheet(fileName2, token2, cfg2, 'sheet1Id');
          var rows2 = items.map(function(it, i) { return feature.toRow(it, i, ctx); });
          var n2 = await _append(spreadsheetId2, cfg2.sheet1Tab || '', feature.sheetHeader, rows2, token2);
          return '✅ Đã ghi ' + n2 + ' dòng vào Google Sheet';
        } catch (e2) {
          return '⚠ Lỗi: ' + (e2.message || String(e2));
        }
      }
      return '⚠ Lỗi: ' + msg;
    }
  }

  // Save Tab2 data (image upload log)
  async function saveTab2(items, ctx) {
    try {
      var token = await getToken(true);
      var stash = await chrome.storage.local.get([CFG]);
      var cfg = stash[CFG] || {};

      var fileName = (cfg.sheet2Name || '').trim() || 'shopee_images';
      var spreadsheetId = await _ensureSpreadsheet(fileName, token, cfg, 'sheet2Id');

      var header = ['Thời gian', 'Tên sản phẩm', 'Folder Drive', 'STT', 'Tên file', 'Link ảnh'];
      var rows = items.map(function(it, i) {
        return [
          ctx.ts || '',
          ctx.productName || '',
          ctx.folderLink || '',
          i + 1,
          it.filename || '',
          it.driveLink || ''
        ];
      });

      var n = await _append(spreadsheetId, cfg.sheet2Tab || '', header, rows, token);
      return '✅ Đã ghi ' + n + ' dòng log vào Sheet';
    } catch (e) {
      return '⚠ Lỗi log Sheet: ' + (e.message || String(e));
    }
  }

  async function logout() {
    await chrome.storage.local.remove([TK, TE]);
  }

  // Fallback: CSV download
  async function _csvFallback(feature, items, ctx) {
    var header = feature.sheetHeader.join(',');
    var rows = items.map(function(it, i) {
      return feature.toRow(it, i, ctx).map(function(c) {
        var s = String(c == null ? '' : c);
        if (s.indexOf(',') > -1 || s.indexOf('"') > -1 || s.indexOf('\n') > -1) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(',');
    });
    var csv = [header].concat(rows).join('\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url: url,
      filename: (ctx.keyword || 'shopee') + '_top10.csv',
      saveAs: true
    });
    return '✅ Đã tải file CSV';
  }

  window.Sheet = {
    save: save,
    saveTab2: saveTab2,
    getToken: getToken,
    _ensureSpreadsheet: _ensureSpreadsheet,
    _hasData: _hasData,
    _append: _append,
    _getLastId: _getLastId,
    _getLastId2: _getLastId2,
    logout: logout,
    _csvFallback: _csvFallback
  };
})();
