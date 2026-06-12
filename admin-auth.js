/* admin-auth.js — control de sesion del panel, respaldado por el BACKEND.
   Reemplaza la version "demo" del export: el login real ocurre contra /api/login
   y la fuente de verdad es la cookie httpOnly `el_sess` del servidor.
   `el_auth`/`el_user` son cookies legibles solo para UX (mostrar nombre / guard rapido).
   El login en si lo intercepta element-backend.js (llamada async al servidor).
   NOTA: este archivo lo mantiene el repo; build.py NO lo sobreescribe con el del export. */
(function () {
  function cookie(name){
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  var Auth = {
    loginUrl: 'login.html',
    hubUrl: 'panel.html',
    user: function(){ return cookie('el_user') || 'admin'; },
    valid: function(){ return cookie('el_auth') === '1'; },
    check: function(){ return false; },   // el login real lo hace element-backend.js
    login: function(){},                   // no-op de compatibilidad
    logout: function(){
      fetch('/api/logout', { method:'POST', credentials:'same-origin' })
        .catch(function(){})
        .then(function(){ location.href = 'login.html'; });
    },
    guard: function(){
      if (this.valid()) return true;
      var here = (location.pathname.split('/').pop() || '');
      location.replace('login.html?next=' + encodeURIComponent(here));
      return false;
    }
  };
  window.ElementAuth = Auth;
})();
