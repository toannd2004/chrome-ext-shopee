// relay.js — ISOLATED world: Bridge MAIN world ↔ background SW
// Receives window.postMessage from inject.js/dom.js, forwards via chrome.runtime.sendMessage
// Also listens to chrome.storage.onChanged for pickerMode control
(function() {
  'use strict';

  var KEY = '__shopeeScrape';
  var DBG_KEY = '__shopeeDbg';

  function dbg(msg) {
    try { chrome.runtime.sendMessage({ type: 'DBG', msg: '[relay] ' + String(msg) }).catch(function() {}); } catch(e) {}
  }

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;

    if (e.data.__tag === DBG_KEY) {
      chrome.runtime.sendMessage({ type: 'DBG', msg: String(e.data.msg || '') }).catch(function() {});
      return;
    }

    if (e.data.__tag === KEY) {
      var kind = e.data.kind;
      var raw = e.data.raw;
      var page = e.data.page || '';

      if (kind === 'api') {
        chrome.runtime.sendMessage({ type: 'HOOK_ITEMS', raw: raw, page: page }).catch(function() {});
      } else if (kind === 'dom') {
        chrome.runtime.sendMessage({ type: 'DOM_ITEMS', raw: raw, page: page }).catch(function() {});
      } else if (kind === 'picker') {
        if (e.data.selected === false) {
          chrome.runtime.sendMessage({ type: 'PICKER_UNSELECT', item: e.data.item, page: page }).catch(function() {});
        } else {
          dbg('forwarding PICKER_ITEM id=' + (e.data.item && e.data.item.id));
          chrome.runtime.sendMessage({ type: 'PICKER_ITEM', item: e.data.item, page: page }).catch(function(err) {
            dbg('PICKER_ITEM send failed: ' + (err && err.message));
          });
        }
      }
    }
  });

  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;
    if ('pickerMode' in changes) {
      var active = !!changes.pickerMode.newValue;
      dbg('pickerMode changed: ' + active);
      window.postMessage({ type: 'PICKER_MODE', active: active }, '*');
    }
  });
})();
