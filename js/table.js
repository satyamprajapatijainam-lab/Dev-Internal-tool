// TechExcelToTable tab: JSON -> table ({COLUMNS|HEADER, DATA}, array of objects, array of arrays)
(function () {
  const $ = (id) => document.getElementById(id);
  let headers = [], rows = [], visible = new Set();

  function parse(txt) {
    let d = JSON.parse(txt);
    if (typeof d === 'string') d = JSON.parse(d);
    const keyOf = (o, n) => Object.keys(o).find((k) => k.toLowerCase() === n);
    if (d && !Array.isArray(d) && typeof d === 'object') {
      const c = keyOf(d, 'columns') || keyOf(d, 'header'), v = keyOf(d, 'data');
      if (c && v && Array.isArray(d[c]) && Array.isArray(d[v]))
        return { h: d[c].map(String), r: d[v].map((r) => Array.isArray(r) ? r : d[c].map((k) => r[k])) };
      d = Object.values(d).find((x) => Array.isArray(x) && x.length) || [d];
    }
    if (!Array.isArray(d)) throw new Error('Unsupported JSON shape.');
    if (!d.length) throw new Error('No rows found.');
    if (Array.isArray(d[0])) {
      const n = Math.max(...d.map((r) => r.length));
      return { h: Array.from({ length: n }, (_, i) => 'Col' + (i + 1)), r: d };
    }
    const h = [];
    d.forEach((o) => Object.keys(o || {}).forEach((k) => { if (!h.includes(k)) h.push(k); }));
    return { h, r: d.map((o) => h.map((k) => (o ? o[k] : ''))) };
  }

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const str = (v) => v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  const showErr = (m) => { $('err').textContent = m; $('err').classList.toggle('hidden', !m); };
  const visCols = () => headers.map((h, i) => i).filter((i) => visible.has(i));
  function filtered() {
    const q = $('filter').value.trim().toLowerCase();
    return q ? rows.filter((r) => r.some((c) => str(c).toLowerCase().includes(q))) : rows;
  }

  function render() {
    const cols = visCols(), data = filtered(), idx = $('optIdx').checked;
    let html = '<thead><tr>' + (idx ? '<th class="idx">#</th>' : '') + cols.map((i) => '<th>' + esc(headers[i]) + '</th>').join('') + '</tr></thead><tbody>';
    data.forEach((r, n) => {
      html += '<tr>' + (idx ? '<td class="idx">' + (n + 1) + '</td>' : '') + cols.map((i) => {
        const v = r[i];
        return '<td' + (typeof v === 'number' ? ' class="num"' : '') + '>' + esc(str(v)) + '</td>';
      }).join('') + '</tr>';
    });
    $('tbl').innerHTML = html + '</tbody>';
    $('info').textContent = data.length + ' of ' + rows.length + ' rows · ' + cols.length + ' of ' + headers.length + ' columns';
    $('colCount').textContent = '(' + cols.length + '/' + headers.length + ')';
  }

  function buildCols() {
    $('colList').innerHTML = headers.map((h, i) => '<label class="opt"><input type="checkbox" data-i="' + i + '" ' + (visible.has(i) ? 'checked' : '') + '> ' + esc(h) + '</label>').join('');
  }
  $('colList').addEventListener('change', (e) => {
    const i = +e.target.dataset.i;
    e.target.checked ? visible.add(i) : visible.delete(i);
    render();
  });
  $('allCols').onclick = () => { visible = new Set(headers.map((_, i) => i)); buildCols(); render(); };
  $('noCols').onclick = () => { visible.clear(); buildCols(); render(); };
  $('optIdx').onchange = render;
  $('filter').oninput = render;

  $('convert').onclick = () => {
    try {
      const { h, r } = parse($('input').value.trim());
      headers = h; rows = r; visible = new Set(h.map((_, i) => i));
      showErr(''); buildCols(); $('result').classList.remove('hidden'); render();
    } catch (e) {
      $('result').classList.add('hidden');
      if (!$('input').value.trim()) return showErr('Paste some JSON first.');
      const info = DT.jsonError($('input').value, e);
      showErr(info.text.split('\n')[0]); DT.gotoError($('input'), info);
    }
  };
  $('clear').onclick = () => { $('input').value = ''; $('result').classList.add('hidden'); showErr(''); $('colList').innerHTML =
        '<span class="mini">Convert JSON to see columns</span>'; };
  $('sample').onclick = () => {
    $('input').value = JSON.stringify({ COLUMNS: ['CLIENTCODE', 'SCRIP_NAME', 'ISIN', 'NET', 'SCRIP_VALUE'], DATA: [['WA2544', 'CANARA BANK', 'INE476A01022', 20000, 119.51], ['WA2544', 'SUZLON ENERGY LTD.', 'INE040H01021', 17000, 39.5]] });
    $('convert').click();
  };

  function grid() {
    const cols = visCols();
    const out = filtered().map((r) => cols.map((i) => str(r[i])));
    if ($('optHdr').checked) out.unshift(cols.map((i) => headers[i]));
    return out;
  }
  const fmt = {
    tsv: () => grid().map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n'),
    csv: () => grid().map((r) => r.map((c) => /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(',')).join('\n'),
    md: () => {
      const g = grid().map((r) => r.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')));
      if (!g.length) return '';
      const h = $('optHdr').checked ? g.shift() : visCols().map((i) => headers[i]);
      return '| ' + h.join(' | ') + ' |\n|' + h.map(() => ' --- |').join('') + '\n' + g.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
    },
    json: () => {
      const cols = visCols();
      return JSON.stringify(filtered().map((r) => Object.fromEntries(cols.map((i) => [headers[i], r[i]]))), null, 2);
    }
  };

  async function copy(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove();
    }
    const old = btn.textContent; btn.textContent = ok ? 'Copied ✓' : 'Copy failed'; btn.classList.toggle('done', ok);
    setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1200);
  }
  document.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(fmt[b.dataset.copy](), b));
  $('download').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([fmt.csv()], { type: 'text/csv' }));
    a.download = 'table.csv'; a.click();
  };
})();
