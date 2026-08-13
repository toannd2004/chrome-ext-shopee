// sidepanel.js — Ext-Shopee Sidebar Controller
// Tab1 (Top10): scan, picker, save to Sheet
// Tab2 (Ảnh & Drive): extract images, upload Drive, affiliate link
// Tab3 (Cấu hình): OAuth, sheet names, Drive root

(function() {
  'use strict';

  // ============ State ============
  var items = [];
  var activeId = 'product_top10';
  var pickerActive = false;
  var lastPickedLen = 0;
  var lastResultTs = 0;
  var mode = 'select'; // 'select' | 'all'

  // Tab2 state
  var tab2Images = [];
  var tab2ProductName = '';
  var tab2UploadResult = null;

  // ============ DOM refs ============
  var $ = function(id) { return document.getElementById(id); };

  // Tab bar
  var tabBtns = document.querySelectorAll('.tab-btn');
  var tab1 = $('tab1'), tab2 = $('tab2'), tab3 = $('tab3');

  // Tab1
  var featureTabs = $('feature-tabs');
  var keywordEl = $('keyword');
  var btnScan = $('btn-scan');
  var btnSelectSP = $('btn-select-sp');
  var btnClearAll = $('btn-clear-all');
  var btnReset = $('btn-reset');
  var statusEl = $('status');
  var listEl = $('list');
  var debugLogEl = $('debug-log');
  var btnCopyRaw = $('btn-copy-raw');
  var btnSaveSheet = $('btn-save-sheet');
  var sheetLinkDiv = $('sheet-link');
  var sheetLinkA = $('sheet-link-a');

  // Tab2
  var btnExtract = $('btn-extract');
  var tab2ExtractStatus = $('tab2-extract-status');
  var tab2Result = $('tab2-result');
  var tab2Idle = $('tab2-idle');
  var tab2Name = $('tab2-name');
  var tab2Count = $('tab2-count');
  var btnUploadDrive = $('btn-upload-drive');
  var btnUploadNew = $('btn-upload-new');
  var btnForceUpdate = $('btn-force-update');
  var tab2UploadProgress = $('tab2-upload-progress');
  var progressFill = $('progress-fill');
  var progressText = $('progress-text');
  var tab2DriveResult = $('tab2-drive-result');
  var tab2FolderA = $('tab2-folder-a');
  var tab2FileList = $('tab2-file-list');
  var btnCopyAll = $('btn-copy-all');
  var btnAffiliate = $('btn-affiliate');
  var tab2AffiliateResult = $('tab2-affiliate-result');
  var tab2AffLink = $('tab2-aff-link');

  // Tab3
  var cfgClientId = $('cfg-client-id');
  var cfgRedirectUri = $('cfg-redirect-uri');
  var cfgSheet1Name = $('cfg-sheet1-name');
  var cfgSheet2Name = $('cfg-sheet2-name');
  var cfgDriveRoot = $('cfg-drive-root');
  var cfgAuthStatus = $('cfg-auth-status');
  var btnLogin = $('btn-login');
  var btnLogout = $('btn-logout');
  var btnSaveConfig = $('btn-save-config');

  // ============ Tab Switching ============
  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var targetTab = btn.getAttribute('data-tab');
      // Update buttons
      tabBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      // Update content
      document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
      $(targetTab).classList.add('active');

      if (targetTab === 'tab2') checkTab2Page();
      if (targetTab === 'tab3') loadConfig();
    });
  });

  // ============ Tab1: Feature Tabs ============
  function renderFeatureTabs() {
    var feats = window.ShopeeFeatures || {};
    var html = '';
    for (var k in feats) {
      if (!feats.hasOwnProperty(k)) continue;
      var f = feats[k];
      html += '<button class="ftab' + (f.id === activeId ? ' active' : '') + '" data-fid="' + f.id + '">' + f.label + '</button>';
    }
    featureTabs.innerHTML = html;

    featureTabs.querySelectorAll('.ftab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var fid = btn.getAttribute('data-fid');
        switchFeature(fid);
      });
    });
  }

  function switchFeature(fid) {
    activeId = fid;
    featureTabs.querySelectorAll('.ftab').forEach(function(b) { b.classList.remove('active'); });
    var btn = featureTabs.querySelector('[data-fid="' + fid + '"]');
    if (btn) btn.classList.add('active');
    items = [];
    renderList();
    statusEl.textContent = '';
  }

  // ============ Tab1: Mode ============
  document.querySelectorAll('input[name="mode"]').forEach(function(r) {
    r.addEventListener('change', function() {
      mode = this.value;
      if (mode === 'all') {
        // Reset picker if active
        if (pickerActive) togglePicker();
        // Sync items from lastResult if available
        chrome.storage.local.get(['lastResult'], function(s) {
          if (s.lastResult && s.lastResult.feature === activeId && s.lastResult.items) {
            var ni = s.lastResult.items.filter(function(it) { return it && it.name; });
            if (ni.length > 0 && !statusEl.dataset.edited) {
              items = ni;
              lastResultTs = s.lastResult.ts;
              renderList();
            }
          }
        });
      }
    });
  });

  // ============ Tab1: Scan ============
  btnScan.addEventListener('click', function() {
    var kw = keywordEl.value.trim();
    if (!kw) { statusEl.textContent = '⚠ Nhập từ khoá'; return; }

    // Reset
    items = [];
    lastPickedLen = 0;
    lastResultTs = 0;
    pickerActive = false;
    if (btnSelectSP) { btnSelectSP.textContent = '🔍 Chọn SP'; btnSelectSP.className = 'sec'; }
    statusEl.textContent = 'Đang quét...';
    delete statusEl.dataset.edited;
    renderList();

    var feat = (window.ShopeeFeatures || {})[activeId];
    var sort = feat ? feat.sort : 'sales';

    // Tell background to start scan
    chrome.runtime.sendMessage({
      type: 'START_SCAN',
      feature: activeId,
      keyword: kw
    });

    // Navigate current tab to search URL
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) return;
      var url = 'https://shopee.vn/search?keyword=' + encodeURIComponent(kw) + '&sortBy=' + sort;
      chrome.tabs.update(tabs[0].id, { url: url });
    });

    // Timeout
    var startTime = Date.now();
    var checkTimeout = setInterval(function() {
      if (Date.now() - startTime > 25000) {
        clearInterval(checkTimeout);
        if (!statusEl.textContent || statusEl.textContent === 'Đang quét...') {
          statusEl.textContent = 'LỖI: 25s không bắt được dữ liệu';
        }
      }
    }, 1000);
  });

  // ============ Tab1: Picker Toggle ============
  btnSelectSP.addEventListener('click', togglePicker);

  function togglePicker() {
    pickerActive = !pickerActive;

    if (pickerActive) {
      btnSelectSP.textContent = '🟢 Đang chọn... (dừng)';
      btnSelectSP.className = 'warn';
      chrome.storage.local.set({ pickerMode: true });
      statusEl.textContent = '🟢 Click vào SP trên trang Shopee để chọn';
    } else {
      btnSelectSP.textContent = '🔍 Chọn SP';
      btnSelectSP.className = 'sec';
      chrome.storage.local.set({ pickerMode: false, pickedItems: [] });
      statusEl.textContent = '';
    }
  }

  // ============ Tab1: Clear / Reset ============
  btnClearAll.addEventListener('click', function() {
    items = [];
    lastPickedLen = 0;
    statusEl.dataset.edited = '1';
    renderList();
    chrome.storage.local.set({ pickedItems: [], editedSeq: Date.now() });
  });

  btnReset.addEventListener('click', function() {
    items = [];
    lastPickedLen = 0;
    lastResultTs = 0;
    pickerActive = false;
    if (btnSelectSP) { btnSelectSP.textContent = '🔍 Chọn SP'; btnSelectSP.className = 'sec'; }
    statusEl.textContent = '';
    delete statusEl.dataset.edited;
    renderList();
    chrome.storage.local.set({
      pickedItems: [],
      pickerMode: false,
      lastResult: null,
      lastRaw: null,
      lastRawDom: null,
      debugLog: [],
      scanStatus: '',
      pendingScan: false,
      pendingKeyword: '',
      editedSeq: Date.now()
    });
  });

  // ============ Tab1: Save to Sheet ============
  btnSaveSheet.addEventListener('click', async function() {
    if (items.length === 0) { statusEl.textContent = '⚠ Chưa có sản phẩm nào'; return; }

    btnSaveSheet.disabled = true;
    btnSaveSheet.textContent = '⏳ Đang lưu...';

    var feat = (window.ShopeeFeatures || {})[activeId];
    if (!feat) { statusEl.textContent = '⚠ Không tìm thấy feature'; btnSaveSheet.disabled = false; btnSaveSheet.textContent = '📤 Lưu Google Sheet'; return; }

    try {
      var now = new Date();
      var ctx = {
        ts: now.toLocaleString('vi-VN'),
        keyword: (await chrome.storage.local.get(['pendingKeyword'])).pendingKeyword || ''
      };

      var msg = await window.Sheet.save(feat, items, ctx);
      statusEl.textContent = msg;

      if (msg.indexOf('✅') === 0) {
        var id = await window.Sheet._getLastId();
        if (id) {
          sheetLinkA.href = 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
          sheetLinkDiv.style.display = 'block';
        }

        // Clear all
        items = [];
        lastPickedLen = 0;
        pickerActive = false;
        if (btnSelectSP) { btnSelectSP.textContent = '🔍 Chọn SP'; btnSelectSP.className = 'sec'; }
        statusEl.dataset.edited = '1';
        renderList();
        await chrome.storage.local.set({ pickedItems: [], pickerMode: false, editedSeq: Date.now() });
      } else {
        // Save failed — offer CSV fallback
        statusEl.textContent = msg + ' | 📥 Đang tải CSV...';
        await window.Sheet._csvFallback(feat, items, ctx);
      }
    } catch(e) {
      statusEl.textContent = '⚠ Lỗi: ' + (e.message || String(e));
    }

    btnSaveSheet.disabled = false;
    btnSaveSheet.textContent = '📤 Lưu Google Sheet';
  });

  // ============ Tab1: Copy Raw JSON ============
  btnCopyRaw.addEventListener('click', function() {
    chrome.storage.local.get(['lastRaw', 'lastRawDom'], function(r) {
      var raw = r.lastRaw || r.lastRawDom;
      if (raw) {
        navigator.clipboard.writeText(JSON.stringify(raw, null, 2)).then(function() {
          statusEl.textContent = '✅ Đã copy Raw JSON (' + (r.lastRaw ? 'API' : 'DOM') + ')';
        }).catch(function() {
          statusEl.textContent = '⚠ Không copy được';
        });
      } else {
        statusEl.textContent = '⚠ Chưa có dữ liệu API';
      }
    });
  });

  // ============ Tab1: Delete Item ============
  listEl.addEventListener('click', function(e) {
    if (e.target.classList.contains('item-del') || e.target.closest('.item-del')) {
      var btn = e.target.classList.contains('item-del') ? e.target : e.target.closest('.item-del');
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      if (!isNaN(idx) && idx >= 0 && idx < items.length) {
        items.splice(idx, 1);
        statusEl.dataset.edited = '1';
        renderList();
      }
    }
  });

  // ============ Tab1: Render List ============
  function fmtPrice(n) {
    if (!n) return '0 ₫';
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫';
  }

  function fmtSold(n) {
    if (!n) return '0';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderList() {
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.name) continue;
      html += '<div class="item-card">' +
        '<img class="item-thumb" src="' + escapeHtml(it.image || '') + '" onerror="this.style.display=\'none\'">' +
        '<div class="item-info">' +
          '<div class="item-name"><a href="' + escapeHtml(it.url || '#') + '" target="_blank">' + escapeHtml(it.name) + '</a></div>' +
          '<div class="item-meta">' +
            '<span class="item-price">' + fmtPrice(it.price) + '</span>' +
            '<span>Đã bán ' + fmtSold(it.sold) + '</span>' +
            (it.shop ? '<span>' + escapeHtml(it.shop) + '</span>' : '') +
            (it.rating ? '<span>⭐' + (Math.round(it.rating * 10) / 10) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<button class="item-del" data-idx="' + i + '">✕</button>' +
      '</div>';
    }
    listEl.innerHTML = html || '<div style="text-align:center;color:#aaa;padding:12px;">Chưa có sản phẩm</div>';
  }

  // ============ Tab1: Poll Storage ============
  function refreshFromStorage() {
    chrome.storage.local.get(['scanStatus', 'lastResult', 'pickedItems', 'debugLog'], function(s) {
      if (s.scanStatus) statusEl.textContent = s.scanStatus;
      if (s.debugLog && debugLogEl) debugLogEl.textContent = s.debugLog.join('\n');

      // Batch scan result — respect mode: All=auto-populate, Select=status only
      if (s.lastResult && s.lastResult.feature === activeId && s.lastResult.ts !== lastResultTs) {
        lastResultTs = s.lastResult.ts;
        if (mode === 'all') {
          var ni = (s.lastResult.items || []).filter(function(it) { return it && it.name; });
          if (!statusEl.dataset.edited) {
            items = ni;
            renderList();
          }
        }
        // In select mode: only status updates (already handled by scanStatus above)
      }

      // Picker items merge (Select mode)
      if (s.pickedItems && s.pickedItems.length !== lastPickedLen) {
        lastPickedLen = s.pickedItems.length;
        var existingIds = new Set(items.map(function(it) { return String(it.id); }));
        var newItems = (s.pickedItems || []).filter(function(it) {
          return it && it.name && !existingIds.has(String(it.id));
        });
        if (newItems.length > 0) {
          items = items.concat(newItems);
          statusEl.dataset.edited = '1';
          renderList();
        }
      }
    });
  }

  setInterval(refreshFromStorage, 700);

  // ============ TAB 2: Image Extraction & Drive Upload ============
  function checkTab2Page() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) return;
      var url = tabs[0].url || '';
      if (url.indexOf('shopee.vn') === -1) {
        tab2ExtractStatus.textContent = '⚠ Hãy mở trang sản phẩm Shopee';
        return;
      }

      // Check if already have cached result
      var storageKey = 'tab2_' + encodeURIComponent(url);
      chrome.storage.local.get([storageKey], function(r) {
        if (r[storageKey]) {
          tab2UploadResult = r[storageKey];
          showTab2Result(r[storageKey]);
        } else {
          tab2UploadResult = null;
          tab2Result.style.display = 'none';
          tab2Idle.style.display = 'block';
          tab2ExtractStatus.textContent = '';
        }
      });
    });
  }

  btnExtract.addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) return;
      var tab = tabs[0];
      if (tab.url.indexOf('shopee.vn') === -1) {
        tab2ExtractStatus.textContent = '⚠ Hãy mở trang sản phẩm Shopee';
        return;
      }

      tab2ExtractStatus.textContent = '⏳ Đang trích xuất...';
      btnExtract.disabled = true;

      chrome.tabs.sendMessage(tab.id, { action: 'extractImages' }, function(res) {
        btnExtract.disabled = false;
        if (chrome.runtime.lastError) {
          tab2ExtractStatus.textContent = '⚠ Lỗi: ' + chrome.runtime.lastError.message + '. Reload trang Shopee.';
          return;
        }
        if (!res || !res.success) {
          tab2ExtractStatus.textContent = '⚠ Không tìm thấy ảnh sản phẩm. Đảm bảo đang ở trang chi tiết sản phẩm.';
          return;
        }

        tab2Images = res.images || [];
        tab2ProductName = res.name || 'unknown';

        tab2ExtractStatus.textContent = '✅ Tìm thấy ' + tab2Images.length + ' ảnh';
        tab2Idle.style.display = 'none';
        tab2Result.style.display = 'block';
        tab2Name.textContent = tab2ProductName;
        tab2Count.textContent = tab2Images.length + ' ảnh';

        // Check storage for existing result
        var storageKey = 'tab2_' + encodeURIComponent(tab.url);
        chrome.storage.local.get([storageKey], function(r) {
          if (r[storageKey]) {
            tab2UploadResult = r[storageKey];
            btnForceUpdate.style.display = 'inline-block';
            btnUploadNew.style.display = 'inline-block';
            btnUploadDrive.style.display = 'none';
            showTab2DriveResult(r[storageKey]);
          } else {
            tab2UploadResult = null;
            btnForceUpdate.style.display = 'none';
            btnUploadNew.style.display = 'none';
            btnUploadDrive.style.display = 'inline-block';
            tab2DriveResult.style.display = 'none';
          }
        });
      });
    });
  });

  // Shared upload logic
  async function doUpload(forceUpdate) {
    if (tab2Images.length === 0) {
      tab2ExtractStatus.textContent = '⚠ Cần trích xuất ảnh trước';
      return;
    }
    tab2UploadProgress.style.display = 'block';
    progressFill.style.width = '0%';

    try {
      var token = await window.Sheet.getToken(true);
      var result = await window.Drive.uploadImages(
        tab2Images,
        tab2ProductName,
        forceUpdate,
        function(current, total, filename) {
          progressFill.style.width = Math.round(current / total * 100) + '%';
          progressText.textContent = 'Upload ' + current + '/' + total + ': ' + filename;
        },
        token
      );

      tab2UploadResult = result;
      showTab2DriveResult(result);

      // Cache result
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs.length > 0 && tabs[0].url) {
          var storageKey = 'tab2_' + encodeURIComponent(tabs[0].url);
          chrome.storage.local.set({ [storageKey]: result });
        }
      });

      btnForceUpdate.style.display = 'inline-block';
      btnUploadNew.style.display = 'inline-block';
      btnUploadDrive.style.display = 'none';
      tab2ExtractStatus.textContent = forceUpdate ? '✅ Đã cập nhật ảnh' : '✅ Đã upload ' + (result.results || []).length + ' ảnh';

      // Log to Sheet
      try {
        if (result.results && result.results.length > 0) {
          await window.Sheet.saveTab2(result.results, {
            ts: new Date().toLocaleString('vi-VN'),
            productName: result.productName,
            folderLink: result.folderLink
          });
        }
      } catch(e) {}

    } catch(e) {
      tab2ExtractStatus.textContent = '⚠ Lỗi upload: ' + (e.message || String(e));
      // Show retry: keep upload button enabled
      btnUploadDrive.disabled = false;
      btnUploadDrive.textContent = '🔄 Thử lại';
    }

    tab2UploadProgress.style.display = 'none';
    btnUploadDrive.disabled = false;
    btnUploadDrive.textContent = '📤 Upload lên Drive';
    btnForceUpdate.disabled = false;
    btnForceUpdate.textContent = '🔄 Cập nhật ảnh';
    btnUploadNew.disabled = false;
    btnUploadNew.textContent = '📤 Upload mới';
  }

  btnUploadDrive.addEventListener('click', function() {
    btnUploadDrive.disabled = true;
    btnUploadDrive.textContent = '⏳ Đang upload...';
    doUpload(false);
  });

  btnUploadNew.addEventListener('click', function() {
    btnUploadNew.disabled = true;
    btnUploadNew.textContent = '⏳ Đang upload...';
    doUpload(true);
  });

  btnForceUpdate.addEventListener('click', async function() {
    btnForceUpdate.disabled = true;
    btnForceUpdate.textContent = '⏳ Đang trích xuất lại...';

    // Re-extract from page first to get fresh images
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) { btnForceUpdate.disabled = false; btnForceUpdate.textContent = '🔄 Cập nhật ảnh'; return; }
      var tab = tabs[0];
      chrome.tabs.sendMessage(tab.id, { action: 'extractImages' }, function(res) {
        if (res && res.success) {
          tab2Images = res.images || [];
          tab2ProductName = res.name || tab2ProductName;
          tab2ExtractStatus.textContent = '✅ Tìm thấy ' + tab2Images.length + ' ảnh mới';
        }
        // Proceed with force update (even if re-extract failed, use old images)
        doUpload(true);
      });
    });
  });

  function showTab2Result(result) {
    tab2Result.style.display = 'block';
    tab2Name.textContent = result.productName || '';
    if (result.alreadyExists) {
      tab2Count.textContent = (result.results || []).length + ' ảnh (đã có sẵn)';
    } else {
      tab2Count.textContent = (result.results || []).length + ' ảnh';
    }
    showTab2DriveResult(result);
  }

  function showTab2DriveResult(result) {
    if (!result || !result.folderLink) return;
    tab2DriveResult.style.display = 'block';

    tab2FolderA.href = result.folderLink;

    // File list
    var html = '';
    (result.results || []).forEach(function(f) {
      html += '<div class="file-row">' +
        (f.driveLink ? '<img src="https://drive.google.com/thumbnail?id=' + (f.fileId || '') + '&sz=w80" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        '<div class="file-link"><a href="' + (f.driveLink || '#') + '" target="_blank">' + escapeHtml(f.filename || '') + '</a></div>' +
        (f.driveLink ? '<button class="copy-btn sm" data-copy="' + f.driveLink.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">📋</button>' : '') +
        (f.fileId ? '<button class="file-del" data-fid="' + f.fileId + '">✕</button>' : '') +
      '</div>';
    });
    tab2FileList.innerHTML = html || '<div style="color:#aaa">Chưa có file</div>';

    // Copy buttons
    tab2FileList.querySelectorAll('.copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var link = btn.getAttribute('data-copy');
        navigator.clipboard.writeText(link).then(function() {
          btn.textContent = '✅';
          setTimeout(function() { btn.textContent = '📋'; }, 1500);
        });
      });
    });

    // Delete buttons
    tab2FileList.querySelectorAll('.file-del').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var fid = btn.getAttribute('data-fid');
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
          var token = await window.Sheet.getToken(true);
          await window.Drive.trashFile(fid, token);
          btn.closest('.file-row').remove();
          // Update cached result
          if (tab2UploadResult && tab2UploadResult.results) {
            tab2UploadResult.results = tab2UploadResult.results.filter(function(r) { return r.fileId !== fid; });
          }
        } catch(e) {
          btn.textContent = '❌';
        }
      });
    });
  }

  // Copy all links
  btnCopyAll.addEventListener('click', function() {
    if (!tab2UploadResult || !tab2UploadResult.results) return;
    var links = tab2UploadResult.results
      .filter(function(f) { return f.driveLink; })
      .map(function(f) { return f.driveLink; })
      .join('\n');
    navigator.clipboard.writeText(links).then(function() {
      btnCopyAll.textContent = '✅ Đã copy!';
      setTimeout(function() { btnCopyAll.textContent = '📋 Copy All Links'; }, 2000);
    });
  });

  // Folder copy
  tab2FolderA.parentElement.querySelector('.copy-btn')?.addEventListener('click', function() {
    var link = tab2FolderA.href;
    navigator.clipboard.writeText(link).then(function() {
      tab2FolderA.parentElement.querySelector('.copy-btn').textContent = '✅';
      setTimeout(function() {
        tab2FolderA.parentElement.querySelector('.copy-btn').textContent = '📋';
      }, 1500);
    });
  });

  // ============ Tab2: Affiliate Link ============
  btnAffiliate.addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length === 0) return;
      var url = tabs[0].url || '';
      if (url.indexOf('shopee.vn') === -1) {
        tab2AffLink.textContent = '⚠ Hãy mở trang sản phẩm Shopee';
        tab2AffiliateResult.style.display = 'flex';
        return;
      }

      btnAffiliate.disabled = true;
      btnAffiliate.textContent = '⏳ Đang lấy...';

      chrome.runtime.sendMessage({ type: 'GENERATE_AFFILIATE', url: url }, function(res) {
        btnAffiliate.disabled = false;
        btnAffiliate.textContent = '🔗 Lấy link Affiliate';

        if (res && res.link) {
          tab2AffLink.innerHTML = '<a href="' + res.link + '" target="_blank">' + res.link + '</a>';
          tab2AffiliateResult.style.display = 'flex';
          tab2AffiliateResult.querySelector('.copy-btn').setAttribute('data-copy', res.link);
        } else {
          tab2AffLink.textContent = '⚠ ' + (res && res.error ? res.error : 'Không lấy được link. Bạn đã đăng nhập affiliate.shopee.vn chưa?');
          tab2AffiliateResult.style.display = 'flex';
        }
      });
    });
  });

  // Affiliate copy button
  tab2AffiliateResult.querySelector('.copy-btn')?.addEventListener('click', function() {
    var link = this.getAttribute('data-copy');
    if (!link) return;
    navigator.clipboard.writeText(link).then(function() {
      tab2AffiliateResult.querySelector('.copy-btn').textContent = '✅';
      setTimeout(function() { tab2AffiliateResult.querySelector('.copy-btn').textContent = '📋'; }, 1500);
    });
  });

  // ============ TAB 3: Configuration ============
  function loadConfig() {
    cfgRedirectUri.textContent = chrome.identity.getRedirectURL();

    chrome.storage.local.get(['gsConfig', 'gsTokenExp'], function(r) {
      var cfg = r.gsConfig || {};
      cfgClientId.value = cfg.clientId || '';
      cfgSheet1Name.value = cfg.sheet1Name || 'shopee_top10';
      cfgSheet2Name.value = cfg.sheet2Name || 'shopee_images';
      cfgDriveRoot.value = cfg.driveRoot || 'shopee-products';

      if (r.gsTokenExp && r.gsTokenExp > Date.now()) {
        cfgAuthStatus.textContent = '✅ Đã đăng nhập (hết hạn: ' + new Date(r.gsTokenExp).toLocaleTimeString('vi-VN') + ')';
        btnLogin.style.display = 'none';
        btnLogout.style.display = 'inline-block';
      } else {
        cfgAuthStatus.textContent = '⚠ Chưa đăng nhập';
        btnLogin.style.display = 'inline-block';
        btnLogout.style.display = 'none';
      }
    });
  }

  btnLogin.addEventListener('click', async function() {
    btnLogin.disabled = true;
    btnLogin.textContent = '⏳ Đang đăng nhập...';
    try {
      // Save config first
      await saveConfigOnly();
      await window.Sheet.getToken(true);
      loadConfig();
    } catch(e) {
      cfgAuthStatus.textContent = '⚠ ' + (e.message || 'Lỗi đăng nhập');
    }
    btnLogin.disabled = false;
    btnLogin.textContent = '🔑 Đăng nhập Google';
  });

  btnLogout.addEventListener('click', async function() {
    await window.Sheet.logout();
    loadConfig();
  });

  async function saveConfigOnly() {
    var stash = await chrome.storage.local.get(['gsConfig']);
    var cfg = stash.gsConfig || {};
    cfg.clientId = cfgClientId.value.trim();
    cfg.sheet1Name = cfgSheet1Name.value.trim();
    cfg.sheet2Name = cfgSheet2Name.value.trim();
    cfg.driveRoot = cfgDriveRoot.value.trim();
    await chrome.storage.local.set({ gsConfig: cfg });
    return cfg;
  }

  btnSaveConfig.addEventListener('click', async function() {
    await saveConfigOnly();
    cfgAuthStatus.textContent = '✅ Đã lưu cấu hình';
    setTimeout(function() { loadConfig(); }, 1000);
  });

  // ============ Init ============
  function init() {
    renderFeatureTabs();
    loadConfig();

    // Auto-detect page for Tab2
    checkTab2Page();
  }

  init();
})();
