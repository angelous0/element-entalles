#!/bin/bash
# ============================================================================
# ver-local.command  —  Abre el sitio Element Premium en LOCAL para revisarlo
# antes de publicar.  (Doble clic para ejecutar.)
#
#   - Sirve la web + el panel (login, publicar, fichas, catalogo) en tu Mac.
#   - Usa datos LOCALES (carpeta data-local/), separados de produccion.
#   - Para cerrarlo: cierra esta ventana de Terminal o pulsa Ctrl + C.
# ============================================================================
cd "$(dirname "$0")" || exit 1

echo ""
echo "  Element Premium — vista local"
echo "  ------------------------------------------------------------"

# Node instalado?
if ! command -v node >/dev/null 2>&1; then
  echo "  ⚠️  No encuentro Node.js. Instalalo desde https://nodejs.org y reintenta."
  echo ""; read -r -p "  (Enter para cerrar) " _; exit 1
fi

# Dependencias del servidor (solo la primera vez)
if [ ! -d server/node_modules ]; then
  echo "  Instalando dependencias (solo la primera vez)..."
  ( cd server && npm install --omit=dev ) || { echo "  Error instalando."; read -r -p "  (Enter) " _; exit 1; }
fi

# Liberar el puerto 8090 si quedo algo corriendo
PORT=8090
if lsof -ti tcp:$PORT >/dev/null 2>&1; then
  echo "  Cerrando una vista local anterior..."
  lsof -ti tcp:$PORT | xargs kill >/dev/null 2>&1
  sleep 1
fi

echo "  Abriendo  http://localhost:$PORT"
echo "  Panel:    http://localhost:$PORT/admin   (usuario: admin · clave: local)"
echo "  ------------------------------------------------------------"
echo "  Deja esta ventana abierta mientras revisas. Ctrl+C para cerrar."
echo ""

# Abrir el navegador a los 2 segundos
( sleep 2 && open "http://localhost:$PORT" ) >/dev/null 2>&1 &

# Arrancar el servidor (sirve esta carpeta; datos locales aparte)
SITE_DIR="$PWD" \
DATA_DIR="$PWD/data-local" \
PORT="$PORT" \
ADMIN_USER="admin" \
ADMIN_PASS="local" \
SESSION_SECRET="vista-local-no-secreta" \
node server/server.js
