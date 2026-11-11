'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('./src/config');
const store = require('./src/store');
const mp = require('./src/payments/mercadopago');
const mailer = require('./src/mailer');

const app = express();
const PUBLIC = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------- Security headers ----------
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (config.isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// ---------- Tiny in-memory rate limiter for the API ----------
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const h = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > h.reset) { h.n = 0; h.reset = now + windowMs; }
    h.n += 1;
    hits.set(key, h);
    if (h.n > max) return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta en un momento.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now > h.reset) hits.delete(k); }, 60e3).unref();

// ---------- HTML templates with config values ----------
const { renderTemplate, escHtml, money } = require('./src/render');

const pageCache = new Map();
function renderPage(file) {
  if (config.isProduction && pageCache.has(file)) return pageCache.get(file);
  const html = renderTemplate(file);
  pageCache.set(file, html);
  return html;
}

function sendPage(file, { noindex = false } = {}) {
  return (req, res) => {
    res.set('Cache-Control', 'no-cache');
    if (noindex) res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(renderPage(file));
  };
}

app.get('/', sendPage('index.html'));
app.get('/gracias', sendPage('gracias.html', { noindex: true }));
app.get('/legal', sendPage('legal.html'));
// Templates are only served rendered.
app.get(/\.html$/, (req, res) => res.redirect(301, req.path.replace(/(index)?\.html$/, '') || '/'));

app.use('/assets', express.static(path.join(PUBLIC, 'assets'), {
  maxAge: config.isProduction ? '30d' : 0,
  immutable: config.isProduction,
  fallthrough: false,
}));
app.use(express.static(PUBLIC, { index: false, extensions: false, maxAge: '1d' }));

// ---------- API ----------
app.use('/api', express.json({ limit: '20kb' }));

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function publicOrder(order) {
  const out = { id: order.id, status: order.status, amount: order.amount, currency: order.currency };
  if (order.status === 'paid' && order.download) {
    const d = order.download;
    out.download = {
      url: `/descargar/${store.tokenFor(order)}`,
      expiresAt: d.expiresAt,
      remaining: Math.max(0, config.download.maxDownloads - d.count),
    };
    out.emailSent = Boolean(order.emailSentAt);
  }
  return out;
}

async function deliver(order, token) {
  if (!token || !mailer.isEnabled()) return;
  try {
    await mailer.sendDownloadEmail(order, token);
    store.updateOrder(order.id, { emailSentAt: new Date().toISOString() });
  } catch (err) {
    console.error('[mail] no se pudo enviar el correo del pedido', order.id, err.message);
  }
}

/** Verifies a payment against Mercado Pago and, if valid, marks the order as paid. */
async function confirmPayment(paymentId, expectedOrderId) {
  const payment = await mp.getPayment(paymentId);
  const order = store.getOrder(payment.external_reference);
  if (!order) return { order: null, payment };
  if (expectedOrderId && order.id !== expectedOrderId) return { order: null, payment };
  if (mp.paymentMatchesOrder(payment, order)) {
    const { token } = store.markPaid(order.id, payment.id);
    await deliver(order, token);
  } else if (order.status === 'pending' && ['rejected', 'cancelled'].includes(payment.status)) {
    store.updateOrder(order.id, { lastPaymentStatus: payment.status });
  } else if (payment.status) {
    store.updateOrder(order.id, { lastPaymentStatus: payment.status });
  }
  return { order: store.getOrder(order.id), payment };
}

app.post('/api/checkout', rateLimit(10, 10 * 60e3), async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Ingresa un correo electrónico válido para recibir tu recetario.' });
  }
  const order = store.createOrder({ email, name });
  try {
    if (config.paymentMode === 'demo') {
      return res.json({ orderId: order.id, redirectUrl: `/demo/pagar/${order.id}` });
    }
    const { redirectUrl, preferenceId } = await mp.createCheckout(order);
    store.updateOrder(order.id, { preferenceId });
    return res.json({ orderId: order.id, redirectUrl });
  } catch (err) {
    console.error('[checkout]', err.message, err.details ? JSON.stringify(err.details) : '');
    return res.status(502).json({ error: 'No pudimos iniciar el pago en este momento. Inténtalo de nuevo en unos minutos.' });
  }
});

app.get('/api/pedidos/:id', rateLimit(120, 10 * 60e3), async (req, res) => {
  let order = store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  const paymentId = req.query.payment_id || req.query.collection_id;
  // Coming back from Mercado Pago: verify right away instead of waiting for the webhook.
  if (order.status !== 'paid' && paymentId && config.paymentMode !== 'demo' && /^\d{1,20}$/.test(String(paymentId))) {
    try {
      const r = await confirmPayment(String(paymentId), order.id);
      if (r.order) order = r.order;
    } catch (err) {
      console.error('[pedido] verificación fallida', order.id, err.message);
    }
  }
  res.set('Cache-Control', 'no-store');
  return res.json({ ...publicOrder(order), lastPaymentStatus: order.lastPaymentStatus || null });
});

// Mercado Pago webhook (also accepts legacy IPN query format).
app.post('/api/webhooks/mercadopago', async (req, res) => {
  const sig = mp.verifyWebhookSignature(req);
  if (!sig.ok) return res.status(401).json({ error: 'invalid signature' });
  const paymentId = mp.paymentIdFromNotification(req);
  if (!paymentId) return res.status(200).json({ ignored: true });
  try {
    const { order, payment } = await confirmPayment(paymentId);
    console.log('[webhook] pago', paymentId, payment.status, '-> pedido', order ? `${order.id} (${order.status})` : 'desconocido');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] error', paymentId, err.message);
    // 500 => Mercado Pago will retry the notification later.
    return res.status(500).json({ error: 'retry' });
  }
});

// Resend download link to the buyer's e-mail (generic answer to avoid leaking who bought).
app.post('/api/reenviar', rateLimit(5, 30 * 60e3), async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const generic = { ok: true, message: 'Si existe una compra confirmada con ese correo, te enviaremos un nuevo enlace de descarga en unos minutos.' };
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Ingresa un correo válido.' });
  if (!mailer.isEnabled()) {
    return res.json({ ok: true, message: `Escríbenos a ${config.site.contactEmail} desde el correo de tu compra y te ayudamos con tu descarga.` });
  }
  const order = store.findPaidByEmail(email);
  if (order) {
    const token = store.issueToken(order);
    await deliver(order, token);
  }
  return res.json(generic);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

// ---------- Protected download ----------
function messagePage(res, status, title, body) {
  res.status(status).set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).type('html').send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)} · Ají Tradición</title><link rel="icon" href="/assets/brand/favicon.svg"><link rel="stylesheet" href="/assets/css/styles.css"></head>
<body class="msg-page"><main class="msg-card"><img src="/assets/brand/logo-horizontal.svg" alt="Ají Tradición" width="200" height="48"><h1>${escHtml(title)}</h1><p>${body}</p><a class="btn btn--primary" href="/">Volver al inicio</a></main></body></html>`
  );
}

app.get('/descargar/:token', rateLimit(30, 10 * 60e3), (req, res) => {
  const order = store.findByToken(req.params.token);
  const help = `Escríbenos a <a href="mailto:${escHtml(config.site.contactEmail)}">${escHtml(config.site.contactEmail)}</a> y te ayudamos.`;
  if (!order || order.status !== 'paid' || !order.download) {
    return messagePage(res, 404, 'Enlace no válido', `Este enlace de descarga no existe o fue reemplazado por uno nuevo. ${help}`);
  }
  const d = order.download;
  if (Date.now() > Date.parse(d.expiresAt)) {
    return messagePage(res, 410, 'Enlace vencido', `Este enlace de descarga venció. Puedes pedir uno nuevo desde la página de compra (“¿Ya compraste?”) o ${help}`);
  }
  if (d.count >= config.download.maxDownloads) {
    return messagePage(res, 410, 'Límite de descargas alcanzado', `Ya usaste las ${config.download.maxDownloads} descargas de este enlace. ${help}`);
  }
  fs.stat(config.pdfPath, (err, stat) => {
    if (err || !stat.isFile()) {
      console.error('[descarga] PDF no encontrado en', config.pdfPath);
      return messagePage(res, 503, 'Descarga no disponible por el momento', `Tu compra está confirmada, pero el archivo no está disponible ahora mismo. ${help}`);
    }
    d.count += 1;
    store.persist();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${config.pdfDownloadName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    fs.createReadStream(config.pdfPath).pipe(res);
  });
});

// ---------- Demo payment (local testing only) ----------
if (config.paymentMode === 'demo') {
  console.warn('⚠️  PAYMENT_MODE=demo: los pagos son SIMULADOS. No uses este modo en producción.');
  app.get('/demo/pagar/:id', (req, res) => {
    const order = store.getOrder(req.params.id);
    if (!order) return messagePage(res, 404, 'Pedido no encontrado', 'Vuelve a la página e inicia la compra otra vez.');
    res.set('X-Robots-Tag', 'noindex').type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago de prueba</title><link rel="stylesheet" href="/assets/css/styles.css"></head>
<body class="msg-page"><main class="msg-card"><p class="eyebrow">Modo demo · pago simulado</p><h1>S/ ${money(order.amount)}</h1><p>Pedido ${escHtml(order.id)}<br>${escHtml(order.email)}</p>
<form method="post" action="/demo/pagar/${escHtml(order.id)}"><button class="btn btn--primary" name="r" value="approved">Simular pago aprobado</button> <button class="btn btn--ghost" name="r" value="rejected">Simular rechazo</button></form></main></body></html>`);
  });
  app.post('/demo/pagar/:id', express.urlencoded({ extended: false }), async (req, res) => {
    const order = store.getOrder(req.params.id);
    if (!order) return res.redirect('/');
    if (req.body.r === 'approved') {
      const { token } = store.markPaid(order.id, `demo-${Date.now()}`);
      await deliver(order, token);
      return res.redirect(`/gracias?pedido=${order.id}&status=approved`);
    }
    store.updateOrder(order.id, { lastPaymentStatus: 'rejected' });
    return res.redirect(`/gracias?pedido=${order.id}&status=rejected`);
  });
}

app.get('/healthz', (req, res) => res.json({ ok: true, pdf: fs.existsSync(config.pdfPath), mode: config.paymentMode }));

app.use((req, res) => messagePage(res, 404, 'Página no encontrada', 'La página que buscas no existe.'));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', err);
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'Error interno' });
  return messagePage(res, 500, 'Algo salió mal', 'Inténtalo nuevamente en unos minutos.');
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Ají Tradición escuchando en ${config.baseUrl} (puerto ${config.port}, pagos: ${config.paymentMode})`);
    if (!fs.existsSync(config.pdfPath)) console.warn(`⚠️  No se encontró el PDF en ${config.pdfPath}. Configura PDF_PATH.`);
    if (config.paymentMode === 'mercadopago' && !config.mercadopago.accessToken) console.warn('⚠️  Falta MP_ACCESS_TOKEN.');
    if (config.paymentMode === 'mercadopago' && !config.mercadopago.webhookSecret) console.warn('⚠️  Falta MP_WEBHOOK_SECRET: los webhooks no se autentican (los pagos igual se verifican contra la API).');
  });
}

module.exports = app;
