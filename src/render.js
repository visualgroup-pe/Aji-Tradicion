'use strict';

// Renderizado de las plantillas HTML de /public:
//  - {{VARIABLES}} con los valores de configuración
//  - <x-img name="…" sizes="…" alt="…" class="…" eager> → <picture> AVIF + WebP responsivo
// Lo usan el servidor (server.js) y el generador estático (scripts/build-static.js).

const fs = require('fs');
const path = require('path');
const config = require('./config');
const mailer = require('./mailer');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const money = (n) => n.toFixed(2);
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function templateVars(overrides = {}) {
  const p = config.product;
  const [ent, dec] = money(p.price).split('.');
  const whatsapp = config.site.whatsapp.replace(/\D/g, '');
  return {
    PRICE: money(p.price),
    PRICE_INT: ent,
    PRICE_DEC: dec,
    COMPARE_PRICE: p.comparePrice ? money(p.comparePrice) : '',
    COMPARE_HIDDEN: p.comparePrice ? '' : 'hidden',
    BASE_URL: config.baseUrl,
    CONTACT_EMAIL: config.site.contactEmail,
    WHATSAPP_URL: whatsapp ? `https://wa.me/${whatsapp}` : `mailto:${config.site.contactEmail}`,
    WHATSAPP_LABEL: whatsapp ? 'WhatsApp' : 'Correo',
    BUSINESS_NAME: config.site.businessName,
    BUSINESS_RUC: config.site.businessRuc ? `RUC ${config.site.businessRuc}` : '',
    COMPLAINTS_URL: config.site.complaintsBookUrl || `mailto:${config.site.contactEmail}?subject=Libro%20de%20Reclamaciones`,
    DOWNLOAD_TTL: String(config.download.ttlHours),
    DOWNLOAD_MAX: String(config.download.maxDownloads),
    YEAR: String(new Date().getFullYear()),
    SITE_MODE: config.paymentMode, // "mercadopago" | "demo" | "preview" (estático)
    DEMO_BANNER: config.paymentMode === 'demo' ? '' : 'hidden',
    DEMO_BANNER_TEXT: 'Modo demo: los pagos son simulados.',
    EMAIL_STEP: mailer.isEnabled() ? 'y recibe también el enlace en tu correo.' : 'y guárdalo en tu equipo.',
    ...overrides,
  };
}

let imgSizes = null;
function getImgSizes() {
  if (!imgSizes) {
    try { imgSizes = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'images.sizes.json'), 'utf8')); } catch { imgSizes = {}; console.warn('⚠️  Falta scripts/images.sizes.json'); }
  }
  return imgSizes;
}

function attrs(str) {
  const out = {};
  str.replace(/([a-z-]+)(?:="([^"]*)")?/g, (m, k, v) => { out[k] = v === undefined ? true : v; return m; });
  return out;
}

function pictureTag(a) {
  const info = getImgSizes()[a.name];
  if (!info) { console.warn('[img] imagen desconocida:', a.name); return ''; }
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

function renderTemplate(file, overrides) {
  const vars = templateVars(overrides);
  return fs.readFileSync(path.join(PUBLIC, file), 'utf8')
    .replace(/<x-img\s([^>]*?)\s*\/?>(?:<\/x-img>)?/g, (m, a) => pictureTag(attrs(a)))
    .replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? escHtml(vars[k]) : m));
}

module.exports = { renderTemplate, templateVars, escHtml, money, PUBLIC, ROOT };
