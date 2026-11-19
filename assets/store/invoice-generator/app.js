(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const $ = (id) => document.getElementById(id);
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  let rows = [{ desc: '', qty: 1, price: 0 }];

  const money = (n, cur) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n); } catch (_) { return `${cur} ${n.toFixed(2)}`; }
  };
  // The built-in PDF fonts only cover Western characters; fall back gracefully (e.g. ₹ → "Rs.").
  const pdfSafe = (s) => String(s).replace(/₹/g, 'Rs.').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF€\n]/g, '?');
  const pdfMoney = (n, cur) => pdfSafe(money(n, cur));

  function totals() {
    const sub = rows.reduce((s, r) => s + (+r.qty || 0) * (+r.price || 0), 0);
    const discount = Math.min(sub, +$('discount').value || 0);
    const tax = ((sub - discount) * (+$('tax').value || 0)) / 100;
    return { sub, discount, tax, total: sub - discount + tax };
  }

  function renderRows() {
    const cur = $('currency').value;
    $('rows').innerHTML = rows.map((r, i) => `<tr>
      <td><input class="wd-input" data-i="${i}" data-k="desc" value="${esc(r.desc)}" placeholder="Item or service"></td>
      <td><input class="wd-input" data-i="${i}" data-k="qty" type="number" min="0" step="any" value="${r.qty}" style="width:80px"></td>
      <td><input class="wd-input" data-i="${i}" data-k="price" type="number" min="0" step="any" value="${r.price}" style="width:110px"></td>
      <td style="text-align:right;white-space:nowrap">${money((+r.qty || 0) * (+r.price || 0), cur)}</td>
      <td><button class="wd-btn wd-btn-sm wd-btn-ghost" data-rm="${i}" ${rows.length === 1 ? 'disabled' : ''}>✕</button></td></tr>`).join('');
    renderTotals();
  }
  function renderTotals() {
    const t = totals(), cur = $('currency').value;
    $('totals').innerHTML = `<div><span class="wd-muted">Subtotal</span><span>${money(t.sub, cur)}</span></div>
      ${t.discount ? `<div><span class="wd-muted">Discount</span><span>−${money(t.discount, cur)}</span></div>` : ''}
      ${t.tax ? `<div><span class="wd-muted">Tax (${+$('tax').value}%)</span><span>${money(t.tax, cur)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(t.total, cur)}</span></div>`;
  }

  $('rows').addEventListener('input', (e) => {
    const { i, k } = e.target.dataset;
    if (i == null) return;
    rows[+i][k] = k === 'desc' ? e.target.value : e.target.value;
    const cell = e.target.closest('tr').children[3];
    cell.textContent = money((+rows[+i].qty || 0) * (+rows[+i].price || 0), $('currency').value);
    renderTotals();
  });
  $('rows').addEventListener('click', (e) => { const i = e.target.dataset.rm; if (i != null && rows.length > 1) { rows.splice(+i, 1); renderRows(); } });
  $('addRow').onclick = () => { rows.push({ desc: '', qty: 1, price: 0 }); renderRows(); $('rows').querySelector('tr:last-child input').focus(); };
  ['tax', 'discount'].forEach((id) => $(id).addEventListener('input', renderTotals));
  $('currency').onchange = renderRows;
  $('folder').onclick = () => wd.files.openFolder().catch((e) => wd.ui.toast(e.message, 'error'));

  async function buildPdf() {
    const cur = $('currency').value;
    const color = (() => { const n = parseInt($('color').value.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); })();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 595.28, H = 841.89, M = 48;
    let page = doc.addPage([W, H]);
    const gray = rgb(0.4, 0.4, 0.45), dark = rgb(0.1, 0.1, 0.12);
    const text = (s, x, y, o = {}) => page.drawText(pdfSafe(s), { x, y, size: o.size || 10, font: o.bold ? bold : font, color: o.color || dark });
    const right = (s, x, y, o = {}) => { const f = o.bold ? bold : font, sz = o.size || 10; text(s, x - f.widthOfTextAtSize(pdfSafe(s), sz), y, o); };
    const lines = (s) => pdfSafe(s).split('\n').map((l) => l.trim()).filter(Boolean);

    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color });
    text('INVOICE', M, H - 70, { size: 26, bold: true, color });
    right(`# ${$('number').value}`, W - M, H - 62, { size: 12, bold: true });
    right(`Date: ${$('date').value}`, W - M, H - 78, { color: gray });
    if ($('due').value) right(`Due: ${$('due').value}`, W - M, H - 92, { color: gray });

    let y = H - 130;
    text('FROM', M, y, { size: 8, bold: true, color: gray });
    text('BILL TO', W / 2, y, { size: 8, bold: true, color: gray });
    const from = lines($('from').value), to = lines($('to').value);
    for (let i = 0; i < Math.max(from.length, to.length); i++) {
      y -= 14;
      if (from[i]) text(from[i], M, y, { bold: i === 0 });
      if (to[i]) text(to[i], W / 2, y, { bold: i === 0 });
    }

    y -= 34;
    const cols = { desc: M + 8, qty: W - M - 190, price: W - M - 100, amt: W - M - 8 };
    const header = () => {
      page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 22, color, opacity: 0.12 });
      text('DESCRIPTION', cols.desc, y, { size: 8, bold: true });
      right('QTY', cols.qty + 20, y, { size: 8, bold: true });
      right('PRICE', cols.price + 40, y, { size: 8, bold: true });
      right('AMOUNT', cols.amt, y, { size: 8, bold: true });
      y -= 24;
    };
    header();
    for (const r of rows.filter((x) => x.desc || +x.price)) {
      if (y < 160) { page = doc.addPage([W, H]); y = H - M; header(); }
      // Wrap long descriptions.
      const words = pdfSafe(r.desc || '-').split(/\s+/);
      const wrapped = [''];
      for (const w of words) {
        const next = (wrapped[wrapped.length - 1] + ' ' + w).trim();
        if (font.widthOfTextAtSize(next, 10) > cols.qty - cols.desc - 40) wrapped.push(w); else wrapped[wrapped.length - 1] = next;
      }
      wrapped.forEach((l, k) => text(l, cols.desc, y - k * 13));
      right(String(+r.qty || 0), cols.qty + 20, y);
      right(pdfMoney(+r.price || 0, cur), cols.price + 40, y);
      right(pdfMoney((+r.qty || 0) * (+r.price || 0), cur), cols.amt, y);
      y -= 13 * wrapped.length + 9;
      page.drawLine({ start: { x: M, y: y + 12 }, end: { x: W - M, y: y + 12 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) });
    }

    const t = totals();
    y -= 8;
    const row = (label, value, o = {}) => { right(label, W - M - 120, y, { color: gray, ...o }); right(value, W - M - 8, y, o); y -= o.size ? 22 : 16; };
    row('Subtotal', pdfMoney(t.sub, cur));
    if (t.discount) row('Discount', '-' + pdfMoney(t.discount, cur));
    if (t.tax) row(`Tax (${+$('tax').value}%)`, pdfMoney(t.tax, cur));
    y -= 4;
    row('TOTAL', pdfMoney(t.total, cur), { bold: true, size: 14, color });

    const notes = lines($('notes').value);
    if (notes.length) {
      y -= 18;
      text('NOTES', M, y, { size: 8, bold: true, color: gray });
      for (const n of notes) { y -= 14; text(n, M, y, { color: gray }); }
    }
    doc.setTitle(`Invoice ${$('number').value}`);
    doc.setCreator('WebDeck Invoice Generator');
    return doc.save();
  }

  $('make').onclick = async () => {
    if (!rows.some((r) => r.desc || +r.price)) { wd.ui.toast('Add at least one line item', 'error'); return; }
    try {
      const bytes = await buildPdf();
      const client = ($('to').value.split('\n')[0] || 'client').trim();
      const saved = await wd.files.save({ name: `Invoice ${$('number').value} - ${client}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) });
      // Remember sender + settings, and bump the invoice number for next time.
      const next = $('number').value.replace(/(\d+)(?!.*\d)/, (d) => String(+d + 1).padStart(d.length, '0'));
      await wd.kv.set('profile', { from: $('from').value, currency: $('currency').value, tax: $('tax').value, color: $('color').value, notes: $('notes').value, nextNumber: next });
      $('result').innerHTML = `<div class="wd-card wd-row"><div class="wd-grow">✅ ${esc(saved.name)}</div><button class="wd-btn wd-btn-sm" id="o">Open</button><button class="wd-btn wd-btn-sm" id="s">Show</button><button class="wd-btn wd-btn-sm wd-btn-primary" id="n">New invoice</button></div>`;
      $('o').onclick = () => wd.files.open(saved.path);
      $('s').onclick = () => wd.files.reveal(saved.path);
      $('n').onclick = () => { rows = [{ desc: '', qty: 1, price: 0 }]; $('to').value = ''; $('number').value = next; $('result').innerHTML = ''; $('discount').value = 0; renderRows(); };
      wd.ui.toast('Invoice saved', 'ok');
    } catch (e) { wd.ui.toast(e.message, 'error'); }
  };

  (async () => {
    const today = new Date();
    const iso = (d) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $('date').value = iso(today);
    $('due').value = iso(new Date(+today + 14 * 86400000));
    const p = await wd.kv.get('profile', null);
    $('number').value = p?.nextNumber || `INV-${today.getFullYear()}-001`;
    if (p) { $('from').value = p.from || ''; $('currency').value = p.currency || 'USD'; $('tax').value = p.tax || 0; $('color').value = p.color || '#1f6feb'; $('notes').value = p.notes || ''; }
    renderRows();
  })();
})();
