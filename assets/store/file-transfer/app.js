(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const conns = wd.db.collection('connections');

  const TYPES = {
    ftp: { label: 'FTP / FTPS', fields: [['host', 'Host'], ['port', 'Port', '21'], ['user', 'Username', 'anonymous'], ['pass', 'Password', '', 'password'], ['tls', 'Encryption', 'none', 'select', [['none', 'None (plain FTP)'], ['explicit', 'Explicit TLS (FTPES)'], ['implicit', 'Implicit TLS (FTPS)']]]] },
    sftp: { label: 'SFTP (SSH)', fields: [['host', 'Host'], ['port', 'Port', '22'], ['user', 'Username'], ['pass', 'Password', '', 'password']] },
    webdav: { label: 'WebDAV', fields: [['url', 'Server URL (https://…/remote.php/dav/files/you)'], ['vendor', 'Server type', 'other', 'select', [['other', 'Other'], ['nextcloud', 'Nextcloud'], ['owncloud', 'ownCloud'], ['sharepoint', 'SharePoint']]], ['user', 'Username'], ['pass', 'Password', '', 'password']] },
    smb: { label: 'SMB / Windows share', fields: [['host', 'Host or IP'], ['user', 'Username', 'guest'], ['pass', 'Password', '', 'password'], ['domain', 'Domain', 'WORKGROUP']] },
    s3: { label: 'S3-compatible', fields: [['provider', 'Provider', 'AWS', 'select', [['AWS', 'Amazon S3'], ['Cloudflare', 'Cloudflare R2'], ['Minio', 'MinIO'], ['Wasabi', 'Wasabi'], ['Other', 'Other']]], ['access_key_id', 'Access key ID'], ['secret_access_key', 'Secret key', '', 'password'], ['region', 'Region', 'us-east-1'], ['endpoint', 'Endpoint (blank for AWS)']] },
  };

  // ------------------------------------------------------------- rclone
  async function rclone(args, opts = {}) {
    const t = await wd.tools.run('rclone', args, opts);
    if (t.status !== 'done') {
      const err = (t.lines || []).filter((l) => /ERROR|Failed|failed|error/i.test(l)).pop() || t.error || 'rclone failed';
      throw new Error(err.replace(/^.*?(ERROR|NOTICE)\s*:\s*/, '').slice(0, 300));
    }
    return t;
  }
  const q = (v) => (/[,:="'\s]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

  /** Builds an on-the-fly rclone remote ("connection string") so no config file is needed. */
  function remote(c) {
    const p = [];
    const add = (k, v) => { if (v !== undefined && v !== null && v !== '') p.push(`${k}=${q(v)}`); };
    if (c.type === 'ftp') { add('host', c.host); add('port', c.port); add('user', c.user); add('pass', c.passObscured); if (c.tls === 'explicit') add('explicit_tls', 'true'); if (c.tls === 'implicit') add('tls', 'true'); }
    if (c.type === 'sftp') { add('host', c.host); add('port', c.port); add('user', c.user); add('pass', c.passObscured); }
    if (c.type === 'webdav') { add('url', c.url); add('vendor', c.vendor); add('user', c.user); add('pass', c.passObscured); }
    if (c.type === 'smb') { add('host', c.host); add('user', c.user); add('pass', c.passObscured); add('domain', c.domain); }
    if (c.type === 's3') { add('provider', c.provider); add('access_key_id', c.access_key_id); add('secret_access_key', c.secret_access_key); add('region', c.region); add('endpoint', c.endpoint); }
    return `:${c.type}${p.length ? ',' + p.join(',') : ''}:`;
  }
  const join = (a, b) => (a ? a.replace(/\/$/, '') + '/' : '') + b;

  // --------------------------------------------------------------- setup
  async function checkTool() {
    const s = await wd.tools.status().catch(() => null);
    if (s && s.rclone.installed) { $('setup').hidden = true; return true; }
    $('setup').hidden = false;
    $('setup').innerHTML = s && !s.supported ? '<div class="wd-notice">File Transfer needs WebDeck on macOS, Windows or Linux.</div>'
      : `<div class="wd-row"><div class="wd-grow"><h2>One-time setup</h2><p class="wd-muted" id="smsg">File Transfer uses rclone, a free open-source tool for 70+ storage protocols.</p></div><button class="wd-btn wd-btn-primary" id="inst">Install rclone</button></div>`;
    if ($('inst')) $('inst').onclick = async () => {
      $('inst').disabled = true;
      try { await wd.tools.install('rclone', (p) => ($('smsg').textContent = p.message)); wd.ui.toast('rclone installed', 'ok'); } catch (e) { wd.ui.toast(e.message, 'error'); }
      checkTool();
    };
    return false;
  }

  // --------------------------------------------------------- connections
  let current = null, path = '';
  async function drawConns() {
    const list = await conns.find(null, { sort: 'name' });
    $('conns').innerHTML = list.map((c) => `<div class="conn ${current && current._id === c._id ? 'on' : ''}" data-c="${c._id}"><span>${{ ftp: '📁', sftp: '🔐', webdav: '☁️', smb: '🖧', s3: '🪣' }[c.type]}</span>
      <div class="wd-grow" style="min-width:0"><div class="wd-ellipsis">${esc(c.name)}</div><div class="wd-small wd-muted wd-ellipsis">${esc(TYPES[c.type].label)} · ${esc(c.host || c.url || c.provider || '')}</div></div>
      <a href="#" data-edit="${c._id}" class="wd-small">Edit</a></div>`).join('') || '<div class="wd-small wd-muted">No connections yet.</div>';
  }
  $('conns').onclick = async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { e.preventDefault(); e.stopPropagation(); return editConn(await conns.get(ed.dataset.edit)); }
    const c = e.target.closest('[data-c]');
    if (c) { current = await conns.get(c.dataset.c); path = current.path || ''; drawConns(); browse(); }
  };
  $('new').onclick = () => editConn({ type: 'ftp' });

  function editConn(c) {
    const dlg = $('dlg');
    const draw = () => {
      const t = TYPES[c.type];
      dlg.innerHTML = `<h2>${c._id ? 'Edit connection' : 'New connection'}</h2>
        <div class="wd-fields" style="margin-top:12px">
          <div><label class="wd-label">Name</label><input class="wd-input" data-k="name" value="${esc(c.name || '')}" placeholder="My server"></div>
          <div><label class="wd-label">Protocol</label><select class="wd-select" id="ctype">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === c.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
          ${t.fields.map(([k, label, def = '', kind = 'text', opts]) => kind === 'select'
            ? `<div><label class="wd-label">${label}</label><select class="wd-select" data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${(c[k] ?? def) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`
            : `<div><label class="wd-label">${label}</label><input class="wd-input" type="${kind}" data-k="${k}" value="${esc(k === 'pass' ? '' : c[k] ?? def)}" placeholder="${k === 'pass' && c.passObscured ? '(unchanged)' : esc(def)}"></div>`).join('')}
          <div><label class="wd-label">Start folder ${c.type === 's3' ? '(bucket/prefix)' : c.type === 'smb' ? '(share/folder)' : ''}</label><input class="wd-input" data-k="path" value="${esc(c.path || '')}" placeholder="/"></div>
        </div>
        <p class="wd-small wd-muted" style="margin-top:10px">Passwords are stored obscured (not strongly encrypted) in this app's private data.</p>
        <div class="wd-row" style="margin-top:12px">${c._id ? '<button class="wd-btn wd-btn-danger" id="cdel">Delete</button>' : ''}<div class="wd-spacer"></div><button class="wd-btn" id="ctest">Test</button><button class="wd-btn" id="ccancel">Cancel</button><button class="wd-btn wd-btn-primary" id="csave">Save</button></div>
        <div id="cmsg" class="wd-small" style="margin-top:8px"></div>`;
      $('ctype').onchange = () => { collect(); c.type = $('ctype').value; draw(); };
      $('ccancel').onclick = () => dlg.close();
      $('ctest').onclick = async () => { $('cmsg').textContent = 'Connecting…'; try { await collect(true); await rclone(['lsjson', '--max-depth', '1', remote(c) + (c.path || '')]); $('cmsg').innerHTML = '<span style="color:var(--wd-green)">✓ Connected</span>'; } catch (err) { $('cmsg').innerHTML = `<span style="color:var(--wd-red)">${esc(err.message)}</span>`; } };
      $('csave').onclick = async () => {
        try {
          await collect(true);
          if (!c.name) c.name = c.host || c.url || c.provider || 'Server';
          const { _id, _createdAt, _updatedAt, ...data } = c;
          if (_id) await conns.update(_id, data); else Object.assign(c, await conns.insert(data));
          dlg.close(); current = c; path = c.path || ''; drawConns(); browse();
        } catch (err) { $('cmsg').textContent = err.message; }
      };
      if ($('cdel')) $('cdel').onclick = async () => { await conns.remove(c._id); if (current && current._id === c._id) current = null; dlg.close(); drawConns(); };
    };
    async function collect(obscure) {
      dlg.querySelectorAll('[data-k]').forEach((el) => { if (el.dataset.k === 'pass') { if (el.value) c._newPass = el.value; } else c[el.dataset.k] = el.value.trim(); });
      if (obscure && c._newPass) {
        if (!(await checkTool())) throw new Error('Install rclone first');
        const t = await rclone(['obscure', c._newPass]);
        c.passObscured = t.lines.filter(Boolean).pop().trim();
        delete c._newPass;
      }
    }
    draw();
    if (!dlg.open) dlg.showModal();
  }

  // ------------------------------------------------------------- browser
  let items = [];
  async function browse() {
    if (!current) return;
    if (!(await checkTool())) return;
    const crumbs = ['', ...path.split('/').filter(Boolean)];
    $('browser').innerHTML = `<div class="wd-row" style="margin-bottom:10px">
        <div class="crumbs wd-grow">${crumbs.map((p, i) => `<button data-crumb="${i}">${i === 0 ? esc(current.name) : esc(p)}</button>${i < crumbs.length - 1 ? '<span class="wd-muted">/</span>' : ''}`).join('')}</div>
        <button class="wd-btn wd-btn-sm" id="up">Upload</button><button class="wd-btn wd-btn-sm" id="mk">New folder</button><button class="wd-btn wd-btn-sm" id="rf">↻</button></div>
      <div id="listing"><div class="wd-progress wd-indeterminate"><div></div></div></div>`;
    try {
      const t = await rclone(['lsjson', '--max-depth', '1', '--no-mimetype', remote(current) + path]);
      const text = t.lines.join('\n');
      items = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1) || '[]').sort((a, b) => (b.IsDir - a.IsDir) || a.Name.localeCompare(b.Name));
      $('listing').innerHTML = items.length ? `<table class="wd-table files"><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr>
        ${items.map((f, i) => `<tr class="${f.IsDir ? 'dir' : ''}"><td data-open="${i}">${f.IsDir ? '📁' : '📄'} ${esc(f.Name)}</td><td class="wd-small wd-muted">${f.IsDir ? '' : wd.ui.formatBytes(f.Size)}</td>
          <td class="wd-small wd-muted">${f.ModTime ? new Date(f.ModTime).toLocaleString() : ''}</td>
          <td style="text-align:right;white-space:nowrap">${f.IsDir ? '' : `<button class="wd-btn wd-btn-sm" data-dl="${i}">Download</button>`}<button class="wd-btn wd-btn-sm wd-btn-ghost" data-rm="${i}">Delete</button></td></tr>`).join('')}</table>`
        : '<div class="wd-empty" style="padding:24px">This folder is empty.</div>';
    } catch (e) {
      $('listing').innerHTML = `<div class="wd-error">${esc(e.message)}</div>`;
    }
  }

  $('browser').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-crumb],[data-open],[data-dl],[data-rm],#up,#mk,#rf');
    if (!b) return;
    if (b.dataset.crumb) { path = path.split('/').filter(Boolean).slice(0, +b.dataset.crumb).join('/'); return browse(); }
    if (b.dataset.open) { const f = items[+b.dataset.open]; if (f.IsDir) { path = join(path, f.Name); browse(); } return; }
    if (b.id === 'rf') return browse();
    if (b.dataset.dl) return transfer('down', items[+b.dataset.dl]);
    if (b.dataset.rm) {
      const f = items[+b.dataset.rm];
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirm'; return; }
      try { await rclone([f.IsDir ? 'purge' : 'deletefile', remote(current) + join(path, f.Name)]); wd.ui.toast(`Deleted ${f.Name}`, 'ok'); } catch (err) { wd.ui.toast(err.message, 'error'); }
      return browse();
    }
    if (b.id === 'mk') {
      const dlg = $('dlg');
      dlg.innerHTML = `<h2>New folder</h2><input class="wd-input" id="fname" style="margin:12px 0" placeholder="Folder name"><div class="wd-row"><div class="wd-spacer"></div><button class="wd-btn" id="fx">Cancel</button><button class="wd-btn wd-btn-primary" id="fok">Create</button></div>`;
      dlg.showModal();
      $('fx').onclick = () => dlg.close();
      $('fok').onclick = async () => { const n = $('fname').value.trim(); dlg.close(); if (!n) return; try { await rclone(['mkdir', remote(current) + join(path, n)]); } catch (err) { wd.ui.toast(err.message, 'error'); } browse(); };
      return;
    }
    if (b.id === 'up') {
      const picked = await wd.files.pick({ multiple: true }).catch((err) => { wd.ui.toast(err.message, 'error'); return []; });
      for (const f of picked) await transfer('up', f);
      browse();
    }
  });

  // ------------------------------------------------------------ transfers
  const active = [];
  async function transfer(dir, f) {
    const t = { name: f.Name || f.name, dir, pct: 0, status: 'running', conn: current.name };
    active.unshift(t);
    drawTransfers();
    const stats = ['--stats', '1s', '--stats-one-line', '--stats-log-level', 'NOTICE', '--retries', '2'];
    const onLine = (l) => { const m = /(\d+)%/.exec(l); if (m) { t.pct = +m[1]; drawTransfers(); } };
    try {
      if (dir === 'down') {
        const sub = current.name.replace(/[\\/:*?"<>|]/g, '_');
        const r = await rclone(['copyto', ...stats, remote(current) + join(path, f.Name), f.Name], { subdir: sub, onLine, onStart: (k) => (t.task = k.id) });
        t.path = (r.outputFiles || [])[0];
      } else {
        await rclone(['copyto', ...stats, f.path, remote(current) + join(path, f.name)], { onLine, onStart: (k) => (t.task = k.id) });
      }
      t.status = 'done'; t.pct = 100;
      wd.notify(dir === 'down' ? 'Download complete' : 'Upload complete', t.name).catch(() => {});
    } catch (e) { t.status = 'failed'; t.error = e.message; }
    drawTransfers();
  }
  function drawTransfers() {
    $('transfers').hidden = !active.length;
    $('tlist').innerHTML = active.slice(0, 30).map((t, i) => `<div class="wd-item"><span>${t.dir === 'down' ? '⬇️' : '⬆️'}</span>
      <div class="wd-grow" style="min-width:0"><div class="wd-ellipsis">${esc(t.name)} <span class="wd-small wd-muted">· ${esc(t.conn)}</span></div>
        ${t.status === 'running' ? `<div class="wd-progress" style="margin-top:6px"><div style="width:${t.pct}%"></div></div>` : t.status === 'failed' ? `<div class="wd-small" style="color:var(--wd-red)">${esc(t.error)}</div>` : '<div class="wd-small" style="color:var(--wd-green)">Done</div>'}</div>
      ${t.status === 'running' && t.task ? `<button class="wd-btn wd-btn-sm" data-cancel="${i}">Cancel</button>` : t.path ? `<button class="wd-btn wd-btn-sm" data-show="${i}">Show</button>` : ''}</div>`).join('');
  }
  $('tlist').onclick = (e) => {
    const c = e.target.dataset.cancel, s = e.target.dataset.show;
    if (c != null) wd.tools.cancel(active[+c].task);
    if (s != null) wd.files.reveal(active[+s].path);
  };
  $('folder').onclick = () => wd.files.openFolder().catch((e) => wd.ui.toast(e.message, 'error'));

  checkTool();
  drawConns();
})();
