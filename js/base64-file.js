// Base64 to PDF / Excel tab.
// Decodes Base64 locally, detects the real file type from its signature (never from the extension),
// keeps genuine PDF / Excel files untouched, and converts text / CSV / JSON / PNG / JPEG when needed.
// SheetJS and jsPDF are loaded lazily from the CDN the first time they are needed.
(function () {
  const $ = (id) => document.getElementById(id);

  const LIBS = {
    xlsx: { src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', ok: () => window.XLSX, label: 'Excel (SheetJS)' },
    jspdf: { src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', ok: () => window.jspdf && window.jspdf.jsPDF, label: 'PDF (jsPDF)' }
  };
  const pending = {};
  function loadLib(name) {
    const lib = LIBS[name];
    if (lib.ok()) return Promise.resolve();
    if (pending[name]) return pending[name];
    return (pending[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = lib.src; s.async = true;
      s.onload = () => { lib.ok() ? resolve() : (delete pending[name], reject(new Error(`The ${lib.label} library loaded but is not usable.`))); };
      s.onerror = () => { delete pending[name]; s.remove(); reject(new Error(`Could not load the ${lib.label} library from the CDN. Check your internet connection and try again.`)); };
      document.head.appendChild(s);
    }));
  }

  const MAX_PREVIEW_ROWS = 1000, MAX_PREVIEW_COLS = 100, MAX_TEXT_PDF = 3000000;
  const MIME = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    xls: 'application/vnd.ms-excel'
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Base64 → bytes ---------- */
  function normalize(raw) {
    let s = String(raw || '').trim().replace(/^["'`]+|["'`]+$/g, '');
    if (!s) throw new Error('There is no Base64 data. Paste a Base64 string or upload a .txt file first.');
    const m = s.match(/^data:([^;,]*)((?:;[^,;]*)*),/i);
    if (m) {
      if (!/;base64/i.test(m[2])) throw new Error('This is a data: URI but it is not Base64-encoded.');
      s = s.slice(m[0].length);
    }
    s = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');   // line breaks, URL-safe alphabet
    if (!s) throw new Error('The data URI has no content after the "base64," prefix.');
    const bad = s.search(/[^A-Za-z0-9+/=]/);
    if (bad !== -1) throw new Error(`Invalid Base64: unexpected character "${s[bad]}" at position ${bad + 1} (whitespace ignored). Base64 may only contain A–Z, a–z, 0–9, + and /.`);
    const core = s.replace(/=+$/, ''), pad = s.length - core.length;
    if (core.includes('=')) throw new Error('Invalid Base64: "=" padding appears in the middle of the data.');
    if (pad > 2) throw new Error('Invalid Base64: too many "=" padding characters at the end.');
    if (core.length % 4 === 1) throw new Error(`Invalid Base64: ${core.length} characters is not a valid length — the data looks cut off or has extra characters.`);
    return core;
  }

  // Decodes in 256K-character slices so no giant intermediate binary string is created.
  async function decode(core) {
    const n = core.length, out = new Uint8Array(Math.floor(n * 3 / 4)), CH = 1 << 18;
    let o = 0;
    try {
      for (let i = 0, k = 0; i < n; i += CH, k++) {
        let part = core.slice(i, i + CH);
        if (part.length % 4) part += '='.repeat(4 - part.length % 4);
        const bin = atob(part);
        for (let j = 0; j < bin.length; j++) out[o++] = bin.charCodeAt(j);
        if (k % 16 === 15) await tick();
      }
    } catch (e) { throw new Error('Invalid Base64: the data could not be decoded.'); }
    return o === out.length ? out : out.subarray(0, o);
  }

  /* ---------- File-type detection (by signature) ---------- */
  function hasAscii(b, str) {
    const first = str.charCodeAt(0), n = str.length;
    for (let i = b.indexOf(first); i !== -1 && i <= b.length - n; i = b.indexOf(first, i + 1)) {
      let k = 1; while (k < n && b[i + k] === str.charCodeAt(k)) k++;
      if (k === n) return true;
    }
    return false;
  }
  function detect(b) {
    const at = (arr, off = 0) => arr.every((v, i) => b[off + i] === v);
    const head = Math.min(b.length, 1024);
    for (let i = 0; i + 5 <= head; i++) if (b[i] === 0x25 && at([0x25, 0x50, 0x44, 0x46, 0x2d], i)) return { type: 'pdf', offset: i };
    if (at([0x50, 0x4b, 3, 4]) || at([0x50, 0x4b, 5, 6])) {
      if (hasAscii(b, 'xl/workbook.xml')) return { type: 'xlsx', ext: hasAscii(b, 'xl/vbaProject.bin') ? 'xlsm' : 'xlsx' };
      if (hasAscii(b, 'xl/workbook.bin')) return { type: 'xlsx', ext: 'xlsb' };
      return { type: 'zip', hint: hasAscii(b, 'word/document.xml') ? 'a Word document' : hasAscii(b, 'ppt/presentation.xml') ? 'a PowerPoint file' : 'a ZIP archive' };
    }
    if (at([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { type: 'ole' };
    if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'png' };
    if (at([0xff, 0xd8, 0xff])) return { type: 'jpeg' };
    if (at([0x47, 0x49, 0x46, 0x38])) return { type: 'other', hint: 'a GIF image' };
    if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return { type: 'other', hint: 'a WebP image' };
    if (at([0x1f, 0x8b])) return { type: 'other', hint: 'gzip-compressed data' };
    const probe = b.subarray(0, 8192);
    if (probe.indexOf(0) === -1) {
      try { return { type: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(b) }; } catch (e) { /* not UTF-8 */ }
    }
    return { type: 'binary' };
  }
  const typeName = (d) => ({ pdf: 'PDF document', xlsx: d.ext === 'xlsm' ? 'Excel macro-enabled workbook' : d.ext === 'xlsb' ? 'Excel binary workbook' : 'Excel workbook (.xlsx)', ole: 'legacy Excel workbook (.xls)', png: 'PNG image', jpeg: 'JPEG image', text: 'text', zip: d.hint, other: d.hint, binary: 'unknown binary data' }[d.type]);
  const hex = (b, n = 8) => Array.from(b.subarray(0, n), (x) => x.toString(16).padStart(2, '0')).join(' ');

  /* ---------- Text helpers ---------- */
  function parseDelimited(text, d) {
    const rows = []; let row = [], f = '', q = false, i = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"' && f === '') q = true;
      else if (c === d) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function pickDelimiter(text) {
    const sample = text.slice(0, 20000);
    let best = null, bestScore = 0;
    for (const d of [',', '\t', ';', '|']) {
      const rows = parseDelimited(sample, d).slice(0, 30).filter((r) => r.length > 1 || r[0] !== '');
      if (!rows.length) continue;
      const freq = {}; rows.forEach((r) => { freq[r.length] = (freq[r.length] || 0) + 1; });
      const [cols, hits] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      if (+cols > 1 && hits / rows.length >= 0.6 && hits * +cols > bestScore) { best = d; bestScore = hits * +cols; }
    }
    return best;
  }
  const toCell = (v) => {
    if (typeof v !== 'string') return v;
    return /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v) ? Number(v) : v;
  };
  function jsonToRows(d) {
    const cell = (v) => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
    const keyOf = (o, n) => Object.keys(o).find((k) => k.toLowerCase() === n);
    if (d && !Array.isArray(d) && typeof d === 'object') {
      const c = keyOf(d, 'columns') || keyOf(d, 'header'), v = keyOf(d, 'data');
      if (c && v && Array.isArray(d[c]) && Array.isArray(d[v]))
        return [d[c].map(String)].concat(d[v].map((r) => Array.isArray(r) ? r.map(cell) : d[c].map((k) => cell(r && r[k]))));
      d = Object.values(d).find((x) => Array.isArray(x) && x.length) || [d];
    }
    if (!Array.isArray(d)) d = [d];
    if (!d.length) throw new Error('The JSON contains no rows.');
    if (d.every(Array.isArray)) return d.map((r) => r.map(cell));
    if (d.every((x) => x && typeof x === 'object')) {
      const h = []; d.forEach((o) => Object.keys(o).forEach((k) => { if (!h.includes(k)) h.push(k); }));
      return [h].concat(d.map((o) => h.map((k) => cell(o[k]))));
    }
    return [['value']].concat(d.map((x) => [cell(x)]));
  }
  function textToRows(text) {
    const t = text.replace(/^﻿/, '');
    const trimmed = t.trim();
    if (!trimmed) throw new Error('The decoded text is empty.');
    let note = '';
    if (/^[[{]/.test(trimmed)) {
      let d;
      try { d = JSON.parse(trimmed); } catch (e) {
        const info = DT.jsonError(trimmed, e);
        throw new Error('The decoded data looks like JSON but is not valid: ' + info.text.split('\n')[0].replace(/^Invalid JSON:\s*/, ''));
      }
      return { rows: jsonToRows(d), note: 'Converted from JSON.' };
    }
    const d = pickDelimiter(t);
    if (d) {
      const rows = parseDelimited(t, d).filter((r) => r.length > 1 || r[0] !== '').map((r) => r.map(toCell));
      return { rows, note: `Converted from ${d === ',' ? 'CSV' : d === '\t' ? 'tab-separated' : d === ';' ? 'semicolon-separated' : 'pipe-separated'} text.` };
    }
    if (/^[A-Za-z0-9+/=_\s-]{200,}$/.test(trimmed))
      throw new Error('The decoded text is itself Base64 — the data may have been encoded twice. Decode it once more and try again.');
    return { rows: t.split(/\r?\n/).map((l) => [l]), note: 'No delimiter found, so each line was placed in column A.' };
  }

  /* ---------- Conversions ---------- */
  const wrongType = (d, wanted) => {
    const other = wanted === 'pdf' ? 'Excel' : 'PDF';
    if (d.type === 'xlsx' || d.type === 'ole') return new Error(`This Base64 contains an Excel workbook. Converting a workbook to PDF is not supported — choose “Excel” to preview and download the original file.`);
    if (d.type === 'pdf') return new Error('This Base64 contains a PDF document, which is not spreadsheet data. Choose “PDF” to preview and download it.');
    if (d.type === 'png' || d.type === 'jpeg') return new Error(`This Base64 contains a ${typeName(d)}. Images can be converted to PDF, but not to Excel — choose “PDF”.`);
    if (d.type === 'zip' || d.type === 'other') return new Error(`This Base64 contains ${d.hint}, which cannot be converted to ${other === 'PDF' ? 'Excel' : 'PDF'}. Supported inputs: PDF, Excel (.xlsx/.xls), PNG/JPEG (to PDF), and text/CSV/JSON (to PDF or Excel).`);
    return new Error(`The decoded data (first bytes: ${d.bytes ? hex(d.bytes) : '—'}) is not a PDF, Excel file, PNG/JPEG image or readable UTF-8 text, so it cannot be converted. The selected format alone is not enough — the content itself has to match.`);
  };

  async function toPdf(bytes, d) {
    if (d.type === 'pdf') {
      const out = d.offset ? bytes.subarray(d.offset) : bytes;
      const tail = new TextDecoder('latin1').decode(out.subarray(Math.max(0, out.length - 2048)));
      return { bytes: out, ext: 'pdf', converted: false, label: 'Original PDF',
        note: (d.offset ? `Skipped ${d.offset} stray byte(s) before the %PDF header. ` : '') + (/%%EOF/.test(tail) ? '' : 'Warning: no %%EOF marker found — the PDF may be truncated or damaged.') };
    }
    if (d.type === 'png' || d.type === 'jpeg') {
      await loadLib('jspdf');
      const url = URL.createObjectURL(new Blob([bytes], { type: d.type === 'png' ? 'image/png' : 'image/jpeg' }));
      let w, h;
      try {
        ({ w, h } = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => rej(new Error('The image data is corrupt or cannot be decoded.')); im.src = url; }));
      } finally { URL.revokeObjectURL(url); }
      const k = Math.min(1, 14400 / Math.max(w, h) / 0.75), pw = w * 0.75 * k, ph = h * 0.75 * k;
      const doc = new window.jspdf.jsPDF({ orientation: pw > ph ? 'l' : 'p', unit: 'pt', format: [pw, ph] });
      doc.addImage(bytes, d.type === 'png' ? 'PNG' : 'JPEG', 0, 0, pw, ph);
      return { bytes: new Uint8Array(doc.output('arraybuffer')), ext: 'pdf', converted: true, label: `${typeName(d)} → PDF`, note: `Image ${w} × ${h}px placed on a single page.` };
    }
    if (d.type === 'text') {
      let t = d.text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
        .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/•/g, '*').replace(/ /g, ' ');
      if (!t.trim()) throw new Error('The decoded text is empty, so there is nothing to put in a PDF.');
      if (t.length > MAX_TEXT_PDF) throw new Error(`The decoded text is too large to convert to PDF in the browser (${t.length.toLocaleString()} characters, limit ${MAX_TEXT_PDF.toLocaleString()}).`);
      const bad = t.search(/[^\x09\x0a\x20-\x7e\xa0-\xff]/);
      if (bad !== -1) {
        const cp = t.codePointAt(bad);
        throw new Error(`The text contains a character (“${String.fromCodePoint(cp)}”, U+${cp.toString(16).toUpperCase().padStart(4, '0')}) that the built-in PDF fonts cannot render. Text-to-PDF supports Latin (Western European) text only.`);
      }
      await loadLib('jspdf');
      const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
      const M = 40, W = doc.internal.pageSize.getWidth() - 2 * M, H = doc.internal.pageSize.getHeight() - M, LH = 12.5;
      doc.setFont('courier', 'normal'); doc.setFontSize(10);
      let y = M + 8, n = 0;
      for (const line of t.split('\n')) {
        for (const piece of doc.splitTextToSize(line || ' ', W)) {
          if (y > H) { doc.addPage(); y = M + 8; }
          doc.text(piece, M, y); y += LH;
        }
        if (++n % 2000 === 0) await tick();
      }
      return { bytes: new Uint8Array(doc.output('arraybuffer')), ext: 'pdf', converted: true, label: 'Text → PDF', note: `Rendered ${doc.getNumberOfPages()} page(s) in a monospaced font.` };
    }
    throw wrongType(d, 'pdf');
  }

  async function toExcel(bytes, d) {
    if (d.type === 'xlsx' || d.type === 'ole') {
      await loadLib('xlsx');
      let wb;
      try { wb = XLSX.read(bytes, { type: 'array', cellDates: true, sheetRows: MAX_PREVIEW_ROWS + 1 }); } catch (e) {
        throw new Error('The data has an Excel signature but the workbook could not be read: ' + (e.message || e));
      }
      if (!wb.SheetNames || !wb.SheetNames.length) throw new Error('The workbook contains no worksheets (it may be damaged, or not really an Excel file).');
      const ext = d.type === 'ole' ? 'xls' : d.ext;
      return { bytes, ext, wb, converted: false, label: 'Original ' + (ext === 'xls' ? 'legacy .xls workbook' : '.' + ext + ' workbook'),
        note: ext === 'xls' ? 'Legacy .xls format is preserved as-is (not converted to .xlsx).' : '' };
    }
    if (d.type === 'text') {
      await loadLib('xlsx');
      const { rows, note } = textToRows(d.text);
      if (!rows.length) throw new Error('No rows were found in the decoded data.');
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const widths = []; rows.slice(0, 200).forEach((r) => r.forEach((v, i) => { widths[i] = Math.max(widths[i] || 8, Math.min(60, String(v == null ? '' : v).length + 2)); }));
      ws['!cols'] = widths.map((wch) => ({ wch }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      return { bytes: new Uint8Array(out), ext: 'xlsx', wb, converted: true, label: 'Text → Excel', note };
    }
    throw wrongType(d, 'xlsx');
  }

  /* ---------- UI ---------- */
  const st = { fileText: '', fileName: '', run: 0, url: null, wb: null, res: null, nameTouched: false };
  const fmt = () => document.querySelector('input[name="b64fmt"]:checked').value;
  const getRaw = () => st.fileText || $('b64In').value;

  function live(msg) { $('b64Live').textContent = msg; }
  function setState(state, msg) {
    $('b64Pv').dataset.state = state; $('b64Pv').setAttribute('aria-busy', String(state === 'loading'));
    $('b64Empty').classList.toggle('hidden', state !== 'empty');
    $('b64Load').classList.toggle('hidden', state !== 'loading');
    $('b64Err').classList.toggle('hidden', state !== 'error');
    $('b64Ok').classList.toggle('hidden', state !== 'success');
    $('b64Convert').disabled = state === 'loading';
    if (state === 'loading') { $('b64LoadMsg').textContent = msg || 'Converting…'; $('b64Status').textContent = ''; live(msg || 'Converting'); }
    if (state === 'error') { $('b64ErrMsg').textContent = msg; $('b64Status').textContent = 'Failed'; $('b64Status').className = 'status err'; live('Error: ' + msg); }
    if (state === 'success') { $('b64Status').textContent = 'Ready'; $('b64Status').className = 'status'; live(msg || 'Preview ready'); }
    if (state === 'empty') { $('b64Status').textContent = ''; }
    if (state !== 'success') { $('b64Download').disabled = true; $('b64Open').classList.add('hidden'); }
  }

  function releaseResult() {
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = null; st.wb = null; st.res = null;
    $('b64Pdf').src = 'about:blank'; $('b64Tbl').innerHTML = ''; $('b64Sheet').innerHTML = '';
  }
  function resetResult() { st.run++; releaseResult(); setState('empty'); }

  function stamp() { const n = new Date(), p = (x) => String(x).padStart(2, '0'); return `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`; }
  const base = (ext) => (ext === 'pdf' ? 'document-' : 'workbook-') + stamp();
  function cleanName(v, ext) {
    let n = String(v || '').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
    n = n.replace(/\.(pdf|xlsx|xlsm|xlsb|xls)$/i, '');
    return (n.slice(0, 100) || base(ext)) + '.' + ext;
  }
  function updateFormatLabels() {
    const pdf = fmt() === 'pdf', ext = st.res ? st.res.ext : (pdf ? 'pdf' : 'xlsx');
    $('b64Download').textContent = pdf ? 'Download PDF' : 'Download Excel';
    $('b64Ext').textContent = '.' + ext;
  }

  function renderSheet(name) {
    const ws = st.wb.Sheets[name];
    if (!ws || !ws['!ref']) { $('b64Tbl').innerHTML = ''; $('b64SheetInfo').textContent = 'This sheet is empty.'; return; }
    const full = XLSX.utils.decode_range(ws['!fullref'] || ws['!ref']), r = XLSX.utils.decode_range(ws['!ref']);
    r.s = { r: 0, c: 0 };
    r.e = { r: Math.min(r.e.r, MAX_PREVIEW_ROWS - 1), c: Math.min(r.e.c, MAX_PREVIEW_COLS - 1) };
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true, range: XLSX.utils.encode_range(r) });
    const nc = r.e.c + 1;
    let html = '<thead><tr><th class="idx" scope="col">#</th>';
    for (let c = 0; c < nc; c++) html += '<th scope="col">' + XLSX.utils.encode_col(c) + '</th>';
    html += '</tr></thead><tbody>';
    data.forEach((row, i) => {
      html += '<tr><td class="idx">' + (i + 1) + '</td>';
      for (let c = 0; c < nc; c++) { const v = row[c]; html += '<td title="' + esc(v == null ? '' : v) + '">' + esc(v == null ? '' : v) + '</td>'; }
      html += '</tr>';
    });
    $('b64Tbl').innerHTML = html + '</tbody>';
    const totalR = full.e.r + 1, totalC = full.e.c + 1;
    $('b64SheetInfo').textContent = `Showing ${Math.min(data.length, totalR).toLocaleString()} of ${totalR.toLocaleString()} row(s) · ${Math.min(nc, totalC)} of ${totalC} column(s)` + (totalR > MAX_PREVIEW_ROWS || totalC > MAX_PREVIEW_COLS ? ' — preview is capped; the download contains everything.' : '');
  }

  function showResult(res, d, size) {
    releaseResult();
    st.res = res;
    const blob = new Blob([res.bytes], { type: MIME[res.ext] });
    st.url = URL.createObjectURL(blob);
    res.size = blob.size; res.bytes = null;            // the Blob now owns the data
    const isPdf = res.ext === 'pdf';
    $('b64PdfWrap').classList.toggle('hidden', !isPdf);
    $('b64XlsWrap').classList.toggle('hidden', isPdf);
    $('b64Badge').textContent = res.converted ? 'Converted' : 'Original preserved';
    $('b64Info').textContent = `${res.label} · ${fmtSize(res.size)}` + (d && !res.converted ? ` · detected: ${typeName(d)}` : '');
    const note = [res.note].filter(Boolean).join(' ');
    $('b64Note').textContent = note; $('b64Note').classList.toggle('hidden', !note);
    if (isPdf) { $('b64Pdf').src = st.url; $('b64Open').href = st.url; $('b64Open').classList.remove('hidden'); }
    else {
      st.wb = res.wb; res.wb = null;
      const sel = $('b64Sheet'); sel.innerHTML = st.wb.SheetNames.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
      $('b64SheetRow').classList.toggle('hidden', st.wb.SheetNames.length < 2);
      renderSheet(st.wb.SheetNames[0]);
    }
    if (!st.nameTouched) $('b64Name').value = '';
    $('b64Name').placeholder = base(res.ext);
    setState('success', `${res.label} ready — preview below.`);
    if (!isPdf) $('b64Open').classList.add('hidden');
    $('b64Download').disabled = false;
    updateFormatLabels();
  }

  async function run() {
    const token = ++st.run, want = fmt();
    releaseResult();
    setState('loading', 'Decoding and converting…');
    await tick(); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));   // let the spinner paint
    try {
      const core = normalize(getRaw());
      const bytes = await decode(core);
      if (token !== st.run) return;
      if (!bytes.length) throw new Error('The Base64 data decodes to zero bytes.');
      const d = detect(bytes);
      d.bytes = bytes;
      const res = want === 'pdf' ? await toPdf(bytes, d) : await toExcel(bytes, d);
      if (token !== st.run) return;
      showResult(res, d, bytes.length);
    } catch (e) {
      if (token !== st.run) return;
      releaseResult();
      setState('error', e && e.message ? e.message : 'Conversion failed.');
    }
  }

  function updateCount() {
    const n = st.fileText ? st.fileText.length : $('b64In').value.length;
    $('b64Count').textContent = n.toLocaleString() + ' characters';
  }
  function dropFile() { st.fileText = ''; st.fileName = ''; $('b64FileInfo').textContent = ''; $('b64In').disabled = false; $('b64In').placeholder = 'Paste Base64 here (a data:…;base64, prefix, line breaks and URL-safe characters are fine)'; }

  $('b64In').addEventListener('input', () => { updateCount(); });
  $('b64Convert').onclick = run;
  document.querySelectorAll('input[name="b64fmt"]').forEach((r) => r.addEventListener('change', () => { resetResult(); updateFormatLabels(); }));
  $('b64Sheet').onchange = () => renderSheet(st.wb.SheetNames[+$('b64Sheet').value]);
  $('b64Name').addEventListener('input', () => { st.nameTouched = !!$('b64Name').value.trim(); });

  $('b64Upload').onclick = () => $('b64File').click();
  $('b64File').onchange = async () => {
    const f = $('b64File').files[0]; $('b64File').value = '';
    if (!f) return;
    if (!/\.(txt|b64)$/i.test(f.name) && f.type !== 'text/plain') {
      resetResult(); setState('error', `“${f.name}” is not a .txt file. Upload a text file that contains Base64 data.`); return;
    }
    try {
      const text = await f.text();
      if (!text.trim()) { resetResult(); setState('error', `“${f.name}” is empty.`); return; }
      resetResult();
      if (text.length > 1000000) {          // keep huge strings out of the textarea (slow to render)
        st.fileText = text; st.fileName = f.name; $('b64In').value = ''; $('b64In').disabled = true;
        $('b64In').placeholder = `Loaded from ${f.name} (${fmtSize(f.size)}). Press Clear to remove it.`;
      } else { dropFile(); $('b64In').value = text; }
      $('b64FileInfo').textContent = `Loaded ${f.name} (${fmtSize(f.size)})`;
      updateCount();
    } catch (e) { resetResult(); setState('error', `Could not read “${f.name}”: ${e.message || e}`); }
  };

  $('b64Clear').onclick = () => {
    dropFile(); $('b64In').value = ''; $('b64Name').value = ''; st.nameTouched = false;
    resetResult(); updateCount(); updateFormatLabels(); $('b64In').focus();
  };

  $('b64Download').onclick = () => {
    if (!st.res || !st.url) return;
    const a = document.createElement('a');
    a.href = st.url; a.download = cleanName($('b64Name').value, st.res.ext);
    document.body.appendChild(a); a.click(); a.remove();
  };

  updateCount(); updateFormatLabels();
  DT.b64 = { normalize, decode, detect, textToRows, parseDelimited, pickDelimiter, cleanName };   // exposed for testing
})();
