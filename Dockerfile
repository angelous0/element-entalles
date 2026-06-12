# Sitio estatico Element Premium servido con Nginx (listo para Easypanel)
FROM nginx:alpine

# Config del servidor: URLs limpias + entrada al panel
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Credenciales para el candado OPCIONAL del servidor (ver nginx.conf / README)
COPY .htpasswd /etc/nginx/.htpasswd

# Recursos
COPY assets /usr/share/nginx/html/assets

# Paginas + scripts (publico + panel con login). Glob = robusto a cambios del set de archivos.
COPY *.html *.js /usr/share/nginx/html/

EXPOSE 80
