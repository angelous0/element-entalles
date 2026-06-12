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
import sys, os, glob, zipfile, unicodedata, shutil

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
JS_REWRITE = ["admin-auth.js"]      # se copia y se le reescriben los enlaces
JS_OPTIONAL = ["assets-data.js"]    # se copia tal cual SI existe (puede no estar)

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
        # prefer deploy/, luego ruta mas corta
        cands.sort(key=lambda pr: (0 if "deploy/" in ("/"+pr[0]) else 1, pr[0].count("/"), len(pr[0])))
        return cands[0][1]
    def read_text(self, basename):
        raw=self.find(basename); return self._raw(raw).decode("utf-8") if raw else None
    def read_bytes_of(self, raw): return self._raw(raw)
    def assets(self):
        a=[(p,raw) for (p,raw) in self.entries
           if "/assets/" in ("/"+p) and not excluded(p)]
        prefer_deploy=any("deploy/assets/" in ("/"+p) for p,_ in a)
        out={}
        for p,raw in a:
            if prefer_deploy and "deploy/assets/" not in ("/"+p): continue
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

    # 1) HTML -> slug + enlaces reescritos
    for orig,out in FILE_MAP.items():
        html=src.read_text(orig)
        if html is None: print("  !! falta %s — omitido" % orig); continue
        open(os.path.join(HERE,out),"w",encoding="utf-8").write(apply_rewrite(html))
        print("  %-20s <- %s" % (out, orig))

    # 2) admin-auth.js (con enlaces reescritos)
    for js in JS_REWRITE:
        d=src.read_text(js)
        if d is None: print("  !! falta %s — omitido" % js); continue
        open(os.path.join(HERE,js),"w",encoding="utf-8").write(apply_rewrite(d))
        print("  %s" % js)

    # 3) assets-data.js (opcional: copiar si existe; si no, quitar el viejo)
    for js in JS_OPTIONAL:
        raw=src.find(js); dst=os.path.join(HERE,js)
        if raw:
            with open(dst,"wb") as fh: fh.write(src.read_bytes_of(raw))
            print("  %s" % js)
        elif os.path.exists(dst):
            os.remove(dst); print("  %s (ya no existe en el export -> eliminado del proyecto)" % js)

    # 4) assets/ (subarbol completo, prefiriendo deploy/assets)
    adir=os.path.join(HERE,"assets")
    if os.path.isdir(adir): shutil.rmtree(adir)
    n=0
    for rel,raw in src.assets():
        dst=os.path.join(HERE,rel); os.makedirs(os.path.dirname(dst),exist_ok=True)
        with open(dst,"wb") as fh: fh.write(src.read_bytes_of(raw)); n+=1
    print("  assets/  (%d archivos)" % n)
    print("\nListo. Revisa con: python3 -m http.server 8080")

if __name__ == "__main__":
    main()
