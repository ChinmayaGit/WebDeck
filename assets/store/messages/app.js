(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const { setup, pairedPeers, icon } = window.LinkKit;
  let peer = null, peers = [], lastCount = -1;

  async function render(force) {
    const on = await setup($('setup'), () => render(true));
    if (!on) { $('main').innerHTML = ''; return; }
    peers = await pairedPeers();
    if (!peer && peers.length) peer = peers[0].id;
    const msgs = peer ? await wd.link.inbox({ channel: 'chat', peer }) : [];
    if (!force && msgs.length === lastCount && $('msgs')) { drawPeers(); return; }
    lastCount = msgs.length;
    const draft = $('text')?.value || '';
    $('main').innerHTML = peers.length ? `<div class="chat">
        <div class="peers wd-list" id="peers"></div>
        <div class="thread"><div class="msgs" id="msgs">${msgs.map((m) => `<div class="b ${m.outgoing ? 'out' : 'in'}">${linkify(m.payload.text || '')}<small>${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('') || '<div class="wd-muted" style="margin:auto">Say hi 👋</div>'}</div>
          <form class="compose" id="form"><textarea class="wd-input" id="text" rows="1" placeholder="Message" style="min-height:40px;resize:none;font-family:var(--wd-font);font-size:14px"></textarea><button class="wd-btn wd-btn-primary">Send</button></form></div></div>`
      : '<div class="wd-empty"><div class="wd-empty-icon">💬</div>Pair a device above to start chatting.</div>';
    if (!peers.length) return;
    $('text').value = draft;
    drawPeers();
    $('msgs').scrollTop = $('msgs').scrollHeight;
    $('form').onsubmit = async (e) => {
      e.preventDefault();
      const text = $('text').value.trim();
      if (!text) return;
      try { await wd.link.send(peer, 'chat', { text }); $('text').value = ''; render(true); } catch (err) { wd.ui.toast(err.message, 'error'); }
    };
    $('text').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit(); } };
  }
  function drawPeers() {
    if (!$('peers')) return;
    $('peers').innerHTML = peers.map((p) => `<div class="wd-item ${p.id === peer ? 'on' : ''}" data-peer="${p.id}"><span>${icon(p.platform)}</span><div class="wd-grow"><div>${esc(p.name)}</div><div class="wd-small ${p.online ? '' : 'wd-muted'}" style="${p.online ? 'color:var(--wd-green)' : ''}">${p.online ? '● online' : 'offline'}</div></div></div>`).join('');
  }
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="#" data-url="$1">$1</a>');
  $('main').addEventListener('click', (e) => {
    const u = e.target.closest('[data-url]');
    if (u) { e.preventDefault(); wd.openUrl(u.dataset.url); return; }
    const p = e.target.closest('[data-peer]');
    if (p) { peer = p.dataset.peer; render(true); }
  });
  render(true);
  setInterval(() => render(false), 2000);
})();
