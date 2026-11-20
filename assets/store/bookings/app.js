(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);
  const collection = wd.db.collection('bookings');

  let currentFilter = 'all';
  let searchQuery = '';
  let bookingsList = [];

  const SAMPLE_BOOKINGS = [
    {
      type: 'flight',
      title: 'Flight 6E-204 · Delhi (DEL) → Mumbai (BOM)',
      datetime: new Date(Date.now() + 2 * 24 * 3600 * 1000 + 4 * 3600 * 1000).toISOString().slice(0, 16),
      code: '6E-PNR-8842',
      seat: '12F (Window)',
      location: 'Terminal 1D Gate 6',
      notes: 'Check-in opens 48 hours prior. Carry DigiYatra pass.'
    },
    {
      type: 'train',
      title: 'Vande Bharat Express (22436)',
      datetime: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 16),
      code: '2847593021',
      seat: 'Coach C4, Seat 28',
      location: 'New Delhi Platform 16',
      notes: 'Breakfast included.'
    },
    {
      type: 'movie',
      title: 'Dune: Part Two · IMAX 3D',
      datetime: new Date(Date.now() + 1 * 24 * 3600 * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 16),
      code: 'BMS-TK-90214',
      seat: 'Audi 2, Seats H14, H15',
      location: 'PVR Director\'s Cut',
      notes: 'Show starts at 7:30 PM. 15 mins interval.'
    },
    {
      type: 'doctor',
      title: 'Cardiology Checkup · Dr. A. K. Sen',
      datetime: new Date(Date.now() + 3 * 24 * 3600 * 1000 + 2 * 3600 * 1000).toISOString().slice(0, 16),
      code: 'APPT-DOC-4412',
      seat: 'Room 208, 2nd Floor',
      location: 'Apollo Speciality Clinic',
      notes: 'Bring last 6 months ECG & lipid profile reports.'
    }
  ];

  async function init() {
    bindEvents();
    await loadBookings();
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

    $('btnOpenAdd').onclick = () => { $('addModal').hidden = false; $('bkTitle').focus(); };
    $('closeAddModal').onclick = () => { $('addModal').hidden = true; };
    $('btnCancelAdd').onclick = () => { $('addModal').hidden = true; };

    $('addForm').onsubmit = async (e) => {
      e.preventDefault();
      const booking = {
        type: $('bkType').value,
        title: $('bkTitle').value.trim(),
        datetime: $('bkDatetime').value,
        code: $('bkCode').value.trim(),
        seat: $('bkSeat').value.trim(),
        location: $('bkLocation').value.trim(),
        notes: $('bkNotes').value.trim(),
        createdAt: new Date().toISOString()
      };
      await collection.insert(booking);
      wd.ui.toast(`Added booking "${booking.title}"`, 'ok');
      $('addForm').reset();
      $('addModal').hidden = true;
      await loadBookings();
    };

    $('btnExportJson').onclick = async () => {
      const all = await collection.find();
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webdeck-bookings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      wd.ui.toast('Exported bookings to JSON', 'ok');
    };
  }

  async function loadBookings() {
    bookingsList = await collection.find(null, { sort: 'datetime' });
    if (bookingsList.length === 0) {
      for (const b of SAMPLE_BOOKINGS) {
        await collection.insert({ ...b, createdAt: new Date().toISOString() });
      }
      bookingsList = await collection.find(null, { sort: 'datetime' });
    }
    $('cntAll').textContent = bookingsList.length;
    render();
  }

  function getCountdownText(datetimeStr) {
    const target = new Date(datetimeStr).getTime();
    const now = Date.now();
    const diff = target - now;
    if (diff < 0) return 'Passed / Completed';
    const hours = Math.floor(diff / (1000 * 3600));
    const days = Math.floor(hours / 24);
    if (days > 0) return `Starts in ${days}d ${hours % 24}h`;
    const mins = Math.floor((diff % (1000 * 3600)) / (1000 * 60));
    return `Starts in ${hours}h ${mins}m`;
  }

  function render() {
    const filtered = bookingsList.filter(b => {
      if (currentFilter !== 'all' && b.type !== currentFilter) return false;
      if (searchQuery) {
        const titleMatch = (b.title || '').toLowerCase().includes(searchQuery);
        const codeMatch = (b.code || '').toLowerCase().includes(searchQuery);
        const locMatch = (b.location || '').toLowerCase().includes(searchQuery);
        if (!titleMatch && !codeMatch && !locMatch) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      $('bookingsGrid').innerHTML = '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">🎟️</div>No bookings found for this category.</div>';
      return;
    }

    $('bookingsGrid').innerHTML = filtered.map(b => {
      const countdown = getCountdownText(b.datetime);
      const dateFormatted = new Date(b.datetime).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      return `
        <div class="ticket-card" data-id="${esc(b._id)}">
          <div class="wd-row">
            <span class="type-badge type-${esc(b.type)}">${esc(b.type)}</span>
            <div class="wd-spacer"></div>
            <span class="countdown-pill">⏳ ${esc(countdown)}</span>
          </div>

          <div style="font-size:16px;font-weight:700">${esc(b.title)}</div>
          <div class="wd-small wd-muted">📅 ${esc(dateFormatted)}</div>

          <div class="wd-row" style="background:var(--wd-surface-2);padding:10px 12px;border-radius:8px;gap:12px;align-items:center">
            <div style="flex:1">
              <div class="wd-small wd-muted">REF / PNR</div>
              <div style="font-family:monospace;font-weight:800;font-size:15px;letter-spacing:1px">${esc(b.code)}</div>
              ${b.seat ? `<div class="wd-small" style="margin-top:2px">Seat: <b>${esc(b.seat)}</b></div>` : ''}
              ${b.location ? `<div class="wd-small" style="margin-top:2px">Gate: <b>${esc(b.location)}</b></div>` : ''}
            </div>
            <div class="qr-container" id="qr-${esc(b._id)}"></div>
          </div>

          ${b.notes ? `<div class="wd-small wd-muted">💡 ${esc(b.notes)}</div>` : ''}

          <div class="wd-row" style="margin-top:auto;gap:8px">
            <button class="wd-btn wd-btn-sm" data-export-ics="${esc(b._id)}">📅 Add to Calendar (.ics)</button>
            <div class="wd-spacer"></div>
            <button class="wd-btn wd-btn-ghost wd-btn-sm" data-delete-booking="${esc(b._id)}" title="Delete">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    // Generate QR codes using qrcode.js
    filtered.forEach(b => {
      const el = document.getElementById(`qr-${b._id}`);
      if (el && window.QRCode) {
        new QRCode(el, {
          text: b.code || b.title,
          width: 64,
          height: 64,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    });

    document.querySelectorAll('[data-export-ics]').forEach(btn => {
      btn.onclick = () => {
        const b = bookingsList.find(x => x._id === btn.dataset.exportIcs);
        if (b) exportIcs(b);
      };
    });

    document.querySelectorAll('[data-delete-booking]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this booking?')) return;
        await collection.remove(btn.dataset.deleteBooking);
        wd.ui.toast('Removed booking', 'ok');
        await loadBookings();
      };
    });
  }

  function exportIcs(b) {
    const dt = new Date(b.datetime);
    const dtStr = dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WebDeck//Bookings Tracker//EN
BEGIN:VEVENT
SUMMARY:${b.title}
DESCRIPTION:Ref: ${b.code} | Seat: ${b.seat || ''} | ${b.notes || ''}
LOCATION:${b.location || ''}
DTSTART:${dtStr}
DTEND:${dtStr}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${b.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    wd.ui.toast('Downloaded calendar event (.ics)', 'ok');
  }

  init();
})();
