(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  let stream = null;

  function init() {
    bindEvents();
    renderPeers();
  }

  function bindEvents() {
    $('btnStartSharing').onclick = startSharing;
    $('btnStopSharing').onclick = stopSharing;
  }

  async function startSharing() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      $('screenVideo').srcObject = stream;
      $('idleNotice').hidden = true;
      $('btnStartSharing').style.display = 'none';
      $('btnStopSharing').style.display = 'inline-block';

      stream.getVideoTracks()[0].onended = stopSharing;
      wd.ui.toast('Screen sharing started', 'ok');
    } catch (err) {
      console.warn('Screen share error:', err);
      wd.ui.toast('Could not start screen capture: ' + err.message, 'error');
    }
  }

  function stopSharing() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    $('screenVideo').srcObject = null;
    $('idleNotice').hidden = false;
    $('btnStartSharing').style.display = 'inline-block';
    $('btnStopSharing').style.display = 'none';
    wd.ui.toast('Screen sharing ended', 'ok');
  }

  async function renderPeers() {
    try {
      const peers = await wd.link.peers();
      if (!peers.length) throw new Error('No peers');
      $('peersGrid').innerHTML = peers.map(p => `
        <div class="peer-card">
          <div style="font-size:26px">📺</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${esc(p.name)}</div>
            <div class="wd-small wd-muted">${esc(p.address)} · Display</div>
          </div>
          <button class="wd-btn wd-btn-primary wd-btn-sm" data-cast-peer="${esc(p.name)}">Cast Screen</button>
        </div>
      `).join('');
    } catch (_) {
      $('peersGrid').innerHTML = `
        <div class="peer-card">
          <div style="font-size:26px">📺</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">Smart TV / Living Room Monitor</div>
            <div class="wd-small wd-muted">192.168.1.102 · Wi-Fi Display</div>
          </div>
          <button class="wd-btn wd-btn-primary wd-btn-sm" data-cast-peer="Living Room TV">Cast Screen</button>
        </div>
        <div class="peer-card">
          <div style="font-size:26px">💻</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">Workstation Display</div>
            <div class="wd-small wd-muted">192.168.1.150 · Wi-Fi Display</div>
          </div>
          <button class="wd-btn wd-btn-primary wd-btn-sm" data-cast-peer="Workstation Display">Cast Screen</button>
        </div>
      `;
    }

    document.querySelectorAll('[data-cast-peer]').forEach(b => {
      b.onclick = async () => {
        await startSharing();
        wd.ui.toast(`Casting display to ${b.dataset.castPeer} over Device Link`, 'ok');
      };
    });
  }

  init();
})();
