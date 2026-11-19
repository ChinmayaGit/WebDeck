(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const { setup, pairedPeers, icon } = window.LinkKit;
  let sending = {};

  async function render() {
    const on = await setup($('setup'), render);
    if (!on) { $('main').innerHTML = ''; return; }
    const peers = await pairedPeers();
    const items = (await wd.link.inbox({ channel: 'files' })).reverse();
    $('main').innerHTML = `
      <div class="wd-card"><h2 style="margin-bottom:10px">Send files to…</h2>
        ${peers.length ? `<div class="dev">${peers.map((p) => `<button data-peer="${p.id}" class="${p.online ? '' : 'off'}"><span class="ic">${icon(p.platform)}</span><b>${esc(p.name)}</b><div class="wd-small wd-muted">${sending[p.id] || (p.online ? 'Online' : 'Offline')}</div></button>`).join('')}</div>`
          : '<p class="wd-muted">Pair a device above first.</p>'}
      </div>
      <div class="wd-row" style="margin:18px 0 8px"><h2 class="wd-grow">Received &amp; sent</h2><button class="wd-btn wd-btn-sm" id="openRecv">Open Received folder</button><button class="wd-btn wd-btn-sm wd-btn-ghost" id="clear">Clear list</button></div>
      <div class="wd-list">${items.map((m) => `<div class="wd-item"><span>${m.outgoing ? '⬆️' : '⬇️'}</span>
          <div class="wd-grow" style="min-width:0"><div class="wd-ellipsis">${esc(m.payload.name)}</div><div class="wd-small wd-muted">${m.outgoing ? 'to' : 'from'} ${esc(m.peerName)} · ${wd.ui.formatBytes(m.payload.size)} · ${wd.ui.timeAgo(m.at)}</div></div>
          ${m.outgoing ? '' : `<button class="wd-btn wd-btn-sm" data-open="${esc(m.payload.path)}">Open</button><button class="wd-btn wd-btn-sm" data-show="${esc(m.payload.path)}">Show</button>`}</div>`).join('') || '<div class="wd-empty">Files you send or receive appear here.</div>'}</div>`;
  }

  $('main').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.open) return wd.files.open(b.dataset.open).catch((err) => wd.ui.toast(err.message, 'error'));
    if (b.dataset.show) return wd.files.reveal(b.dataset.show).catch((err) => wd.ui.toast(err.message, 'error'));
    if (b.id === 'clear') { await wd.link.clearInbox('files'); return render(); }
    if (b.id === 'openRecv') { const dir = await wd.link.receivedDir(); return wd.files.reveal(dir).catch(() => wd.ui.toast(dir)); }
    if (b.dataset.peer) {
      const files = await wd.files.pick({ multiple: true }).catch((err) => { wd.ui.toast(err.message, 'error'); return []; });
      const id = b.dataset.peer;
      for (const [i, f] of files.entries()) {
        sending[id] = `Sending ${i + 1}/${files.length}…`;
        render();
        try { await wd.link.sendFile(id, f.path); } catch (err) { wd.ui.toast(err.message, 'error'); break; }
      }
      delete sending[id];
      if (files.length) wd.ui.toast(`Sent ${files.length} file${files.length === 1 ? '' : 's'}`, 'ok');
      render();
    }
  });

  render();
  setInterval(render, 4000);
})();
