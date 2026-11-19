// JSON Tools tab: Format / Minify / Validate
(function () {
  const $ = (id) => document.getElementById(id);
  const inp = $('jtIn'), out = $('jtOut'), st = $('jtStatus');

  const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
  const describe = (v) => Array.isArray(v) ? `array, ${v.length} items`
    : v && typeof v === 'object' ? `object, ${Object.keys(v).length} keys` : typeof v;
  const status = (t, err) => { st.textContent = t; st.className = 'status' + (err ? ' err' : ''); };
  const setOut = (t, state) => { out.textContent = t || 'Output will appear here'; out.classList.toggle('empty', !t); out.classList.toggle('error', state === 'error'); };

  function run(mode) {
    let v;
    try { v = JSON.parse(inp.value); } catch (e) {
      if (!inp.value.trim()) return status('Paste some JSON first', true);
      const info = DT.jsonError(inp.value, e);
      status(info.short, true); setOut(info.text, 'error'); DT.gotoError(inp, info);
      return;
    }
    if (out.classList.contains('error')) setOut('');
    if ($('jtSort').value === 'asc') v = sortKeys(v);
    const ind = $('jtIndent').value;
    if (mode === 'format') setOut(JSON.stringify(v, null, ind === 'tab' ? '\t' : +ind));
    if (mode === 'minify') setOut(JSON.stringify(v));
    status({ format: 'Formatted: valid JSON', minify: 'Minified: valid JSON', validate: 'Valid JSON' }[mode] + ` (${describe(v)})`);
  }
  $('jtFormat').onclick = () => run('format');
  $('jtMinify').onclick = () => run('minify');
  $('jtValidate').onclick = () => run('validate');
  $('jtClear').onclick = () => { inp.value = ''; setOut(''); status(''); };
  $('jtCopy').innerHTML = DT.ICON;
  $('jtCopy').onclick = () => { if (!out.classList.contains('empty') && !out.classList.contains('error')) DT.copyText(out.textContent, $('jtCopy')); };
})();
