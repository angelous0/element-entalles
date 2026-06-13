/* ============================================================================
   element-backend.js — puente entre los paneles (localStorage) y el BACKEND.
   build.py lo inyecta en: login.html, panel.html, admin-fichas.html, admin-catalogo.html.

   Hace 3 cosas, SIN tocar el codigo que genera el disenador:
   1) SIEMBRA el localStorage desde /api/config antes de que el panel pinte.
   2) SINCRONIZA al servidor cuando el dueno PUBLICA fichas (o cambia el catalogo):
      sube las imagenes base64 nuevas a /api/media (optimiza+sobreescribe) y guarda
      la config con URLs via PUT /api/config -> la web se actualiza para todos.
   3) En login.html, autentica contra /api/login (sesion real por cookie).
   ============================================================================ */
(function () {
  var DRAFT = 'element_fichas_config_v1';
  var PUB   = 'element_fichas_published_v1';
  var CAT   = 'element_catalog_pages_v1';

  var rawSet = localStorage.setItem.bind(localStorage);
  var rawGet = localStorage.getItem.bind(localStorage);

  // ---- 1) SEED sincrono desde el servidor ----
  // Solo en los paneles que de verdad usan localStorage (fichas / catalogo).
  // En login.html y panel.html NO se hace, para no bloquear la carga (pantalla en blanco).
  if (/admin-fichas|admin-catalogo/.test(location.pathname)) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', '/api/config', false); // sincrono: herramienta interna
      x.send(null);
      if (x.status >= 200 && x.status < 300) {
        var cfg = JSON.parse(x.responseText || '{}');
        if (cfg.fichas) { var f = JSON.stringify(cfg.fichas); rawSet(DRAFT, f); rawSet(PUB, f); }
        if (cfg.catalog && cfg.catalog.pages) {
          var pages = cfg.catalog.pages.map(function (p, i) {
            return { id: p.id || ('p' + i), img: p.img, label: p.label || '' };
          });
          rawSet(CAT, JSON.stringify(pages));
        }
      }
    } catch (e) { /* sin backend: el panel sigue con su localStorage local */ }
  }

  // ---- 2) SYNC al servidor al publicar fichas / cambiar catalogo ----
  var timer = null;
  function schedule(){ clearTimeout(timer); timer = setTimeout(push, 600); }
  localStorage.setItem = function (k, v) {
    rawSet(k, v);
    if (k === PUB || k === CAT) schedule();
  };

  function isData(s){ return typeof s === 'string' && s.slice(0, 11) === 'data:image/'; }

  // sube un dataURL a su slot (cada slot = 1 archivo deterministico, sobreescribe).
  // No deduplicamos por contenido: dos slots distintos con la misma imagen deben
  // ser archivos distintos. Tras publicar, los valores quedan como URL (no base64),
  // asi que una segunda publicacion sin cambios no vuelve a subir nada.
  async function up(dataURL, slot) {
    var blob = await (await fetch(dataURL)).blob();
    var fd = new FormData(); fd.append('file', blob, 'img');
    var r = await fetch('/api/media?slot=' + encodeURIComponent(slot), { method:'POST', body:fd, credentials:'same-origin' });
    if (r.status === 401) throw new Error('sin-sesion');
    if (!r.ok) throw new Error('subida ' + r.status);
    return (await r.json()).url;
  }
  async function upFichas(f) {
    for (var k in f) {
      if (k[0] === '_') continue;
      var e = f[k]; if (!e || typeof e !== 'object') continue;
      if (isData(e.hero)) e.hero = await up(e.hero, 'fichas/' + k + '-hero');
      if (Array.isArray(e.details)) for (var i = 0; i < e.details.length; i++) {
        if (isData(e.details[i])) e.details[i] = await up(e.details[i], 'fichas/' + k + '-det-' + i);
      }
    }
    if (f._pal) for (var c in f._pal) { if (isData(f._pal[c])) f._pal[c] = await up(f._pal[c], 'colors/' + c); }
  }

  var syncing = false, again = false;
  async function push() {
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      var f = JSON.parse(rawGet(PUB) || '{}');
      var pages = JSON.parse(rawGet(CAT) || '[]');
      await upFichas(f);
      for (var i = 0; i < pages.length; i++) {
        if (isData(pages[i].img)) pages[i].img = await up(pages[i].img, 'catalog/' + (pages[i].id || ('p' + i)));
      }
      var body = { fichas: f, catalog: { pages: pages.map(function (p) { return { id:p.id, img:p.img, label:p.label || '' }; }) } };
      var r = await fetch('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify(body) });
      if (r.status === 401) { note('Inicia sesion para publicar'); return; }
      if (r.ok) {
        // reflejar URLs en localStorage para no re-subir
        rawSet(PUB, JSON.stringify(f)); rawSet(DRAFT, JSON.stringify(f)); rawSet(CAT, JSON.stringify(pages));
        note('Publicado en el sitio');
      } else { note('No se pudo publicar (' + r.status + ')'); }
    } catch (e) { note('No se pudo publicar (' + (e.message || e) + ')'); }
    finally { syncing = false; if (again) { again = false; schedule(); } }
  }
  function note(m) {
    try { console.log('[element]', m); } catch (e) {}
    var t = document.getElementById('toast');
    if (t) { t.textContent = m; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); }, 1900); }
  }

  // ---- 3) login real + verificacion de sesion ----
  function qp(n){ return new URLSearchParams(location.search).get(n); }
  function authed(){ return /(?:^|; )el_auth=1(?:;|$)/.test(document.cookie); }
  function isLoginPage(){ return !!(document.getElementById('user') && document.getElementById('pass')); }

  // intercepta el submit del login en fase de captura (corre antes del handler original)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !isLoginPage()) return;
    e.preventDefault(); e.stopPropagation();
    var u = (document.getElementById('user').value || '').trim();
    var p = document.getElementById('pass').value || '';
    var err = document.getElementById('err'), msg = document.getElementById('errMsg');
    function fail(t){ if (msg) msg.textContent = t; if (err) err.classList.add('show'); }
    if (!u || !p) { fail('Completa usuario y clave.'); return; }
    fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify({ user:u, pass:p }) })
      .then(function (r) {
        if (r.ok) { location.href = qp('next') || 'panel.html'; }
        else { fail('Usuario o clave incorrectos.'); }
      })
      .catch(function () { fail('No hay conexion con el servidor.'); });
  }, true);

  // El boton del catalogo ("Generar y descargar" / "Publicar catalogo") ahora PUBLICA
  // al servidor (sube las paginas y guarda la config) en vez de descargar un archivo.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('#genBtn');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();   // no descargar archivo
    note('Publicando catalogo…');
    push();
  }, true);

  // limpia las cookies/sesion de UX obsoletas (rompe bucles login<->panel)
  function clearStaleAuth(){
    document.cookie = 'el_auth=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'el_user=; Path=/; Max-Age=0; SameSite=Lax';
    try { localStorage.removeItem('element_admin_session_v1'); } catch (e) {} // sesion demo vieja
  }
  // En el Panel (hub): agrega una tarjeta "Textos de las fichas" que abre la ficha
  // en modo edicion. Asi no hay que escribir ?admin a mano.
  function injectPanelCard(){
    var cards = document.querySelector('.cards');
    if (!cards || document.getElementById('el-edit-texts')) return;
    var a = document.createElement('a');
    a.className = 'card';
    a.id = 'el-edit-texts';
    a.href = '/baggy?admin';
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML =
      '<span class="tag">Textos · descripciones</span>' +
      '<div class="ic"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></div>' +
      '<h3>Textos de las fichas</h3>' +
      '<p>Edita los textos de cada entalle (subtítulo, “por qué” y looks) directo sobre la página. Se publica al instante.</p>' +
      '<span class="go">Editar <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>';
    cards.appendChild(a);
  }

  function onReady(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  onReady(function () {
    if (isLoginPage()) {
      // ¿hay sesion REAL en el servidor? (no confiar solo en la cookie de UX -> evita bucles)
      fetch('/api/session', { credentials:'same-origin' })
        .then(function(r){ return r.json(); })
        .then(function(d){ if (d.user) location.replace(qp('next') || 'panel.html'); else clearStaleAuth(); })
        .catch(function(){});
      return;
    }
    injectPanelCard(); // solo hace algo en el Panel (donde existe .cards)
    // pagina protegida: valida la sesion real; si no hay, limpia lo viejo y va al login
    fetch('/api/session', { credentials:'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d.user) { clearStaleAuth(); var here = location.pathname.split('/').pop() || ''; location.replace('login.html?next=' + encodeURIComponent(here)); }
      }).catch(function(){});
  });
})();
