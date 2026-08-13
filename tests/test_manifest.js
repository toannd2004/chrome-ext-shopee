// test_manifest.js — Validate manifest.json structure
// Run: node test_manifest.js

var fs = require('fs');
var path = require('path');

var manifestPath = path.join(__dirname, '..', 'manifest.json');
var m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

var passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + msg); }
}

function check(name, val, expected) {
  if (expected !== undefined) assert(val === expected, name + ': expected ' + expected + ', got ' + val);
  else assert(!!val, name + ': must be truthy, got ' + val);
}

// Required manifest_version
check('manifest_version', m.manifest_version, 3);

// Required fields
check('name', m.name);
check('version', m.version);

// Background
assert(m.background && m.background.service_worker, 'background.service_worker');
assert(fs.existsSync(path.join(__dirname, '..', m.background.service_worker)), 'background.js exists');

// Side panel
assert(m.side_panel && m.side_panel.default_path, 'side_panel.default_path');
assert(fs.existsSync(path.join(__dirname, '..', m.side_panel.default_path)), 'sidepanel.html exists');

// No oauth2 block (we use launchWebAuthFlow, not getAuthToken)
assert(!m.oauth2, 'No oauth2 block (use launchWebAuthFlow)');

// Required permissions
var perms = m.permissions || [];
var requiredPerms = ['storage', 'sidePanel', 'tabs', 'identity'];
requiredPerms.forEach(function(p) {
  assert(perms.indexOf(p) > -1, 'permission: ' + p);
});

// Host permissions
var hosts = m.host_permissions || [];
var requiredHosts = ['https://shopee.vn/*', 'https://www.googleapis.com/*', 'https://accounts.google.com/*'];
requiredHosts.forEach(function(h) {
  assert(hosts.indexOf(h) > -1, 'host_permission: ' + h);
});

// Content scripts
var cs = m.content_scripts || [];
assert(cs.length >= 3, 'content_scripts: at least 3 entries');

// Check MAIN world scripts inject on search pages
var mainScripts = cs.filter(function(c) { return c.world === 'MAIN'; });
assert(mainScripts.length >= 2, 'MAIN world scripts: at least 2');

// Check ISOLATED world scripts
var isoScripts = cs.filter(function(c) { return !c.world || c.world !== 'MAIN'; });
assert(isoScripts.length >= 1, 'ISOLATED world scripts: at least 1');

// Verify all JS files exist
cs.forEach(function(c) {
  (c.js || []).forEach(function(jsFile) {
    var fp = path.join(__dirname, '..', jsFile);
    assert(fs.existsSync(fp), 'content_script file exists: ' + jsFile);
  });
});

// Verify lib files exist
['lib/sheet.js', 'lib/drive.js'].forEach(function(f) {
  assert(fs.existsSync(path.join(__dirname, '..', f)), 'lib file exists: ' + f);
});

// Verify icons exist
['icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'].forEach(function(f) {
  assert(fs.existsSync(path.join(__dirname, '..', f)), 'icon exists: ' + f);
  var stat = fs.statSync(path.join(__dirname, '..', f));
  assert(stat.size > 100, 'icon size > 100 bytes: ' + f + ' (' + stat.size + ' bytes)');
});

console.log('\n=== Manifest Tests: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
