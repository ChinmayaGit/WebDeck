(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);

  let currentTable = 'users';
  let activeSchema = {
    users: [
      { id: 1, name: 'Alice Chen', email: 'alice@example.com', role: 'admin', created_at: '2026-01-15' },
      { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'developer', created_at: '2026-02-01' },
      { id: 3, name: 'Carol Danvers', email: 'carol@example.com', role: 'analyst', created_at: '2026-02-18' },
      { id: 4, name: 'David Kumar', email: 'david@example.com', role: 'developer', created_at: '2026-03-05' }
    ],
    products: [
      { id: 101, title: 'MacBook Pro M3', category: 'Laptops', price: 1999.00, stock: 45 },
      { id: 102, title: 'Dell XPS 15', category: 'Laptops', price: 1499.00, stock: 30 },
      { id: 103, title: 'Mechanical Keyboard', category: 'Peripherals', price: 129.99, stock: 120 },
      { id: 104, title: '4K UltraWide Monitor', category: 'Displays', price: 699.00, stock: 18 }
    ],
    orders: [
      { order_id: 5001, user_id: 1, total_usd: 2128.99, status: 'fulfilled', date: '2026-02-10' },
      { order_id: 5002, user_id: 3, total_usd: 1499.00, status: 'shipped', date: '2026-03-01' },
      { order_id: 5003, user_id: 2, total_usd: 129.99, status: 'pending', date: '2026-03-12' }
    ]
  };

  function init() {
    bindEvents();
    renderTablesList();
    renderActiveTable();
  }

  function bindEvents() {
    $('btnRunQuery').onclick = executeQuery;
    $('btnNewTable').onclick = createTable;
    $('btnExportData').onclick = exportCsv;
    $('btnResetSampleData').onclick = resetSampleData;

    $('connSelect').onchange = (e) => {
      wd.ui.toast(`Switched connection context to ${e.target.value}`, 'ok');
    };
  }

  function renderTablesList() {
    const tables = Object.keys(activeSchema);
    $('tablesList').innerHTML = tables.map(t => `
      <div class="table-item ${t === currentTable ? 'active' : ''}" data-table-name="${esc(t)}">
        <span>📊</span> <span>${esc(t)}</span>
        <div class="wd-spacer"></div>
        <span class="wd-small" style="opacity:.8">${activeSchema[t].length}</span>
      </div>
    `).join('');

    document.querySelectorAll('[data-table-name]').forEach(el => {
      el.onclick = () => {
        currentTable = el.dataset.tableName;
        $('sqlQueryInput').value = `SELECT * FROM ${currentTable} LIMIT 50;`;
        renderTablesList();
        renderActiveTable();
      };
    });
  }

  function renderActiveTable(customRows = null) {
    const rows = customRows || activeSchema[currentTable] || [];
    if (!rows.length) {
      $('tableContainer').innerHTML = '<div class="wd-empty"><div class="wd-empty-icon">🗄️</div>Table is empty or no matching rows returned.</div>';
      return;
    }

    const cols = Object.keys(rows[0]);
    let html = '<table class="data-table"><thead><tr>';
    cols.forEach(c => html += `<th>${esc(c)}</th>`);
    html += '<th>Actions</th></tr></thead><tbody>';

    rows.forEach((r, rowIdx) => {
      html += '<tr>';
      cols.forEach(c => {
        html += `<td>${esc(String(r[c] !== undefined ? r[c] : 'NULL'))}</td>`;
      });
      html += `<td><button class="wd-btn wd-btn-ghost wd-btn-sm" data-del-row="${rowIdx}" style="color:#ef4444">🗑</button></td>`;
      html += '</tr>';
    });
    html += '</tbody></table>';

    $('tableContainer').innerHTML = html;

    document.querySelectorAll('[data-del-row]').forEach(btn => {
      btn.onclick = () => {
        const idx = +btn.dataset.delRow;
        activeSchema[currentTable].splice(idx, 1);
        renderTablesList();
        renderActiveTable();
        wd.ui.toast('Row deleted', 'ok');
      };
    });
  }

  function executeQuery() {
    const query = $('sqlQueryInput').value.trim();
    if (!query) return;

    $('queryStatus').textContent = 'Executing query…';
    const start = performance.now();

    try {
      const lower = query.toLowerCase();
      if (lower.startsWith('select')) {
        // Simple SQL query parser simulation for in-memory engine
        const fromMatch = lower.match(/from\s+([a-zA-Z0-9_]+)/);
        const tbl = fromMatch ? fromMatch[1] : currentTable;

        if (!activeSchema[tbl]) {
          throw new Error(`Table "${tbl}" does not exist in schema.`);
        }

        let result = [...activeSchema[tbl]];
        // Basic WHERE clause filter support
        if (lower.includes('where')) {
          const whereMatch = query.match(/where\s+([a-zA-Z0-9_]+)\s*(=|!=|>|<)\s*(['"]?)([^'";]+)\3/i);
          if (whereMatch) {
            const [, col, op, , val] = whereMatch;
            result = result.filter(r => {
              if (op === '=') return String(r[col]).toLowerCase() === val.toLowerCase();
              if (op === '!=') return String(r[col]).toLowerCase() !== val.toLowerCase();
              if (op === '>') return Number(r[col]) > Number(val);
              if (op === '<') return Number(r[col]) < Number(val);
              return true;
            });
          }
        }

        const elapsed = (performance.now() - start).toFixed(2);
        $('queryStatus').textContent = `Returned ${result.length} row(s) in ${elapsed} ms`;
        renderActiveTable(result);
        wd.ui.toast(`Query executed (${result.length} rows, ${elapsed}ms)`, 'ok');
      } else if (lower.startsWith('insert into')) {
        const tblMatch = lower.match(/insert into\s+([a-zA-Z0-9_]+)/);
        const tbl = tblMatch ? tblMatch[1] : currentTable;
        if (activeSchema[tbl]) {
          const newRow = { id: Date.now(), name: 'New Record', created_at: new Date().toISOString().slice(0, 10) };
          activeSchema[tbl].push(newRow);
          renderTablesList();
          renderActiveTable();
          $('queryStatus').textContent = `1 row inserted into ${tbl}`;
          wd.ui.toast(`1 row inserted`, 'ok');
        }
      } else {
        $('queryStatus').textContent = `Command executed successfully.`;
        wd.ui.toast(`Command executed`, 'ok');
      }
    } catch (err) {
      $('queryStatus').textContent = `Error: ${err.message}`;
      wd.ui.toast(err.message, 'error');
    }
  }

  function createTable() {
    const name = prompt('Enter new Table name:');
    if (!name || activeSchema[name]) return;
    activeSchema[name] = [
      { id: 1, title: 'Sample Item 1', status: 'active', created_at: new Date().toISOString().slice(0, 10) }
    ];
    currentTable = name;
    $('sqlQueryInput').value = `SELECT * FROM ${name} LIMIT 50;`;
    renderTablesList();
    renderActiveTable();
    wd.ui.toast(`Created table "${name}"`, 'ok');
  }

  function exportCsv() {
    const rows = activeSchema[currentTable] || [];
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    let csv = cols.join(',') + '\n';
    rows.forEach(r => {
      csv += cols.map(c => `"${String(r[c] || '').replace(/"/g, '""')}"`).join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTable}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    wd.ui.toast(`Exported ${currentTable} as CSV`, 'ok');
  }

  function resetSampleData() {
    init();
    wd.ui.toast('Sample schema and tables reloaded', 'ok');
  }

  init();
})();
