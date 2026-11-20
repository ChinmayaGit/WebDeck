(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  // Audio Context for DTMF, Ringback, and Ringtone synthesizers
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // DTMF frequency map (Row x Column)
  const DTMF_FREQS = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
  };

  function playDtmf(digit) {
    try {
      const ctx = getAudioCtx();
      if (!ctx || !DTMF_FREQS[digit]) return;
      const [f1, f2] = DTMF_FREQS[digit];
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.value = f1;
      osc2.frequency.value = f2;
      osc1.type = 'sine';
      osc2.type = 'sine';

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.18);
      osc2.stop(now + 0.18);
    } catch (_) {}
  }

  // Ringback generator (Standard 440Hz + 480Hz tone)
  let ringbackInterval = null;
  function startRingback() {
    stopRingback();
    function pulse() {
      try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.setValueAtTime(0.08, now + 1.6);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.85);
        osc2.stop(now + 1.85);
      } catch (_) {}
    }
    pulse();
    ringbackInterval = setInterval(pulse, 4000);
  }

  function stopRingback() {
    if (ringbackInterval) {
      clearInterval(ringbackInterval);
      ringbackInterval = null;
    }
  }

  // Incoming Call Ringtone synthesizer loop
  let ringtoneInterval = null;
  function startRingtone() {
    stopRingtone();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    function ringArpeggio() {
      try {
        const ctx = getAudioCtx();
        if (!ctx) return;
        notes.forEach((freq, idx) => {
          const startTime = ctx.currentTime + idx * 0.12;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.18, startTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.45);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.5);
        });
      } catch (_) {}
    }
    ringArpeggio();
    ringtoneInterval = setInterval(ringArpeggio, 2500);
  }

  function stopRingtone() {
    if (ringtoneInterval) {
      clearInterval(ringtoneInterval);
      ringtoneInterval = null;
    }
  }

  // --- App State ---
  let myProfile = null;
  let myStatus = null;
  let activeTransport = 'auto';
  let dialInputString = '';
  let inCall = false;
  let localStream = null;
  let callTimer = null;
  let callSeconds = 0;
  let micMuted = false;
  let camOff = false;
  let speakerOn = true;
  let visualizerAnimId = null;
  let incomingCallData = null;
  let activeCallPeerId = null;
  let activeCallId = null;
  let peerProfiles = {}; // Map of peerId -> { name, number }

  function cleanNumber(num) {
    return String(num || '').replace(/[^0-9]/g, '');
  }

  function generateNumberForId(idStr) {
    let hash = 0;
    for (let i = 0; i < idStr.length; i++) hash = ((hash << 5) - hash) + idStr.charCodeAt(i);
    hash = Math.abs(hash);
    const area = 200 + (hash % 700);
    const mid = 200 + (Math.floor(hash / 700) % 700);
    const line = 1000 + (Math.floor(hash / 490000) % 8999);
    return `+1 (${area}) ${mid}-${line}`;
  }

  function generateRandomNumber() {
    const area = Math.floor(200 + Math.random() * 799);
    const mid = Math.floor(200 + Math.random() * 799);
    const line = Math.floor(1000 + Math.random() * 8999);
    return `+1 (${area}) ${mid}-${line}`;
  }

  // Load user profile
  async function loadProfile() {
    try {
      if (wd && wd.link) myStatus = await wd.link.status();
    } catch (_) {}

    try {
      if (wd && wd.kv) myProfile = await wd.kv.get('caller_profile');
    } catch (_) {}
    if (!myProfile) {
      const stored = localStorage.getItem('wd_caller_profile');
      if (stored) {
        try { myProfile = JSON.parse(stored); } catch (_) {}
      }
    }

    if (!myProfile || !myProfile.number) {
      const defaultName = (myStatus && myStatus.deviceName) ? myStatus.deviceName : 'My Device';
      const randNum = (myStatus && myStatus.deviceId) ? generateNumberForId(myStatus.deviceId) : generateRandomNumber();
      myProfile = {
        id: (myStatus && myStatus.deviceId) ? myStatus.deviceId : 'user-' + Date.now(),
        name: defaultName,
        number: randNum,
        updatedAt: new Date().toISOString()
      };
      try {
        if (wd && wd.kv) await wd.kv.set('caller_profile', myProfile);
      } catch (_) {}
      localStorage.setItem('wd_caller_profile', JSON.stringify(myProfile));
    }

    updateProfilePill();
  }

  function updateProfilePill() {
    if (myProfile) {
      $('pillName').textContent = myProfile.name || 'My Device';
      $('pillNumber').textContent = myProfile.number || 'No number';
      $('callerBadge').textContent = `${myProfile.number}${cloudOk ? ' · 🌐 Online' : ' · Wi-Fi only'}`;
      $('callerBadge').title = cloudOk ? 'Reachable over the internet' : 'Internet calling is offline; only paired devices on this Wi-Fi can call you';
      if ($('bannerMyNumber')) {
        $('bannerMyNumber').textContent = myProfile.number;
      }
    }
  }

  // Check if number is already taken
  async function checkNumberAvailability(enteredNumber, ignoreId) {
    const cleaned = cleanNumber(enteredNumber);
    if (!cleaned || cleaned.length < 4) {
      return { available: false, msg: 'Enter at least 4 digits.' };
    }
    const dir = await getDirectory();
    for (const c of dir) {
      if (ignoreId && c.id === ignoreId) continue;
      if (cleanNumber(c.number) === cleaned) {
        return {
          available: false,
          msg: `⚠️ Number is already assigned to "${c.name}".`
        };
      }
    }
    if (cloudOk) {
      try {
        if (!(await wd.cloud.available(enteredNumber))) {
          return { available: false, msg: '⚠️ That number is taken by another WebDeck user.' };
        }
      } catch (_) {}
    }
    return { available: true, msg: '✓ Number is available!' };
  }

  // Directory handling
  async function getSavedContacts() {
    let saved = [];
    try {
      if (wd && wd.kv) saved = (await wd.kv.get('caller_custom_contacts')) || [];
    } catch (_) {}
    if (!saved || !saved.length) {
      const stored = localStorage.getItem('wd_caller_custom_contacts');
      if (stored) {
        try { saved = JSON.parse(stored); } catch (_) {}
      }
    }
    return saved || [];
  }

  async function saveCustomContacts(list) {
    try {
      if (wd && wd.kv) await wd.kv.set('caller_custom_contacts', list);
    } catch (_) {}
    localStorage.setItem('wd_caller_custom_contacts', JSON.stringify(list));
  }

  async function getDirectory() {
    const list = [];
    // 1. Paired real devices from Device Link
    try {
      if (wd && wd.link) {
        const peers = await wd.link.peers();
        for (const p of peers) {
          const prof = peerProfiles[p.id];
          const peerNum = prof ? prof.number : generateNumberForId(p.id);
          const peerName = prof ? prof.name : p.name;
          list.push({
            id: p.id,
            peerId: 'link:' + p.id,
            name: peerName,
            number: peerNum,
            platform: p.platform,
            addr: p.addr,
            port: p.port,
            paired: p.paired,
            online: p.online,
            transport: 'wifi',
            isDeviceLink: true
          });
        }
      }
    } catch (_) {}

    // 2. Custom contacts
    const custom = await getSavedContacts();
    for (const c of custom) {
      if (!list.some(x => cleanNumber(x.number) === cleanNumber(c.number))) {
        list.push(c);
      }
    }
    return list;
  }

  // Render Directory
  async function renderDirectory(filter = '') {
    const all = await getDirectory();
    $('contactsCount').textContent = all.length;

    const filtered = all.filter(c => {
      const q = filter.toLowerCase();
      return !filter || c.name.toLowerCase().includes(q) || c.number.includes(q);
    });

    if (!filtered.length) {
      $('directoryList').innerHTML = `
        <div class="wd-empty">
          <div class="wd-empty-icon">👥</div>
          No connected devices or contacts yet. Pair your phone or laptop in the Device Link bar above to make direct Wi-Fi calls!
        </div>
      `;
      return;
    }

    $('directoryList').innerHTML = filtered.map(c => {
      const icon = c.platform === 'android' ? '📱' : c.platform === 'macos' ? '💻' : c.platform === 'windows' ? '🖥️' : '📞';
      const statusText = c.isDeviceLink 
        ? (c.paired ? (c.online ? '<span style="color:#10B981">● Paired & Online</span>' : '<span style="color:#94A3B8">○ Paired (Offline)</span>') : '<span style="color:#F59E0B">● Nearby (Unpaired)</span>')
        : '<span style="color:#10B981">● Available</span>';

      return `
        <div class="contact-card" data-select-contact="${esc(c.number)}">
          <div class="contact-avatar">${icon}</div>
          <div style="flex:1;cursor:pointer" title="Click to fill number in dialpad">
            <div style="font-weight:700;font-size:14px">${esc(c.name)}</div>
            <div class="wd-small" style="font-family:monospace;letter-spacing:.5px;color:var(--wd-fg)">${esc(c.number)}</div>
            <div class="wd-small wd-muted" style="margin-top:2px">
              ${statusText} ${c.addr ? '· ' + esc(c.addr) : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="wd-btn wd-btn-sm" data-call-peer="${esc(c.peerId || '')}" data-call-number="${esc(c.number)}" data-call-video="false" style="background:#16A34A;color:#fff;border:none;padding:5px 10px" title="Voice Call">📞</button>
            <button class="wd-btn wd-btn-sm" data-call-peer="${esc(c.peerId || '')}" data-call-number="${esc(c.number)}" data-call-video="true" style="background:#8B5CF6;color:#fff;border:none;padding:5px 10px" title="Video Call">📹</button>
          </div>
        </div>
      `;
    }).join('');

    // Select into dialpad
    document.querySelectorAll('[data-select-contact]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        dialInputString = el.dataset.selectContact;
        updateDialDisplay();
        playDtmf('1');
        if (wd && wd.ui) wd.ui.toast(`Selected ${dialInputString}`, 'ok');
      });
    });

    // Call Buttons
    document.querySelectorAll('[data-call-number]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const num = b.dataset.callNumber;
        const peer = b.dataset.callPeer;
        const isVid = b.dataset.callVideo === 'true';
        initiateCall(num, isVid, peer);
      };
    });
  }

  // --- Device Link signaling ---
  // Messages are de-duplicated by id (not by a time window) so nothing is lost
  // while a poll is in flight. Polls never overlap.
  const seenMsgIds = new Set();
  let pollSince = Date.now() - 15000;
  let polling = false;
  let lastPresenceAt = 0;
  const INVITE_MAX_AGE_MS = 40000;
  const RING_TIMEOUT_MS = 45000;
  let ringTimeout = null;
  let pc = null;
  let pendingRemoteCandidates = [];
  let callIsVideo = false;
  let callRole = null; // 'caller' | 'callee'

  const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  // Peers are addressed as 'link:<deviceId>' (same Wi-Fi) or 'cloud:<userId>' (internet).
  const viaOf = (peerKey) => (String(peerKey || '').startsWith('cloud:') ? 'cloud' : 'link');
  const idOf = (peerKey) => String(peerKey || '').replace(/^(cloud|link):/, '');
  const transportLabel = (peerKey) => (viaOf(peerKey) === 'cloud' ? 'Internet' : 'Wi-Fi');

  function sendSignal(peerKey, payload) {
    const msg = { ...payload, ts: Date.now() };
    return viaOf(peerKey) === 'cloud'
      ? wd.cloud.send(idOf(peerKey), 'call_signal', msg)
      : wd.link.send(idOf(peerKey), 'call_signal', msg);
  }

  // --- WebDeck Cloud (internet) ---
  let cloudOk = false;
  let cloudPolling = false;
  let cloudSince = Date.now() - 15000;

  async function registerCloudProfile(interactive = false) {
    if (!wd || !wd.cloud || !myProfile) return false;
    try {
      const st = await wd.cloud.connect();
      if (!st.connected) {
        cloudOk = false;
        if (interactive && st.error) wd.ui.toast(st.error, 'err');
        return false;
      }
      const remote = st.profile;
      if (remote && remote.number_key === cleanNumber(myProfile.number) && remote.name === myProfile.name) {
        cloudOk = true;
        return true;
      }
      try {
        await wd.cloud.setProfile({ name: myProfile.name, number: myProfile.number });
      } catch (e) {
        if (e.code !== 'number_taken') throw e;
        if (interactive) throw e;
        // Someone else owns our number: pick a fresh free one.
        let rand = generateRandomNumber();
        for (let i = 0; i < 10 && !(await wd.cloud.available(rand)); i++) rand = generateRandomNumber();
        myProfile.number = rand;
        myProfile.updatedAt = new Date().toISOString();
        await persistProfile();
        await wd.cloud.setProfile({ name: myProfile.name, number: myProfile.number });
        wd.ui.toast(`Your old number was taken; your new number is ${rand}`, 'ok');
      }
      cloudOk = true;
      return true;
    } catch (e) {
      cloudOk = false;
      if (interactive) throw e;
      return false;
    } finally {
      updateProfilePill();
    }
  }

  async function persistProfile() {
    try {
      if (wd && wd.kv) await wd.kv.set('caller_profile', myProfile);
    } catch (_) {}
    localStorage.setItem('wd_caller_profile', JSON.stringify(myProfile));
  }

  async function pollCloud() {
    if (cloudPolling || !cloudOk || !wd || !wd.cloud) return;
    cloudPolling = true;
    try {
      const msgs = await wd.cloud.inbox({ channel: 'call_signal', since: cloudSince });
      let newest = cloudSince;
      for (const m of msgs) {
        const at = Date.parse(m.at) || 0;
        if (at > newest) newest = at;
        if (seenMsgIds.has('c' + m.id)) continue;
        seenMsgIds.add('c' + m.id);
        handleIncomingSignal('cloud:' + m.from, m.payload || {});
      }
      cloudSince = Math.max(cloudSince, newest - 3000);
    } catch (_) {
    } finally {
      cloudPolling = false;
    }
  }

  async function broadcastPresence(force = false) {
    if (!myProfile || !wd || !wd.link) return;
    if (!force && Date.now() - lastPresenceAt < 15000) return;
    lastPresenceAt = Date.now();
    try {
      const peers = (await wd.link.peers()).filter((p) => p.paired && p.online);
      // Fire in parallel and don't block the poll on slow/offline devices.
      peers.forEach((p) => wd.link.send(p.id, 'call_presence', { profile: myProfile }).catch(() => {}));
    } catch (_) {}
  }

  async function pollDeviceLink() {
    if (polling || !wd || !wd.link) return;
    polling = true;
    try {
      const status = await wd.link.status();
      myStatus = status;
      if (!status.enabled) return;

      broadcastPresence();

      const msgs = await wd.link.inbox({ since: pollSince });
      let newest = pollSince;
      for (const m of msgs) {
        const at = Date.parse(m.at) || 0;
        if (at > newest) newest = at;
        if (seenMsgIds.has(m.id)) continue;
        seenMsgIds.add(m.id);
        if (m.outgoing || !m.payload) continue;
        if (m.channel === 'call_presence' && m.payload.profile) {
          const known = peerProfiles[m.peerId];
          peerProfiles[m.peerId] = m.payload.profile;
          if (!known || known.number !== m.payload.profile.number || known.name !== m.payload.profile.name) {
            if (!inCall) renderDirectory($('searchDirectoryInput').value.trim());
          }
        } else if (m.channel === 'call_signal') {
          handleIncomingSignal('link:' + m.peerId, m.payload);
        }
      }
      // Keep a small overlap; ids prevent double handling.
      pollSince = Math.max(pollSince, newest - 3000);
      if (seenMsgIds.size > 2000) {
        const keep = Array.from(seenMsgIds).slice(-1000);
        seenMsgIds.clear();
        keep.forEach((id) => seenMsgIds.add(id));
      }
    } catch (_) {
    } finally {
      polling = false;
    }
  }

  // --- WebRTC media ---
  async function getLocalMedia(isVideo) {
    if (localStream) return localStream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access is not available in this WebView');
    }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
    } catch (e) {
      if (!isVideo) throw e;
      // Fall back to audio only if the camera is unavailable.
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      wd.ui.toast('Camera unavailable, continuing with audio only', 'err');
    }
    const hasVideo = localStream.getVideoTracks().length > 0;
    $('localVideo').srcObject = localStream;
    $('localPip').hidden = !hasVideo;
    $('localPip').style.display = hasVideo ? 'block' : 'none';
    localStream.getAudioTracks().forEach((t) => (t.enabled = !micMuted));
    return localStream;
  }

  function createPeerConnection(peerId) {
    closePeerConnection();
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pendingRemoteCandidates = [];
    pc.onicecandidate = (e) => {
      if (e.candidate && activeCallId) {
        sendSignal(peerId, { type: 'ice', callId: activeCallId, candidate: e.candidate.toJSON() }).catch(() => {});
      }
    };
    pc.ontrack = (e) => {
      const remote = $('remoteVideo');
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      if (remote.srcObject !== stream) remote.srcObject = stream;
      remote.muted = false;
      remote.play().catch(() => {});
      const hasVideo = stream.getVideoTracks().length > 0;
      remote.style.display = hasVideo ? 'block' : 'none';
      $('callOverlayText').hidden = hasVideo;
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      const st = pc.connectionState;
      if (st === 'connected') {
        $('callHudTransport').textContent = `${transportLabel(activeCallPeerId)} P2P · encrypted`;
        $('callHudStats').textContent = callIsVideo ? 'Opus / video' : 'Opus audio';
        if (!callTimer) {
          $('callWithText').textContent = $('callWithText').textContent.replace(/^Calling |…$/g, '');
          startCallTimer();
          startVisualizer();
        }
      } else if (st === 'failed') {
        endCall('Connection failed. The networks may block direct calls (a relay server is needed).');
      }
    };
    if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    return pc;
  }

  function closePeerConnection() {
    if (pc) {
      try { pc.close(); } catch (_) {}
      pc = null;
    }
    pendingRemoteCandidates = [];
    const remote = $('remoteVideo');
    if (remote) {
      remote.srcObject = null;
      remote.style.display = 'none';
    }
  }

  async function flushCandidates() {
    if (!pc || !pc.remoteDescription) return;
    for (const c of pendingRemoteCandidates.splice(0)) {
      try { await pc.addIceCandidate(c); } catch (_) {}
    }
  }

  async function handleIncomingSignal(fromPeerId, signal) {
    const sameCall = activeCallId && signal.callId === activeCallId;
    switch (signal.type) {
      case 'invite': {
        if (signal.ts && Date.now() - signal.ts > INVITE_MAX_AGE_MS) return; // stale
        if (inCall || incomingCallData) {
          sendSignal(fromPeerId, { type: 'hangup', callId: signal.callId, reason: 'busy' }).catch(() => {});
          return;
        }
        activeCallPeerId = fromPeerId;
        activeCallId = signal.callId;
        callRole = 'callee';
        // Let the caller know we're ringing.
        sendSignal(fromPeerId, { type: 'ringing', callId: signal.callId }).catch(() => {});
        showIncomingCall({
          name: signal.callerName || 'WebDeck Device',
          number: signal.callerNumber || '',
          transport: 'wifi',
          callId: signal.callId,
          isVideo: signal.isVideo === true,
          peerId: fromPeerId,
        });
        clearTimeout(ringTimeout);
        ringTimeout = setTimeout(() => {
          if (incomingCallData && incomingCallData.callId === signal.callId) {
            addRecentCall({ name: incomingCallData.name, number: incomingCallData.number, type: 'missed', isVideo: incomingCallData.isVideo, transport: 'wifi' });
            closeIncomingModal();
            incomingCallData = null;
            activeCallPeerId = null;
            activeCallId = null;
          }
        }, RING_TIMEOUT_MS);
        break;
      }
      case 'ringing':
        if (sameCall && inCall && callRole === 'caller') {
          $('callDuration').textContent = 'Ringing…';
        }
        break;
      case 'answer': {
        // Callee accepted: caller creates the WebRTC offer.
        if (!sameCall || !inCall || callRole !== 'caller') return;
        clearTimeout(ringTimeout);
        stopRingback();
        $('callWithText').textContent = signal.calleeName || $('callWithText').textContent;
        $('callDuration').textContent = 'Connecting audio…';
        try {
          await getLocalMedia(callIsVideo);
          const conn = createPeerConnection(fromPeerId);
          const offer = await conn.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await conn.setLocalDescription(offer);
          await sendSignal(fromPeerId, { type: 'offer', callId: activeCallId, sdp: conn.localDescription.sdp });
        } catch (e) {
          endCall(`Could not start media: ${e.message || e}`);
        }
        break;
      }
      case 'offer': {
        if (!sameCall || !inCall || callRole !== 'callee') return;
        try {
          const conn = createPeerConnection(fromPeerId);
          await conn.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
          await flushCandidates();
          const answer = await conn.createAnswer();
          await conn.setLocalDescription(answer);
          await sendSignal(fromPeerId, { type: 'sdp-answer', callId: activeCallId, sdp: conn.localDescription.sdp });
        } catch (e) {
          endCall(`Could not connect media: ${e.message || e}`);
        }
        break;
      }
      case 'sdp-answer':
        if (!sameCall || !pc) return;
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          await flushCandidates();
        } catch (_) {}
        break;
      case 'ice':
        if (!sameCall || !signal.candidate) return;
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(signal.candidate); } catch (_) {}
        } else {
          pendingRemoteCandidates.push(signal.candidate);
        }
        break;
      case 'hangup': {
        if (incomingCallData && incomingCallData.callId === signal.callId) {
          clearTimeout(ringTimeout);
          addRecentCall({ name: incomingCallData.name, number: incomingCallData.number, type: 'missed', isVideo: incomingCallData.isVideo, transport: 'wifi' });
          closeIncomingModal();
          incomingCallData = null;
          activeCallPeerId = null;
          activeCallId = null;
          wd.ui.toast('Caller hung up', 'ok');
        } else if (inCall && sameCall) {
          const reason = signal.reason === 'busy' ? 'Device is busy'
            : signal.reason === 'declined' ? 'Call declined'
            : signal.reason === 'no-answer' ? 'No answer'
            : 'Call ended by remote device';
          endCallLocal(reason);
        }
        break;
      }
    }
  }

  // --- Outgoing call ---
  async function initiateCall(numberOrName, isVideo = false, specificPeerId = null) {
    if (inCall) return;
    const target = numberOrName || dialInputString;
    if (!target && !specificPeerId) {
      wd.ui.toast('Enter or select a number to call', 'err');
      return;
    }

    if (myProfile && target && cleanNumber(target) === cleanNumber(myProfile.number)) {
      wd.ui.toast('That is your own number. Dial the number shown on your other device.', 'err');
      return;
    }

    const dir = await getDirectory();
    let peer = specificPeerId ? dir.find((c) => c.peerId === specificPeerId) : null;
    if (!peer && target) {
      peer = dir.find((c) => (cleanNumber(target) && cleanNumber(c.number) === cleanNumber(target)) || c.name.toLowerCase() === String(target).toLowerCase());
    }

    const lanOk = peer && peer.peerId && peer.paired && peer.online !== false;
    if (!lanOk) {
      // Not reachable on this Wi-Fi: look the number up over the internet.
      const number = peer ? peer.number : target;
      let found = null;
      if (cloudOk && cleanNumber(number)) {
        try { found = await wd.cloud.lookup(number); } catch (_) {}
      }
      if (found) {
        if (!found.online) wd.ui.toast(`${found.name} looks offline; ringing anyway…`, 'ok');
        peer = { peerId: 'cloud:' + found.user_id, name: found.name, number: found.number, paired: true };
      } else if (peer && peer.peerId && peer.paired) {
        // Paired but not seen recently on Wi-Fi: still try Device Link.
      } else {
        wd.ui.toast(cloudOk
          ? 'No WebDeck user has that number.'
          : 'No paired device has that number, and internet calling is offline.', 'err');
        return;
      }
    }

    // Ask for the mic first so the permission prompt happens before ringing.
    try {
      await getLocalMedia(isVideo);
    } catch (e) {
      wd.ui.toast(`Microphone permission is needed to call: ${e.message || e}`, 'err');
      return;
    }

    activeCallPeerId = peer.peerId;
    activeCallId = 'call-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    callIsVideo = isVideo;
    callRole = 'caller';
    inCall = true;
    showCallStage();

    $('callOverlayText').hidden = false;
    $('callWithText').textContent = `Calling ${peer.name}…`;
    $('callWithNumber').textContent = peer.number;
    $('callDuration').textContent = 'Connecting…';
    $('callHudTransport').textContent = transportLabel(peer.peerId);

    startRingback();
    addRecentCall({ name: peer.name, number: peer.number, type: 'outgoing', isVideo, transport: viaOf(peer.peerId) });

    try {
      await sendSignal(activeCallPeerId, {
        type: 'invite',
        callId: activeCallId,
        callerName: myProfile.name,
        callerNumber: myProfile.number,
        isVideo,
      });
    } catch (err) {
      endCallLocal(`Could not reach ${peer.name}: ${err.message || err}`);
      return;
    }

    clearTimeout(ringTimeout);
    const callId = activeCallId;
    ringTimeout = setTimeout(() => {
      if (inCall && activeCallId === callId && !callTimer) endCall('No answer', 'no-answer');
    }, RING_TIMEOUT_MS);
  }

  function showCallStage() {
    $('callStageView').hidden = false;
    $('callStageView').style.display = 'block';
    for (const id of ['tabContentMain', 'tabContentRecents', 'tabContentSettings']) {
      $(id).hidden = true;
      $(id).style.display = 'none';
    }
  }

  function startCallTimer() {
    callSeconds = 0;
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
      callSeconds++;
      const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
      const s = String(callSeconds % 60).padStart(2, '0');
      $('callDuration').textContent = `${m}:${s}`;
    }, 1000);
  }

  function endCall(msg = 'Call ended', reason) {
    if (activeCallPeerId && wd && wd.link && activeCallId) {
      sendSignal(activeCallPeerId, { type: 'hangup', callId: activeCallId, reason }).catch(() => {});
    }
    endCallLocal(typeof msg === 'string' ? msg : 'Call ended');
  }

  function endCallLocal(msg) {
    clearTimeout(ringTimeout);
    stopRingback();
    stopRingtone();
    closePeerConnection();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    if (callTimer) {
      clearInterval(callTimer);
      callTimer = null;
    }
    stopVisualizer();

    inCall = false;
    callRole = null;
    activeCallPeerId = null;
    activeCallId = null;
    $('callStageView').hidden = true;
    $('callStageView').style.display = 'none';
    switchTab('dialer-contacts');

    if (callSeconds > 0) {
      wd.ui.toast(`${msg} (${Math.floor(callSeconds / 60)}m ${callSeconds % 60}s)`, 'ok');
    } else {
      wd.ui.toast(msg, 'ok');
    }
    callSeconds = 0;
  }

  // --- Incoming Call UI & Actions ---
  function showIncomingCall(data) {
    incomingCallData = data;
    $('incomingCallerName').textContent = data.name || 'Incoming Caller';
    $('incomingCallerNumber').textContent = data.number || '';
    $('incomingTransportBadge').textContent = data.selfTest ? '🧪 Self-test (local only)' : `${viaOf(data.peerId) === 'cloud' ? '🌐' : '📶'} Incoming ${data.isVideo ? 'video' : 'voice'} call · ${transportLabel(data.peerId)}`;

    const modal = $('incomingCallModal');
    modal.hidden = false;
    modal.classList.add('active');
    modal.style.display = 'flex';

    startRingtone();

    try {
      if (wd && wd.notify && !data.selfTest) {
        wd.notify(`Incoming call: ${data.name}`, `${data.isVideo ? 'Video' : 'Voice'} call to ${myProfile ? myProfile.number : ''}`);
      }
    } catch (_) {}
  }

  function closeIncomingModal() {
    stopRingtone();
    const modal = $('incomingCallModal');
    modal.hidden = true;
    modal.classList.remove('active');
    modal.style.display = 'none';
  }

  async function acceptIncomingCall(isVideo) {
    clearTimeout(ringTimeout);
    closeIncomingModal();
    const data = incomingCallData;
    incomingCallData = null;
    if (!data) return;

    if (data.selfTest) {
      wd.ui.toast('Ringtone works. Call from your other device to test a real call.', 'ok');
      return;
    }

    try {
      await getLocalMedia(isVideo);
    } catch (e) {
      sendSignal(data.peerId, { type: 'hangup', callId: data.callId, reason: 'declined' }).catch(() => {});
      activeCallPeerId = null;
      activeCallId = null;
      wd.ui.toast(`Microphone permission is needed to answer: ${e.message || e}`, 'err');
      return;
    }

    inCall = true;
    callRole = 'callee';
    callIsVideo = isVideo;
    activeCallPeerId = data.peerId;
    activeCallId = data.callId;
    showCallStage();

    $('callOverlayText').hidden = false;
    $('callWithText').textContent = data.name;
    $('callWithNumber').textContent = data.number;
    $('callDuration').textContent = 'Connecting audio…';
    $('callHudTransport').textContent = transportLabel(data.peerId);

    addRecentCall({ name: data.name, number: data.number, type: 'incoming', isVideo, transport: 'wifi' });

    try {
      await sendSignal(activeCallPeerId, {
        type: 'answer',
        callId: activeCallId,
        calleeName: myProfile.name,
        calleeNumber: myProfile.number,
        isVideo,
      });
    } catch (e) {
      endCallLocal(`Could not reach caller: ${e.message || e}`);
      return;
    }
    // Wait for the offer; give up if media never connects.
    const callId = activeCallId;
    ringTimeout = setTimeout(() => {
      if (inCall && activeCallId === callId && !callTimer) endCall('Could not connect audio');
    }, 30000);
  }

  function declineIncomingCall() {
    clearTimeout(ringTimeout);
    closeIncomingModal();
    const data = incomingCallData;
    incomingCallData = null;
    if (data && !data.selfTest) {
      sendSignal(data.peerId, { type: 'hangup', callId: data.callId, reason: 'declined' }).catch(() => {});
      addRecentCall({ name: data.name, number: data.number, type: 'missed', isVideo: data.isVideo, transport: 'wifi' });
    }
    activeCallPeerId = null;
    activeCallId = null;
    wd.ui.toast('Call declined', 'ok');
  }

  // --- Visualizer & In-Call Controls ---
  function toggleMic() {
    micMuted = !micMuted;
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
    }
    $('btnToggleMic').classList.toggle('active', micMuted);
    $('btnToggleMic').textContent = micMuted ? '🔇' : '🎤';
    wd.ui.toast(micMuted ? 'Microphone muted' : 'Microphone unmuted', 'ok');
  }

  function toggleCam() {
    camOff = !camOff;
    if (localStream) {
      localStream.getVideoTracks().forEach(t => t.enabled = !camOff);
    }
    $('localPip').hidden = camOff;
    $('localPip').style.display = camOff ? 'none' : 'block';
    $('btnToggleCam').classList.toggle('active', camOff);
    wd.ui.toast(camOff ? 'Camera turned off' : 'Camera turned on', 'ok');
  }

  function toggleSpeaker() {
    speakerOn = !speakerOn;
    $('btnToggleSpeaker').textContent = speakerOn ? '🔊' : '🔈';
    $('remoteVideo').volume = speakerOn ? 1 : 0.35;
    wd.ui.toast(speakerOn ? 'Speaker output enabled' : 'Earpiece output enabled', 'ok');
  }

  function startVisualizer() {
    const canvas = $('audioVisualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth || 800;
    canvas.height = canvas.offsetHeight || 480;

    let step = 0;
    function render() {
      if (!inCall) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(9, 13, 22, 0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#10B981';
      const w = canvas.width, h = canvas.height, cy = h / 2;

      for (let x = 0; x < w; x += 4) {
        const y = cy + Math.sin((x * 0.015) + step) * 26 * Math.sin(step * 0.5);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(56, 139, 253, 0.6)';
      for (let x = 0; x < w; x += 4) {
        const y = cy + Math.cos((x * 0.02) - step) * 18 * Math.cos(step * 0.7);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      step += 0.06;
      visualizerAnimId = requestAnimationFrame(render);
    }
    render();
  }

  function stopVisualizer() {
    if (visualizerAnimId) {
      cancelAnimationFrame(visualizerAnimId);
      visualizerAnimId = null;
    }
  }

  // --- Dialpad Logic ---
  function updateDialDisplay() {
    $('dialNumberInput').textContent = dialInputString;
  }

  function handleDigit(d) {
    getAudioCtx();
    playDtmf(d);
    if (dialInputString.length < 24) {
      dialInputString += d;
      updateDialDisplay();
    }
  }

  function handleBackspace() {
    if (dialInputString.length > 0) {
      dialInputString = dialInputString.slice(0, -1);
      updateDialDisplay();
    }
  }

  // --- Profile Edit Modal ---
  function openEditModal() {
    const modal = $('onboardingModal');
    modal.hidden = false;
    modal.classList.add('active');
    modal.style.display = 'flex';
    $('inputProfileName').value = myProfile ? myProfile.name : 'My Device';
    $('inputProfileNumber').value = myProfile ? myProfile.number : '';
    validateModalNumber();
  }

  function closeEditModal() {
    const modal = $('onboardingModal');
    modal.hidden = true;
    modal.classList.remove('active');
    modal.style.display = 'none';
  }

  async function validateModalNumber() {
    const val = $('inputProfileNumber').value.trim();
    const res = await checkNumberAvailability(val, myProfile ? myProfile.id : null);
    const msgEl = $('numberValidationMsg');
    msgEl.textContent = res.msg;
    if (res.available) {
      msgEl.style.color = '#10B981';
      $('btnSaveProfile').disabled = false;
      $('btnSaveProfile').style.opacity = '1';
    } else {
      msgEl.style.color = '#EF4444';
      $('btnSaveProfile').disabled = true;
      $('btnSaveProfile').style.opacity = '0.5';
    }
  }

  async function saveProfileFromModal() {
    const name = $('inputProfileName').value.trim() || 'My Device';
    const number = $('inputProfileNumber').value.trim();

    const res = await checkNumberAvailability(number, myProfile ? myProfile.id : null);
    if (!res.available) {
      wd.ui.toast(res.msg, 'err');
      return;
    }

    myProfile = {
      id: myProfile ? myProfile.id : 'user-' + Date.now(),
      name,
      number,
      updatedAt: new Date().toISOString()
    };

    await persistProfile();
    try {
      await registerCloudProfile(true);
    } catch (e) {
      wd.ui.toast(e.code === 'number_taken' ? 'That number was just taken by someone else.' : `Saved locally; internet registration failed: ${e.message}`, 'err');
    }

    updateProfilePill();
    broadcastPresence(true);
    closeEditModal();
    if (wd && wd.ui) wd.ui.toast(`Caller ID updated: ${number}`, 'ok');
    renderDirectory();
  }

  async function randomizeNumberNow() {
    let rand = generateRandomNumber();
    while (!(await checkNumberAvailability(rand, myProfile ? myProfile.id : null)).available) {
      rand = generateRandomNumber();
    }
    myProfile.number = rand;
    myProfile.updatedAt = new Date().toISOString();

    await persistProfile();
    registerCloudProfile();

    updateProfilePill();
    broadcastPresence(true);
    playDtmf('5');
    if (wd && wd.ui) wd.ui.toast(`Assigned random number: ${rand}`, 'ok');
    renderDirectory();
  }

  // --- Recents Management ---
  async function getRecents() {
    let recents = [];
    try {
      if (wd && wd.kv) recents = (await wd.kv.get('caller_recents')) || [];
    } catch (_) {}
    if (!recents || !recents.length) {
      const stored = localStorage.getItem('wd_caller_recents');
      if (stored) {
        try { recents = JSON.parse(stored); } catch (_) {}
      }
    }
    return recents || [];
  }

  async function addRecentCall(call) {
    const recents = await getRecents();
    recents.unshift({
      ...call,
      id: 'call-' + Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString()
    });
    if (recents.length > 50) recents.pop();
    try {
      if (wd && wd.kv) await wd.kv.set('caller_recents', recents);
    } catch (_) {}
    localStorage.setItem('wd_caller_recents', JSON.stringify(recents));
    renderRecents();
  }

  async function renderRecents() {
    const recents = await getRecents();
    if (!recents.length) {
      $('recentsList').innerHTML = `
        <div class="wd-empty">
          <div class="wd-empty-icon">🕒</div>
          No call history yet. Dial any number or pick a paired device above to make your first P2P call!
        </div>
      `;
      return;
    }

    $('recentsList').innerHTML = recents.map(r => {
      let icon = '↗';
      let iconColor = '#10B981';
      let label = 'Outgoing';
      if (r.type === 'incoming') {
        icon = '↙';
        iconColor = '#388BFD';
        label = 'Incoming';
      } else if (r.type === 'missed') {
        icon = '✕';
        iconColor = '#EF4444';
        label = 'Missed';
      }

      return `
        <div class="contact-card">
          <div style="font-size:24px;font-weight:900;color:${iconColor};width:36px;text-align:center">${icon}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${esc(r.name)}</div>
            <div class="wd-small" style="font-family:monospace">${esc(r.number)} · <span class="wd-muted">${label} · ${r.time}</span></div>
          </div>
          <button class="wd-btn wd-btn-sm" data-redial="${esc(r.number)}" data-redial-video="${r.isVideo ? 'true' : 'false'}">
            ${r.isVideo ? '📹 Redial' : '📞 Redial'}
          </button>
        </div>
      `;
    }).join('');

    document.querySelectorAll('[data-redial]').forEach(b => {
      b.onclick = () => initiateCall(b.dataset.redial, b.dataset.redialVideo === 'true');
    });
  }

  // --- Switch Tabs ---
  function switchTab(tabId) {
    document.querySelectorAll('.call-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });
    $('tabContentMain').hidden = tabId !== 'dialer-contacts';
    $('tabContentMain').style.display = tabId === 'dialer-contacts' ? 'block' : 'none';

    $('tabContentRecents').hidden = tabId !== 'recents';
    $('tabContentRecents').style.display = tabId === 'recents' ? 'block' : 'none';

    $('tabContentSettings').hidden = tabId !== 'settings';
    $('tabContentSettings').style.display = tabId === 'settings' ? 'block' : 'none';

    if (tabId === 'dialer-contacts') renderDirectory();
    if (tabId === 'recents') renderRecents();
  }

  function bindEvents() {
    $('profilePill').onclick = openEditModal;
    if ($('btnQuickEditProfile')) $('btnQuickEditProfile').onclick = openEditModal;
    if ($('btnQuickRandomize')) $('btnQuickRandomize').onclick = randomizeNumberNow;
    if ($('btnQuickCopyNumber')) {
      $('btnQuickCopyNumber').onclick = () => {
        if (myProfile && myProfile.number) {
          navigator.clipboard.writeText(myProfile.number);
          wd.ui.toast(`Copied ${myProfile.number} to clipboard`, 'ok');
        }
      };
    }

    $('btnGenRandomNumber').onclick = async () => {
      let rand = generateRandomNumber();
      while (!(await checkNumberAvailability(rand, myProfile ? myProfile.id : null)).available) {
        rand = generateRandomNumber();
      }
      $('inputProfileNumber').value = rand;
      validateModalNumber();
      playDtmf('5');
    };

    $('inputProfileNumber').oninput = validateModalNumber;
    $('btnSaveProfile').onclick = saveProfileFromModal;
    $('btnCancelModal').onclick = closeEditModal;

    document.querySelectorAll('.transport-chip').forEach(c => {
      c.onclick = () => {
        document.querySelectorAll('.transport-chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        activeTransport = c.dataset.transport;
        wd.ui.toast(`Transport: ${c.textContent.trim()}`, 'ok');
      };
    });

    $('btnSimulateIncoming').onclick = () => {
      if (inCall || incomingCallData) return;
      showIncomingCall({
        name: 'Device Self-Test',
        number: myProfile ? myProfile.number : '',
        transport: 'wifi',
        isVideo: false,
        selfTest: true
      });
    };

    $('btnAcceptVoice').onclick = () => acceptIncomingCall(false);
    $('btnAcceptVideo').onclick = () => acceptIncomingCall(true);
    $('btnDeclineIncoming').onclick = declineIncomingCall;

    document.querySelectorAll('.call-tab').forEach(t => {
      t.onclick = () => switchTab(t.dataset.tab);
    });

    document.querySelectorAll('.dial-key').forEach(k => {
      k.onclick = () => handleDigit(k.dataset.digit);
    });
    $('btnDialBackspace').onclick = handleBackspace;

    $('btnDialVoice').onclick = () => initiateCall(dialInputString, false);
    $('btnDialVideo').onclick = () => initiateCall(dialInputString, true);

    $('btnEndCall').onclick = () => endCall('Call ended');
    $('btnToggleMic').onclick = toggleMic;
    $('btnToggleCam').onclick = toggleCam;
    $('btnToggleSpeaker').onclick = toggleSpeaker;

    $('searchDirectoryInput').oninput = (e) => renderDirectory(e.target.value.trim());

    $('btnAddContact').onclick = async () => {
      const name = prompt('Enter contact name:');
      if (!name) return;
      const number = prompt('Enter contact phone number or ID:');
      if (!number) return;

      const avail = await checkNumberAvailability(number);
      if (!avail.available) {
        alert(avail.msg);
        return;
      }

      const custom = await getSavedContacts();
      custom.push({
        id: 'contact-' + Date.now(),
        name,
        number,
        transport: activeTransport,
        status: 'Available'
      });
      await saveCustomContacts(custom);
      renderDirectory();
      wd.ui.toast(`Saved contact ${name}`, 'ok');
    };

    $('btnClearRecents').onclick = async () => {
      try {
        if (wd && wd.kv) await wd.kv.set('caller_recents', []);
      } catch (_) {}
      localStorage.removeItem('wd_caller_recents');
      renderRecents();
      wd.ui.toast('Call history cleared', 'ok');
    };

    $('btnEditProfile').onclick = openEditModal;
    $('btnCopyMyNumber').onclick = () => {
      if (myProfile && myProfile.number) {
        navigator.clipboard.writeText(myProfile.number);
        wd.ui.toast(`Copied ${myProfile.number} to clipboard`, 'ok');
      }
    };
    $('btnTestRingTone').onclick = () => {
      startRingtone();
      setTimeout(stopRingtone, 4500);
      wd.ui.toast('Playing ringtone chime test…', 'ok');
    };
    $('btnTestDtmf').onclick = () => {
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].forEach((d, i) => {
        setTimeout(() => playDtmf(d), i * 140);
      });
    };

    window.addEventListener('keydown', (e) => {
      if (!$('onboardingModal').hidden) return;
      if ($('searchDirectoryInput') === document.activeElement) return;

      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === '*' || e.key === '#') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter' && dialInputString) {
        initiateCall(dialInputString, false);
      }
    });
  }

  async function init() {
    closeIncomingModal();
    closeEditModal();
    $('callStageView').hidden = true;
    $('callStageView').style.display = 'none';

    bindEvents();
    await loadProfile();

    // Setup LinkKit in the header bar
    if (window.LinkKit && $('linkSetup')) {
      try {
        await window.LinkKit.setup($('linkSetup'), () => renderDirectory());
      } catch (_) {}
    }

    await renderDirectory();
    await renderRecents();

    // Device Link signaling loop (polls never overlap).
    broadcastPresence(true);
    registerCloudProfile();
    pollDeviceLink();
    setInterval(() => { pollDeviceLink(); pollCloud(); }, 600);
    setInterval(() => { if (!cloudOk) registerCloudProfile(); }, 20000);
  }

  init();
})();
