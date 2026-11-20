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
  let lastInboxCheck = Date.now() - 5000;

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
      $('callerBadge').textContent = `${myProfile.number}`;
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
            peerId: p.id,
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

  // --- Device Link Real Network Polling & Messaging ---
  async function pollDeviceLink() {
    try {
      if (!wd || !wd.link) return;
      const status = await wd.link.status();
      myStatus = status;

      if (!status.enabled) return;

      // 1. Broadcast caller profile to all paired peers
      const peers = await wd.link.peers();
      const paired = peers.filter(p => p.paired);
      if (myProfile) {
        for (const p of paired) {
          try {
            await wd.link.send(p.id, 'call_presence', { profile: myProfile });
          } catch (_) {}
        }
      }

      // 2. Read incoming presence updates
      const presenceMsgs = await wd.link.inbox({ channel: 'call_presence', since: lastInboxCheck });
      for (const m of presenceMsgs) {
        if (!m.outgoing && m.payload && m.payload.profile) {
          peerProfiles[m.peerId] = m.payload.profile;
        }
      }

      // 3. Read call signals
      const signalMsgs = await wd.link.inbox({ channel: 'call_signal', since: lastInboxCheck });
      for (const m of signalMsgs) {
        if (m.outgoing) continue;
        const s = m.payload || {};
        handleIncomingSignal(m.peerId, s);
      }

      lastInboxCheck = Date.now();
    } catch (_) {}
  }

  function handleIncomingSignal(fromPeerId, signal) {
    if (signal.type === 'invite') {
      if (inCall) {
        // Busy
        try {
          wd.link.send(fromPeerId, 'call_signal', { type: 'hangup', callId: signal.callId, reason: 'busy' });
        } catch (_) {}
        return;
      }
      activeCallPeerId = fromPeerId;
      activeCallId = signal.callId;
      showIncomingCall({
        name: signal.callerName || 'Paired WebDeck Device',
        number: signal.callerNumber || '+1 (555) 000-0000',
        transport: 'wifi',
        callId: signal.callId,
        isVideo: signal.isVideo === true,
        peerId: fromPeerId
      });
    } else if (signal.type === 'answer') {
      if (inCall && (!activeCallId || activeCallId === signal.callId)) {
        stopRingback();
        $('callWithText').textContent = signal.calleeName || 'Connected';
        $('callDuration').textContent = '00:00';
        startCallTimer();
        startVisualizer();
        if (wd && wd.ui) wd.ui.toast(`Call connected!`, 'ok');
      }
    } else if (signal.type === 'hangup') {
      if (incomingCallData && incomingCallData.callId === signal.callId) {
        closeIncomingModal();
        if (wd && wd.ui) wd.ui.toast('Caller hung up', 'ok');
      } else if (inCall && (!activeCallId || activeCallId === signal.callId)) {
        endCallLocal(signal.reason === 'busy' ? 'Device is busy' : 'Call ended by remote device');
      }
    }
  }

  // --- Real Outgoing Call ---
  async function initiateCall(numberOrName, isVideo = false, specificPeerId = null) {
    if (inCall) return;
    const target = numberOrName || dialInputString;
    if (!target) {
      wd.ui.toast('Enter or select a number to call', 'err');
      return;
    }

    if (myProfile && cleanNumber(target) === cleanNumber(myProfile.number)) {
      wd.ui.toast('Cannot call your own number. Dial your other device or click Ring Me.', 'err');
      return;
    }

    // Find peer
    const dir = await getDirectory();
    let peer = null;
    if (specificPeerId) {
      peer = dir.find(c => c.peerId === specificPeerId);
    }
    if (!peer) {
      peer = dir.find(c => cleanNumber(c.number) === cleanNumber(target) || c.name.toLowerCase() === target.toLowerCase());
    }

    const displayName = peer ? peer.name : target;
    const displayNumber = peer ? peer.number : target;
    activeCallPeerId = peer ? peer.peerId : null;
    activeCallId = 'call-' + Date.now();

    inCall = true;
    $('callStageView').hidden = false;
    $('callStageView').style.display = 'block';
    $('tabContentMain').hidden = true;
    $('tabContentMain').style.display = 'none';
    $('tabContentRecents').hidden = true;
    $('tabContentRecents').style.display = 'none';
    $('tabContentSettings').hidden = true;
    $('tabContentSettings').style.display = 'none';

    $('callOverlayText').hidden = false;
    $('callWithText').textContent = `Calling ${displayName}…`;
    $('callWithNumber').textContent = displayNumber;
    $('callDuration').textContent = 'Connecting via Wi-Fi P2P Device Link…';
    $('callHudTransport').textContent = 'Local Wi-Fi P2P';

    startRingback();

    // Start local media
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo }).then(stream => {
        localStream = stream;
        $('localVideo').srcObject = localStream;
        $('localPip').hidden = !isVideo;
        $('localPip').style.display = isVideo ? 'block' : 'none';
      }).catch(() => {
        $('localPip').hidden = true;
        $('localPip').style.display = 'none';
      });
    }

    // Send real call invite over Device Link if peer exists
    if (activeCallPeerId && wd && wd.link) {
      try {
        await wd.link.send(activeCallPeerId, 'call_signal', {
          type: 'invite',
          callId: activeCallId,
          callerName: myProfile.name,
          callerNumber: myProfile.number,
          isVideo: isVideo
        });
        wd.ui.toast(`Calling ${displayName} over Device Link…`, 'ok');
      } catch (err) {
        wd.ui.toast(`Could not reach ${displayName}: ${err.message}`, 'err');
      }
    } else {
      // Offline / standalone simulator fallback after 2.5s
      setTimeout(() => {
        if (!inCall) return;
        stopRingback();
        $('callWithText').textContent = displayName;
        $('callDuration').textContent = '00:00';
        startCallTimer();
        startVisualizer();
        addRecentCall({
          name: displayName,
          number: displayNumber,
          type: 'outgoing',
          isVideo,
          transport: activeTransport
        });
        if (wd && wd.ui) wd.ui.toast(`Connected with ${displayName}`, 'ok');
      }, 2500);
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

  function endCall() {
    // Send hangup to peer if active
    if (activeCallPeerId && wd && wd.link && activeCallId) {
      try {
        wd.link.send(activeCallPeerId, 'call_signal', { type: 'hangup', callId: activeCallId });
      } catch (_) {}
    }
    endCallLocal('Call ended');
  }

  function endCallLocal(msg) {
    stopRingback();
    stopRingtone();
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (callTimer) {
      clearInterval(callTimer);
      callTimer = null;
    }
    stopVisualizer();

    inCall = false;
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
    $('incomingCallerNumber').textContent = data.number || '+1 (555) 492-1829';
    $('incomingTransportBadge').textContent = `📶 Incoming Wi-Fi P2P Call`;

    const modal = $('incomingCallModal');
    modal.hidden = false;
    modal.classList.add('active');
    modal.style.display = 'flex';

    startRingtone();

    try {
      if (wd && wd.notify) {
        wd.notify(`Incoming Call: ${data.name}`, `Tap to answer call to ${myProfile ? myProfile.number : ''}`);
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

  function acceptIncomingCall(isVideo) {
    closeIncomingModal();
    const data = incomingCallData || {
      name: $('incomingCallerName').textContent || 'Jane Doe',
      number: $('incomingCallerNumber').textContent || '+1 (555) 492-1829',
      transport: 'wifi'
    };
    incomingCallData = null;

    inCall = true;
    $('callStageView').hidden = false;
    $('callStageView').style.display = 'block';
    $('tabContentMain').hidden = true;
    $('tabContentMain').style.display = 'none';
    $('tabContentRecents').hidden = true;
    $('tabContentRecents').style.display = 'none';
    $('tabContentSettings').hidden = true;
    $('tabContentSettings').style.display = 'none';

    $('callOverlayText').hidden = false;
    $('callWithText').textContent = data.name;
    $('callWithNumber').textContent = data.number;
    $('callHudTransport').textContent = 'Local Wi-Fi P2P';

    startCallTimer();
    startVisualizer();

    addRecentCall({
      name: data.name,
      number: data.number,
      type: 'incoming',
      isVideo,
      transport: 'wifi'
    });

    // Notify caller that we answered!
    if (activeCallPeerId && wd && wd.link && activeCallId) {
      try {
        wd.link.send(activeCallPeerId, 'call_signal', {
          type: 'answer',
          callId: activeCallId,
          calleeName: myProfile.name,
          calleeNumber: myProfile.number,
          isVideo
        });
      } catch (_) {}
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo }).then(stream => {
        localStream = stream;
        $('localVideo').srcObject = localStream;
        $('localPip').hidden = !isVideo;
        $('localPip').style.display = isVideo ? 'block' : 'none';
      }).catch(() => {
        $('localPip').hidden = true;
        $('localPip').style.display = 'none';
      });
    }
  }

  function declineIncomingCall() {
    closeIncomingModal();
    if (activeCallPeerId && wd && wd.link && activeCallId) {
      try {
        wd.link.send(activeCallPeerId, 'call_signal', { type: 'hangup', callId: activeCallId, reason: 'declined' });
      } catch (_) {}
    }
    if (incomingCallData) {
      addRecentCall({
        name: incomingCallData.name,
        number: incomingCallData.number,
        type: 'missed',
        isVideo: false,
        transport: 'wifi'
      });
      incomingCallData = null;
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

    try {
      if (wd && wd.kv) await wd.kv.set('caller_profile', myProfile);
    } catch (_) {}
    localStorage.setItem('wd_caller_profile', JSON.stringify(myProfile));

    updateProfilePill();
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

    try {
      if (wd && wd.kv) await wd.kv.set('caller_profile', myProfile);
    } catch (_) {}
    localStorage.setItem('wd_caller_profile', JSON.stringify(myProfile));

    updateProfilePill();
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
      showIncomingCall({
        name: 'Device Self-Test',
        number: myProfile ? myProfile.number : '+1 (555) 000-0000',
        transport: 'wifi',
        isVideo: Math.random() > 0.5
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

    $('btnEndCall').onclick = endCall;
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

    // Start real Device Link polling loop every 750ms
    setInterval(pollDeviceLink, 750);
  }

  init();
})();
