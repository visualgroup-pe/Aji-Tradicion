// Ají Tradición — Cloudflare Worker
// Sirve la landing (archivos estáticos de ./dist) y la API de compra:
//   POST /api/checkout               crea el pedido y la preferencia de Mercado Pago
//   GET  /api/pedidos/:id            estado del pedido (verifica el pago al volver de MP)
//   POST /api/webhooks/mercadopago   notificaciones de pago (firma x-signature)
//   POST /api/reenviar               reenvía el enlace al correo de la compra
//   GET  /descargar/:token           descarga protegida del PDF (guardado en KV)

import {
  cfg, esc, EMAIL_RE, UUID_RE, PAYMENT_ID_RE,
  getOrder, putOrder, createOrder, issueDownload, findByToken, publicOrder,
  createPreference, getPayment, paymentMatches, verifyWebhookSignature,
  mailEnabled, sendDownloadEmail,
} from './lib.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function withHeaders(res, extra = {}) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const json = (data, status = 200) => withHeaders(new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
}));

function messagePage(env, status, title, body) {
  const c = cfg(env);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Ají Tradición</title><link rel="icon" href="/assets/brand/favicon.svg"><link rel="stylesheet" href="/assets/css/styles.css"></head>
<body class="msg-page"><main class="msg-card"><img src="/assets/brand/logo-horizontal.svg" alt="Ají Tradición" width="200" height="57"><h1>${esc(title)}</h1><p>${body}</p><a class="btn btn--primary" href="/">Volver al inicio</a><p class="fineprint fineprint--center">¿Dudas? <a href="mailto:${esc(c.contactEmail)}">${esc(c.contactEmail)}</a></p></main></body></html>`;
  return withHeaders(new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }));
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 20000) return {};
  try { return await request.json(); } catch { return {}; }
}

function isLocal(url) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

async function deliver(env, order, token, origin) {
  if (!token || !mailEnabled(env)) return;
  try {
    await sendDownloadEmail(env, order, token, origin);
    order.emailSentAt = new Date().toISOString();
    await putOrder(env, order);
  } catch (err) {
    console.error('[mail] no se pudo enviar el correo del pedido', order.id, err.message);
  }
}

/** Marca un pedido como pagado (idempotente), emite el enlace y lo envía por correo. */
async function markPaid(env, order, paymentId, origin) {
  if (order.status === 'paid') return order;
  order.status = 'paid';
  order.paymentId = String(paymentId);
  order.paidAt = new Date().toISOString();
  const token = await issueDownload(env, order);
  if (order.email) await env.KV.put(`email:${order.email}`, order.id);
  await deliver(env, order, token, origin);
  return order;
}

/**
 * Consulta el pago en la API de Mercado Pago y, si es válido, marca el pedido como pagado.
 * Nunca se confía en los datos que llegan en la URL o en el webhook.
 */
async function confirmPayment(env, paymentId, origin, expectedOrderId) {
  const payment = await getPayment(env, paymentId);
  const orderId = payment.external_reference;
  if (!UUID_RE.test(String(orderId || ''))) return { order: null, payment };
  if (expectedOrderId && orderId !== expectedOrderId) return { order: null, payment };

  let order = await getOrder(env, orderId);
  const amount = order ? order.amount : cfg(env).price;
  if (paymentMatches(payment, { orderId, amount })) {
    if (!order) {
      // El pedido aún no se replicó en esta ubicación de KV: se reconstruye con los datos del pago.
      const email = String((payment.metadata && payment.metadata.email) || (payment.payer && payment.payer.email) || '').toLowerCase();
      order = { id: orderId, email, name: '', amount, currency: 'PEN', status: 'pending', createdAt: payment.date_created || new Date().toISOString(), download: null, emailSentAt: null };
    }
    order = await markPaid(env, order, payment.id, origin);
  } else if (order && order.status !== 'paid' && payment.status) {
    order.lastPaymentStatus = payment.status;
    await putOrder(env, order);
  }
  return { order, payment };
}

// ---------- Rutas ----------
async function handleCheckout(request, env, url) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: 'Ingresa un correo electrónico válido para recibir tu recetario.' }, 400);
  }
  const order = await createOrder(env, { email, name });
  try {
    if (cfg(env).mode === 'demo') {
      if (!isLocal(url)) return json({ error: 'El modo demo solo funciona en local.' }, 403);
      return json({ orderId: order.id, redirectUrl: `/demo/pagar/${order.id}` });
    }
    const { redirectUrl, preferenceId } = await createPreference(env, order, url.origin);
    order.preferenceId = preferenceId;
    await putOrder(env, order);
    return json({ orderId: order.id, redirectUrl });
  } catch (err) {
    console.error('[checkout]', err.message, err.details ? JSON.stringify(err.details) : '');
    return json({ error: 'No pudimos iniciar el pago en este momento. Inténtalo de nuevo en unos minutos.' }, 502);
  }
}

async function handleOrderStatus(env, url, id) {
  let order = await getOrder(env, id);
  const paymentId = url.searchParams.get('payment_id') || url.searchParams.get('collection_id');
  if (!order && !paymentId) return json({ error: 'Pedido no encontrado.' }, 404);
  if ((!order || order.status !== 'paid') && paymentId && PAYMENT_ID_RE.test(paymentId) && cfg(env).mode !== 'demo') {
    try {
      const r = await confirmPayment(env, paymentId, url.origin, id);
      if (r.order) order = r.order;
    } catch (err) {
      console.error('[pedido] verificación fallida', id, err.message);
    }
  }
  if (!order) return json({ error: 'Pedido no encontrado.' }, 404);
  return json(await publicOrder(env, order));
}

async function handleWebhook(request, env, url) {
  const body = await readJson(request);
  const dataId = url.searchParams.get('data.id') || (body.data && body.data.id) || '';
  const sig = await verifyWebhookSignature(cfg(env).mpWebhookSecret, {
    signature: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    dataId,
  });
  if (!sig.ok) return json({ error: 'invalid signature' }, 401);
  const type = body.type || url.searchParams.get('type') || url.searchParams.get('topic');
  const paymentId = String(dataId || url.searchParams.get('id') || '');
  if ((type && type !== 'payment') || !PAYMENT_ID_RE.test(paymentId)) return json({ ignored: true });
  try {
    const { order, payment } = await confirmPayment(env, paymentId, url.origin);
    console.log('[webhook] pago', paymentId, payment.status, '-> pedido', order ? `${order.id} (${order.status})` : 'desconocido');
    return json({ ok: true });
  } catch (err) {
    console.error('[webhook] error', paymentId, err.message);
    return json({ error: 'retry' }, 500); // Mercado Pago reintentará
  }
}

async function handleResend(request, env, url) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Ingresa un correo válido.' }, 400);
  const c = cfg(env);
  if (!mailEnabled(env)) {
    return json({ ok: true, message: `Escríbenos a ${c.contactEmail} desde el correo de tu compra y te ayudamos con tu descarga.` });
  }
  const id = await env.KV.get(`email:${email}`);
  const order = id ? await getOrder(env, id) : null;
  if (order && order.status === 'paid') {
    const token = await issueDownload(env, order);
    await deliver(env, order, token, url.origin);
  }
  return json({ ok: true, message: 'Si existe una compra confirmada con ese correo, te enviaremos un nuevo enlace de descarga en unos minutos.' });
}

async function handleDownload(env, token) {
  const c = cfg(env);
  const help = `Escríbenos a <a href="mailto:${esc(c.contactEmail)}">${esc(c.contactEmail)}</a> y te ayudamos.`;
  const order = await findByToken(env, token);
  if (!order || order.status !== 'paid') {
    return messagePage(env, 404, 'Enlace no válido', `Este enlace de descarga no existe o fue reemplazado por uno nuevo. ${help}`);
  }
  const d = order.download;
  if (Date.now() > Date.parse(d.expiresAt)) {
    return messagePage(env, 410, 'Enlace vencido', `Este enlace venció. Pide uno nuevo en la sección “¿Ya compraste?” de la página o ${help}`);
  }
  if (d.count >= c.maxDownloads) {
    return messagePage(env, 410, 'Límite de descargas alcanzado', `Ya usaste las ${c.maxDownloads} descargas de este enlace. ${help}`);
  }
  const file = await env.KV.getWithMetadata(c.pdfKey, { type: 'stream' });
  if (!file || !file.value) {
    console.error('[descarga] PDF no encontrado en KV con la clave', c.pdfKey);
    return messagePage(env, 503, 'Descarga no disponible por el momento', `Tu compra está confirmada, pero el archivo no está disponible ahora mismo. ${help}`);
  }
  d.count += 1;
  await putOrder(env, order);
  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${c.pdfName.replace(/"/g, '')}"`,
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (file.metadata && file.metadata.size) headers['Content-Length'] = String(file.metadata.size);
  return withHeaders(new Response(file.value, { headers }));
}

async function handleDemo(request, env, url, id) {
  const order = await getOrder(env, id);
  if (!order) return messagePage(env, 404, 'Pedido no encontrado', 'Vuelve a la página e inicia la compra otra vez.');
  if (request.method === 'POST') {
    const form = await request.formData();
    if (form.get('r') === 'approved') {
      await markPaid(env, order, `demo-${Date.now()}`, url.origin);
      return Response.redirect(`${url.origin}/gracias?pedido=${order.id}&status=approved`, 302);
    }
    order.lastPaymentStatus = 'rejected';
    await putOrder(env, order);
    return Response.redirect(`${url.origin}/gracias?pedido=${order.id}&status=rejected`, 302);
  }
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago de prueba</title><link rel="stylesheet" href="/assets/css/styles.css"></head>
<body class="msg-page"><main class="msg-card"><p class="eyebrow">Modo demo · pago simulado</p><h1>S/ ${order.amount.toFixed(2)}</h1><p>Pedido ${esc(order.id)}<br>${esc(order.email)}</p>
<form method="post"><button class="btn btn--primary" name="r" value="approved">Simular pago aprobado</button> <button class="btn btn--ghost" name="r" value="rejected">Simular rechazo</button></form></main></body></html>`;
  return withHeaders(new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname === '/api/checkout' && method === 'POST') return await handleCheckout(request, env, url);
      if (pathname === '/api/webhooks/mercadopago' && method === 'POST') return await handleWebhook(request, env, url);
      if (pathname === '/api/reenviar' && method === 'POST') return await handleResend(request, env, url);
      let m = pathname.match(/^\/api\/pedidos\/([0-9a-f-]{36})$/);
      if (m && method === 'GET') return await handleOrderStatus(env, url, m[1]);
      m = pathname.match(/^\/descargar\/([A-Za-z0-9_-]+)$/);
      if (m && method === 'GET') return await handleDownload(env, m[1]);
      m = pathname.match(/^\/demo\/pagar\/([0-9a-f-]{36})$/);
      if (m && cfg(env).mode === 'demo' && isLocal(url)) return await handleDemo(request, env, url, m[1]);
      if (pathname === '/healthz') {
        const pdf = await env.KV.get(cfg(env).pdfKey, { type: 'stream' });
        if (pdf) await pdf.cancel();
        const c = cfg(env);
        return json({ ok: true, mode: c.mode, pdf: Boolean(pdf), mercadopago: Boolean(c.mpToken), webhookSecret: Boolean(c.mpWebhookSecret), downloadSecret: Boolean(c.downloadSecret), email: mailEnabled(env) });
      }
      if (pathname.startsWith('/api/')) return json({ error: 'No encontrado' }, 404);
    } catch (err) {
      console.error('[error]', pathname, err && err.stack ? err.stack : err);
      if (pathname.startsWith('/api/')) return json({ error: 'Error interno' }, 500);
      return messagePage(env, 500, 'Algo salió mal', 'Inténtalo nuevamente en unos minutos.');
    }

    // Archivos estáticos (landing, gracias, legal, assets).
    const res = await env.ASSETS.fetch(request);
    if (res.status === 404) return messagePage(env, 404, 'Página no encontrada', 'La página que buscas no existe.');
    return res;
  },
};
