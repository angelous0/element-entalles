/* ============================================================================
   Element Premium — backend
   - Sirve el sitio estatico (carpeta ./public)
   - API: login (cookie de sesion), config publicada, subida de imagenes
   - Guarda datos en un VOLUMEN persistente /data  (config.json + media/)
   - Inyecta la config publicada en ficha.html y catalogo.html al servirlas
   ============================================================================ */
'use strict';
const express = require('express');
const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp  = require('sharp');

// ---- config por entorno ----------------------------------------------------
const PORT      = parseInt(process.env.PORT || '80', 10);
const SITE_DIR  = process.env.SITE_DIR || path.join(__dirname, 'public');
const DATA_DIR  = process.env.DATA_DIR || '/data';
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = process.env.ADMIN_PASS || 'element';
const SECRET     = process.env.SESSION_SECRET || 'dev-insecure-change-me';
const TTL_MS     = 12 * 60 * 60 * 1000; // 12 h

// entalles base (para rutas limpias /baggy, /oversize, ...)
const DEFAULT_FITS = ['baggy','oversize','flare-slim','flare-relax','mom','regular','semipitillo','pitillo','skinny'];

// ---- preparar /data --------------------------------------------------------
try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); }
catch (e) { console.error('[ERROR] No pude crear', MEDIA_DIR, '-', e.message); }
try { fs.accessSync(DATA_DIR, fs.constants.W_OK); }
catch { console.warn('\n[ADVERTENCIA] ' + DATA_DIR + ' NO es escribible.\n  Monta un VOLUMEN persistente en /data o las fotos subidas se perderan en cada redeploy.\n'); }

// ---- helpers de sesion (cookie firmada HMAC, sin dependencias) --------------
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac  = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return (p.exp > Date.now()) ? p : null; }
  catch { return null; }
}
function readCookie(req, name) {
  const h = req.headers.cookie || '';
  const m = h.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function currentUser(req) { const p = verifyToken(readCookie(req, 'el_sess')); return p ? p.user : null; }
function requireAuth(req, res, next) { if (!currentUser(req)) return res.status(401).json({ error: 'no-auth' }); next(); }
// comparacion en tiempo constante e independiente de longitud
function safeEqual(a, b) {
  const ha = crypto.createHmac('sha256', SECRET).update(String(a)).digest();
  const hb = crypto.createHmac('sha256', SECRET).update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---- app -------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

// ---------- API: auth ----------
app.post('/api/login', (req, res) => {
  const user = String((req.body && req.body.user) || '').trim();
  const pass = String((req.body && req.body.pass) || '');
  const ok = safeEqual(user.toLowerCase(), ADMIN_USER.toLowerCase()) && safeEqual(pass, ADMIN_PASS);
  if (!ok) return res.status(401).json({ error: 'bad-credentials' });
  const token = signToken({ user: ADMIN_USER, exp: Date.now() + TTL_MS });
  const secure = req.headers['x-forwarded-proto'] === 'https' ? ' Secure;' : '';
  const base = `Path=/; Max-Age=${Math.floor(TTL_MS/1000)}; SameSite=Lax;${secure}`;
  res.setHeader('Set-Cookie', [
    `el_sess=${encodeURIComponent(token)}; HttpOnly; ${base}`,
    `el_auth=1; ${base}`,
    `el_user=${encodeURIComponent(ADMIN_USER)}; ${base}`
  ]);
  res.json({ ok: true, user: ADMIN_USER });
});
app.get('/api/session', (req, res) => res.json({ user: currentUser(req) }));
app.post('/api/logout', (req, res) => {
  const clear = 'Path=/; Max-Age=0; SameSite=Lax';
  res.setHeader('Set-Cookie', [`el_sess=; HttpOnly; ${clear}`, `el_auth=; ${clear}`, `el_user=; ${clear}`]);
  res.json({ ok: true });
});

// ---------- API: config publicada ----------
async function loadConfig() {
  try { return JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
app.get('/api/config', async (_req, res) => {
  try { res.type('application/json').send(await fsp.readFile(CONFIG_FILE, 'utf8')); }
  catch { res.json({}); }
});
app.put('/api/config', requireAuth, async (req, res) => {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(CONFIG_FILE, JSON.stringify(req.body || {}), 'utf8');
    res.json({ ok: true, at: Date.now() });
  } catch (e) { res.status(500).json({ error: 'write-failed', detail: e.message }); }
});

// ---------- API: imagenes (optimiza + sobreescribe por slot) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
function safeSlot(raw) {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/\.\.+/g, '')              // sin ".."
    .replace(/[^a-zA-Z0-9_\-/]/g, '')   // solo chars seguros
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}
app.post('/api/media', requireAuth, upload.single('file'), async (req, res) => {
  const slot = safeSlot(req.query.slot);
  if (!slot || !req.file) return res.status(400).json({ error: 'bad-request' });
  const outAbs = path.join(MEDIA_DIR, slot + '.webp');
  if (!outAbs.startsWith(MEDIA_DIR + path.sep)) return res.status(400).json({ error: 'bad-slot' });
  try {
    await fsp.mkdir(path.dirname(outAbs), { recursive: true });
    await sharp(req.file.buffer)
      .rotate()
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(outAbs);
    // version en la URL: al reemplazar una foto cambia la URL -> rompe el cache del navegador
    res.json({ ok: true, url: '/media/' + slot + '.webp?v=' + Date.now() });
  } catch (e) { res.status(500).json({ error: 'image-failed', detail: e.message }); }
});
app.delete('/api/media', requireAuth, async (req, res) => {
  const slot = safeSlot(req.query.slot);
  const outAbs = path.join(MEDIA_DIR, slot + '.webp');
  if (!outAbs.startsWith(MEDIA_DIR + path.sep)) return res.status(400).json({ error: 'bad-slot' });
  try { await fsp.unlink(outAbs); } catch {}
  res.json({ ok: true });
});

// servir las imagenes subidas
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', fallthrough: true }));

// ---------- paginas con config inyectada ----------
function injectGlobals(html, vars) {
  let js = '<script>';
  for (const [k, v] of Object.entries(vars)) {
    js += 'window.' + k + '=' + JSON.stringify(v).replace(/</g, '\\u003c') + ';';
  }
  js += '</script>';
  return html.replace('</head>', js + '</head>');
}
async function serveFicha(_req, res) {
  try {
    const cfg = await loadConfig();
    const html = await fsp.readFile(path.join(SITE_DIR, 'ficha.html'), 'utf8');
    res.set('Cache-Control', 'no-cache'); // siempre la config publicada mas reciente
    res.type('html').send(injectGlobals(html, { ELEMENT_FICHAS_CFG: cfg.fichas || {} }));
  } catch (e) { res.status(500).send('ficha error: ' + e.message); }
}
async function serveCatalogo(_req, res) {
  try {
    const cfg = await loadConfig();
    const pages = (cfg.catalog && Array.isArray(cfg.catalog.pages)) ? cfg.catalog.pages : null;
    const html = await fsp.readFile(path.join(SITE_DIR, 'catalogo.html'), 'utf8');
    res.set('Cache-Control', 'no-cache'); // siempre el catalogo publicado mas reciente
    res.type('html').send(injectGlobals(html, { ELEMENT_CATALOG: pages }));
  } catch (e) { res.status(500).send('catalogo error: ' + e.message); }
}

// rutas explicitas (antes que el estatico)
app.get(['/catalogo', '/catalogo.html'], serveCatalogo);
app.get('/ficha.html', serveFicha);
app.get(['/admin', '/login'], (_req, res) => res.sendFile(path.join(SITE_DIR, 'login.html')));
app.get('/panel', (_req, res) => res.sendFile(path.join(SITE_DIR, 'panel.html')));
app.get('/flare', (_req, res) => res.redirect(302, '/flare-slim')); // URL vieja -> nueva

// rutas limpias por entalle (/baggy, /oversize, ... + entalles personalizados de la config)
app.get('/:slug', async (req, res, next) => {
  const slug = req.params.slug;
  if (slug.indexOf('.') >= 0) return next();        // es un archivo -> estatico
  const fits = new Set(DEFAULT_FITS);
  try { const cfg = await loadConfig(); Object.keys(cfg.fichas || {}).forEach(k => { if (k[0] !== '_') fits.add(k); }); } catch {}
  if (fits.has(slug)) return serveFicha(req, res);
  next();
});

// ---------- sitio estatico ----------
app.use(express.static(SITE_DIR, { index: 'index.html', extensions: false }));
app.get('/', (_req, res) => res.sendFile(path.join(SITE_DIR, 'index.html')));

app.listen(PORT, () => {
  console.log(`Element backend escuchando en :${PORT}`);
  console.log(`  sitio:  ${SITE_DIR}`);
  console.log(`  datos:  ${DATA_DIR}  (config + media)`);
  console.log(`  admin:  usuario "${ADMIN_USER}"  ${process.env.ADMIN_PASS ? '' : '(clave por defecto: cambia ADMIN_PASS)'}`);
});
