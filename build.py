#!/usr/bin/env python3
"""
build.py — convierte un export de Claude Design (zip o carpeta) en el sitio
desplegable de Element Premium: renombra a slugs limpios y reescribe los
enlaces internos. Reejecutable cada vez que renueves el diseño.

Robusto a la estructura del export: encuentra los archivos por nombre aunque
estén en la raíz, en deploy/ o en pagana-web-entalles/project/… (prefiere deploy/).
assets-data.js es opcional (las versiones nuevas ya no lo usan).

Uso:
    python3 build.py                       # toma el zip "pagana web entalles*.zip" mas reciente de ~/Downloads
    python3 build.py /ruta/al/export.zip   # usa otro zip
    python3 build.py /ruta/a/carpeta       # usa una carpeta ya extraida

Deja intactos: Dockerfile, nginx.conf, _redirects, .htpasswd, README*, DEPLOY*, build.py.
"""
import sys, os, glob, zipfile, unicodedata, shutil, subprocess, re

HERE = os.path.dirname(os.path.abspath(__file__))

# nombre original (NFC) -> archivo de salida con slug limpio
FILE_MAP = {
    "Inicio - Element Premium.html":          "index.html",
    "Catálogo - Element Premium.html":         "catalogo.html",
    "Ficha Entalles - Element Premium.html":  "ficha.html",
    "Admin Fichas - Element Premium.html":    "admin-fichas.html",
    "Admin Catálogo - Element Premium.html":  "admin-catalogo.html",
    "Login - Element Premium.html":           "login.html",
    "Panel Admin - Element Premium.html":     "panel.html",
}
JS_OPTIONAL = ["assets-data.js"]    # se copia tal cual SI existe (puede no estar)

# Archivos que mantiene el REPO (NO se copian del export): la version del backend.
#   admin-auth.js      -> control de sesion respaldado por el servidor
#   element-backend.js -> puente paneles<->backend (inyectado en los paneles)
REPO_KEPT = ["admin-auth.js", "element-backend.js", "ficha-publish.js"]

# Paginas del panel donde se inyecta element-backend.js (en el <head>)
PANELS = {"login.html", "panel.html", "admin-fichas.html", "admin-catalogo.html"}

def post_process(outname, html):
    """Inyecta la conexion al backend sin tocar el codigo generado por el disenador."""
    # 1) paneles: cargar element-backend.js
    if outname in PANELS and "element-backend.js" not in html:
        html = html.replace("</head>", '  <script src="element-backend.js"></script>\n</head>', 1)
    # 2) catalogo publico: que prefiera el catalogo del servidor (window.ELEMENT_CATALOG),
    #    dejando las paginas estaticas como fallback.
    if outname == "catalogo.html" and "window.ELEMENT_CATALOG" not in html:
        html = html.replace(
            "const PAGES = [",
            "const PAGES = (window.ELEMENT_CATALOG && window.ELEMENT_CATALOG.length) ? window.ELEMENT_CATALOG : [",
            1)
    # 3) panel de catalogo: el boton ahora PUBLICA (lo maneja element-backend.js)
    if outname == "admin-catalogo.html":
        html = html.replace("Generar y descargar", "Publicar")
    # 4) renombrar la clave del entalle "Flare Slim": flare -> flare-slim (URL /flare-slim).
    #    OJO: no tocar 'flare-relax', 'flare-360', 'flare-cut' ni el texto descriptivo.
    if outname == "index.html":
        html = html.replace("'flare'", "'flare-slim'")          # key:'flare' -> key:'flare-slim'
    if outname == "ficha.html":
        html = html.replace("flare:", "'flare-slim':")          # 2 claves de objeto
        html = html.replace("'flare'", "'flare-slim'")          # fit:'flare' y refs
        # Fotos de detalle: ignorar las "por defecto" (DEFAULT_MEDIA, p.ej. las 3 del Baggy)
        # y ocultar la tira cuando no hay fotos reales (las que se suben por el panel SI salen).
        html = html.replace(
            "const details = ecfg.details || dm.details || [];",
            "const details = ecfg.details || [];\n    var _strip = document.getElementById('thumbs'); if (_strip) _strip.style.display = details.length ? '' : 'none';")
        # editor de textos conectado al backend (publica al guardar, en modo admin)
        if "ficha-publish.js" not in html:
            html = html.replace("</head>", '  <script src="ficha-publish.js"></script>\n</head>', 1)
        # Fotos de color POR ENTALLE: el diseno aplicaba cfg._pal global a MASTER (se veian
        # iguales en todos los entalles). Cada entalle tiene su propia foto en cfg[ent].pal;
        # sincronizamos MASTER.img segun el entalle actual al renderizar los colores.
        html = html.replace(
            "  // Fotos de colores personalizadas (subidas desde el panel Admin Fichas)\n"
            "  const PAL_OV = fichasCfg._pal || {};\n"
            "  Object.keys(PAL_OV).forEach(id => { if (MASTER[id]) MASTER[id].img = PAL_OV[id]; });",
            "  // Fotos de colores personalizadas (subidas desde el panel Admin Fichas).\n"
            "  // POR ENTALLE: cada entalle tiene su propia foto por color (fichasCfg[ent].pal).\n"
            "  // _pal global queda solo como compatibilidad con publicaciones viejas.\n"
            "  // MASTER comparte referencias con colorData, así que sincronizamos .img según el entalle actual.\n"
            "  function applyColorPhotos(){\n"
            "    const ent = fichasCfg[currentFitKey] || {};\n"
            "    const entPal = ent.pal || {};\n"
            "    const glob = fichasCfg._pal || {};\n"
            "    Object.keys(MASTER).forEach(id => { MASTER[id].img = entPal[id] || glob[id] || null; });\n"
            "  }\n"
            "  applyColorPhotos();")
        if "applyColorPhotos();   // sincroniza" not in html:
            html = html.replace(
                "  function renderColors(fam){\n    currentFam = fam;",
                "  function renderColors(fam){\n    currentFam = fam;\n    applyColorPhotos();   // sincroniza las fotos de color al entalle actual (cada uno tiene las suyas)")
        # Paleta personalizada: la ficha usaba solo los colores "quemados" del diseño, así que
        # los colores que el dueño crea/renombra en el panel (_palMeta, ids c-xxxx) no aparecían.
        # Integramos _palMeta a colorData + MASTER.
        if "(ids c-xxxx que el diseño base no conoce)" not in html:
            html = html.replace(
                "  const MASTER = {};\n"
                "  ['color','negra'].forEach(fam => {\n"
                "    [...colorData[fam].featured, ...colorData[fam].extras].forEach(c => { MASTER[c.id] = c; });\n"
                "  });",
                "  const MASTER = {};\n"
                "  ['color','negra'].forEach(fam => {\n"
                "    [...colorData[fam].featured, ...colorData[fam].extras].forEach(c => { MASTER[c.id] = c; });\n"
                "  });\n"
                "  // Paleta personalizada publicada desde el panel (_palMeta): el dueño pudo renombrar,\n"
                "  // agregar o quitar colores (ids c-xxxx que el diseño base no conoce). Sin integrarla,\n"
                "  // esos colores no aparecen en la ficha. La integramos a colorData + MASTER, conservando\n"
                "  // los datos del diseño (c2/sub/desc) cuando el id coincide.\n"
                "  if (fichasCfg._palMeta) ['color','negra'].forEach(fam => {\n"
                "    const list = fichasCfg._palMeta[fam];\n"
                "    if (!Array.isArray(list) || !list.length) return;\n"
                "    const built = list.map(pc => {\n"
                "      const base = MASTER[pc.id] || {};\n"
                "      const m = Object.assign({ c2: pc.hex || '#888888', sub: '', desc: '' }, base,\n"
                "        { id: pc.id, name: pc.name || base.name || pc.id, hex: pc.hex || base.hex || '#888888' });\n"
                "      if (!m.c2) m.c2 = m.hex;\n"
                "      MASTER[pc.id] = m;\n"
                "      return m;\n"
                "    });\n"
                "    colorData[fam] = { featured: built.slice(0, 6), extras: built.slice(6) };\n"
                "  });")
    # 5) panel de fichas: su lista de entalles seguia con "Flare" (uno). Ahora son dos:
    #    Flare Slim + Flare Relax (igual que el inicio/ficha).
    if outname == "admin-fichas.html":
        html = html.replace(
            "{key:'flare',name:'Flare',sig:'#e85d9b'},",
            "{key:'flare-slim',name:'Flare Slim',sig:'#e85d9b'},\n    {key:'flare-relax',name:'Flare Relax',sig:'#c95ba0'},")
        # Distinguir de un vistazo los dos bloques: Versión Color (acento lima) vs Negra (oscuro).
        if "el-fam-distinct" not in html:
            html = html.replace(
                "  .fam-head .editlist:hover{border-color:var(--accent)}",
                "  .fam-head .editlist:hover{border-color:var(--accent)}\n"
                "  /* el-fam-distinct: distinguir de un vistazo Versión Color (acento lima) vs Versión Negra (oscuro) */\n"
                "  .fam-block:has([data-all=\"color\"]){border-left:3px solid var(--accent);padding-left:12px;border-radius:0 6px 6px 0;background:linear-gradient(90deg,rgba(203,232,58,.06),transparent 55%)}\n"
                "  .fam-block:has([data-all=\"negra\"]){border-left:3px solid #6a6a6a;padding-left:12px;border-radius:0 6px 6px 0;background:linear-gradient(90deg,rgba(255,255,255,.05),transparent 55%)}\n"
                "  .fam-block:has([data-all=\"color\"]) .fam-head .lbl{color:var(--accent)}\n"
                "  .fam-block:has([data-all=\"negra\"]) .fam-head .lbl{color:#cfcfcf}\n"
                "  .fam-block:has([data-all=\"color\"]) .fam-head .lbl::before{content:'';display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:8px;vertical-align:-1px;background:var(--accent)}\n"
                "  .fam-block:has([data-all=\"negra\"]) .fam-head .lbl::before{content:'';display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:8px;vertical-align:-1px;background:#0d0d0d;border:1px solid #6a6a6a}")
        # Fotos de color POR ENTALLE (el diseno las guardaba globales en cfg._pal -> se veian
        # iguales en TODOS los entalles). Cada entalle guarda las suyas en cfg[ent].pal.
        html = html.replace(
            "subes la foto real de cada color (se usa en todas las fichas).",
            "subes la foto real de cada color para <b style=\"color:var(--text);font-weight:600\">este entalle</b> (cada entalle tiene sus propias fotos).")
        html = html.replace(
            "  // ===== fotos de la paleta de colores (globales: se usan en todos los entalles) =====",
            "  // ===== fotos de la paleta de colores (POR ENTALLE: cada entalle tiene las suyas) =====")
        html = html.replace(
            "if(d){ cfg._pal = cfg._pal || {}; cfg._pal[palTarget] = d; save(); renderColorLists(); toast('Foto del color guardada'); }",
            "if(d){ const c=entCfg(cur); c.pal=c.pal||{}; c.pal[palTarget]=d; save(); renderColorLists(); toast('Foto del color guardada'); }")
        html = html.replace(
            "    const c=entCfg(cur); c.colors=c.colors||{};\n    const pal = cfg._pal || {};",
            "    const c=entCfg(cur); c.colors=c.colors||{};\n    const pal = c.pal || {};")
        html = html.replace(
            "        if(cfg._pal){ delete cfg._pal[b.dataset.camx]; if(!Object.keys(cfg._pal).length) delete cfg._pal; }",
            "        const cp=entCfg(cur).pal; if(cp){ delete cp[b.dataset.camx]; if(!Object.keys(cp).length) delete entCfg(cur).pal; }")
        html = html.replace(
            "    cfg._palMeta[fam].splice(i,1);\n"
            "    if(cfg._pal && cfg._pal[id]){ delete cfg._pal[id]; if(!Object.keys(cfg._pal).length) delete cfg._pal; }\n"
            "    Object.keys(cfg).forEach(k=>{ if(k[0]==='_') return; const cc=cfg[k]; if(cc && cc.colors && cc.colors[fam]){ cc.colors[fam]=cc.colors[fam].filter(x=>x!==id); if(!cc.colors[fam].length) delete cc.colors[fam]; } });",
            "    cfg._palMeta[fam].splice(i,1);\n"
            "    Object.keys(cfg).forEach(k=>{ if(k[0]==='_') return; const cc=cfg[k]; if(!cc) return;\n"
            "      if(cc.colors && cc.colors[fam]){ cc.colors[fam]=cc.colors[fam].filter(x=>x!==id); if(!cc.colors[fam].length) delete cc.colors[fam]; }\n"
            "      if(cc.pal && cc.pal[id]){ delete cc.pal[id]; if(!Object.keys(cc.pal).length) delete cc.pal; }\n"
            "    });")
        # Migración 1x: copia las fotos globales viejas a cada entalle y quita la global.
        if "Migración 1x: antes las fotos de color" not in html:
            html = html.replace(
                "  renderTabs(); renderPanel(); updatePubState();",
                "  // Migración 1x: antes las fotos de color eran globales (cfg._pal) y se veían igual en\n"
                "  // todos los entalles. Ahora cada entalle tiene las suyas (cfg[ent].pal). Copiamos las\n"
                "  // globales a cada entalle (como punto de partida) y quitamos la global -> ya son independientes.\n"
                "  if(cfg._pal && Object.keys(cfg._pal).length){\n"
                "    allEnt().forEach(e=>{ const c=entCfg(e.key); c.pal=c.pal||{}; Object.keys(cfg._pal).forEach(id=>{ if(c.pal[id]==null) c.pal[id]=cfg._pal[id]; }); });\n"
                "    delete cfg._pal; save();\n"
                "  }\n\n"
                "  renderTabs(); renderPanel(); updatePubState();")
        # Subida inmediata: cada foto sube al servidor al ELEGIRLA y en el navegador queda
        # solo el enlace (no la imagen entera) -> el localStorage no se llena ("Memoria llena").
        html = html.replace(
            "  heroInput.onchange=async()=>{ if(!heroInput.files[0])return; toast('Procesando…'); const d=await compress(heroInput.files[0]); if(d){ entCfg(cur).hero=d; save(); renderMedia(); toast('Foto principal lista'); } heroInput.value=''; };\n"
            "  detInput.onchange=async()=>{ if(!detInput.files[0])return; toast('Procesando…'); const d=await compress(detInput.files[0]); if(d){ const c=entCfg(cur); c.details=c.details||[]; c.details[detTarget]=d; save(); renderMedia(); toast('Detalle añadido'); } detInput.value=''; };",
            "  // Sube la imagen al servidor al instante y deja en el navegador solo el enlace corto\n"
            "  // (no la imagen entera) -> la memoria del navegador no se llena. Sin backend: queda igual.\n"
            "  async function putImg(dataURL, slot){\n"
            "    try { return (window.elementUpload) ? await window.elementUpload(dataURL, slot) : dataURL; }\n"
            "    catch(e){ toast('No se pudo subir la foto'); return dataURL; }\n"
            "  }\n"
            "  heroInput.onchange=async()=>{ if(!heroInput.files[0])return; toast('Procesando…'); const d=await compress(heroInput.files[0]); if(d){ const u=await putImg(d,'fichas/'+cur+'-hero'); entCfg(cur).hero=u; save(); renderMedia(); toast('Foto principal lista'); } heroInput.value=''; };\n"
            "  detInput.onchange=async()=>{ if(!detInput.files[0])return; toast('Procesando…'); const d=await compress(detInput.files[0]); if(d){ const c=entCfg(cur); c.details=c.details||[]; const u=await putImg(d,'fichas/'+cur+'-det-'+detTarget); c.details[detTarget]=u; save(); renderMedia(); toast('Detalle añadido'); } detInput.value=''; };")
        html = html.replace(
            "    if(d){ const c=entCfg(cur); c.pal=c.pal||{}; c.pal[palTarget]=d; save(); renderColorLists(); toast('Foto del color guardada'); }",
            "    if(d){ const c=entCfg(cur); c.pal=c.pal||{}; const u=await putImg(d,'fichas/'+cur+'-color-'+palTarget); c.pal[palTarget]=u; save(); renderColorLists(); toast('Foto del color guardada'); }")
    return html

# reescritura de enlaces: lo mas especifico primero (p.ej. "Catálogo" dentro de "Admin Catálogo")
REWRITE = [
    ("Admin Catálogo - Element Premium.html", "admin-catalogo.html"),
    ("Admin Fichas - Element Premium.html",   "admin-fichas.html"),
    ("Panel Admin - Element Premium.html",    "panel.html"),
    ("Login - Element Premium.html",          "login.html"),
    ("Ficha Entalles - Element Premium.html", "ficha.html"),
    ("Catálogo - Element Premium.html",        "catalogo.html"),
    ("Inicio - Element Premium.html",          "index.html"),
]
EXCLUDE = ('standalone', '- App', '(móvil', '(movil', '/screens/',
           '/uploads/', 'design_handoff', '.thumbnail', '__MACOSX')

def nfc(s): return unicodedata.normalize("NFC", s)
def excluded(p): return any(tok in p for tok in EXCLUDE)
def apply_rewrite(t):
    for old, new in REWRITE: t = t.replace(old, new)
    return t

class Source:
    """Resuelve archivos por nombre base; sirve para zip o carpeta."""
    def __init__(self, path):
        if path.lower().endswith(".zip"):
            self.kind="zip"; self.z=zipfile.ZipFile(path)
            self.entries=[(nfc(n), n) for n in self.z.namelist() if not n.endswith("/")]
        else:
            self.kind="dir"; self.entries=[]
            for dp,_,fs in os.walk(path):
                for f in fs:
                    full=os.path.join(dp,f)
                    self.entries.append((nfc(os.path.relpath(full,path)), full))
    def _raw(self, raw): return self.z.read(raw) if self.kind=="zip" else open(raw,"rb").read()
    def find(self, basename):
        cands=[(p,raw) for (p,raw) in self.entries
               if p.split("/")[-1]==basename and not excluded(p)]
        if not cands: return None
        # Prefiere la version de la RAIZ (export actual) sobre deploy/, que en los
        # exports completos suele quedar STALE (vieja). En los exports "lean" solo
        # existe deploy/ -> igual se usa (es el unico candidato).
        cands.sort(key=lambda pr: (1 if "deploy/" in ("/"+pr[0]) else 0, pr[0].count("/"), len(pr[0])))
        return cands[0][1]
    def read_text(self, basename):
        raw=self.find(basename); return self._raw(raw).decode("utf-8") if raw else None
    def read_bytes_of(self, raw): return self._raw(raw)
    def assets(self):
        a=[(p,raw) for (p,raw) in self.entries
           if "/assets/" in ("/"+p) and not excluded(p)]
        # Si hay assets en la RAIZ (export actual), ignora los de deploy/ (stale).
        has_root=any("deploy/assets/" not in ("/"+p) for p,_ in a)
        out={}
        for p,raw in a:
            if has_root and "deploy/assets/" in ("/"+p): continue
            out[p[p.find("assets/"):]]=raw
        return list(out.items())

def default_source():
    zips=glob.glob(os.path.expanduser("~/Downloads/pagana web entalles*.zip"))
    return max(zips, key=os.path.getmtime) if zips else None

def main():
    src_path = sys.argv[1] if len(sys.argv)>1 else default_source()
    if not src_path or not os.path.exists(src_path):
        sys.exit("No encontre el export. Pasa la ruta: python3 build.py /ruta/al/export.zip")
    src=Source(src_path)
    print("Fuente: %s\n" % src_path)

    # 1) HTML -> slug + enlaces reescritos + inyeccion del backend
    for orig,out in FILE_MAP.items():
        html=src.read_text(orig)
        if html is None: print("  !! falta %s — omitido" % orig); continue
        html = post_process(out, apply_rewrite(html))
        open(os.path.join(HERE,out),"w",encoding="utf-8").write(html)
        tag = "  +backend" if (out in PANELS or out=="catalogo.html") else ""
        print("  %-20s <- %s%s" % (out, orig, tag))

    # 2) admin-auth.js / element-backend.js los mantiene el repo (NO se copian del export)
    for js in REPO_KEPT:
        print("  %-20s (repo, backend)" % js if os.path.exists(os.path.join(HERE,js)) else "  !! falta %s en el repo" % js)

    # 3) assets-data.js: copiar SOLO si algun HTML lo referencia (si no, quitar el viejo)
    used = any('assets-data.js' in open(os.path.join(HERE,o),encoding='utf-8').read()
               for o in FILE_MAP.values() if os.path.exists(os.path.join(HERE,o)))
    for js in JS_OPTIONAL:
        raw=src.find(js); dst=os.path.join(HERE,js)
        if raw and used:
            with open(dst,"wb") as fh: fh.write(src.read_bytes_of(raw))
            print("  %s" % js)
        elif os.path.exists(dst):
            os.remove(dst); print("  %s (no usado por ningun HTML -> eliminado)" % js)

    # 4) assets/ (subarbol completo, prefiriendo la raiz sobre deploy/)
    adir=os.path.join(HERE,"assets")
    if os.path.isdir(adir): shutil.rmtree(adir)
    n=0
    for rel,raw in src.assets():
        dst=os.path.join(HERE,rel); os.makedirs(os.path.dirname(dst),exist_ok=True)
        with open(dst,"wb") as fh: fh.write(src.read_bytes_of(raw)); n+=1
    print("  assets/  (%d archivos)" % n)

    # 5) optimizar imagenes (frames 360 PNG -> WebP) + reescribir refs .png -> .webp
    webp_ok=False
    try:
        r=subprocess.run(["node", os.path.join(HERE,"optimize-assets.js")], cwd=HERE,
                         capture_output=True, text=True, timeout=900)
        if r.stdout: sys.stdout.write(r.stdout)
        if r.returncode!=0 and r.stderr: sys.stderr.write(r.stderr)
        webp_ok=bool(glob.glob(os.path.join(HERE,"assets","fits","*-360","*.webp")))
    except Exception as e:
        print("  (no pude optimizar imagenes: %s)" % e)
    if webp_ok:
        for out in ("index.html","ficha.html"):
            p=os.path.join(HERE,out)
            if not os.path.exists(p): continue
            h=open(p,encoding="utf-8").read()
            h2=re.sub(r"(assets/fits/[^\"'\s)]+)\.png", r"\1.webp", h)
            if h2!=h: open(p,"w",encoding="utf-8").write(h2)
        print("  imagenes -> WebP (frames 360), refs .png reescritas a .webp")
    else:
        print("  (imagenes quedan en PNG: node/sharp no disponible)")
    print("\nListo. Revisa con: ver-local.command (o python3 -m http.server 8080)")

if __name__ == "__main__":
    main()
