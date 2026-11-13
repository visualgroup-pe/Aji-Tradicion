'use strict';

// Renderizado de las plantillas HTML de /public en tiempo de build:
//  - {{VARIABLES}} con los valores de configuración (vars de wrangler.json)
//  - <x-img name="…" sizes="…" alt="…" class="…" eager> → <picture> AVIF + WebP responsivo

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const money = (n) => n.toFixed(2);
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Lee la configuración pública (vars) de wrangler.json. */
function siteVars() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.json'), 'utf8')).vars || {};
}

function templateVars(v, overrides = {}) {
  const num = (x, d) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : d; };
  const price = num(v.PRICE_PEN, 29.9);
  const compare = num(v.COMPARE_PRICE_PEN, 0);
  const [ent, dec] = money(price).split('.');
  const contact = v.CONTACT_EMAIL || 'hola@example.com';
  const emailOn = Boolean(v.MAIL_FROM);
  return {
    PRICE: money(price),
    PRICE_INT: ent,
    PRICE_DEC: dec,
    COMPARE_PRICE: compare ? money(compare) : '',
    COMPARE_HIDDEN: compare ? '' : 'hidden',
    BASE_URL: (v.PUBLIC_URL || '').replace(/\/+$/, ''),
    CONTACT_EMAIL: contact,
    BUSINESS_NAME: v.BUSINESS_NAME || 'Ají Tradición',
    BUSINESS_RUC: v.BUSINESS_RUC ? `RUC ${v.BUSINESS_RUC}` : '',
    COMPLAINTS_URL: v.COMPLAINTS_BOOK_URL || `mailto:${contact}?subject=Libro%20de%20Reclamaciones`,
    DOWNLOAD_TTL: String(num(v.DOWNLOAD_TTL_HOURS, 72)),
    DOWNLOAD_MAX: String(num(v.DOWNLOAD_MAX, 5)),
    YEAR: String(new Date().getFullYear()),
    SITE_MODE: v.PAYMENT_MODE || 'mercadopago',
    DEMO_BANNER: v.PAYMENT_MODE === 'demo' ? '' : 'hidden',
    DEMO_BANNER_TEXT: 'Modo demo: los pagos son simulados.',
    EMAIL_STEP: emailOn ? 'y recibe también el enlace en tu correo.' : 'y guárdalo en tu equipo.',
    ...overrides,
  };
}

let imgSizes = null;
function getImgSizes() {
  if (!imgSizes) imgSizes = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'images.sizes.json'), 'utf8'));
  return imgSizes;
}

function attrs(str) {
  const out = {};
  str.replace(/([a-z-]+)(?:="([^"]*)")?/g, (m, k, val) => { out[k] = val === undefined ? true : val; return m; });
  return out;
}

function pictureTag(a) {
  const info = getImgSizes()[a.name];
  if (!info) throw new Error(`Imagen desconocida en <x-img>: ${a.name}`);
  const ws = info.widths;
  const set = (ext) => ws.map((w) => `/assets/img/${a.name}-${w}.${ext} ${w}w`).join(', ');
  const fallbackW = ws.find((w) => w >= 800) || ws[ws.length - 1];
  const h = Math.round(info.h * fallbackW / info.w);
  const sizes = a.sizes || '100vw';
  const load = a.eager ? 'fetchpriority="high"' : 'loading="lazy"';
  return `<picture${a.class ? ` class="${a.class}"` : ''}>`
    + `<source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">`
    + `<source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">`
    + `<img src="/assets/img/${a.name}-${fallbackW}.webp" alt="${a.alt || ''}" width="${fallbackW}" height="${h}" ${load} decoding="async">`
    + '</picture>';
}

function renderTemplate(file, { vars = siteVars(), overrides } = {}) {
  const tv = templateVars(vars, overrides);
  const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8')
    .replace(/<x-img\s([^>]*?)\s*\/?>(?:<\/x-img>)?/g, (m, a) => pictureTag(attrs(a)))
    .replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in tv ? escHtml(tv[k]) : m));
  if (/\{\{[A-Z_]+\}\}|<x-img/.test(html)) throw new Error(`Plantilla sin resolver en ${file}`);
  return html;
}

module.exports = { renderTemplate, templateVars, siteVars, escHtml, money, PUBLIC, ROOT };
