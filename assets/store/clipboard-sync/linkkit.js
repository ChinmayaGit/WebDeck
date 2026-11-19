/* Shared Device Link UI: on/off, pairing and the device picker. */
window.LinkKit = (() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const icon = (p) => ({ android: '📱', ios: '📱', macos: '💻', windows: '🖥️', linux: '🐧' }[p] || '💻');

  /** Renders the setup / pairing card into `el`; resolves true when Device Link is on. */
  async function setup(el, onChange) {
    let st;
    try { st = await wd.link.status(); } catch (e) { el.innerHTML = `<div class="wd-error">${esc(e.message)}</div>`; return false; }
    if (!st.enabled) {
      el.innerHTML = `<div class="wd-card wd-row"><div class="wd-grow"><h2>Turn on Device Link</h2>
        <p class="wd-muted">Connect WebDeck on your phone and computers over the same Wi-Fi. Only devices you pair with a code can reach you.</p></div>
        <button class="wd-btn wd-btn-primary" data-lk="on">Turn on</button></div>`;
      el.querySelector('[data-lk=on]').onclick = async () => { try { await wd.link.enable(true); } catch (e) { wd.ui.toast(e.message, 'error'); } setup(el, onChange).then(onChange); };
      return false;
    }
    const peers = await wd.link.peers();
    const paired = peers.filter((p) => p.paired), nearby = peers.filter((p) => !p.paired && p.online);
    el.innerHTML = `<div class="wd-card"><div class="wd-row" style="margin-bottom:8px"><b class="wd-grow">This device: ${esc(st.deviceName)} <span class="wd-small wd-muted">· ${esc((st.addresses || []).join(', '))}</span></b>
        <button class="wd-btn wd-btn-sm" data-lk="code">Show pairing code</button><button class="wd-btn wd-btn-sm" data-lk="pair">Pair with code</button></div>
      ${st.error ? `<div class="wd-notice">${esc(st.error)}</div>` : ''}
      <div id="lk-code"></div>
      ${nearby.length ? `<div class="wd-small wd-muted" style="margin:6px 0">Nearby, not paired:</div>${nearby.map((p) => `<div class="wd-item"><span>${icon(p.platform)}</span><div class="wd-grow">${esc(p.name)} <span class="wd-small wd-muted">${esc(p.addr)}</span></div><button class="wd-btn wd-btn-sm" data-lk="pair" data-addr="${esc(p.addr)}">Pair</button></div>`).join('')}` : ''}
      ${!paired.length ? '<p class="wd-small wd-muted" style="margin-top:6px">No paired devices yet. Open WebDeck on your other device, press "Show pairing code" there, then "Pair with code" here.</p>' : ''}</div>`;
    el.onclick = async (e) => {
      const b = e.target.closest('[data-lk]');
      if (!b) return;
      if (b.dataset.lk === 'code') {
        const c = await wd.link.pairCode();
        el.querySelector('#lk-code').innerHTML = `<div class="wd-notice" style="margin:8px 0;font-size:15px">Pairing code <b style="font-size:22px;letter-spacing:3px">${c.code}</b> · this device's address: <b>${esc(c.addresses.join(', '))}</b> · valid 5 minutes</div>`;
      }
      if (b.dataset.lk === 'pair') {
        const dlg = document.createElement('dialog');
        dlg.className = 'wd-dialog';
        dlg.innerHTML = `<h2>Pair a device</h2><p class="wd-small wd-muted" style="margin:6px 0 10px">Enter the address and code shown on the other device.</p>
          <div class="wd-stack"><input class="wd-input" id="lk-a" placeholder="192.168.1.20" value="${esc(b.dataset.addr || '')}"><input class="wd-input" id="lk-c" placeholder="6-digit code" inputmode="numeric"></div>
          <div class="wd-row" style="margin-top:12px"><div class="wd-spacer"></div><button class="wd-btn" id="lk-x">Cancel</button><button class="wd-btn wd-btn-primary" id="lk-ok">Pair</button></div>`;
        document.body.appendChild(dlg);
        dlg.showModal();
        dlg.querySelector('#lk-x').onclick = () => dlg.remove();
        dlg.querySelector('#lk-ok').onclick = async () => {
          try { const p = await wd.link.pair(dlg.querySelector('#lk-a').value, dlg.querySelector('#lk-c').value); wd.ui.toast(`Paired with ${p.name}`, 'ok'); dlg.remove(); setup(el, onChange).then(onChange); }
          catch (err) { wd.ui.toast(err.message, 'error'); }
        };
      }
    };
    return true;
  }

  async function pairedPeers() { return (await wd.link.peers()).filter((p) => p.paired); }
  return { setup, pairedPeers, icon };
})();
