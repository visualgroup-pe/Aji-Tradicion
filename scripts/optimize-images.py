"""Convierte las fotos fuente (JPG) a AVIF + WebP responsivos en public/assets/img.
Uso: python3 scripts/optimize-images.py <carpeta_con_fuentes>
Lee scripts/images.json: [{"name", "src", "widths", "crop": [l,t,r,b] fracción opcional}]"""
import json, os, sys
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/assets/img')
os.makedirs(OUT, exist_ok=True)
src_dir = sys.argv[1]
manifest = json.load(open(os.path.join(ROOT, 'scripts/images.json')))
sizes = {}
for item in manifest:
    path = os.path.join(src_dir, item['src'])
    if not os.path.exists(path):
        print('FALTA', item['src']); continue
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    if item.get('crop'):
        l, t, r, b = item['crop']; W, H = im.size
        im = im.crop((int(l * W), int(t * H), int(r * W), int(b * H)))
    W, H = im.size
    sizes[item['name']] = {'w': W, 'h': H, 'widths': []}
    for w in item.get('widths', [640, 1024, 1600]):
        if w > W: w = W
        h = round(H * w / W)
        r = im.resize((w, h), Image.LANCZOS)
        base = os.path.join(OUT, f"{item['name']}-{w}")
        r.save(base + '.avif', quality=item.get('q_avif', 52), speed=6)
        r.save(base + '.webp', quality=item.get('q_webp', 76), method=6)
        sizes[item['name']]['widths'].append(w)
        print(item['name'], w, h, os.path.getsize(base + '.avif') // 1024, 'KB avif', os.path.getsize(base + '.webp') // 1024, 'KB webp')
json.dump(sizes, open(os.path.join(ROOT, 'scripts/images.sizes.json'), 'w'), indent=1)
