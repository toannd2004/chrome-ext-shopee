// inject.js — MAIN world: Intercept Shopee fetch/XHR API responses
// Uses Object.defineProperty proxy to survive Shopee overwriting window.fetch
(function() {
  'use strict';

  var KEY = '__shopeeScrape';
  var DBG_KEY = '__shopeeDbg';

  function dbg(msg) {
    try { window.postMessage({ __tag: DBG_KEY, msg: String(msg) }, '*'); } catch(e) {}
  }

  // Check if raw data contains product items (searches multiple paths)
  function hasItems(raw) {
    if (!raw || typeof raw !== 'object') return false;
    // Direct items
    if (raw.items && Array.isArray(raw.items) && raw.items.length > 0) return true;
    // Nested: data.items
    if (raw.data && raw.data.items && Array.isArray(raw.data.items) && raw.data.items.length > 0) return true;
    // Nested: data.sections[].data.items
    if (raw.data && raw.data.sections && Array.isArray(raw.data.sections)) {
      for (var i = 0; i < raw.data.sections.length; i++) {
        var sec = raw.data.sections[i];
        if (sec && sec.data && sec.data.items && Array.isArray(sec.data.items) && sec.data.items.length > 0) return true;
        if (sec && sec.data && sec.data.item && Array.isArray(sec.data.item) && sec.data.item.length > 0) return true;
      }
    }
    // response.items
    if (raw.response && raw.response.items && Array.isArray(raw.response.items) && raw.response.items.length > 0) return true;
    return false;
  }

  function emit(raw, kind) {
    if (!hasItems(raw)) return;
    dbg('api hook: EMIT ' + kind + ' items=' + (raw.items ? raw.items.length : (raw.data && raw.data.items ? raw.data.items.length : '?')));
    try {
      window.postMessage({ __tag: KEY, kind: kind, raw: raw }, '*');
    } catch(e) {}
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && input.url) return input.url;
    if (input && input.href) return input.href;
    return '';
  }

  // ---- Fetch proxy ----
  var _realFetch = window.fetch ? window.fetch.bind(window) : null;
  var _fetchHitCount = 0;

  function makeFetchProxy(impl) {
    return function(url, opts) {
      var urlStr = urlOf(url);
      return impl(url, opts).then(function(res) {
        // Catch ANY Shopee API response — don't filter by URL pattern
        if (res.ok && urlStr.indexOf('shopee') > -1 && urlStr.indexOf('/api/') > -1) {
          _fetchHitCount++;
          res.clone().text().then(function(body) {
            try {
              var json = JSON.parse(body);
              if (hasItems(json)) {
                dbg('api hook #' + _fetchHitCount + ': CAPTURED ' + urlStr.slice(0, 80));
                emit(json, 'api');
              }
            } catch(e) {}
          }).catch(function(){});
        }
        return res;
      });
    };
  }

  try {
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      enumerable: true,
      get: function() {
        return _realFetch ? makeFetchProxy(_realFetch) : _realFetch;
      },
      set: function(v) {
        _realFetch = (typeof v === 'function') ? v : v.bind(window);
      }
    });
  } catch(e) {
    if (window.fetch) {
      var _f = window.fetch;
      window.fetch = makeFetchProxy(_f);
    }
  }

  // ---- XHR proxy ----
  var OrigXHR = window.XMLHttpRequest;
  try {
    Object.defineProperty(window, 'XMLHttpRequest', {
      configurable: true,
      enumerable: true,
      get: function() { return HookedXHR; },
      set: function(v) { OrigXHR = v; }
    });
  } catch(e) {}

  function HookedXHR() {
    var xhr = new OrigXHR();
    var _open = xhr.open;
    xhr.open = function(method, url) {
      xhr._url = url;
      return _open.apply(xhr, arguments);
    };
    var _send = xhr.send;
    xhr.send = function() {
      var self = this;
      var url = self._url || '';
      self.addEventListener('load', function() {
        if (self.status === 200 && url.indexOf('shopee') > -1 && url.indexOf('/api/') > -1) {
          try {
            var json = JSON.parse(self.responseText);
            if (hasItems(json)) emit(json, 'api');
          } catch(e) {}
        }
      });
      return _send.apply(self, arguments);
    };
    return xhr;
  }

  dbg('inject.js loaded, hooks ready — catching ALL shopee API responses');
})();
