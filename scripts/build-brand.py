"""Genera los SVG de marca (texto convertido a trazos) a partir de las fuentes OFL del proyecto.
Uso: python3 scripts/build-brand.py   (requiere: pip install fonttools brotli)"""
import io, os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'public/assets/fonts')
OUT = os.path.join(ROOT, 'public/assets/brand')
os.makedirs(OUT, exist_ok=True)

C = dict(aji='#B23A1E', ajiDeep='#8E2C15', amarillo='#E9A23B', oliva='#56683A', cacao='#2A1C14', marfil='#FAF4EA', crema='#F3E9D8')

def instance(file, **axes):
    f = TTFont(os.path.join(FONTS, file))
    f.flavor = None
    return instantiateVariableFont(f, axes)

serif = instance('fraunces-latin-opsz-normal.woff2', opsz=144, wght=560)
serif_it = instance('fraunces-latin-opsz-italic.woff2', opsz=144, wght=480)
sans = instance('manrope-latin-wght-normal.woff2', wght=700)

def text_path(font, text, size, x=0, y=0, tracking=0):
    """Return (svg path d, advance width) for text with baseline at y."""
    gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
    s = size / upm
    pen = SVGPathPen(gs)
    cx = 0.0
    kern = {}
    for ch in text:
        g = cmap.get(ord(ch))
        if g is None:
            raise ValueError(f'glyph missing for {ch!r}')
        tp = TransformPen(pen, (s, 0, 0, -s, x + cx, y))
        gs[g].draw(tp)
        cx += gs[g].width * s + tracking
    import re
    d = re.sub(r'-?\d+\.\d+', lambda m: f'{float(m.group()):.1f}'.rstrip('0').rstrip('.'), pen.getCommands())
    return d, cx - tracking

# ---- Isotipo: sello con ají ----
def pepper(fill_body, fill_stem, highlight):
    # Drawn on a 64x64 grid, centered.
    return f'''<g transform="translate(32 32) scale(1.12) translate(-30.6 -31)"><path d="M27.2 21.6c6.9-1.6 13.6 1.3 14.4 8.6.9 8.3-6.9 16.9-21.8 21.6-1.1.3-1.6-.9-.8-1.6 5.4-4.9 6.6-10.8 6.1-17.4-.3-4 .3-9.9 2.1-11.2z" fill="{fill_body}"/>
  <path d="M30.6 26.4c3.7-.4 6.6 1.6 6.6 5.4" fill="none" stroke="{highlight}" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>
  <path d="M25.4 22.9c1.9-3.6 6.9-5.3 11.4-3.6 1.6.6 3 1.6 4 2.9-3.3-.9-6.2-.6-8.7.6-2.6-1.2-4.9-1.1-6.7.1z" fill="{fill_stem}"/>
  <path d="M33 19.6c-.2-4.4 2.3-8 6.9-9.4" fill="none" stroke="{fill_stem}" stroke-width="2.4" stroke-linecap="round"/></g>'''

def seal(bg, ring, body, stem, hl):
    return f'''<circle cx="32" cy="32" r="31" fill="{bg}"/>
  <circle cx="32" cy="32" r="27.2" fill="none" stroke="{ring}" stroke-width="1" opacity=".45"/>
  {pepper(body, stem, hl)}'''

def svg(w, h, body, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}" role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'

iso_main = seal(C['aji'], C['marfil'], C['marfil'], C['amarillo'], C['aji'])
iso_light = seal(C['marfil'], C['aji'], C['aji'], C['oliva'], C['marfil'])

open(f'{OUT}/isotipo.svg', 'w').write(svg(64, 64, iso_main, 'Ají Tradición'))
open(f'{OUT}/isotipo-claro.svg', 'w').write(svg(64, 64, iso_light, 'Ají Tradición'))
open(f'{OUT}/favicon.svg', 'w').write(svg(64, 64, seal(C['aji'], C['marfil'], C['marfil'], C['amarillo'], C['aji']).replace('stroke-width="1"', 'stroke-width="0"'), 'Ají Tradición'))

# ---- Logo horizontal ----
def horizontal(word_color, accent, tag_color, iso):
    a_d, a_w = text_path(serif, 'Ají', 40, x=74, y=40)
    t_d, t_w = text_path(serif_it, 'Tradición', 40, x=74 + a_w + 9, y=40)
    total = 74 + a_w + 9 + t_w
    tag_d, tag_w = text_path(sans, 'RECETARIOS PERUANOS', 9.2, x=76, y=58, tracking=2.6)
    w = max(total, 76 + tag_w) + 2
    body = f'''<g transform="translate(0 2) scale(0.9375)">{iso}</g>
  <path d="{a_d}" fill="{accent}"/><path d="{t_d}" fill="{word_color}"/><path d="{tag_d}" fill="{tag_color}"/>'''
    return svg(w, 64, body, 'Ají Tradición')

open(f'{OUT}/logo-horizontal.svg', 'w').write(horizontal(C['cacao'], C['aji'], C['oliva'], iso_main))
open(f'{OUT}/logo-horizontal-claro.svg', 'w').write(horizontal(C['marfil'], C['amarillo'], '#CDBFA6', iso_main))

# ---- Logo principal (apilado) ----
def stacked(word_color, accent, tag_color, iso):
    a_d, a_w = text_path(serif, 'Ají', 64)
    t_d, t_w = text_path(serif_it, 'Tradición', 64)
    gap = 14
    line = a_w + gap + t_w
    W = max(line, 300) + 40
    x0 = (W - line) / 2
    a_d, _ = text_path(serif, 'Ají', 64, x=x0, y=178)
    t_d, _ = text_path(serif_it, 'Tradición', 64, x=x0 + a_w + gap, y=178)
    _, tg_w = text_path(sans, 'RECETARIOS PERUANOS', 13, tracking=4.2)
    tg_d, _ = text_path(sans, 'RECETARIOS PERUANOS', 13, x=(W - tg_w) / 2, y=212, tracking=4.2)
    body = f'''<g transform="translate({W/2-48:.1f} 8) scale(1.5)">{iso}</g>
  <path d="{a_d}" fill="{accent}"/><path d="{t_d}" fill="{word_color}"/>
  <rect x="{W/2-18:.1f}" y="190" width="36" height="1.6" fill="{tag_color}" opacity=".5"/>
  <path d="{tg_d}" fill="{tag_color}"/>'''
    return svg(W, 224, body, 'Ají Tradición')

open(f'{OUT}/logo.svg', 'w').write(stacked(C['cacao'], C['aji'], C['oliva'], iso_main))
open(f'{OUT}/logo-claro.svg', 'w').write(stacked(C['marfil'], C['amarillo'], '#CDBFA6', iso_main))

# ---- Avatar para redes (1:1) ----
open(f'{OUT}/avatar-redes.svg', 'w').write(svg(512, 512, f'<rect width="512" height="512" fill="{C["aji"]}"/><g transform="translate(56 56) scale(6.25)">{pepper(C["marfil"], C["amarillo"], C["aji"])}</g>', 'Ají Tradición'))
print('ok')
