// lib/drive.js — Google Drive upload + manage (Tab2: Ảnh & Drive)
// Uses the same OAuth token from lib/sheet.js

(function() {
  // Fetch image as blob
  async function fetchImage(url) {
    var res = await fetch(url);
    if (!res.ok) throw new Error('Không tải được ảnh: ' + url);
    return await res.blob();
  }

  // Get or create a folder by name
  async function getOrCreateFolder(name, parentId, token) {
    var searchUrl = 'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent(
        "name='" + escapeName(name) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false" +
        (parentId ? " and '" + parentId + "' in parents" : '')
      ) + '&fields=files(id,name)';

    var res = await fetch(searchUrl, { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) {
      var j = await res.json();
      if (j.files && j.files.length > 0) return { id: j.files[0].id, isNew: false };
    }

    // Create folder
    var body = {
      name: name,
      mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) body.parents = [parentId];

    var createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var createJ = await createRes.json();
    if (!createRes.ok) throw new Error((createJ.error && createJ.error.message) || 'HTTP ' + createRes.status);
    return { id: createJ.id, isNew: true };
  }

  // List files in a folder
  async function listFolderFiles(folderId, token) {
    var url = 'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent("'" + folderId + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'") +
      '&orderBy=name&fields=files(id,name)';
    var res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return [];
    var j = await res.json();
    return j.files || [];
  }

  // Upload a file to Drive
  async function uploadFile(blob, filename, folderId, token) {
    var metadata = { name: filename, parents: [folderId] };
    var form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob, filename);

    var res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form
    });
    var j = await res.json();
    if (!res.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + res.status);
    return j.id;
  }

  // Set public permission on a file
  async function setPublicPermission(fileId, token) {
    await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '/permissions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
  }

  // Trash a file
  async function trashFile(fileId, token) {
    await fetch('https://www.googleapis.com/drive/v3/files/' + fileId, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
  }

  // Sanitize folder name
  function sanitizeFolderName(name) {
    return String(name || '').replace(/[\/\\?%*:|\"<>]/g, '-').trim().substring(0, 100) || 'unknown';
  }

  // Escape name for Drive query
  function escapeName(name) {
    return String(name || '').replace(/'/g, "\\'");
  }

  // Main upload flow
  async function uploadImages(images, productName, forceUpdate, onProgress, token) {
    var rootName = 'shopee-products';
    // Try to get configured root name from storage
    try {
      var stash = await chrome.storage.local.get(['gsConfig']);
      if (stash.gsConfig && stash.gsConfig.driveRoot) {
        rootName = stash.gsConfig.driveRoot;
      }
    } catch (e) {}

    var rootRes = await getOrCreateFolder(rootName, null, token);
    var safeName = sanitizeFolderName(productName);
    var folderRes = await getOrCreateFolder(safeName, rootRes.id, token);

    if (!folderRes.isNew && !forceUpdate) {
      // Check if folder has files already
      var existingFiles = await listFolderFiles(folderRes.id, token);
      if (existingFiles.length > 0) {
        // Return existing results
        var results = existingFiles.map(function(f, i) {
          return {
            filename: f.name,
            fileId: f.id,
            driveLink: 'https://drive.google.com/uc?id=' + f.id
          };
        });
        return {
          success: true,
          alreadyExists: true,
          productName: productName,
          folderId: folderRes.id,
          folderLink: 'https://drive.google.com/drive/folders/' + folderRes.id,
          results: results
        };
      }
    }

    // Force update: trash old files
    if (!folderRes.isNew && forceUpdate) {
      var oldFiles = await listFolderFiles(folderRes.id, token);
      for (var i = 0; i < oldFiles.length; i++) {
        await trashFile(oldFiles[i].id, token);
      }
    }

    // Upload images
    var results = [];
    for (var i = 0; i < images.length; i++) {
      var filename = String(i + 1).padStart(2, '0') + '.jpg';
      try {
        if (onProgress) onProgress(i + 1, images.length, filename);
        var blob = await fetchImage(images[i]);
        var fileId = await uploadFile(blob, filename, folderRes.id, token);
        await setPublicPermission(fileId, token);
        results.push({
          filename: filename,
          fileId: fileId,
          driveLink: 'https://drive.google.com/uc?id=' + fileId
        });
      } catch (e) {
        results.push({
          filename: filename,
          error: e.message || 'Lỗi upload'
        });
      }
    }

    return {
      success: true,
      alreadyExists: false,
      productName: productName,
      folderId: folderRes.id,
      folderLink: 'https://drive.google.com/drive/folders/' + folderRes.id,
      results: results
    };
  }

  window.Drive = {
    uploadImages: uploadImages,
    trashFile: trashFile,
    getOrCreateFolder: getOrCreateFolder,
    listFolderFiles: listFolderFiles
  };
})();
