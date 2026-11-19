// Tabs: Encrypt / Decrypt / JSON Tools / TechExcelToTable / Base64 to PDF-Excel
(function () {
  const $ = (id) => document.getElementById(id);
  const tabs = document.querySelectorAll('.tab'), views = document.querySelectorAll('.view');
  const names = ['encrypt', 'decrypt', 'json', 'table', 'b64'];
  let current = 'encrypt';

  function updateBadge() {
    $('badge').textContent = current === 'json' ? 'JSON TOOLS' : current === 'table' ? 'TECH EXCEL TO TABLE'
      : current === 'b64' ? 'BASE64 → PDF / EXCEL'
      : `AES-${$('keySize').value} · ${$('mode').value} · PKCS7`;
  }
  function show(name) {
    current = name;
    const crypto = name === 'encrypt' || name === 'decrypt';
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    views.forEach((v) => v.classList.toggle('hidden', v.dataset.view !== name));
    $('asideCrypto').classList.toggle('hidden', !crypto);
    $('asideTable').classList.toggle('hidden', name !== 'table');
    const wide = name === 'json' || name === 'b64';
    $('side').classList.toggle('hidden', wide);
    $('body').classList.toggle('no-aside', wide);
    updateBadge();
    const at = document.querySelector('.tab.active'); if (at && at.scrollIntoView) at.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    history.replaceState(null, '', '#' + name);
  }
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  document.addEventListener('cryptocfg', updateBadge);
  const h = location.hash.slice(1);
  show(names.includes(h) ? h : 'encrypt');
})();
