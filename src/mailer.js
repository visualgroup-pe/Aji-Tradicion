'use strict';

const config = require('./config');

let transporter = null;
function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

const isEnabled = () => Boolean(config.smtp.host);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendDownloadEmail(order, token) {
  const t = getTransporter();
  if (!t) return false;
  const link = `${config.baseUrl}/descargar/${token}`;
  const hours = config.download.ttlHours;
  const max = config.download.maxDownloads;
  const hi = order.name ? `Hola ${esc(order.name)},` : 'Hola,';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#F7F1E6;font-family:Arial,Helvetica,sans-serif;color:#2A1C14">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFCF6;border-radius:16px;padding:36px">
  <tr><td style="font-family:Georgia,serif;font-size:26px;color:#B23A1E;padding-bottom:4px">Ají Tradición</td></tr>
  <tr><td style="font-size:16px;line-height:1.6;padding:16px 0">${hi}<br>¡Gracias por tu compra! Tu pago fue confirmado y tu recetario de <strong>100 recetas peruanas</strong> ya está listo.</td></tr>
  <tr><td style="padding:8px 0 20px"><a href="${link}" style="display:inline-block;background:#B23A1E;color:#fff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px">Descargar mi recetario (PDF)</a></td></tr>
  <tr><td style="font-size:13px;line-height:1.6;color:#6B5847">El enlace es personal, vence en ${hours} horas y permite hasta ${max} descargas. Guarda el PDF en tu equipo o en la nube.<br>Pedido: ${esc(order.id)}<br>¿Algún problema? Escríbenos a ${esc(config.site.contactEmail)}.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${order.name ? `Hola ${order.name},` : 'Hola,'}\n\n¡Gracias por tu compra! Tu pago fue confirmado.\nDescarga tu recetario aquí: ${link}\n\nEl enlace vence en ${hours} horas y permite hasta ${max} descargas.\nPedido: ${order.id}\nSoporte: ${config.site.contactEmail}\n`;
  await t.sendMail({
    from: config.smtp.from,
    to: order.email,
    subject: 'Tu recetario Ají Tradición está listo para descargar',
    text,
    html,
  });
  return true;
}

module.exports = { isEnabled, sendDownloadEmail };
