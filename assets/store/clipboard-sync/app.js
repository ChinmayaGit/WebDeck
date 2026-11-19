(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const { setup, pairedPeers } = window.LinkKit;
  let q = '';

  async function render() {
    const on = await setup($('setup'), render);
    if (!on) { $('main').innerHTML = ''; return; }
    const st = await wd.link.status();
    const peers = await pairedPeers();
    const hist = await wd.link.clipboard.history();
    const draft = $('send')?.value || '';
    const focused = document.activeElement?.id;
    $('main').innerHTML = `
      <div class="wd-card wd-stack">
        <label class="wd-row"><input type="checkbox" id="sync" ${st.clipboardSync ? 'checked' : ''}> <b>Sync my clipboard automatically</b></label>
        <p class="wd-small wd-muted">${peers.length ? `Shared with ${peers.filter((p) => p.online).length} online of ${peers.length} paired device${peers.length === 1 ? '' : 's'}. WebDeck must be open on each device.` : 'Pair a device above to start syncing.'}</p>
        <div class="wd-row"><input class="wd-input wd-grow" id="send" placeholder="Type or paste text to send to your devices' clipboards"><button class="wd-btn wd-btn-primary" id="go">Send</button></div>
      </div>
      <div class="wd-row" style="margin:18px 0 8px"><h2 class="wd-grow">History</h2><input class="wd-input" id="q" placeholder="Search…" style="max-width:220px" value="${esc(q)}"></div>
      <div class="wd-list">${hist.filter((h) => !q || h.text.toLowerCase().includes(q.toLowerCase())).map((h, i) => `<div class="wd-item"><div class="wd-grow" style="min-width:0"><div class="clip">${esc(h.text)}</div><div class="wd-small wd-muted">${esc(h.from)} · ${wd.ui.timeAgo(h.at)}</div></div><button class="wd-btn wd-btn-sm" data-copy="${i}">Copy</button></div>`).join('') || '<div class="wd-empty">Copied text from this and your paired devices shows up here.</div>'}</div>`;
    $('send').value = draft;
    if (focused === 'send' || focused === 'q') { $(focused).focus(); }
    $('sync').onchange = () => wd.link.clipboard.setSync($('sync').checked);
    $('go').onclick = async () => { const t = $('send').value; if (!t) return; const n = await wd.link.clipboard.share(t); $('send').value = ''; wd.ui.toast(`Sent to ${n} device${n === 1 ? '' : 's'}`, 'ok'); render(); };
    $('q').oninput = (e) => { q = e.target.value; render(); };
    $('main').querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => { await wd.link.clipboard.copy(hist.filter((h) => !q || h.text.toLowerCase().includes(q.toLowerCase()))[+b.dataset.copy].text); wd.ui.toast('Copied', 'ok'); }));
  }
  render();
  setInterval(() => { if (!['send', 'q'].includes(document.activeElement?.id)) render(); }, 3000);
})();
