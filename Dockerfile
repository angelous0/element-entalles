# Element Premium — backend Node (sirve el sitio + API del panel). Listo para Easypanel.
FROM node:20-bookworm-slim
WORKDIR /app

# dependencias (capa cacheable)
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

# servidor
COPY server/server.js ./

# sitio estatico -> ./public  (HTML/JS de la raiz + assets/)
COPY *.html *.js ./public/
COPY assets ./public/assets

ENV NODE_ENV=production PORT=80 DATA_DIR=/data
EXPOSE 80

# /data debe ser un VOLUMEN persistente en Easypanel (config + imagenes subidas)
VOLUME ["/data"]

CMD ["node", "server.js"]
