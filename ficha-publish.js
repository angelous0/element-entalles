/* ============================================================================
   ficha-publish.js — editor de textos de la ficha conectado al BACKEND.
   build.py lo inyecta SOLO en ficha.html.

   Dos capas:
   A) TEXTOS DE MARCA (globales, iguales en todos los entalles): titulos de
      seccion, cuidados, "el resumen", bullets de lavado, footer. Se guardan en
      config.fichas._textOv y se APLICAN a todos los visitantes (MutationObserver).
   B) TEXTOS POR ENTALLE (subtitulo, "por que", looks): los maneja la propia ficha
      (config[entalle].texts); aqui solo se publican al servidor al guardarse.

   - Visitante normal: solo aplica los overrides publicados (capa A). No edita nada.
   - Modo admin (?admin/.../admin) + logueado: desbloquea la edicion y publica.
   ============================================================================ */
(function () {
  var CFG = 'element_fichas_config_v1';
  var rawSet = localStorage.setItem.bind(localStorage);
  var rawGet = localStorage.getItem.bind(localStorage);

  // ---- selectores de los textos de marca editables (anclas estables) ----
  var SELECTORS = [
    '.sec-head .num', '.sec-head h2', '.sec-head .blurb',
    '.care-item .sub-lbl', '.care-item .lbl',
    '.qf-tag', '.qf-text', '.qf-meta .k', '.qf-meta .v',
    '#washList li', '#washTag', '#footTag', '#footSub'
  ];
  function keyOf(el, sel, i) { return el.id ? ('#' + el.id) : (sel + '##' + i); }

  // overrides globales en memoria (servidor + borrador local en admin).
  // OJO: window.ELEMENT_FICHAS_CFG lo inyecta el servidor DESPUES de este script,
  // por eso loadOV() se llama en DOMContentLoaded (no aqui arriba).
  var OV = {};
  function loadOV() {
    var srv = (window.ELEMENT_FICHAS_CFG && window.ELEMENT_FICHAS_CFG._textOv) || {};
    OV = Object.assign({}, srv);
    try { var d = JSON.parse(rawGet(CFG) || '{}'); if (d._textOv) OV = Object.assign(OV, d._textOv); } catch (e) {}
  }

  var applying = false;
  function applyOverrides() {
    if (applying) return; applying = true;
    for (var s = 0; s < SELECTORS.length; s++) {
      var els = document.querySelectorAll(SELECTORS[s]);
      for (var i = 0; i < els.length; i++) {
        var ov = OV[keyOf(els[i], SELECTORS[s], i)];
        if (ov != null && els[i].textContent !== ov) els[i].textContent = ov;
      }
    }
    applying = false;
  }

  // ---- modo admin ----
  var params = new URLSearchParams(location.search);
  var isAdmin = params.has('admin') || /\/admin\/?$/.test(location.pathname);
  var adminOn = false;

  // observa los re-render de la ficha y reaplica overrides (y editabilidad en admin)
  var t1 = null;
  var obs = new MutationObserver(function () {
    clearTimeout(t1);
    t1 = setTimeout(function () { applyOverrides(); if (adminOn) { makeEditable(); fixAdminBar(); } }, 70);
  });
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () { loadOV(); applyOverrides(); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); });

  if (!isAdmin) return; // visitantes: aplican overrides (arriba) y nada mas

  // 1) sesion del servidor (sincrono, solo en modo admin)
  var loggedIn = false;
  try {
    var x = new XMLHttpRequest(); x.open('GET', '/api/session', false); x.send(null);
    if (x.status >= 200 && x.status < 300) loggedIn = !!(JSON.parse(x.responseText || '{}').user);
  } catch (e) {}
  if (!loggedIn) {
    location.replace('/admin?next=' + encodeURIComponent(location.pathname + (location.search || '?admin')));
    return;
  }
  try { sessionStorage.setItem('element_admin_ok', '1'); } catch (e) {} // desbloquea sin la clave demo
  adminOn = true;

  // estilo del resaltado editable para los textos de marca
  ready(function () {
    var st = document.createElement('style');
    st.textContent = '.cms-editable{outline:1.5px dashed rgba(203,232,58,.5);outline-offset:3px;border-radius:3px;cursor:text}'
      + '.cms-editable:hover{outline-color:#cbe83a}.cms-editable:focus{outline:2px solid #cbe83a;outline-offset:3px}';
    document.head.appendChild(st);
    makeEditable();
    setTimeout(fixAdminBar, 300);
  });

  // ajusta la barra de edicion: oculta "Exportar" (obsoleto), agrega "Publicar"
  // y aclara que se publica solo al tocar afuera.
  function fixAdminBar() {
    var bar = document.querySelector('.admin-bar');
    if (!bar || bar.dataset.elFixed) return;
    bar.dataset.elFixed = '1';
    var exp = bar.querySelector('#admExport');
    if (exp) exp.style.display = 'none';
    var span = bar.querySelector('span');
    if (span) span.innerHTML = '✏️ <b>Modo edición</b> · se <b style="color:#cbe83a">publica solo</b> al tocar afuera';
    var pub = document.createElement('button');
    pub.id = 'admPublish'; pub.type = 'button'; pub.textContent = 'Publicar';
    pub.addEventListener('click', function () { toast('Publicando…'); publish(); });
    var exit = bar.querySelector('#admExit');
    if (exit) bar.insertBefore(pub, exit); else bar.appendChild(pub);
  }

  function makeEditable() {
    for (var s = 0; s < SELECTORS.length; s++) {
      var els = document.querySelectorAll(SELECTORS[s]);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.getAttribute('data-edit')) continue;   // ya lo maneja la ficha (per-entalle)
        if (el.dataset.cmsKey) continue;
        el.dataset.cmsKey = keyOf(el, SELECTORS[s], i);
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
        el.classList.add('cms-editable');
      }
    }
  }

  // 2) publicar (per-entalle + globales) cuando se guarda algo en el borrador
  localStorage.setItem = function (k, v) { rawSet(k, v); if (k === CFG) schedulePublish(); };

  // guardar los textos de marca al editar (escribe _textOv -> dispara el publish)
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (!el || !el.dataset || !el.dataset.cmsKey) return;
    var val = el.innerText.trim();
    OV[el.dataset.cmsKey] = val;
    var d = {}; try { d = JSON.parse(rawGet(CFG) || '{}'); } catch (_) {}
    d._textOv = d._textOv || {}; d._textOv[el.dataset.cmsKey] = val;
    localStorage.setItem(CFG, JSON.stringify(d)); // -> schedulePublish
  }, true);

  var pubTimer = null;
  function schedulePublish() { clearTimeout(pubTimer); pubTimer = setTimeout(publish, 700); }
  function toast(m) { var t = document.getElementById('toast'); if (t) { t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 1900); } }

  var busy = false, again = false;
  function publish() {
    if (busy) { again = true; return; }
    busy = true;
    var d = {}; try { d = JSON.parse(rawGet(CFG) || '{}'); } catch (_) {}
    fetch('/api/config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (cur) {
        cur.fichas = cur.fichas || {};
        // textos por entalle
        Object.keys(d).forEach(function (k) {
          if (k[0] === '_') return;
          if (d[k] && d[k].texts) { cur.fichas[k] = cur.fichas[k] || {}; cur.fichas[k].texts = d[k].texts; }
        });
        // textos de marca globales
        if (d._textOv) cur.fichas._textOv = d._textOv;
        return fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(cur) });
      })
      .then(function (r) { toast(r && r.ok ? 'Texto publicado en el sitio' : (r && r.status === 401 ? 'Inicia sesion para publicar' : 'No se pudo publicar')); })
      .catch(function () { toast('No se pudo publicar'); })
      .then(function () { busy = false; if (again) { again = false; schedulePublish(); } });
  }
})();
