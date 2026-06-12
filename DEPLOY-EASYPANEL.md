# Desplegar en Easypanel (con backend)

El sitio ahora es un **servicio Node** (Express) que sirve la web **y** guarda el contenido del
panel (fotos + config) en un **volumen persistente** `/data`. Easypanel construye con el
`Dockerfile`. Easypanel ya está conectado a GitHub (repo `angelous0/element-entalles`).

## ⚠️ 2 pasos OBLIGATORIOS la primera vez (si no, no funciona bien)

### 1) Volumen persistente en `/data`  ← sin esto se pierden las fotos en cada redeploy
Easypanel → tu servicio `web_element_entalles` → pestaña **Mounts / Volúmenes** → **Add Volume**:
- **Type:** Volume
- **Name:** `element-data`  (o el que quieras)
- **Mount Path:** `/data`
- Guardar.

### 2) Variables de entorno (el login del panel)
Easypanel → servicio → **Entorno / Environment** → pega estas 3 (cambia los valores):
```
ADMIN_USER=tu_usuario
ADMIN_PASS=una_clave_larga_y_secreta
SESSION_SECRET=otra_cadena_larga_aleatoria_distinta
```
- `ADMIN_USER` / `ADMIN_PASS` → con eso entras al panel en `/admin`.
- `SESSION_SECRET` → firma las sesiones; ponla larga y aleatoria (no la compartas).
- Guardar.

## Implementar
1. **Source:** GitHub → `angelous0/element-entalles`, rama `main`.
2. **Build:** Dockerfile.
3. **Implementar.** Mira **Implementaciones**: el build hace `npm install` y termina en *success*.
4. **Dominios:** tu dominio con **Port = 80** (ya lo tienes con SSL).

## Probar que quedó bien
- Abre `https://tudominio.com/admin` → entra con `ADMIN_USER`/`ADMIN_PASS`.
- En el panel de Fichas sube una foto a un entalle y dale **Publicar**.
- Abre esa ficha en el **celular con otra red (o incógnito)** → debe verse la foto.
  Si se ve desde otro dispositivo, el backend está guardando bien (ya no es solo tu navegador).

## Cómo funciona el contenido ahora
- El panel sube las imágenes al servidor (se **optimizan a WebP**, máx 2000px, y **sobreescriben**
  la anterior del mismo lugar — no se acumulan). La config se guarda en `/data/config.json`.
- Las páginas públicas (inicio/ficha/catálogo) leen esa config del servidor → **todos** ven lo
  publicado al instante, sin generar ni subir archivos a mano.
- Si aún no has publicado nada, el sitio muestra el contenido por defecto (catálogo de 8 páginas,
  fichas base). Nada queda vacío.

## Actualizar el diseño (igual que antes)
Cuando exportes una versión nueva del diseño:
```bash
python3 build.py                 # toma el zip más reciente de Descargas
git add -A && git commit -m "Actualizar diseño" && git push
```
`build.py` reconecta el backend solo (inyecta `element-backend.js` y deja `admin-auth.js` del repo).
Easypanel redespliega. **El volumen `/data` no se toca: tus fotos publicadas se mantienen.**

## Respaldo (opcional)
Tus fotos y config viven en el volumen `/data`. Para respaldar, copia `/data` desde Easypanel
(o desde el servidor): `config.json` + carpeta `media/`.

## Notas
- Local: `cd server && npm install && SITE_DIR=.. DATA_DIR=./data PORT=8090 ADMIN_PASS=test node server.js` → http://localhost:8090
- El login del panel ahora es **real** (clave en el servidor, no en el código).
