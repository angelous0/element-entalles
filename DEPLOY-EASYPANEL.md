# Desplegar en Easypanel

El sitio trae todo lo necesario: `Dockerfile` + `nginx.conf` (URLs limpias + entrada al panel).
Easypanel construye la imagen y Traefik le pone el SSL.

## Antes de publicar (checklist)
1. **Cambia la clave del login del panel.** Está en `admin-auth.js` (`DEMO_USER='admin'`,
   `DEMO_PASS='element'`). Ese login es de nivel UX.
2. **(Recomendado) Candado real del servidor.** Para que el panel no quede abierto al público,
   descomenta el bloque `auth_basic` de `nginx.conf` y crea las credenciales:
   `htpasswd -nB miusuario` → pega la línea en `.htpasswd`. (Alternativa: Cloudflare Access.)
3. **Cambia `ADMIN_KEY`** del editor de textos dentro de `ficha.html` (hoy `element2026`).

## Opción A — vía GitHub (recomendada)
1. Sube esta carpeta a un repo en GitHub (incluyendo `Dockerfile`, `nginx.conf`, `admin-auth.js`,
   `assets-data.js` y `assets/`).
2. En Easypanel: **+ Service → App**.
3. **Source:** GitHub → elige el repo y la rama.
4. **Build:** **Dockerfile** (Easypanel lo detecta solo).
5. **Deploy.** Luego en la pestaña **Domains** del servicio:
   - Agrega tu dominio o subdominio con **Port = 80**.
   - Apunta el DNS (registro **A**) de ese dominio a la IP del VPS.
   - Easypanel emite el certificado **Let's Encrypt** (HTTPS) automáticamente.
6. Listo: tienda en `/`, fichas en `/baggy` `/oversize`…, panel en `/admin`.

> Cada `git push` vuelve a desplegar (si activas auto-deploy).

## Opción B — sin GitHub (imagen Docker)
```bash
docker build -t TU_REGISTRY/element:latest .
docker push  TU_REGISTRY/element:latest
```
En Easypanel: **App → Source: Docker Image →** `TU_REGISTRY/element:latest`. Domains = puerto 80.

## Probar la imagen en tu máquina (opcional)
```bash
docker build -t element .
docker run --rm -p 8099:80 element     # abre http://localhost:8099
```
Rutas a probar: `/`, `/catalogo`, `/baggy`, `/admin` (login → panel).

## Actualizar tras renovar el diseño
```bash
python3 build.py "/ruta/al/nuevo-export.zip"
git add -A && git commit -m "Actualizar diseño" && git push   # si usas la Opción A
```

## Notas
- `_redirects` es solo para Cloudflare Pages/Netlify; **en Easypanel manda `nginx.conf`**.
- El panel guarda en el navegador (`localStorage`), no en el servidor: sirve para preparar y
  previsualizar, pero lo “publicado” no llega solo a todos los visitantes. Para eso hace falta el
  backend (ver `README.md` → “Mejoras futuras”).
