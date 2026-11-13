'use strict';
// Genera el sitio a partir de las plantillas de /public.
//
//   node scripts/build-site.js                 → dist/  (para el Cloudflare Worker, tienda real)
//   node scripts/build-site.js --target pages  → docs/  (vista previa estática para GitHub Pages)
//
// El PDF NUNCA se incluye: vive en Workers KV y solo lo entrega el Worker tras verificar el pago.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renderTemplate, siteVars, PUBLIC, ROOT } = require('../src/render');

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : d; };
const target = arg('target', 'worker');
const OUT = path.resolve(ROOT, arg('out', target === 'pages' ? 'docs' : 'dist'));

const vars = siteVars();
let overrides = {};
if (target === 'pages') {
  vars.PUBLIC_URL = process.env.PAGES_URL || vars.PUBLIC_URL || 'https://visualgroup-pe.github.io/Aji-Tradicion';
  overrides = {
    SITE_MODE: 'preview',
    DEMO_BANNER: '',
    DEMO_BANNER_TEXT: 'Vista previa del diseño · Los pagos no están activos en esta versión.',
  };
}

// Versión de CSS/JS para invalidar caché cuando cambian.
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC, f))).digest('hex').slice(0, 10);
const versions = {
  '/assets/css/styles.css': hash('assets/css/styles.css'),
  '/assets/js/app.js': hash('assets/js/app.js'),
  '/assets/js/gracias.js': hash('assets/js/gracias.js'),
};
function versionAssets(html) {
  for (const [p, h] of Object.entries(versions)) html = html.split(`"${p}"`).join(`"${p}?v=${h}"`);
  return html;
}

// En GitHub Pages el sitio vive bajo /<repo>/: las rutas absolutas pasan a relativas.
function relativize(html) {
  return html
    .replace(/(["\s,(])\/assets\//g, '$1assets/')
    .replace(/href="\/legal(#[^"]*)?"/g, (m, h) => `href="legal.html${h || ''}"`)
    .replace(/href="\/(#[^"]*)?"/g, (m, h) => `href="./${h || ''}"`)
    .replace(/href="\/site\.webmanifest"/g, 'href="site.webmanifest"');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const pages = target === 'pages' ? ['index.html', 'legal.html'] : ['index.html', 'gracias.html', 'legal.html'];
for (const file of pages) {
  let html = versionAssets(renderTemplate(file, { vars, overrides }));
  if (target === 'pages') html = relativize(html);
  fs.writeFileSync(path.join(OUT, file), html);
}

fs.cpSync(path.join(PUBLIC, 'assets'), path.join(OUT, 'assets'), { recursive: true });
let manifest = fs.readFileSync(path.join(PUBLIC, 'site.webmanifest'), 'utf8');
if (target === 'pages') manifest = manifest.replace(/"\/assets\//g, '"assets/');
fs.writeFileSync(path.join(OUT, 'site.webmanifest'), manifest);

if (target === 'pages') {
  fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n'); // vista previa: no indexar
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
} else {
  fs.copyFileSync(path.join(PUBLIC, 'robots.txt'), path.join(OUT, 'robots.txt'));
  fs.copyFileSync(path.join(PUBLIC, '_headers'), path.join(OUT, '_headers'));
}

console.log(`Sitio (${target}) generado en ${path.relative(ROOT, OUT)}/`);
