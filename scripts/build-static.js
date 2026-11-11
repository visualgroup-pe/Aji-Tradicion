'use strict';
// Genera una versión ESTÁTICA de vista previa en dist/ para GitHub Pages.
// En esta versión no hay servidor: el botón de compra muestra un aviso y
// no se procesa ningún pago (el PDF no se incluye en ningún caso).
//
// Uso: PAGES_URL=https://usuario.github.io/repo node scripts/build-static.js [--out dist|docs]

const fs = require('fs');
const path = require('path');

process.env.PAYMENT_MODE = process.env.PAYMENT_MODE || 'demo'; // evita exigir credenciales
const pagesUrl = (process.env.PAGES_URL || 'https://visualgroup-pe.github.io/Aji-Tradicion').replace(/\/+$/, '');
process.env.BASE_URL = pagesUrl;

const { renderTemplate, PUBLIC, ROOT } = require('../src/render');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(ROOT, outArg > -1 ? process.argv[outArg + 1] : 'dist');

const overrides = {
  SITE_MODE: 'preview',
  DEMO_BANNER: '',
  DEMO_BANNER_TEXT: 'Vista previa del diseño · Los pagos no están activos en esta versión.',
};

// Rutas absolutas del servidor → relativas, para funcionar bajo /<repo>/ en GitHub Pages.
function relativize(html) {
  return html
    .replace(/(["\s,(])\/assets\//g, '$1assets/')
    .replace(/href="\/legal(#[^"]*)?"/g, (m, h) => `href="legal.html${h || ''}"`)
    .replace(/href="\/(#[^"]*)?"/g, (m, h) => `href="./${h || ''}"`)
    .replace(/href="\/site\.webmanifest"/g, 'href="site.webmanifest"');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const [src, dest] of [['index.html', 'index.html'], ['legal.html', 'legal.html']]) {
  const html = relativize(renderTemplate(src, overrides));
  if (/\{\{[A-Z_]+\}\}|<x-img/.test(html)) throw new Error(`Plantilla sin resolver en ${src}`);
  fs.writeFileSync(path.join(OUT, dest), html);
}

fs.cpSync(path.join(PUBLIC, 'assets'), path.join(OUT, 'assets'), { recursive: true });
const manifest = fs.readFileSync(path.join(PUBLIC, 'site.webmanifest'), 'utf8').replace(/"\/assets\//g, '"assets/');
fs.writeFileSync(path.join(OUT, 'site.webmanifest'), manifest);
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n'); // vista previa: no indexar
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`Vista previa estática generada en ${path.relative(ROOT, OUT)}/ para ${pagesUrl}/`);
