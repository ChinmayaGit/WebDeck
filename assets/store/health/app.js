(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const days = wd.db.collection('days');
  const keyOf = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const todayKey = () => keyOf(new Date());
  const DEFAULTS = { heightCm: 170, waterGoal: 8, glassMl: 250, stepGoal: 8000, sleepGoal: 8, reminders: true, unit: 'kg' };
  const MOODS = ['😞', '😕', '😐', '🙂', '😄'];

  async function getDay(key) {
    return (await days.find({ date: key }))[0] || { date: key, water: 0, sleep: null, sleepQuality: 0, weight: null, steps: null, mood: null, note: '' };
  }
  // Saves are queued so rapid taps can't create duplicate records for the same day.
  let saving = Promise.resolve();
  function saveDay(d) {
    saving = saving.then(async () => {
      const { _id, _createdAt, _updatedAt, ...data } = d;
      if (_id) return days.update(_id, data);
      const existing = (await days.find({ date: d.date }))[0];
      if (existing) { d._id = existing._id; return days.update(existing._id, data); }
      const created = await days.insert(data);
      d._id = created._id;
      return created;
    }).catch((e) => wd.ui.toast(e.message, 'error'));
    return saving;
  }

  // -------------------------------------------- background water reminder
  if (wd.job.active) {
    wd.job.run(async () => {
      const s = { ...DEFAULTS, ...(await wd.kv.get('settings', {})) };
      const h = new Date().getHours();
      if (!s.reminders || h < 9 || h >= 21) return 'Reminders paused (off or outside 9:00–21:00)';
      const d = await getDay(todayKey());
      // Expected glasses so far, spread evenly across the 12-hour day.
      const expected = Math.floor(((h - 9 + 1) / 12) * s.waterGoal);
      const last = await wd.kv.get('lastReminder', 0);
      if (d.water < expected && Date.now() - last > 90 * 60000) {
        await wd.notify('💧 Time for some water', `${d.water}/${s.waterGoal} glasses so far today`);
        await wd.kv.set('lastReminder', Date.now());
        return `Reminded (${d.water}/${expected} expected)`;
      }
      return `On track (${d.water}/${s.waterGoal})`;
    });
    return;
  }

  // ----------------------------------------------------------------- UI
  let settings = { ...DEFAULTS };
  let cur = null;
  const dayInput = $('day');
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    ['today', 'trends', 'settings'].forEach((id) => ($(id).hidden = id !== b.dataset.tab));
    if (b.dataset.tab === 'trends') renderTrends(30);
    if (b.dataset.tab === 'settings') renderSettings();
  }));
  const shiftDay = (n) => { const d = new Date(dayInput.value + 'T12:00'); d.setDate(d.getDate() + n); if (keyOf(d) <= todayKey()) { dayInput.value = keyOf(d); loadDay(); } };
  $('prevDay').onclick = () => shiftDay(-1);
  $('nextDay').onclick = () => shiftDay(1);
  dayInput.onchange = loadDay;

  async function loadDay() { cur = await getDay(dayInput.value); renderDay(); }

  function bmi(w) {
    if (!w || !settings.heightCm) return null;
    const kg = settings.unit === 'lbs' ? w * 0.4536 : w;
    const b = kg / (settings.heightCm / 100) ** 2;
    const label = b < 18.5 ? 'Underweight' : b < 25 ? 'Healthy' : b < 30 ? 'Overweight' : 'Obese';
    return `${b.toFixed(1)} · ${label}`;
  }

  function renderDay() {
    const d = cur;
    const ml = d.water * settings.glassMl;
    $('today').innerHTML = `
      <div class="wd-card tile"><h3>💧 Water</h3><div class="big">${d.water}<span class="wd-muted" style="font-size:15px"> / ${settings.waterGoal} glasses</span></div>
        <div class="glasses">${Array.from({ length: Math.max(settings.waterGoal, d.water) }, (_, i) => `<div class="glass ${i < d.water ? 'full' : ''}"></div>`).join('')}</div>
        <div class="wd-small wd-muted">${(ml / 1000).toFixed(2)} L</div>
        <div class="wd-row" style="margin-top:8px"><button class="wd-btn" data-water="-1">−</button><button class="wd-btn wd-btn-primary" data-water="1">+ Glass</button></div></div>
      <div class="wd-card tile"><h3>😴 Sleep</h3>
        <div class="wd-row"><input class="wd-input" type="number" step="0.25" min="0" max="24" data-f="sleep" value="${d.sleep ?? ''}" placeholder="Hours" style="width:110px"><span class="wd-muted">hours (goal ${settings.sleepGoal})</span></div>
        <div class="stars" style="margin-top:8px">Quality ${[1, 2, 3, 4, 5].map((n) => `<button data-quality="${n}" class="${n <= d.sleepQuality ? 'on' : ''}">★</button>`).join('')}</div></div>
      <div class="wd-card tile"><h3>⚖️ Weight</h3>
        <div class="wd-row"><input class="wd-input" type="number" step="0.1" min="0" data-f="weight" value="${d.weight ?? ''}" placeholder="${settings.unit}" style="width:110px"><span class="wd-muted">${settings.unit}</span></div>
        <div class="wd-small" style="margin-top:8px">BMI: <b>${bmi(d.weight) || '—'}</b></div></div>
      <div class="wd-card tile"><h3>👟 Steps</h3>
        <input class="wd-input" type="number" min="0" data-f="steps" value="${d.steps ?? ''}" placeholder="Steps" style="width:140px">
        <div class="wd-progress" style="margin-top:10px"><div style="width:${Math.min(100, ((d.steps || 0) / settings.stepGoal) * 100)}%"></div></div>
        <div class="wd-small wd-muted" style="margin-top:4px">Goal ${settings.stepGoal.toLocaleString()}</div></div>
      <div class="wd-card tile"><h3>🙂 Mood</h3><div class="moods">${MOODS.map((m, i) => `<button data-mood="${i + 1}" aria-pressed="${d.mood === i + 1}">${m}</button>`).join('')}</div></div>
      <div class="wd-card tile"><h3>📝 Notes</h3><textarea class="wd-input" data-f="note" style="min-height:80px;font-family:var(--wd-font);font-size:14px" placeholder="How did today go?">${esc(d.note || '')}</textarea></div>`;
  }
  let saveT;
  $('today').addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    cur[f] = f === 'note' ? e.target.value : e.target.value === '' ? null : +e.target.value;
    clearTimeout(saveT);
    saveT = setTimeout(async () => { await saveDay(cur); if (f === 'weight') renderDay(); }, 500);
  });
  $('today').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.water) cur.water = Math.max(0, cur.water + +b.dataset.water);
    if (b.dataset.quality) cur.sleepQuality = +b.dataset.quality;
    if (b.dataset.mood) cur.mood = +b.dataset.mood;
    await saveDay(cur);
    renderDay();
    if (b.dataset.water === '1' && cur.water === settings.waterGoal) wd.ui.toast('💧 Water goal reached!', 'ok');
  });

  // ------------------------------------------------------------- trends
  function lineChart(points, { color, goal, fmt = (v) => v }) {
    const W = 600, H = 150, L = 36, B = 18, T = 8;
    const vals = points.filter((p) => p.v != null);
    if (vals.length < 2) return '<p class="wd-small wd-muted">Log at least two days to see a trend.</p>';
    let lo = Math.min(...vals.map((p) => p.v), goal ?? Infinity), hi = Math.max(...vals.map((p) => p.v), goal ?? -Infinity);
    if (lo === hi) { lo -= 1; hi += 1; }
    const X = (i) => L + (i / (points.length - 1)) * (W - L - 8), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const d = points.map((p, i) => (p.v == null ? null : `${X(i)},${Y(p.v)}`)).filter(Boolean).join(' L');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%">${goal != null ? `<line x1="${L}" x2="${W - 8}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="#8b949e" stroke-dasharray="4 4"/><text x="${W - 8}" y="${Y(goal) - 3}" text-anchor="end">goal</text>` : ''}
      <path d="M${d}" fill="none" stroke="${color}" stroke-width="2"/>${points.map((p, i) => (p.v == null ? '' : `<circle cx="${X(i)}" cy="${Y(p.v)}" r="2.5" fill="${color}"><title>${p.date}: ${fmt(p.v)}</title></circle>`)).join('')}
      <text x="${L - 4}" y="${Y(hi) + 4}" text-anchor="end">${fmt(hi)}</text><text x="${L - 4}" y="${Y(lo) + 4}" text-anchor="end">${fmt(lo)}</text>
      <text x="${L}" y="${H - 4}">${points[0].date.slice(5)}</text><text x="${W - 8}" y="${H - 4}" text-anchor="end">${points[points.length - 1].date.slice(5)}</text></svg>`;
  }
  async function renderTrends(n) {
    const all = await days.find();
    const byDate = Object.fromEntries(all.map((d) => [d.date, d]));
    const series = Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); const k = keyOf(d); return { date: k, d: byDate[k] || {} }; });
    const pick = (f) => series.map((s) => ({ date: s.date, v: s.d[f] ?? null }));
    const avg = (f) => { const v = series.map((s) => s.d[f]).filter((x) => x != null && x !== 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const weights = series.map((s) => s.d.weight).filter((x) => x != null);
    const change = weights.length > 1 ? weights[weights.length - 1] - weights[0] : null;
    $('trends').innerHTML = `<div class="wd-row" style="margin-bottom:12px">${[7, 30, 90].map((x) => `<button class="wd-chip" aria-pressed="${x === n}" data-range="${x}">${x} days</button>`).join('')}</div>
      <div class="cards">
        <div class="wd-card"><h3>💧 Water · avg ${avg('water')?.toFixed(1) ?? '—'} glasses</h3>${lineChart(pick('water'), { color: '#38bdf8', goal: settings.waterGoal })}</div>
        <div class="wd-card"><h3>😴 Sleep · avg ${avg('sleep')?.toFixed(1) ?? '—'} h</h3>${lineChart(pick('sleep'), { color: '#a78bfa', goal: settings.sleepGoal })}</div>
        <div class="wd-card"><h3>⚖️ Weight${change != null ? ` · ${change > 0 ? '+' : ''}${change.toFixed(1)} ${settings.unit}` : ''}</h3>${lineChart(pick('weight'), { color: '#f97316', fmt: (v) => v.toFixed(1) })}</div>
        <div class="wd-card"><h3>👟 Steps · avg ${avg('steps') ? Math.round(avg('steps')).toLocaleString() : '—'}</h3>${lineChart(pick('steps'), { color: '#22c55e', goal: settings.stepGoal, fmt: (v) => Math.round(v).toLocaleString() })}</div>
        <div class="wd-card"><h3>🙂 Mood · avg ${avg('mood') ? MOODS[Math.round(avg('mood')) - 1] : '—'}</h3>${lineChart(pick('mood'), { color: '#facc15', fmt: (v) => MOODS[Math.round(v) - 1] || v })}</div>
      </div>`;
    $('trends').querySelectorAll('[data-range]').forEach((b) => (b.onclick = () => renderTrends(+b.dataset.range)));
  }

  // ----------------------------------------------------------- settings
  function renderSettings() {
    const f = (id, label, type = 'number', extra = '') => `<div><label class="wd-label">${label}</label><input class="wd-input" data-s="${id}" type="${type}" value="${esc(settings[id])}" ${extra}></div>`;
    $('settings').innerHTML = `<div class="wd-card wd-stack"><div class="wd-fields">
        ${f('heightCm', 'Height (cm)', 'number', 'min="50" max="250"')}${f('waterGoal', 'Water goal (glasses)', 'number', 'min="1" max="30"')}${f('glassMl', 'Glass size (ml)', 'number', 'min="50" max="1000"')}
        ${f('stepGoal', 'Daily step goal')}${f('sleepGoal', 'Sleep goal (hours)', 'number', 'step="0.5"')}
        <div><label class="wd-label">Weight unit</label><select class="wd-select" data-s="unit"><option ${settings.unit === 'kg' ? 'selected' : ''}>kg</option><option ${settings.unit === 'lbs' ? 'selected' : ''}>lbs</option></select></div></div>
        <label class="wd-row"><input type="checkbox" data-s="reminders" ${settings.reminders ? 'checked' : ''}> Remind me to drink water when I'm behind (9:00–21:00)</label>
        <div class="wd-row"><div class="wd-spacer"></div><button class="wd-btn" id="export">Export CSV</button></div></div>`;
    $('export').onclick = async () => {
      const all = await days.find(null, { sort: 'date' });
      const csv = ['date,water,sleep,sleepQuality,weight,steps,mood,note', ...all.map((d) => [d.date, d.water, d.sleep ?? '', d.sleepQuality || '', d.weight ?? '', d.steps ?? '', d.mood ?? '', `"${(d.note || '').replace(/"/g, '""')}"`].join(','))].join('\n');
      try { const s = await wd.files.save({ name: 'health-export.csv', text: csv }); wd.ui.toast('Saved ' + s.name, 'ok'); wd.files.reveal(s.path); } catch (e) { wd.ui.toast(e.message, 'error'); }
    };
  }
  $('settings').addEventListener('change', async (e) => {
    const k = e.target.dataset.s;
    if (!k) return;
    settings[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? +e.target.value : e.target.value;
    await wd.kv.set('settings', settings);
    wd.ui.toast('Saved', 'ok');
  });

  (async () => {
    settings = { ...DEFAULTS, ...(await wd.kv.get('settings', {})) };
    dayInput.value = todayKey();
    dayInput.max = todayKey();
    loadDay();
  })();
})();
