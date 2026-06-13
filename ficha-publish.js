/* ============================================================================
   ficha-publish.js — conecta el editor de TEXTOS de la ficha con el BACKEND.
   build.py lo inyecta SOLO en ficha.html.

   - Visitante normal (sin ?admin): NO hace nada.
   - En modo admin (?admin o ruta .../admin):
       * si el dueno esta logueado en el servidor -> desbloquea la edicion sin la
         clave vieja y PUBLICA los textos al servidor cada vez que se guardan.
       * si no esta logueado -> lo manda al login y vuelve a esta ficha.
   Publica SOLO los textos por entalle (no toca fotos/colores ni el catalogo).
   ============================================================================ */
(function () {
  var params = new URLSearchParams(location.search);
  var isAdmin = params.has('admin') || /\/admin\/?$/.test(location.pathname);
  if (!isAdmin) return; // visitantes: nada

  // 1) sesion del servidor (sincrono, solo en modo admin)
  var loggedIn = false;
  try {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/session', false);
    x.send(null);
    if (x.status >= 200 && x.status < 300) loggedIn = !!(JSON.parse(x.responseText || '{}').user);
  } catch (e) {}

  if (!loggedIn) {
    var back = location.pathname + (location.search || '?admin');
    location.replace('/admin?next=' + encodeURIComponent(back));
    return;
  }
  // logueado: desbloquear la edicion sin pedir la clave demo (la sesion ES el permiso)
  try { sessionStorage.setItem('element_admin_ok', '1'); } catch (e) {}

  // 2) publicar los textos al guardar (interceptar el borrador en localStorage)
  var CFG = 'element_fichas_config_v1';
  var rawSet = localStorage.setItem.bind(localStorage);
  var rawGet = localStorage.getItem.bind(localStorage);
  var timer = null;
  localStorage.setItem = function (k, v) {
    rawSet(k, v);
    if (k === CFG) { clearTimeout(timer); timer = setTimeout(publish, 700); }
  };

  function toast(m) {
    var t = document.getElementById('toast');
    if (t) { t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 1900); }
  }

  var busy = false, again = false;
  function publish() {
    if (busy) { again = true; return; }
    busy = true;
    var draft = {};
    try { draft = JSON.parse(rawGet(CFG) || '{}'); } catch (e) {}
    fetch('/api/config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (cur) {
        cur.fichas = cur.fichas || {};
        // copiar SOLO los textos por entalle (no tocar fotos/colores del servidor)
        Object.keys(draft).forEach(function (key) {
          if (key[0] === '_') return;
          if (draft[key] && draft[key].texts) {
            cur.fichas[key] = cur.fichas[key] || {};
            cur.fichas[key].texts = draft[key].texts;
          }
        });
        return fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(cur) });
      })
      .then(function (r) { toast(r && r.ok ? 'Texto publicado en el sitio' : (r && r.status === 401 ? 'Inicia sesion para publicar' : 'No se pudo publicar')); })
      .catch(function () { toast('No se pudo publicar'); })
      .then(function () { busy = false; if (again) { again = false; clearTimeout(timer); timer = setTimeout(publish, 300); } });
  }
})();
