// Shared helpers (loaded first)
window.DT = {
  ICON: '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" stroke-width="1.8"/></svg>',

  async copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch (e) { return; }
    btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 900);
  },

  // Works with Chrome ("at position N (line L column C)"), Firefox ("at line L column C") and falls back gracefully.
  jsonError(text, err) {
    const raw = String(err && err.message || err);
    let pos = null, line = null, col = null, m;
    if ((m = raw.match(/position (\d+)/i))) pos = +m[1];
    if ((m = raw.match(/line (\d+) column (\d+)/i))) { line = +m[1]; col = +m[2]; }
    if (pos === null && line === null && /end of (the )?JSON|unexpected eof/i.test(raw)) pos = text.length;
    if (line === null && pos !== null) {
      const before = text.slice(0, pos);
      line = before.split('\n').length; col = pos - before.lastIndexOf('\n');
    } else if (pos === null && line !== null) {
      pos = text.split('\n').slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0) + col - 1;
    }
    const clean = raw.replace(/^JSON\.parse:\s*/i, '').replace(/\s*\(line \d+ column \d+\)/i, '')
      .replace(/\s+at (position \d+|line \d+ column \d+)/i, '').replace(/\s+of the JSON data/i, '');
    if (line === null) return { pos: null, short: 'Invalid JSON', text: 'Invalid JSON: ' + clean };
    const where = `line ${line}, column ${col}`;
    const lt = (text.split('\n')[line - 1] || '').replace(/\r$/, '');
    const start = Math.max(0, col - 1 - 40);
    const snippet = (start ? '…' : '') + lt.slice(start, col - 1 + 40);
    const pre = `${line} | `;
    const caret = ' '.repeat(pre.length + (start ? 1 : 0) + col - 1 - start) + '^';
    return { pos, line, col, short: `Invalid JSON (${where})`,
      text: `Invalid JSON: ${clean} (${where})\n\n${pre}${snippet}\n${caret}` };
  },

  // Put the cursor on the error and scroll the textarea to that line
  gotoError(ta, info) {
    if (info.pos == null) return;
    const len = ta.value.length;
    ta.focus();
    const s = Math.min(info.pos, Math.max(0, len - 1));
    ta.setSelectionRange(s, Math.min(s + 1, len));
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (info.line - 3) * lh);
  }
};
