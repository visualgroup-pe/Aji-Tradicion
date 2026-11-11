# Ají Tradición — landing de venta del recetario digital

Landing page de conversión + backend de pago y entrega segura para vender el **recetario digital en PDF con 100 recetas peruanas**.

- **Frontend:** HTML/CSS/JS sin frameworks (rápido, sin build). Fuentes e imágenes auto-alojadas (AVIF + WebP responsivas).
- **Backend:** Node.js + Express. Pagos con **Mercado Pago Checkout Pro** (PEN, Perú).
- **Entrega:** el PDF vive en una ruta privada; solo se descarga mediante un enlace firmado que se emite **después de verificar el pago contra la API de Mercado Pago**.

Identidad de marca, paleta y tipografías: ver [`BRAND.md`](BRAND.md).

---

## Puesta en marcha

Requisitos: Node.js 22.9 o superior.

```bash
npm install
```

```bash
cp .env.example .env
```

Copia tu PDF a `private/` (o indica otra ruta en `PDF_PATH`):

```bash
cp /ruta/a/tu/recetario.pdf private/recetario-100-recetas-peruanas.pdf
```

Prueba local con pagos simulados (no cobra nada):

```bash
npm run dev
```

Abre http://localhost:3000, pulsa “Comprar”, completa el correo y elige “Simular pago aprobado”.

Pruebas automáticas:

```bash
npm test
```

## Cómo funciona la compra

```
Visitante ─► "Comprar" ─► correo + términos ─► POST /api/checkout
                                                  │ crea pedido (pending)
                                                  │ crea preferencia en Mercado Pago
                                                  ▼
                                  Checkout Pro de Mercado Pago (pago)
                                                  │
              ┌───────────────────────────────────┴──────────────────────┐
              ▼                                                          ▼
  Webhook POST /api/webhooks/mercadopago              Regreso a /gracias?pedido=…&payment_id=…
  (firma x-signature validada)                        (la página consulta /api/pedidos/:id)
              └──────────────► GET /v1/payments/:id en Mercado Pago ◄────┘
                               ¿approved + mismo pedido + monto + PEN?
                                                  │ sí
                                                  ▼
                         pedido = paid · se emite enlace /descargar/:token
                         (vence en DOWNLOAD_TTL_HOURS, máx. DOWNLOAD_MAX descargas)
                         + correo con el enlace (si SMTP está configurado)
```

Garantías de seguridad:

- El PDF **no** está en `public/` y no tiene URL pública. `/descargar/:token` lo transmite solo si el pedido está pagado, el enlace no venció y no superó el límite.
- Nunca se confía en los parámetros de regreso ni en el cuerpo del webhook: **siempre** se vuelve a consultar el pago en la API de Mercado Pago con tu Access Token.
- Un pago solo cuenta si está `approved`, su `external_reference` es el pedido, la moneda es `PEN` y el monto cubre el precio.
- Los webhooks se autentican con la clave secreta (`MP_WEBHOOK_SECRET`, cabecera `x-signature`).
- Los tokens de descarga se derivan con HMAC (`DOWNLOAD_SECRET`) y en disco solo se guarda su hash.
- Cabeceras de seguridad (CSP estricta sin scripts en línea, `X-Frame-Options`, HSTS en producción) y límite de solicitudes en la API.
- `PAYMENT_MODE=demo` se niega a arrancar con `NODE_ENV=production`.

## Configurar Mercado Pago (Perú)

1. Crea o usa tu cuenta de vendedor en Mercado Pago Perú y entra a **Tus integraciones → Crear aplicación** (producto: Checkout Pro).
2. Copia el **Access Token de producción** en `MP_ACCESS_TOKEN`. Para pruebas usa las credenciales y usuarios de prueba que da el mismo panel.
3. En **Webhooks**, configura la URL `https://TU-DOMINIO/api/webhooks/mercadopago`, marca el evento **Pagos** y copia la **clave secreta** en `MP_WEBHOOK_SECRET`.
4. Define `BASE_URL` con tu dominio **https** (Mercado Pago no acepta URLs http para volver al sitio).
5. Los medios de pago disponibles (tarjetas, PagoEfectivo, billeteras, etc.) dependen de lo que tengas habilitado en tu cuenta; la landing no promete ninguno en particular más allá de tarjetas.

## Correo (recomendado)

Si defines `SMTP_HOST` (y usuario/clave), el comprador recibe el enlace de descarga por correo al confirmarse el pago, y funciona el formulario “¿Ya compraste y perdiste tu enlace?”. Sirve cualquier proveedor SMTP (Google Workspace, Zoho, Brevo, Amazon SES…). Sin SMTP, la descarga se entrega en la página de confirmación y el formulario de recuperación indica escribir a `CONTACT_EMAIL`.

## Despliegue

Cualquier servidor o PaaS con Node 22 y disco persistente (Railway, Render, Fly.io, un VPS…):

```bash
NODE_ENV=production npm start
```

- `DATA_DIR` debe estar en un **volumen persistente** (allí se guardan los pedidos y el secreto de descarga).
- `PDF_PATH` puede apuntar a cualquier ruta privada del servidor o a un volumen montado.
- El almacén de pedidos es un archivo JSON pensado para **una sola instancia**. Para varias instancias, reemplaza `src/store.js` por una base de datos con la misma interfaz.
- Revisa `GET /healthz` tras desplegar: indica el modo de pago y si el PDF existe.

## Vista previa en GitHub Pages

GitHub Pages solo sirve archivos estáticos, así que publica una **vista previa del diseño**: la página completa, pero sin pagos (el botón de compra muestra un aviso) y sin el PDF. La venta real necesita el servidor Node descrito arriba.

- El workflow `.github/workflows/pages.yml` ejecuta las pruebas, genera `dist/` con `node scripts/build-static.js` y lo publica en cada push.
- Recomendado: en **Settings → Pages → Build and deployment → Source** elige **GitHub Actions**; así se publica siempre la última versión automáticamente.
- Si Pages está en modo **Deploy from a branch** (raíz o `/docs`), también funciona: la carpeta `docs/` contiene la vista previa ya generada y `index.html` en la raíz redirige a ella. Tras cambiar la landing, regenérala con `npm run build:pages` y haz commit de `docs/`.
- Generarla en local sin tocar `docs/`: `node scripts/build-static.js` (salida en `dist/`).

## Antes de publicar: lista de verificación

- [ ] **Contenido fiel al PDF.** Revisa en `public/index.html` los platos nombrados (galería y tarjeta “Y mucho más”, marcada con `<!-- EDITAR -->`) y la frase “del ceviche al ají de gallina”: deben estar en tu recetario. No se mencionan videos, clases ni bonos porque el producto no los incluye.
- [ ] Precio (`PRICE_PEN`). Usa `COMPARE_PRICE_PEN` solo si de verdad vendiste antes a ese precio.
- [ ] Datos del negocio: `BUSINESS_NAME`, `BUSINESS_RUC`, `CONTACT_EMAIL` y **`COMPLAINTS_BOOK_URL`** (Libro de Reclamaciones virtual, obligatorio en Perú).
- [ ] Revisa con asesoría legal `public/legal.html` (términos, privacidad, devoluciones). Tiene una nota interna para definir tu política de reembolsos.
- [ ] Haz una compra real de bajo monto y verifica webhook, correo y descarga.

## Fotografías

Todas las fotos publicadas son de **Pexels** (licencia de uso comercial gratuito, sin atribución obligatoria: https://www.pexels.com/license/), descargadas, revisadas una a una y convertidas a AVIF/WebP. Los créditos están en `/legal#creditos`.

Para ají de gallina, anticuchos, rocoto relleno, papa a la huancaína y arroz con pollo no se encontró fotografía profesional con licencia comercial clara (las disponibles en Wikimedia Commons eran de calidad amateur), así que esos platos se mencionan en texto y no con foto. La mejor opción es usar las **fotos del propio recetario** si tienes sus derechos: agrégalas a `scripts/images.json` y ejecuta:

```bash
python3 scripts/optimize-images.py /carpeta/con/las/fotos
```

En el HTML se insertan con `<x-img name="nombre" sizes="…" alt="…">`; el servidor genera el `<picture>` con AVIF, WebP, `srcset`, dimensiones y `loading="lazy"`.

## Estructura

```
server.js                 Servidor, rutas, descarga protegida, modo demo
src/config.js             Configuración desde variables de entorno
src/store.js              Pedidos (JSON) y tokens de descarga
src/payments/mercadopago.js  Preferencias, verificación de pagos y webhooks
src/mailer.js             Envío del enlace por correo (SMTP opcional)
public/index.html         Landing (plantilla con {{VARIABLES}} y <x-img>)
public/gracias.html       Confirmación y descarga
public/legal.html         Términos, privacidad, devoluciones, créditos
public/assets/            CSS, JS, fuentes, imágenes, marca
scripts/                  Generadores de marca, imágenes y redes
test/                     Pruebas del flujo de compra
private/                  PDF (ignorado por git)
data/                     Pedidos (ignorado por git)
```

## Analítica

`public/assets/js/app.js` y `gracias.js` empujan eventos `begin_checkout`, `add_payment_info` y `purchase` a `window.dataLayer`. Para usar Google Tag Manager o Meta Pixel, añade su script y amplía la CSP en `server.js` con sus dominios.
