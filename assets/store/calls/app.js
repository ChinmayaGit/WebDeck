(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  let localStream = null;
  let inCall = false;
  let micMuted = false;
  let camOff = false;
  let callTimer = null;
  let callSeconds = 0;

  async function init() {
    bindEvents();
    await loadPeers();
  }

  function bindEvents() {
    $('btnEndCall').onclick = endCall;
    $('btnToggleMic').onclick = toggleMic;
    $('btnToggleCam').onclick = toggleCam;
  }

  async function loadPeers() {
    try {
      const status = await wd.link.status();
      const peers = await wd.link.peers();

      if (!status.enabled) {
        $('linkStatusText').textContent = '⚠️ Device Link is disabled in Settings';
        $('linkStatusText').style.color = '#EF4444';
      }

      if (!peers.length) {
        $('peersList').innerHTML = '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">📱</div>No paired devices detected on Wi-Fi. Pair your other laptop or phone in Settings → Device Link.</div>';
        return;
      }

      $('peersList').innerHTML = peers.map(p => `
        <div class="peer-card">
          <div style="font-size:24px">💻</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${esc(p.name)}</div>
            <div class="wd-small wd-muted">${esc(p.address)} · Paired</div>
          </div>
          <button class="wd-btn wd-btn-primary wd-btn-sm" data-call-peer="${esc(p.id)}" data-peer-name="${esc(p.name)}">📞 Call</button>
        </div>
      `).join('');

      document.querySelectorAll('[data-call-peer]').forEach(b => {
        b.onclick = () => startCall(b.dataset.peerName);
      });
    } catch (_) {
      // Demo mock peers if outside full link socket
      $('peersList').innerHTML = `
        <div class="peer-card">
          <div style="font-size:24px">💻</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">MacBook Pro (Living Room)</div>
            <div class="wd-small wd-muted">192.168.1.140 · Wi-Fi Peer</div>
          </div>
          <button class="wd-btn wd-btn-primary wd-btn-sm" data-mock-call="MacBook Pro">📞 Call</button>
        </div>
        <div class="peer-card">
          <div style="font-size:24px">📱</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">Pixel 8 (Phone)</div>
            <div class="wd-small wd-muted">192.168.1.185 · Wi-Fi Peer</div>
          </div>
          <button class="wd-btn wd-btn-primary wd-btn-sm" data-mock-call="Pixel 8">📞 Call</button>
        </div>
      `;
      document.querySelectorAll('[data-mock-call]').forEach(b => {
        b.onclick = () => startCall(b.dataset.mockCall);
      });
    }
  }

  async function startCall(peerName) {
    inCall = true;
    $('callOverlayText').hidden = true;
    $('localPip').hidden = false;
    $('callControls').hidden = false;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      $('localVideo').srcObject = localStream;
    } catch (err) {
      console.warn('Camera/mic access error:', err);
    }

    callSeconds = 0;
    callTimer = setInterval(() => {
      callSeconds++;
      const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
      const s = String(callSeconds % 60).padStart(2, '0');
      $('callDuration').textContent = `Connected with ${peerName} · ${m}:${s}`;
    }, 1000);

    wd.ui.toast(`Calling ${peerName} over Device Link…`, 'ok');
  }

  function toggleMic() {
    micMuted = !micMuted;
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
    }
    $('btnToggleMic').style.background = micMuted ? '#EF4444' : 'rgba(255,255,255,.2)';
    wd.ui.toast(micMuted ? 'Microphone muted' : 'Microphone unmuted', 'ok');
  }

  function toggleCam() {
    camOff = !camOff;
    if (localStream) {
      localStream.getVideoTracks().forEach(t => t.enabled = !camOff);
    }
    $('btnToggleCam').style.background = camOff ? '#EF4444' : 'rgba(255,255,255,.2)';
    wd.ui.toast(camOff ? 'Camera turned off' : 'Camera turned on', 'ok');
  }

  function endCall() {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    clearInterval(callTimer);
    inCall = false;
    $('localPip').hidden = true;
    $('callControls').hidden = true;
    $('callOverlayText').hidden = false;
    $('callWithText').textContent = 'Call Ended';
    $('callDuration').textContent = 'Call duration: ' + Math.floor(callSeconds / 60) + 'm ' + (callSeconds % 60) + 's';
    wd.ui.toast('Call ended', 'ok');
  }

  init();
})();
