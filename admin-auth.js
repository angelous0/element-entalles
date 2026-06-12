/* ============================================================
   Element Premium — capa de sesión para el panel (prototipo)
   ------------------------------------------------------------
   Esto es un guard de demostración del lado del navegador: sirve
   para ver y validar el flujo de "entrar para editar". La seguridad
   real (que solo tú puedas editar de verdad) llega al conectar el
   almacenamiento/backend, que es un paso aparte.
   ============================================================ */
(function () {
  var SESS_KEY = 'element_admin_session_v1';
  var LOGIN = 'login.html';
  var HUB = 'panel.html';
  // Credenciales de demostración. Cámbialas cuando se conecte el backend real.
  var DEMO_USER = 'admin';
  var DEMO_PASS = 'element';
  var TTL = 1000 * 60 * 60 * 12; // 12 horas

  var Auth = {
    key: SESS_KEY,
    loginUrl: LOGIN,
    hubUrl: HUB,
    demoUser: DEMO_USER,
    demoPass: DEMO_PASS,

    get: function () {
      try { return JSON.parse(localStorage.getItem(SESS_KEY)); } catch (e) { return null; }
    },
    valid: function () {
      var s = this.get();
      return !!(s && s.exp && s.exp > Date.now());
    },
    user: function () {
      var s = this.get();
      return (s && s.user) ? s.user : null;
    },
    check: function (user, pass) {
      return user.trim().toLowerCase() === DEMO_USER && pass === DEMO_PASS;
    },
    login: function (user) {
      var s = { user: (user || DEMO_USER).trim(), at: Date.now(), exp: Date.now() + TTL };
      localStorage.setItem(SESS_KEY, JSON.stringify(s));
      return s;
    },
    logout: function () {
      localStorage.removeItem(SESS_KEY);
      location.href = LOGIN;
    },
    /* Llamar en <head> de cada página protegida. Si no hay sesión,
       redirige al login recordando a dónde quería ir el usuario. */
    guard: function () {
      if (!this.valid()) {
        var here = location.pathname.split('/').pop() || '';
        location.replace(LOGIN + '?next=' + encodeURIComponent(here));
        return false;
      }
      return true;
    }
  };

  window.ElementAuth = Auth;
})();
