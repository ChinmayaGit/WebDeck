(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const games = wd.db.collection('games');
  let player = null;

  async function renderLib() {
    const list = await games.find(null, { sort: '-playedAt' });
    $('lib').innerHTML = list.map((g) => `<div class="wd-item wd-clickable" data-id="${g._id}"><div class="wd-grow wd-ellipsis">⚡ ${esc(g.name)}</div><span class="wd-small wd-muted">${wd.ui.timeAgo(g.playedAt)}</span><button class="wd-btn wd-btn-sm wd-btn-ghost" data-rm="${g._id}">✕</button></div>`).join('') ||
      '<div class="wd-small wd-muted">SWF files you open appear here.</div>';
  }

  async function play(g) {
    if (!window.RufflePlayer || !window.RufflePlayer.newest) { wd.ui.toast('Ruffle is missing. Reinstall Flash Player from the Store.', 'error'); return; }
    let file;
    try { file = await wd.files.url(g.path); } catch (e) { wd.ui.toast('File not found: ' + e.message, 'error'); return; }
    await games.update(g._id, { playedAt: new Date().toISOString() });
    if (player) player.remove();
    const ruffle = window.RufflePlayer.newest();
    player = ruffle.createPlayer();
    $('stage').replaceChildren(player);
    $('now').textContent = g.name;
    const api = typeof player.ruffle === 'function' ? player.ruffle() : player;
    try { await api.load({ url: file.url, allowScriptAccess: false, allowNetworking: 'none' }); }
    catch (e) { wd.ui.toast('Could not load this SWF: ' + e.message, 'error'); }
    renderLib();
  }

  async function addAndPlay(files) {
    let first = null;
    for (const f of files) {
      const existing = (await games.find({ path: f.path }))[0];
      const g = existing || (await games.insert({ path: f.path, name: f.name.replace(/\.swf$/i, ''), playedAt: new Date().toISOString() }));
      first = first || g;
    }
    if (first) play(first);
    renderLib();
  }

  $('open').onclick = async () => { try { await addAndPlay(await wd.files.pick({ extensions: ['swf'], multiple: true, remember: true })); } catch (e) { wd.ui.toast(e.message, 'error'); } };
  $('urlForm').onsubmit = async (e) => {
    e.preventDefault();
    const url = $('url').value.trim();
    if (!/^https?:\/\/.+/i.test(url)) return wd.ui.toast('Paste a full link to a .swf file', 'error');
    try {
      const d = await wd.net.download(url, { subdir: 'SWF' });
      await addAndPlay([{ path: d.path, name: d.name }]);
      $('url').value = '';
    } catch (err) { wd.ui.toast(err.message, 'error'); }
  };
  $('lib').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); await games.remove(rm.dataset.rm); return renderLib(); }
    const row = e.target.closest('[data-id]');
    if (row) play(await games.get(row.dataset.id));
  });
  $('full').onclick = () => { if (player) (typeof player.ruffle === 'function' ? player.ruffle() : player).enterFullscreen?.(); };
  renderLib();
})();
