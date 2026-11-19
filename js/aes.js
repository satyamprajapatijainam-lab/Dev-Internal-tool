// Encrypt / Decrypt tabs (CryptoJS). Modes: CBC, ECB. Key size: 128/192/256. Padding: PKCS7.
(function () {
  const $ = (id) => document.getElementById(id);
  const { ICON, copyText } = DT;
  let manual = false, lastDecrypted = '';

  const cfg = () => {
    const mode = $('mode').value, keyLen = +$('keySize').value / 8, ivLen = mode === 'CBC' ? 16 : 0;
    return { mode, keyLen, ivLen, total: ivLen + keyLen, fmt: $('fmt').value };
  };

  function refresh() {
    const c = cfg(), cb = $('combinedKey');
    cb.maxLength = c.total; if (cb.value.length > c.total) cb.value = cb.value.slice(0, c.total);
    cb.placeholder = c.ivLen ? `${c.total}-character IV + key` : `${c.total}-character key`;
    $('secretHint').textContent = c.ivLen ? `CBC: enter a ${c.keyLen}-character key alone to use a zero IV, or enter the 16-character IV followed by the key.` : `ECB: ${c.keyLen}-character key (no IV).`;
    $('secretCount').textContent = `${cb.value.length} / ${c.total}`;
    const v = cb.value;
    $('ivDisplay').value = c.ivLen && v ? (v.slice(0, c.ivLen) || '—') : '—';
    $('keyDisplay').value = v ? (v.slice(c.ivLen, c.ivLen + c.keyLen) || '—') : '—';
    $('ivRoWrap').classList.toggle('hidden', !c.ivLen);
    $('ivWrap').classList.toggle('hidden', !c.ivLen);
    $('ivManual').maxLength = 16; $('keyManual').maxLength = c.keyLen;
    if ($('keyManual').value.length > c.keyLen) $('keyManual').value = $('keyManual').value.slice(0, c.keyLen);
    $('ivCount').textContent = `${$('ivManual').value.length} / 16`;
    $('keyCount').textContent = `${$('keyManual').value.length} / ${c.keyLen}`;
    $('keyManual').placeholder = `${c.keyLen} characters`;
    $('cipherLabel').textContent = `Ciphertext (${c.fmt === 'hex' ? 'Hex' : 'Base64'})`;
    document.dispatchEvent(new Event('cryptocfg'));
  }
  ['mode', 'keySize', 'fmt'].forEach((id) => $(id).addEventListener('change', refresh));
  ['combinedKey', 'ivManual', 'keyManual'].forEach((id) => $(id).addEventListener('input', refresh));

  $('toManual').onclick = () => { manual = true; $('secretBlock').classList.add('hidden'); $('manualBlock').classList.remove('hidden'); };
  $('toSecret').onclick = () => { manual = false; $('manualBlock').classList.add('hidden'); $('secretBlock').classList.remove('hidden'); };

  function getKeyIv() {
    const c = cfg();
    let key = '', iv = '';

    if (manual) {
      key = $('keyManual').value;
      iv = $('ivManual').value;
    } else {
      const v = $('combinedKey').value;
      // Support key-only input in CBC mode by using a zero IV, matching the live toolkit.
      if (c.ivLen && v.length === c.keyLen) {
        key = v;
        iv = '\0'.repeat(c.ivLen);
      } else if (c.ivLen && v.length === c.total) {
        iv = v.slice(0, c.ivLen);
        key = v.slice(c.ivLen, c.ivLen + c.keyLen);
      } else if (!c.ivLen) {
        key = v;
      } else {
        throw new Error(`For CBC, enter either the ${c.keyLen}-character key alone (zero IV), or the 16-character IV followed by the ${c.keyLen}-character key (${c.total} characters total).`);
      }
    }

    if (key.length !== c.keyLen) {
      throw new Error(`Key must be exactly ${c.keyLen} characters (${c.keyLen * 8} bits). You entered ${key.length}.`);
    }

    if (c.ivLen && !iv.length) {
      // Manual mode also permits a blank IV, interpreted as a zero IV.
      iv = '\0'.repeat(c.ivLen);
    }
    if (c.ivLen && iv.length !== c.ivLen) {
      throw new Error(`IV must be exactly ${c.ivLen} characters. You entered ${iv.length}.`);
    }
    return { key, iv, c };
  }
  const opts = (c, iv) => {
    const o = { mode: CryptoJS.mode[c.mode], padding: CryptoJS.pad.Pkcs7 };
    if (c.ivLen) o.iv = CryptoJS.enc.Utf8.parse(iv);
    return o;
  };

  function setOut(el, text, state) {
    el.classList.remove('empty', 'error');
    if (state === 'error') el.classList.add('error');
    if (!text) { el.classList.add('empty'); el.textContent = 'Result will appear here'; return; }
    el.textContent = text;
  }

  function parseCipher(raw, c) {
    const s = raw.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
    if (!s) throw new Error('Paste ciphertext (hex or Base64) to decrypt.');
    const bad = s.search(/[^A-Za-z0-9+/=_-]/);
    if (bad !== -1) throw new Error(`Invalid character "${s[bad]}" at position ${bad + 1} — ciphertext must be Base64 or Hex.`);
    const isHex = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
    const core = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');   // accepts URL-safe and missing '=' padding
    const isB64 = /^[A-Za-z0-9+/]+$/.test(core) && core.length % 4 !== 1;
    let wa;
    for (const f of c.fmt === 'hex' ? ['hex', 'b64'] : ['b64', 'hex']) {
      if (f === 'hex' && isHex) { wa = CryptoJS.enc.Hex.parse(s); break; }
      if (f === 'b64' && isB64) { wa = CryptoJS.enc.Base64.parse(core + '='.repeat((4 - core.length % 4) % 4)); break; }
    }
    if (!wa) throw new Error('Ciphertext is not valid Base64 or Hex (check for missing or extra characters).');
    if (wa.sigBytes % 16) throw new Error(`Ciphertext is ${wa.sigBytes} bytes, but AES-${c.mode} needs a multiple of 16 (next valid size: ${Math.ceil(wa.sigBytes / 16) * 16}). It looks cut off, or it was encrypted with a different method.`);
    return wa;
  }

  // Warn when the "plain text" already looks like ciphertext (Base64 / Hex)
  let anyway = false;
  function looksEncrypted(s) {
    s = s.trim();
    if (!s || /\s/.test(s)) return null;
    if (/^[0-9a-fA-F]{32,}$/.test(s) && s.length % 2 === 0) return 'Hex';
    if (/^[A-Za-z0-9+/]{40,}={0,2}$/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9+/]/.test(s)) return 'Base64';
    return null;
  }
  function checkPlain() {
    const v = $('plaintext').value, kind = looksEncrypted(v), warn = !!kind && !anyway;
    $('encWarn').classList.toggle('hidden', !warn);
    if (kind) $('encWarnMsg').textContent = `This looks already encrypted (${kind} ciphertext). Use the Decrypt tab to read it.`;
    $('encryptBtn').disabled = !v || warn;
  }
  $('plaintext').addEventListener('input', () => { anyway = false; checkPlain(); });
  $('encAnyway').onclick = () => { anyway = true; checkPlain(); };
  $('encToDecrypt').onclick = () => {
    const v = $('plaintext').value.trim(), kind = looksEncrypted(v);
    $('ciphertextIn').value = v; $('ciphertextIn').dispatchEvent(new Event('input'));
    $('fmt').value = kind === 'Hex' ? 'hex' : 'base64'; refresh();
    $('plaintext').value = ''; anyway = false; checkPlain();
    document.querySelector('.tab[data-tab="decrypt"]').click();
  };
  $('ciphertextIn').addEventListener('input', () => { $('decryptBtn').disabled = !$('ciphertextIn').value.trim(); });

  $('encryptBtn').onclick = () => {
    try {
      const { key, iv, c } = getKeyIv();
      const enc = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse($('plaintext').value), CryptoJS.enc.Utf8.parse(key), opts(c, iv));
      setOut($('ciphertextOut'), enc.ciphertext.toString(c.fmt === 'hex' ? CryptoJS.enc.Hex : CryptoJS.enc.Base64), 'ok');
    } catch (e) { setOut($('ciphertextOut'), e.message, 'error'); }
  };

  function renderDecrypted(asJson) {
    if (!lastDecrypted) return;
    let text = lastDecrypted, isJson = false;
    if (asJson) { try { text = JSON.stringify(JSON.parse(lastDecrypted), null, 2); isJson = true; } catch (e) { /* plain */ } }
    setOut($('plaintextOut'), text, 'ok');
    $('viewJson').classList.toggle('active', isJson); $('viewPlain').classList.toggle('active', !isJson);
  }

  $('decryptBtn').onclick = () => {
    const st = $('decryptStatus'); st.classList.add('hidden');
    try {
      const { key, iv, c } = getKeyIv();
      const params = CryptoJS.lib.CipherParams.create({ ciphertext: parseCipher($('ciphertextIn').value, c) });
      let text = '';
      try { text = CryptoJS.AES.decrypt(params, CryptoJS.enc.Utf8.parse(key), opts(c, iv)).toString(CryptoJS.enc.Utf8); } catch (e) { /* bad key */ }
      if (!text) throw new Error('Decryption failed — check the key, IV, mode and ciphertext.');
      lastDecrypted = text; renderDecrypted(false);
      st.textContent = 'Decrypted'; st.className = 'pill ok';
    } catch (e) {
      lastDecrypted = ''; setOut($('plaintextOut'), e.message, 'error');
      st.textContent = 'Failed'; st.className = 'pill error';
    }
  };
  $('viewPlain').onclick = () => renderDecrypted(false);
  $('viewJson').onclick = () => renderDecrypted(true);

  [['copyCiphertext', 'ciphertextOut'], ['copyPlaintext', 'plaintextOut']].forEach(([b, o]) => {
    $(b).innerHTML = ICON;
    $(b).onclick = () => { if (!$(o).classList.contains('empty') && !$(o).classList.contains('error')) copyText($(o).textContent, $(b)); };
  });
  refresh();
})();
