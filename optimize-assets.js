/* optimize-assets.js — optimiza las imagenes de assets/ para web.
   - Los frames/cortes 360 (PNG bajo assets/fits/) -> WebP (resize, transparencia).
   - JPGs grandes (catalogo) -> recomprime manteniendo .jpg.
   - No toca: SVG (iconos), assets/logo-element.png, JPGs ya chicos, video.
   build.py lo ejecuta tras copiar assets/, y luego reescribe las refs .png->.webp.
   Requiere sharp (server/node_modules). Si falla, build.py deja las imagenes en PNG. */
'use strict';
const sharp = require('./server/node_modules/sharp');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, 'assets');
const MAXEDGE_FRAME = 1200;   // lado mayor de los frames 360
const MAXEDGE_JPG   = 1600;   // lado mayor de fotos jpg grandes
const JPG_MIN_BYTES = 400 * 1024;

async function processFile(p) {
  const lower = p.toLowerCase();
  const ext = lower.split('.').pop();
  const underFits = lower.includes(path.sep + 'fits' + path.sep);
  try {
    if (ext === 'png' && underFits) {
      const out = p.replace(/\.png$/i, '.webp');
      const buf = await sharp(p)
        .rotate()  // aplica la orientacion EXIF (foto parada) antes de redimensionar
        .resize(MAXEDGE_FRAME, MAXEDGE_FRAME, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, alphaQuality: 88, effort: 5 })
        .toBuffer();
      fs.writeFileSync(out, buf);
      if (out !== p) { try { fs.unlinkSync(p); } catch (e) {} }
      return true;
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      const st = fs.statSync(p);
      if (st.size <= JPG_MIN_BYTES) return false;
      const buf = await sharp(p)
        .rotate()  // aplica la orientacion EXIF (foto parada) antes de redimensionar
        .resize(MAXEDGE_JPG, MAXEDGE_JPG, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      if (buf.length < st.size) { fs.writeFileSync(p, buf); return true; }
    }
  } catch (e) { console.warn('  skip ' + path.relative(__dirname, p) + ': ' + e.message); }
  return false;
}

async function walk(dir) {
  let count = 0;
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) count += await walk(p);
    else if (await processFile(p)) count++;
  }
  return count;
}

if (!fs.existsSync(ASSETS)) { console.log('  (no hay assets/)'); process.exit(0); }
walk(ASSETS).then(n => console.log('  optimizadas ' + n + ' imagenes')).catch(e => { console.error(e); process.exit(1); });
