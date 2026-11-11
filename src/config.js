'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : String(v).trim();
}

function num(name, fallback) {
  const v = Number(str(name, ''));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const isProduction = str('NODE_ENV') === 'production';

const config = {
  isProduction,
  port: num('PORT', 3000),
  // Public URL of the site, without trailing slash. Used for Mercado Pago
  // back_urls / notification_url and for links in e-mails.
  baseUrl: str('BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''),

  product: {
    id: str('PRODUCT_ID', 'recetario-100-recetas-peruanas'),
    name: str('PRODUCT_NAME', 'Recetario Ají Tradición: 100 recetas peruanas'),
    // Price in soles (PEN). Two decimals.
    price: Math.round(num('PRICE_PEN', 29.9) * 100) / 100,
    // Optional reference price (only shown if you really sold at that price before).
    comparePrice: str('COMPARE_PRICE_PEN') ? Math.round(num('COMPARE_PRICE_PEN', 0) * 100) / 100 : null,
    currency: 'PEN',
  },

  // Private location of the PDF. It is NEVER served statically: it is only
  // streamed by /descargar/:token after the payment has been verified.
  pdfPath: path.resolve(ROOT, str('PDF_PATH', 'private/recetario-100-recetas-peruanas.pdf')),
  pdfDownloadName: str('PDF_DOWNLOAD_NAME', 'Aji-Tradicion-100-recetas-peruanas.pdf'),

  download: {
    ttlHours: num('DOWNLOAD_TTL_HOURS', 72),
    maxDownloads: num('DOWNLOAD_MAX', 5),
  },

  // "mercadopago" (real payments) or "demo" (simulated, for local testing only).
  paymentMode: str('PAYMENT_MODE', 'mercadopago'),

  mercadopago: {
    accessToken: str('MP_ACCESS_TOKEN'),
    // Secret key shown in "Tus integraciones > Webhooks" to validate x-signature.
    webhookSecret: str('MP_WEBHOOK_SECRET'),
    statementDescriptor: str('MP_STATEMENT_DESCRIPTOR', 'AJITRADICION').slice(0, 22),
  },

  dataDir: path.resolve(ROOT, str('DATA_DIR', 'data')),

  smtp: {
    host: str('SMTP_HOST'),
    port: num('SMTP_PORT', 587),
    secure: str('SMTP_SECURE', 'false') === 'true',
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
    from: str('MAIL_FROM', 'Ají Tradición <hola@example.com>'),
  },

  site: {
    contactEmail: str('CONTACT_EMAIL', 'hola@example.com'),
    whatsapp: str('CONTACT_WHATSAPP'), // e.g. 51999999999
    businessName: str('BUSINESS_NAME', 'Ají Tradición'),
    businessRuc: str('BUSINESS_RUC'),
    complaintsBookUrl: str('COMPLAINTS_BOOK_URL'),
  },
};

if (config.paymentMode === 'demo' && isProduction) {
  throw new Error('PAYMENT_MODE=demo no está permitido con NODE_ENV=production.');
}

module.exports = config;
