(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);
  const collection = wd.db.collection('bills');

  let currentFilter = 'all';
  let searchQuery = '';
  let billsList = [];

  const SAMPLE_BILLS = [
    { name: 'Electricity Bill', category: 'utilities', amount: 2450, cycle: 'monthly', dueDay: 15, isPaid: false, offer: '5% cashback up to ₹100 via Amazon Pay ICICI', icon: '⚡' },
    { name: 'Fiber Broadband / Wi-Fi', category: 'utilities', amount: 999, cycle: 'monthly', dueDay: 20, isPaid: true, offer: '25% cashback on Airtel Axis card', icon: '🌐' },
    { name: 'Netflix Premium 4K', category: 'subscriptions', amount: 649, cycle: 'monthly', dueDay: 5, isPaid: true, offer: '5% cashback via SBI Cashback card', icon: '🍿' },
    { name: 'ChatGPT Plus', category: 'subscriptions', amount: 1999, cycle: 'monthly', dueDay: 28, isPaid: false, offer: 'Zero forex markup via Scapia card', icon: '🤖' },
    { name: 'Piped Gas (PNG)', category: 'utilities', amount: 680, cycle: 'monthly', dueDay: 22, isPaid: false, offer: 'Flat ₹50 back on CRED / GPay', icon: '🔥' },
    { name: 'Amazon Prime Annual', category: 'subscriptions', amount: 1499, cycle: 'yearly', dueDay: 10, isPaid: true, offer: 'Included free with mobile recharge plans', icon: '📦' }
  ];

  async function init() {
    bindEvents();
    await loadBills();
  }

  function bindEvents() {
    document.querySelectorAll('[data-filter]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        currentFilter = b.dataset.filter;
        render();
      };
    });

    $('searchInput').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      render();
    };

    $('btnOpenAdd').onclick = () => { $('addModal').hidden = false; $('bName').focus(); };
    $('closeAddModal').onclick = () => { $('addModal').hidden = true; };
    $('btnCancelAdd').onclick = () => { $('addModal').hidden = true; };

    $('addForm').onsubmit = async (e) => {
      e.preventDefault();
      const bill = {
        name: $('bName').value.trim(),
        category: $('bCategory').value,
        amount: parseFloat($('bAmount').value) || 0,
        cycle: $('bCycle').value,
        dueDay: parseInt($('bDueDay').value, 10) || 1,
        offer: $('bOffer').value.trim(),
        isPaid: false,
        icon: getCategoryIcon($('bCategory').value, $('bName').value),
        createdAt: new Date().toISOString()
      };
      await collection.insert(bill);
      wd.ui.toast(`Added bill "${bill.name}"`, 'ok');
      $('addForm').reset();
      $('addModal').hidden = true;
      await loadBills();
    };

    $('btnExportJson').onclick = async () => {
      const all = await collection.find();
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webdeck-bills-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      wd.ui.toast('Exported bills to JSON', 'ok');
    };
  }

  function getCategoryIcon(cat, name) {
    const nl = (name || '').toLowerCase();
    if (nl.includes('elect') || nl.includes('power')) return '⚡';
    if (nl.includes('gas')) return '🔥';
    if (nl.includes('wifi') || nl.includes('net') || nl.includes('fiber')) return '🌐';
    if (nl.includes('water')) return '💧';
    if (nl.includes('phone') || nl.includes('mobile')) return '📱';
    if (nl.includes('netflix') || nl.includes('prime') || nl.includes('stream')) return '🍿';
    if (nl.includes('music') || nl.includes('spotify')) return '🎵';
    if (nl.includes('ai') || nl.includes('gpt')) return '🤖';
    return cat === 'utilities' ? '💡' : '📺';
  }

  async function loadBills() {
    billsList = await collection.find();
    if (billsList.length === 0) {
      for (const b of SAMPLE_BILLS) {
        await collection.insert({ ...b, createdAt: new Date().toISOString() });
      }
      billsList = await collection.find();
    }
    updateSummary();
    render();
  }

  function updateSummary() {
    const today = new Date().getDate();
    let monthlyTotal = 0;
    let upcomingDue = 0;
    let paidTotal = 0;
    let dueCount = 0;
    let paidCount = 0;

    billsList.forEach(b => {
      const cost = b.cycle === 'yearly' ? b.amount / 12 : b.amount;
      monthlyTotal += cost;
      if (b.isPaid) {
        paidTotal += cost;
        paidCount++;
      } else {
        upcomingDue += cost;
        dueCount++;
      }
    });

    $('totalMonthlyVal').textContent = `₹${Math.round(monthlyTotal).toLocaleString()}`;
    $('totalYearlySub').textContent = `Annualized: ₹${Math.round(monthlyTotal * 12).toLocaleString()}`;
    $('upcomingDueVal').textContent = `₹${Math.round(upcomingDue).toLocaleString()}`;
    $('upcomingCountSub').textContent = `${dueCount} bills pending`;
    $('paidThisMonthVal').textContent = `₹${Math.round(paidTotal).toLocaleString()}`;
    $('paidCountSub').textContent = `${paidCount} bills settled`;

    $('cntAll').textContent = billsList.length;
    $('cntDue').textContent = billsList.filter(b => !b.isPaid).length;
  }

  function render() {
    const today = new Date().getDate();
    const filtered = billsList.filter(b => {
      if (currentFilter === 'due' && b.isPaid) return false;
      if (currentFilter === 'paid' && !b.isPaid) return false;
      if (currentFilter === 'utilities' && b.category !== 'utilities') return false;
      if (currentFilter === 'subscriptions' && b.category !== 'subscriptions') return false;

      if (searchQuery) {
        const matchName = (b.name || '').toLowerCase().includes(searchQuery);
        const matchOffer = (b.offer || '').toLowerCase().includes(searchQuery);
        if (!matchName && !matchOffer) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      $('billsList').innerHTML = '<div class="wd-empty"><div class="wd-empty-icon">🧾</div>No bills found for this filter.</div>';
      return;
    }

    $('billsList').innerHTML = filtered.map(b => {
      const diff = b.dueDay - today;
      let statusHtml = '';
      if (b.isPaid) {
        statusHtml = `<span class="status-badge status-paid">✓ Paid</span>`;
      } else if (diff < 0) {
        statusHtml = `<span class="status-badge status-overdue">⚠️ Overdue by ${Math.abs(diff)}d</span>`;
      } else if (diff <= 3) {
        statusHtml = `<span class="status-badge status-due">⏳ Due in ${diff === 0 ? 'Today' : diff + 'd'}</span>`;
      } else {
        statusHtml = `<span class="status-badge status-due">Due on ${b.dueDay}th</span>`;
      }

      return `
        <div class="bill-row" data-id="${esc(b._id)}">
          <div class="bill-icon">${b.icon || '🧾'}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px">${esc(b.name)}</div>
            <div class="wd-small wd-muted">${esc(b.cycle.toUpperCase())} · Due on ${b.dueDay}th of month</div>
            ${b.offer ? `<div style="margin-top:4px"><span class="offer-pill">🎁 Best Offer: ${esc(b.offer)}</span></div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:18px;font-weight:800">₹${b.amount.toLocaleString()}</div>
            <div style="margin-top:2px">${statusHtml}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="wd-btn wd-btn-sm ${b.isPaid ? '' : 'wd-btn-primary'}" data-toggle-paid="${esc(b._id)}">
              ${b.isPaid ? 'Mark Unpaid' : 'Mark as Paid'}
            </button>
            <button class="wd-btn wd-btn-ghost wd-btn-sm" data-delete-bill="${esc(b._id)}" title="Delete">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('[data-toggle-paid]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.togglePaid;
        const b = billsList.find(x => x._id === id);
        if (b) {
          await collection.update(id, { isPaid: !b.isPaid });
          wd.ui.toast(b.isPaid ? `Marked "${b.name}" as pending` : `Marked "${b.name}" as paid!`, 'ok');
          await loadBills();
        }
      };
    });

    document.querySelectorAll('[data-delete-bill]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this bill?')) return;
        await collection.remove(btn.dataset.deleteBill);
        wd.ui.toast('Removed bill', 'ok');
        await loadBills();
      };
    });
  }

  init();
})();
