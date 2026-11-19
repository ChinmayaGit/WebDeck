(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  let files = [];
  let zip = null, zipName = '';

  document.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    $('create').hidden = t.dataset.tab !== 'create';
    $('extract').hidden = t.dataset.tab !== 'extract';
  }));

  const done = (el, saved, label) => {
    el.innerHTML = `<div class="wd-card wd-row"><div class="wd-grow">✅ ${esc(label)}</div><button class="wd-btn wd-btn-sm" id="${el.id}-show">Show</button></div>`;
    $(`${el.id}-show`).onclick = () => wd.files.reveal(saved.path);
  };

  // ------------------------------------------------------------ create
  function renderFiles() {
    $('files').innerHTML = files.map((f, i) => `<div class="wd-item"><div class="wd-grow wd-ellipsis">${esc(f.name)}</div><span class="wd-small wd-muted">${wd.ui.formatBytes(f.size)}</span><button class="wd-btn wd-btn-sm wd-btn-ghost" data-rm="${i}">✕</button></div>`).join('') ||
      '<div class="wd-empty" style="padding:24px">Add the files you want to put in the archive.</div>';
    $('sum').textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'} · ${wd.ui.formatBytes(files.reduce((s, f) => s + f.size, 0))}` : '';
    $('zip').disabled = !files.length;
  }
  $('add').onclick = async () => {
    try {
      const picked = await wd.files.pick({ multiple: true });
      for (const f of picked) if (!files.some((x) => x.path === f.path)) files.push(f);
      if (files.length && $('name').value === 'archive' && files.length === 1) $('name').value = files[0].name.replace(/\.[^.]+$/, '');
      renderFiles();
    } catch (e) { wd.ui.toast(e.message, 'error'); }
  };
  $('files').onclick = (e) => { const i = e.target.dataset.rm; if (i != null) { files.splice(+i, 1); renderFiles(); } };
  $('clear').onclick = () => { files = []; renderFiles(); };
  $('zip').onclick = async () => {
    $('zip').disabled = true; $('zip').textContent = 'Compressing…';
    try {
      const z = new JSZip();
      const used = new Set();
      for (const f of files) {
        let name = f.name, n = 2;
        while (used.has(name)) name = f.name.replace(/(\.[^.]+)?$/, ` (${n++})$1`);
        used.add(name);
        z.file(name, new Uint8Array(await (await fetch(f.url)).arrayBuffer()));
      }
      const level = +$('level').value;
      const data = await z.generateAsync({ type: 'uint8array', compression: level ? 'DEFLATE' : 'STORE', compressionOptions: { level: level || 1 } });
      const blob = new Blob([data], { type: 'application/zip' });
      const name = ($('name').value.trim() || 'archive').replace(/\.zip$/i, '') + '.zip';
      const saved = await wd.files.save({ name, blob });
      done($('zipResult'), saved, `${saved.name} · ${wd.ui.formatBytes(saved.size)}`);
    } catch (e) { wd.ui.toast(e.message, 'error'); }
    $('zip').textContent = 'Create ZIP'; $('zip').disabled = !files.length;
  };

  // ----------------------------------------------------------- extract
  $('open').onclick = async () => {
    try {
      const [f] = await wd.files.pick({ extensions: ['zip'] });
      if (!f) return;
      zip = await JSZip.loadAsync(new Uint8Array(await (await fetch(f.url)).arrayBuffer()));
      zipName = f.name.replace(/\.zip$/i, '');
      const entries = Object.values(zip.files).filter((e) => !e.dir && !e.name.startsWith('__MACOSX/') && !e.name.endsWith('.DS_Store'));
      const total = entries.reduce((s, e) => s + (e._data?.uncompressedSize || 0), 0);
      $('zipInfo').textContent = `${f.name} · ${entries.length} files · ${wd.ui.formatBytes(total)} unpacked`;
      $('entries').innerHTML = entries.map((e, i) => `<tr><td class="wd-mono" style="font-size:12px">${esc(e.name)}</td><td>${wd.ui.formatBytes(e._data?.uncompressedSize || 0)}</td><td class="wd-small wd-muted">${e.date ? e.date.toLocaleDateString() : ''}</td><td><button class="wd-btn wd-btn-sm" data-one="${i}">Save</button></td></tr>`).join('');
      $('entries').onclick = async (ev) => {
        const i = ev.target.dataset.one;
        if (i == null) return;
        const e = entries[+i];
        const parts = e.name.split('/');
        const saved = await wd.files.save({ name: parts.pop(), blob: new Blob([await e.async('uint8array')]), subdir: [zipName, ...parts].join('/') });
        wd.ui.toast('Saved ' + saved.name, 'ok');
      };
      $('entriesCard').hidden = false;
      $('all').disabled = !entries.length;
      $('all').onclick = async () => {
        $('all').disabled = true;
        let first;
        for (const [k, e] of entries.entries()) {
          $('all').textContent = `Extracting ${k + 1}/${entries.length}…`;
          const parts = e.name.split('/');
          const saved = await wd.files.save({ name: parts.pop(), blob: new Blob([await e.async('uint8array')]), subdir: [zipName, ...parts].join('/'), overwrite: true });
          first = first || saved;
        }
        $('all').textContent = 'Extract all'; $('all').disabled = false;
        done($('extractResult'), first, `Extracted ${entries.length} files into “${zipName}”`);
      };
    } catch (e) {
      wd.ui.toast(/encrypt/i.test(e.message) ? 'Password-protected ZIPs are not supported' : e.message, 'error');
    }
  };

  renderFiles();
})();
