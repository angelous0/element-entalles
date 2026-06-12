# Element Premium — Sitio de entalles + panel con backend

Sitio de la marca de denim **Element Premium** (Perú). Es un **servicio Node** (Express) que
sirve la web **y** guarda el contenido del panel (fotos + config) en un volumen persistente,
para que lo que el dueño publica se vea **al instante para todos los visitantes**.

El sitio en sí se arma desde el export del diseño con [`build.py`](build.py) (renombra a *slugs*,
reescribe enlaces y **conecta el backend**). El backend vive en [`server/`](server/).

## Cómo funciona (en una frase)
El dueño entra a `/admin`, sube fotos / arma el catálogo y da **Publicar** → el panel sube las
imágenes al servidor (optimizadas a WebP, sobreescribiendo la anterior) y guarda la config →
las páginas públicas leen esa config del servidor → **todos** ven el cambio. Sin generar archivos
ni depender de nadie.

## Páginas y rutas
| Ruta | Sirve | Rol |
|---|---|---|
| `/` | `index.html` | Landing: 8 entalles, galería 360° |
| `/catalogo` | `catalogo.html` | Catálogo (lee páginas del servidor; fallback a 8 estáticas) |
| `/baggy` `/oversize` … | `ficha.html` | Ficha por entalle (lee la config publicada del servidor) |
| `/admin` `/login` | `login.html` | **Login real** del panel |
| `/panel` | `panel.html` | Hub del panel |
| (desde el hub) | `admin-fichas.html` · `admin-catalogo.html` | Paneles de edición |

Entalles: **Baggy, Oversize, Flare (Slim/Relax), Mom, Regular, Semipitillo, Pitillo, Skinny**
(+ los que agregues desde el panel).

## Backend (`server/`)
`server/server.js` (Node + Express) hace 3 cosas:
1. **Sirve el sitio estático** e **inyecta** la config publicada en `ficha.html` (`window.ELEMENT_FICHAS_CFG`) y `catalogo.html` (`window.ELEMENT_CATALOG`).
2. **API:**
   - `POST /api/login` · `GET /api/session` · `POST /api/logout` — sesión real por cookie httpOnly firmada.
   - `GET /api/config` (público) · `PUT /api/config` (protegido) — la config publicada.
   - `POST /api/media?slot=…` (protegido) — sube imagen → `sharp` (WebP, ≤2000px) → `/data/media/<slot>.webp` (**sobreescribe**). `DELETE /api/media`.
3. **Guarda en el volumen `/data`** (`config.json` + `media/`). **Las escrituras exigen sesión**:
   aunque alguien evada el JS, no puede publicar sin login. Lo público (`/api/config`, `/media`) es de solo lectura.

El login y las credenciales son **variables de entorno** del servidor (`ADMIN_USER`, `ADMIN_PASS`,
`SESSION_SECRET`) — no están en el código.

## Conexión panel ↔ backend (sin romper el flujo del diseñador)
El dueño sigue editando en Claude Design y re-exporta. Para que eso no rompa el backend,
`build.py` **inyecta** la conexión en cada export (no se edita el código generado):
- `admin-auth.js` (versión del repo, respaldada por el servidor) reemplaza la demo del export.
- `element-backend.js` se inyecta en los paneles: **siembra** el localStorage desde `/api/config`,
  intercepta el **login** (lo hace contra el servidor) y, al **Publicar**, sube las imágenes nuevas
  y guarda la config (`PUT /api/config`).
- En `catalogo.html`, `const PAGES = [...]` se transforma para preferir `window.ELEMENT_CATALOG`
  (las 8 páginas estáticas quedan como fallback).

## Actualizar el diseño
```bash
python3 build.py                 # toma el zip más reciente de ~/Downloads
git add -A && git commit -m "Actualizar diseño" && git push
```
Easypanel redespliega. El volumen `/data` no se toca → las fotos publicadas se mantienen.

## Correr en local
```bash
cd server && npm install
SITE_DIR=.. DATA_DIR=./data PORT=8090 ADMIN_USER=admin ADMIN_PASS=test node server.js
# abre http://localhost:8090   ·   panel en /admin
```

## Despliegue (Easypanel)
Guía paso a paso: [`DEPLOY-EASYPANEL.md`](DEPLOY-EASYPANEL.md). Resumen: build con `Dockerfile`
(Node) + **volumen en `/data`** + variables `ADMIN_USER`/`ADMIN_PASS`/`SESSION_SECRET` + dominio
en puerto 80. **El volumen es obligatorio** (sin él se pierden las fotos en cada redeploy).

## Editor de textos de la ficha
La ficha trae un editor de textos in-page (`?admin` + `ADMIN_KEY` dentro de `ficha.html`, hoy
`element2026` — cámbiala). Los textos editados se guardan en `localStorage`; para publicarlos a
todos, el siguiente paso es enviarlos también por `PUT /api/config` (mejora futura).

## Estructura
```
Element entalles/
├── server/                  (backend Node: server.js, package.json)
├── index.html · catalogo.html · ficha.html        (sitio público)
├── login.html · panel.html · admin-fichas.html · admin-catalogo.html  (panel)
├── admin-auth.js · element-backend.js             (conexión al backend, las mantiene el repo)
├── build.py                 (regenera el sitio desde un export + inyecta el backend)
├── Dockerfile               (imagen Node para Easypanel)
├── README.md · DEPLOY-EASYPANEL.md
└── assets/                  (logo, fotos, giros 360°, colores, catálogo)
```

## Design tokens
- Fondo `#0a0a0a` · superficies `#161616` · líneas `#262626`–`#333`
- Texto `#f5f5f5` · secundario `#8a8a8a` · acento (lima) `#cbe83a` (tinta `#0a0a0a`)
- Acento por entalle: Baggy `#cbe83a` · Oversize `#d9a06c` · Flare `#e85d9b` · Mom `#5bc0a8`
  · Regular `#5b8cf5` · Semipitillo `#b88cf0` · Pitillo `#ff7a59` · Skinny `#ff5470`
- Tipografías (Google Fonts): Archivo / Archivo Black, JetBrains Mono · Radios 14–16px / 99px

## Mejoras futuras
1. Publicar también los **textos** de la ficha al servidor (hoy van por `localStorage`).
2. Respaldo automático del volumen `/data` (config + media).
3. Lazy-loading de las imágenes 360° para acelerar la 1ª carga.
