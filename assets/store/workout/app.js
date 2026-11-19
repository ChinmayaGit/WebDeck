(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  // Exercise dataset + demo GIFs from the Reclaim project (ChinmayaGit/exercises).
  const JSON_URL = 'https://raw.githubusercontent.com/ChinmayaGit/exercises/main/data/exercises.json';
  const GIF = (id) => `https://cdn.jsdelivr.net/gh/ChinmayaGit/exercises@main/gifs/${id}.gif`;
  const GIF_FALLBACK = (id) => `https://raw.githubusercontent.com/ChinmayaGit/exercises/main/gifs/${id}.gif`;
  const workouts = wd.db.collection('workouts');
  const routines = wd.db.collection('routines');
  const nid = () => Math.random().toString(36).slice(2, 10);
  let exercises = [];
  let settings = { unit: 'kg', rest: 90 };
  let active = null; // in-progress workout

  // ------------------------------------------------------------ tabs
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  function showTab(t) {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === t)));
    ['log', 'library', 'routines', 'history'].forEach((id) => ($(id).hidden = id !== t));
    if (t === 'log') renderLog();
    if (t === 'library') renderLibrary();
    if (t === 'routines') renderRoutines();
    if (t === 'history') renderHistory();
  }

  // --------------------------------------------------------- dataset
  async function loadExercises() {
    const cached = await wd.kv.get('exercises', null);
    if (cached && Date.now() - cached.at < 7 * 86400000) { exercises = cached.items; return; }
    try {
      const raw = (await wd.net.fetch(JSON_URL, { timeout: 40 })).json();
      exercises = raw.map((r) => {
        const id = String(r.id ?? '').padStart(4, '0');
        const steps = r.instruction_steps?.en?.filter(Boolean) ?? (r.instructions?.en ? r.instructions.en.split(/(?<=\.)\s+/).filter(Boolean) : []);
        return { id, name: (r.name || '').trim(), muscle: (r.muscle_group || r.target || r.body_part || 'other').trim(), bodyPart: (r.body_part || '').trim(), equipment: (r.equipment || '').trim(), secondary: r.secondary_muscles || [], steps };
      }).filter((e) => e.name);
      await wd.kv.set('exercises', { at: Date.now(), items: exercises });
    } catch (e) {
      if (cached) exercises = cached.items;
      else wd.ui.toast('Could not load the exercise library (offline?). You can still log custom exercises.', 'error');
    }
  }
  const exById = (id) => exercises.find((e) => e.id === id);
  const img = (id, cls = '') => `<img class="${cls}" src="${GIF(id)}" onerror="this.onerror=null;this.src='${GIF_FALLBACK(id)}'" loading="lazy" alt="">`;

  // ------------------------------------------------------------- log
  const volume = (w) => w.exercises.reduce((s, e) => s + e.sets.filter((x) => x.done).reduce((a, x) => a + (+x.kg || 0) * (+x.reps || 0), 0), 0);
  const doneSets = (w) => w.exercises.reduce((s, e) => s + e.sets.filter((x) => x.done).length, 0);
  const unit = () => settings.unit;

  async function weekStats() {
    const all = await workouts.find({ finishedAt: { $ne: null } });
    const week = all.filter((w) => Date.now() - Date.parse(w.finishedAt) < 7 * 86400000);
    // Streak of consecutive days with a workout, ending today or yesterday.
    const days = new Set(all.map((w) => w.finishedAt.slice(0, 10)));
    let streak = 0;
    for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
      const key = d.toISOString().slice(0, 10);
      if (days.has(key)) streak++;
      else if (streak || key !== new Date().toISOString().slice(0, 10)) break;
    }
    return { sessions: week.length, sets: week.reduce((s, w) => s + doneSets(w), 0), volume: week.reduce((s, w) => s + volume(w), 0), total: all.length, streak };
  }

  async function renderLog() {
    const st = await weekStats();
    $('sub').textContent = `${st.sessions} session${st.sessions === 1 ? '' : 's'} this week · ${st.sets} sets`;
    const head = `<div class="stats">
      <div class="stat"><span>This week</span><b>${st.sessions}</b><span>sessions</span></div>
      <div class="stat"><span>Sets this week</span><b>${st.sets}</b></div>
      <div class="stat"><span>Volume this week</span><b>${Math.round(st.volume).toLocaleString()}</b><span>${unit()}</span></div>
      <div class="stat"><span>Day streak</span><b>${st.streak} 🔥</b></div>
      <div class="stat"><span>All workouts</span><b>${st.total}</b></div></div>`;
    if (!active) {
      const rs = await routines.find(null, { sort: 'name' });
      $('log').innerHTML = head + `<div class="wd-card wd-stack" style="text-align:center;padding:30px">
        <h2>Ready to train?</h2><p class="wd-muted">Start an empty workout or one of your routines.</p>
        <div class="wd-row" style="justify-content:center"><button class="wd-btn wd-btn-primary" id="startEmpty">Start empty workout</button>
        ${rs.map((r) => `<button class="wd-btn" data-start-routine="${r._id}">▶ ${esc(r.name)}</button>`).join('')}</div>
        <div class="wd-row wd-small" style="justify-content:center;margin-top:10px">Units <select class="wd-select" id="unitSel" style="width:auto"><option ${unit() === 'kg' ? 'selected' : ''}>kg</option><option ${unit() === 'lbs' ? 'selected' : ''}>lbs</option></select>
          Rest timer <select class="wd-select" id="restSel" style="width:auto">${[0, 45, 60, 90, 120, 180].map((s) => `<option value="${s}" ${settings.rest === s ? 'selected' : ''}>${s ? s + ' s' : 'Off'}</option>`).join('')}</select></div></div>`;
      $('startEmpty').onclick = () => start({ title: `Workout ${new Date().toLocaleDateString(undefined, { weekday: 'long' })}`, exercises: [] });
      $('unitSel').onchange = async () => { settings.unit = $('unitSel').value; await wd.kv.set('settings', settings); renderLog(); };
      $('restSel').onchange = async () => { settings.rest = +$('restSel').value; await wd.kv.set('settings', settings); };
      return;
    }
    const elapsed = Math.floor((Date.now() - Date.parse(active.startedAt)) / 60000);
    $('log').innerHTML = head + `<div class="wd-card wd-stack">
        <div class="wd-row"><input class="wd-input wd-grow" id="title" value="${esc(active.title)}" style="font-weight:700;font-size:16px"><span class="wd-muted wd-small">${elapsed} min · ${doneSets(active)} sets · ${Math.round(volume(active)).toLocaleString()} ${unit()}</span></div>
        ${active.exercises.map((ex, i) => exerciseBlock(ex, i)).join('') || '<p class="wd-muted">Add your first exercise.</p>'}
        <div class="wd-row"><button class="wd-btn" id="addEx">+ Add exercise</button><button class="wd-btn" id="addCustom">+ Custom exercise</button><div class="wd-spacer"></div>
          <button class="wd-btn" id="saveRoutine">Save as routine</button><button class="wd-btn wd-btn-danger" id="discard">Discard</button><button class="wd-btn wd-btn-primary" id="finish">Finish workout</button></div></div>`;
    $('title').onchange = () => { active.title = $('title').value; persist(); };
    $('addEx').onclick = () => showTab('library');
    $('addCustom').onclick = askCustom; // native prompt() isn't available in the embedded WebView
    $('saveRoutine').onclick = saveRoutine;
    $('finish').onclick = finish;
    $('discard').onclick = async (e) => {
      if (!e.target.dataset.armed) { e.target.dataset.armed = '1'; e.target.textContent = 'Click again to discard'; return; }
      await workouts.remove(active._id); active = null; renderLog();
    };
  }

  function askCustom() {
    const dlg = $('dlg');
    dlg.innerHTML = `<h2>Custom exercise</h2><input class="wd-input" id="cName" placeholder="e.g. Sled push" style="margin:12px 0"><div class="wd-row"><div class="wd-spacer"></div><button class="wd-btn" id="cX">Cancel</button><button class="wd-btn wd-btn-primary" id="cOk">Add</button></div>`;
    dlg.showModal();
    $('cX').onclick = () => dlg.close();
    $('cOk').onclick = () => { const n = $('cName').value.trim(); if (n) addExercise({ id: 'custom-' + nid(), name: n, muscle: 'custom' }); dlg.close(); };
  }

  function exerciseBlock(ex, i) {
    const known = exById(ex.exId);
    const best = prs[ex.exId];
    return `<div class="wd-card" style="background:var(--wd-surface-2)">
      <div class="wd-row">${known ? `<div style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex:none">${img(ex.exId)}</div>` : ''}
        <div class="wd-grow"><b class="cap">${esc(ex.name)}</b><div class="wd-small wd-muted cap">${esc(ex.muscle || '')}${best ? ` · PR ${best.kg} ${unit()} × ${best.reps}` : ''}</div></div>
        ${known ? `<button class="wd-btn wd-btn-sm wd-btn-ghost" data-info="${ex.exId}">How to</button>` : ''}<button class="wd-btn wd-btn-sm wd-btn-ghost" data-rmex="${i}">✕</button></div>
      <table class="sets"><tr><th>Set</th><th>${unit()}</th><th>Reps</th><th>✓</th><th></th></tr>
        ${ex.sets.map((s, si) => `<tr class="${s.done ? 'done' : ''}"><td>${si + 1}</td>
          <td><input class="wd-input" type="number" step="0.5" min="0" data-e="${i}" data-s="${si}" data-f="kg" value="${s.kg}"></td>
          <td><input class="wd-input" type="number" min="0" data-e="${i}" data-s="${si}" data-f="reps" value="${s.reps}"></td>
          <td><button class="tick ${s.done ? 'on' : ''}" data-tick="${i}:${si}">✓</button></td>
          <td><button class="wd-btn wd-btn-sm wd-btn-ghost" data-rmset="${i}:${si}">−</button></td></tr>`).join('')}</table>
      <button class="wd-btn wd-btn-sm" data-addset="${i}" style="margin-top:6px">+ Add set</button></div>`;
  }

  $('log').addEventListener('input', (e) => {
    const { e: i, s: si, f } = e.target.dataset;
    if (f) { active.exercises[+i].sets[+si][f] = +e.target.value; persistSoon(); }
  });
  $('log').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.startRoutine) {
      const r = await routines.get(b.dataset.startRoutine);
      return start({ title: r.name, exercises: r.exercises.map((x) => ({ ...x, sets: x.sets.map((s) => ({ ...s, id: nid(), done: false })) })) });
    }
    if (b.dataset.info) return showExercise(exById(b.dataset.info), false);
    if (b.dataset.rmex) { active.exercises.splice(+b.dataset.rmex, 1); }
    if (b.dataset.addset) { const ex = active.exercises[+b.dataset.addset]; const last = ex.sets[ex.sets.length - 1]; ex.sets.push({ id: nid(), kg: last ? last.kg : 0, reps: last ? last.reps : 0, done: false }); }
    if (b.dataset.rmset) { const [i, si] = b.dataset.rmset.split(':').map(Number); active.exercises[i].sets.splice(si, 1); }
    if (b.dataset.tick) {
      const [i, si] = b.dataset.tick.split(':').map(Number);
      const s = active.exercises[i].sets[si];
      s.done = !s.done;
      if (s.done && settings.rest) startTimer(settings.rest);
    }
    if (b.dataset.rmex || b.dataset.addset || b.dataset.rmset || b.dataset.tick) { await persist(); renderLog(); }
  });

  async function start(w) {
    active = await workouts.insert({ ...w, startedAt: new Date().toISOString(), finishedAt: null });
    showTab('log');
  }
  function addExercise(ex) {
    if (!active) { start({ title: `Workout ${new Date().toLocaleDateString(undefined, { weekday: 'long' })}`, exercises: [] }).then(() => addExercise(ex)); return; }
    const last = lastSetsFor(ex.id);
    active.exercises.push({ exId: ex.id, name: ex.name, muscle: ex.muscle, sets: last.length ? last.map((s) => ({ id: nid(), kg: s.kg, reps: s.reps, done: false })) : [{ id: nid(), kg: 0, reps: 0, done: false }] });
    persist().then(() => showTab('log'));
    wd.ui.toast(`Added ${ex.name}`, 'ok');
  }
  let persistTimer;
  const persistSoon = () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 600); };
  async function persist() { if (active) await workouts.update(active._id, { title: active.title, exercises: active.exercises }); }
  async function finish() {
    if (!doneSets(active)) { wd.ui.toast('Tick at least one set as done first', 'error'); return; }
    await workouts.update(active._id, { title: active.title, exercises: active.exercises, finishedAt: new Date().toISOString() });
    const newPrs = [];
    for (const ex of active.exercises) for (const s of ex.sets.filter((x) => x.done)) {
      const p = prs[ex.exId];
      if (!p || +s.kg > p.kg) { newPrs.push(`${ex.name} ${s.kg} ${unit()}`); prs[ex.exId] = { kg: +s.kg, reps: +s.reps }; }
    }
    wd.ui.toast(`Workout saved: ${doneSets(active)} sets, ${Math.round(volume(active)).toLocaleString()} ${unit()}`, 'ok');
    if (newPrs.length) wd.notify('🏆 New personal record', newPrs.slice(0, 3).join(', ')).catch(() => {});
    active = null;
    stopTimer();
    await computePrs();
    renderLog();
  }
  async function saveRoutine() {
    const name = active.title.trim() || 'Routine';
    await routines.insert({ name, exercises: active.exercises.map((e) => ({ exId: e.exId, name: e.name, muscle: e.muscle, sets: e.sets.map((s) => ({ kg: s.kg, reps: s.reps })) })) });
    wd.ui.toast(`Saved routine “${name}”`, 'ok');
  }

  // ------------------------------------------------------------- PRs
  let prs = {};
  let lastSets = {};
  async function computePrs() {
    prs = {}; lastSets = {};
    const all = await workouts.find({ finishedAt: { $ne: null } }, { sort: 'finishedAt' });
    for (const w of all) for (const ex of w.exercises) {
      const done = ex.sets.filter((s) => s.done);
      if (done.length) lastSets[ex.exId] = done;
      for (const s of done) if (!prs[ex.exId] || +s.kg > prs[ex.exId].kg || (+s.kg === prs[ex.exId].kg && +s.reps > prs[ex.exId].reps)) prs[ex.exId] = { kg: +s.kg, reps: +s.reps, at: w.finishedAt };
    }
  }
  const lastSetsFor = (id) => lastSets[id] || [];

  // -------------------------------------------------------- rest timer
  let tEnd = 0, tInt = null;
  function startTimer(sec) {
    tEnd = Date.now() + sec * 1000;
    $('timer').hidden = false;
    clearInterval(tInt);
    tInt = setInterval(tick, 250);
    tick();
  }
  function tick() {
    const left = Math.max(0, Math.round((tEnd - Date.now()) / 1000));
    $('tLeft').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (!left) { stopTimer(); beep(); wd.ui.toast('Rest over: next set!', 'ok'); }
  }
  function stopTimer() { clearInterval(tInt); $('timer').hidden = true; }
  function beep() {
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + 0.25); } catch (_) {}
  }
  $('tPlus').onclick = () => (tEnd += 15000);
  $('tMinus').onclick = () => (tEnd -= 15000);
  $('tSkip').onclick = stopTimer;

  // ---------------------------------------------------------- library
  let shown = 60;
  function renderLibrary() {
    if (!$('muscle').options[1]) {
      const opts = (key) => [...new Set(exercises.map((e) => e[key]).filter(Boolean))].sort().map((m) => `<option class="cap" value="${esc(m)}">${esc(m)}</option>`).join('');
      $('muscle').innerHTML += opts('muscle');
      $('equip').innerHTML += opts('equipment');
    }
    const q = $('q').value.toLowerCase(), m = $('muscle').value, eq = $('equip').value;
    const list = exercises.filter((e) => (!m || e.muscle === m) && (!eq || e.equipment === eq) && (!q || e.name.toLowerCase().includes(q)));
    $('exGrid').innerHTML = list.slice(0, shown).map((e) => `<div class="ex" data-ex="${e.id}">${img(e.id)}<div class="meta"><b>${esc(e.name)}</b><span class="wd-small wd-muted cap">${esc(e.muscle)} · ${esc(e.equipment)}</span></div></div>`).join('') ||
      `<div class="wd-empty" style="grid-column:1/-1">${exercises.length ? 'No exercises match.' : 'Exercise library unavailable offline.'}</div>`;
    $('more').hidden = list.length <= shown;
  }
  ['q', 'muscle', 'equip'].forEach((id) => ($(id).oninput = () => { shown = 60; renderLibrary(); }));
  $('more').onclick = () => { shown += 60; renderLibrary(); };
  $('exGrid').addEventListener('click', (e) => { const c = e.target.closest('[data-ex]'); if (c) showExercise(exById(c.dataset.ex), true); });

  function showExercise(ex, canAdd) {
    if (!ex) return;
    const p = prs[ex.id];
    const dlg = $('dlg');
    dlg.innerHTML = `${img(ex.id, 'demo')}<h2 class="cap">${esc(ex.name)}</h2>
      <div class="wd-row" style="gap:6px;margin:8px 0"><span class="wd-badge wd-badge-blue cap">${esc(ex.muscle)}</span><span class="wd-badge cap">${esc(ex.equipment)}</span>${ex.secondary.map((s) => `<span class="wd-badge cap">${esc(s)}</span>`).join('')}</div>
      ${p ? `<p class="wd-small">🏆 Your best: <b>${p.kg} ${unit()} × ${p.reps}</b></p>` : ''}
      <ol style="padding-left:18px;line-height:1.55">${ex.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="wd-row" style="margin-top:12px"><div class="wd-spacer"></div><button class="wd-btn" id="dClose">Close</button>${canAdd ? '<button class="wd-btn wd-btn-primary" id="dAdd">Add to workout</button>' : ''}</div>`;
    dlg.showModal();
    $('dClose').onclick = () => dlg.close();
    if (canAdd) $('dAdd').onclick = () => { dlg.close(); addExercise(ex); };
  }

  // --------------------------------------------------------- routines
  async function renderRoutines() {
    const rs = await routines.find(null, { sort: 'name' });
    $('routines').innerHTML = rs.map((r) => `<div class="wd-item"><div class="wd-grow"><b>${esc(r.name)}</b><div class="wd-small wd-muted cap">${esc(r.exercises.map((e) => e.name).join(' · '))}</div></div>
      <button class="wd-btn wd-btn-sm wd-btn-primary" data-go="${r._id}">Start</button><button class="wd-btn wd-btn-sm wd-btn-ghost" data-del="${r._id}">✕</button></div>`).join('') ||
      '<div class="wd-empty"><div class="wd-empty-icon">📋</div>Build a workout, then press “Save as routine” to reuse it.</div>';
  }
  $('routines').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.del) { await routines.remove(b.dataset.del); return renderRoutines(); }
    if (b.dataset.go) { const r = await routines.get(b.dataset.go); start({ title: r.name, exercises: r.exercises.map((x) => ({ ...x, sets: x.sets.map((s) => ({ ...s, id: nid(), done: false })) })) }); }
  });

  // ---------------------------------------------------------- history
  async function renderHistory() {
    const all = await workouts.find({ finishedAt: { $ne: null } }, { sort: '-finishedAt', limit: 200 });
    // Volume per week for the last 12 weeks.
    const weeks = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 7 * (11 - i)); return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), v: 0, start: Date.now() - 7 * 86400000 * (12 - i) }; });
    for (const w of all) { const t = Date.parse(w.finishedAt); const wk = weeks.find((x) => t >= x.start && t < x.start + 7 * 86400000); if (wk) wk.v += volume(w); }
    const max = Math.max(1, ...weeks.map((w) => w.v));
    const bars = `<svg viewBox="0 0 600 140" width="100%">${weeks.map((w, i) => `<rect x="${i * 50 + 8}" y="${120 - (w.v / max) * 105}" width="34" height="${(w.v / max) * 105}" rx="4" fill="#f97316" opacity="${w.v ? 0.9 : 0.15}"><title>${Math.round(w.v).toLocaleString()} ${unit()}</title></rect><text x="${i * 50 + 25}" y="136" text-anchor="middle" font-size="9" fill="#8b949e">${w.label}</text>`).join('')}</svg>`;
    const prList = Object.entries(prs).map(([id, p]) => ({ name: (exById(id) || {}).name || (all.flatMap((w) => w.exercises).find((e) => e.exId === id) || {}).name || id, ...p })).sort((a, b) => b.kg - a.kg).slice(0, 12);
    $('history').innerHTML = `<div class="wd-card"><h3>Weekly volume (${unit()})</h3>${bars}</div>
      ${prList.length ? `<div class="wd-card"><h3 style="margin-bottom:8px">Personal records</h3><table class="wd-table">${prList.map((p) => `<tr><td class="cap">${esc(p.name)}</td><td><b>${p.kg} ${unit()}</b> × ${p.reps}</td><td class="wd-small wd-muted">${p.at ? new Date(p.at).toLocaleDateString() : ''}</td></tr>`).join('')}</table></div>` : ''}
      <div class="wd-list" style="margin-top:12px">${all.map((w) => `<details class="wd-card"><summary style="cursor:pointer"><b>${esc(w.title)}</b> <span class="wd-small wd-muted">· ${new Date(w.finishedAt).toLocaleString()} · ${w.exercises.length} exercises · ${doneSets(w)} sets · ${Math.round(volume(w)).toLocaleString()} ${unit()}</span></summary>
        <table class="wd-table" style="margin-top:8px">${w.exercises.map((e) => `<tr><td class="cap">${esc(e.name)}</td><td>${e.sets.filter((s) => s.done).map((s) => `${s.kg}×${s.reps}`).join(', ')}</td></tr>`).join('')}</table>
        <button class="wd-btn wd-btn-sm wd-btn-ghost" data-delw="${w._id}" style="margin-top:6px">Delete</button></details>`).join('') || '<div class="wd-empty">Finished workouts appear here.</div>'}</div>`;
  }
  $('history').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-delw]');
    if (!b) return;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to delete'; return; }
    await workouts.remove(b.dataset.delw); await computePrs(); renderHistory();
  });

  (async () => {
    settings = await wd.kv.get('settings', settings);
    active = (await workouts.find({ finishedAt: null }))[0] || null;
    await computePrs();
    renderLog();
    await loadExercises();
    if (!$('library').hidden) renderLibrary();
  })();
})();
