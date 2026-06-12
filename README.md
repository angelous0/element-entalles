# Element Premium — Sitio de entalles + panel con login

Sitio estático de la marca de denim **Element Premium** (Perú). Listo para abrir en el
navegador o desplegar en cualquier hosting estático (Easypanel/Nginx, Cloudflare Pages, Netlify…).

Se arma desde el export del diseño con [`build.py`](build.py): renombra los archivos a *slugs*
limpios y reescribe los enlaces internos. Las imágenes viven como archivos en `assets/`
(versión liviana: páginas chicas + imágenes cacheables, sin datos incrustados).

## Páginas

| Archivo | Rol | URL pública |
|---|---|---|
| `index.html` | Landing: los 8 entalles, galería 360° y paleta | `/` |
| `catalogo.html` | Catálogo de temporada (libro / feed móvil) | `/catalogo` |
| `ficha.html` | Ficha técnica por entalle (vía `#hash` o ruta) | `/baggy`, `/oversize`, … |
| `login.html` | **Acceso al panel** (usuario/clave) | `/admin`, `/login` |
| `panel.html` | **Hub del panel**: elige qué editar | `/panel` |
| `admin-fichas.html` | Panel: fotos, color de acento, colores y entalles | (desde el hub) |
| `admin-catalogo.html` | Panel: páginas del catálogo | (desde el hub) |
| `admin-auth.js` | Lógica de sesión compartida del panel | — |

Entalles: **Baggy, Oversize, Flare, Mom, Regular, Semipitillo, Pitillo, Skinny** (+ los que
agregues desde el panel).

## El panel y su login

Flujo: **`/admin` → Login → Panel → Fichas / Catálogo**.

- **Login** (`login.html`): usuario **`admin`**, clave **`element`**. La sesión dura 12 h y se
  guarda en `localStorage` (`element_admin_session_v1`). Las credenciales están en `admin-auth.js`.
- **Panel de fichas** (`admin-fichas.html`), por entalle:
  - Foto principal + hasta 3 fotos de detalle.
  - Color de acento.
  - Colores disponibles (Versión Color / Versión Negra), con foto real de cada color (📷).
  - **Editar lista** de colores (renombrar / agregar / eliminar).
  - **Agregar entalles nuevos** (botón “+ Entalle”).
  - **Publicar**: pasa el borrador a “publicado”. **Vista previa** abre `ficha.html?preview`
    para ver el borrador antes de publicar.

> ⚠️ **Importante (almacenamiento).** Todo el panel guarda en el `localStorage` del navegador
> (`element_fichas_config_v1` borrador, `element_fichas_published_v1` publicado). **No viaja al
> servidor**: los cambios solo se ven en el equipo donde editas. Para que lleguen a todos los
> visitantes hace falta el backend (ver “Mejoras futuras”).

### Proteger el panel de verdad
El login del navegador es de **nivel UX** (su usuario/clave viven en `admin-auth.js`, visibles
para quien mire el código; el guard es JS, evitable). Como todo el panel solo escribe en el
`localStorage` del visitante, el riesgo hoy es bajo. Aun así, para producción conviene un
**candado de servidor** sobre `/admin`, `/login`, `/panel` y los `.html` del panel:
- En `nginx.conf` ya hay un bloque `auth_basic` **comentado** — descoméntalo y crea las
  credenciales: `htpasswd -nB usuario` → pégalas en [`.htpasswd`](.htpasswd).
- O usa **Cloudflare Access** delante de esas rutas.

## Editor de textos de la ficha
Aparte del panel, la ficha trae un editor de textos in-page: con `?admin` (o ruta `…/admin`) y la
clave `ADMIN_KEY` los textos se vuelven editables. Hoy es **`element2026`** dentro de `ficha.html`
— cámbiala antes de publicar. (Con `?preview`/`?admin` la ficha muestra el borrador sin publicar.)

## Actualizar el sitio cuando renueves el diseño
Cuando exportes una nueva versión desde Claude Design:
```bash
cd "Element entalles"
python3 build.py "/ruta/al/nuevo-export.zip"   # o sin argumento si es el zip por defecto
```
Regenera los `.html`, los `.js` y `assets/` con los nombres y enlaces limpios. No toca
`Dockerfile`, `nginx.conf`, `_redirects`, `README*` ni `build.py`.

## Verlo en local
```bash
cd "Element entalles"
python3 -m http.server 8080      # abre http://localhost:8080
```
Los enlaces internos ya usan `.html`, así que navegar funciona. Las rutas limpias (`/admin`,
`/baggy`…) son del servidor (nginx/Cloudflare); en local usa los `.html`.

## Despliegue
Guía paso a paso para **Easypanel**: [`DEPLOY-EASYPANEL.md`](DEPLOY-EASYPANEL.md).
Resumen: Easypanel construye con el [`Dockerfile`](Dockerfile) (Nginx) → agrega tu dominio
(puerto 80) → SSL automático. El [`nginx.conf`](nginx.conf) configura las URLs limpias.
Para Cloudflare Pages/Netlify, [`_redirects`](_redirects) hace lo mismo.

## Estructura
```
Element entalles/
├── index.html · catalogo.html · ficha.html        (sitio público)
├── login.html · panel.html                         (entrada + hub del panel)
├── admin-fichas.html · admin-catalogo.html         (paneles)
├── admin-auth.js                                   (sesión del panel)
├── build.py            (regenera todo desde un export del diseño)
├── Dockerfile · nginx.conf · .htpasswd             (deploy en Easypanel/Nginx)
├── _redirects          (deploy en Cloudflare Pages / Netlify)
├── README.md · DEPLOY-EASYPANEL.md
└── assets/             (logo, fotos, giros 360°, colores, catálogo, video)
```

## Design tokens
- Fondo `#0a0a0a` · superficies `#161616` · líneas `#262626`–`#333`
- Texto `#f5f5f5` · secundario `#8a8a8a` · acento (lima) `#cbe83a` (tinta `#0a0a0a`)
- Acento por entalle: Baggy `#cbe83a` · Oversize `#d9a06c` · Flare `#e85d9b` · Mom `#5bc0a8`
  · Regular `#5b8cf5` · Semipitillo `#b88cf0` · Pitillo `#ff7a59` · Skinny `#ff5470`
- Tipografías (Google Fonts): Archivo / Archivo Black, JetBrains Mono · Radios 14–16px / 99px

## Mejoras futuras
1. **Backend del panel** — subir imágenes a un bucket + servir la config como JSON, para que lo
   publicado llegue a todos los visitantes (hoy queda en el navegador) y el login sea real.
2. Incrustar la config publicada en el HTML (`window.ELEMENT_FICHAS_CFG`) al publicar.
3. Lazy-loading de las imágenes 360° (ya son archivos en `assets/`) para acelerar la 1ª carga.
