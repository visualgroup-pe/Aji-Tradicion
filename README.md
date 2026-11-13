# Ají Tradición — tienda del recetario digital

Landing de conversión + tienda para vender el **recetario digital en PDF con 100 recetas peruanas**, sobre el plan **gratuito de Cloudflare Workers** y con cobros por **Mercado Pago Checkout Pro** (soles, Perú).

- **Sitio:** HTML/CSS/JS sin frameworks, fuentes e imágenes auto-alojadas (AVIF + WebP responsivas). Se genera desde `public/` con `npm run build`.
- **Backend:** un Cloudflare Worker (`worker/`) que crea el pago, recibe los webhooks y entrega el PDF.
- **PDF:** guardado en **Workers KV** (privado). No está en GitHub ni tiene URL pública: solo se descarga con un enlace firmado que se emite **después de verificar el pago contra la API de Mercado Pago**.

Identidad de marca, paleta y tipografías: [`BRAND.md`](BRAND.md).

---

## Cómo funciona la compra

```
Visitante ─► "Comprar" ─► correo + términos ─► POST /api/checkout
                                                  │ crea pedido en KV (pending)
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
                         pedido = paid · enlace /descargar/:token
                         (vence en DOWNLOAD_TTL_HOURS, máx. DOWNLOAD_MAX descargas)
                         + correo con el enlace (opcional, vía Resend)
```

Garantías:

- Nunca se confía en los parámetros de regreso ni en el cuerpo del webhook: **siempre** se vuelve a consultar el pago en la API de Mercado Pago.
- Un pago solo cuenta si está `approved`, su `external_reference` es el pedido, la moneda es `PEN` y el monto cubre el precio.
- Los webhooks se autentican con la clave secreta de Mercado Pago (`MP_WEBHOOK_SECRET`, cabecera `x-signature`).
- Los enlaces de descarga se firman con HMAC (`DOWNLOAD_SECRET`); en KV solo se guarda su hash.
- CSP estricta sin scripts en línea y demás cabeceras de seguridad (`public/_headers` y el Worker).
- El modo demo (`PAYMENT_MODE=demo`) solo responde en `localhost`.

## Configuración

### Valores públicos — `wrangler.json` → `vars`

| Variable | Qué es |
|---|---|
| `PRICE_PEN` | Precio en soles, p. ej. `29.90` |
| `COMPARE_PRICE_PEN` | Precio tachado. Úsalo solo si de verdad vendiste antes a ese precio |
| `CONTACT_EMAIL`, `CONTACT_WHATSAPP` | Contacto que se muestra en la página |
| `BUSINESS_NAME`, `BUSINESS_RUC` | Datos del negocio en el pie de página |
| `COMPLAINTS_BOOK_URL` | Libro de Reclamaciones virtual (obligatorio en Perú) |
| `DOWNLOAD_TTL_HOURS`, `DOWNLOAD_MAX` | Vigencia y límite del enlace de descarga |
| `MAIL_FROM` | Remitente del correo con el enlace (requiere `RESEND_API_KEY`) |
| `PUBLIC_URL` | URL pública de la tienda (para enlaces canónicos y Open Graph) |

Tras cambiarlos: `npm run deploy` (o push si el despliegue automático está activo).

### Secretos — Cloudflare → Workers → `aji-tradicion` → Settings → Variables and Secrets

| Secreto | De dónde sale |
|---|---|
| `MP_ACCESS_TOKEN` | Mercado Pago → Tus integraciones → tu aplicación → **Credenciales de producción** → Access Token |
| `MP_WEBHOOK_SECRET` | Mercado Pago → Tus integraciones → tu aplicación → **Webhooks** → Clave secreta |
| `DOWNLOAD_SECRET` | Una cadena larga y aleatoria (ya configurada en el primer despliegue) |
| `RESEND_API_KEY` | Opcional: https://resend.com para enviar el enlace por correo |

### Mercado Pago

1. Crea una aplicación de **Checkout Pro** en *Tus integraciones* (cuenta de Mercado Pago Perú).
2. Copia el Access Token de producción en el secreto `MP_ACCESS_TOKEN`.
3. En **Webhooks**, modo producción, pon la URL `https://TU-TIENDA/api/webhooks/mercadopago`, marca el evento **Pagos**, guarda y copia la **clave secreta** en `MP_WEBHOOK_SECRET`.
4. Comprueba `https://TU-TIENDA/healthz`: `mercadopago`, `webhookSecret`, `downloadSecret` y `pdf` deben estar en `true`.
5. Haz una compra real de bajo monto y verifica la descarga.

Los medios de pago disponibles (tarjetas, billeteras, PagoEfectivo, etc.) dependen de lo que tengas habilitado en tu cuenta de Mercado Pago.

### PDF del recetario

Se guarda en Workers KV (máx. 25 MB por archivo). Para subirlo o reemplazarlo:

```bash
npx wrangler kv key put --binding KV "file:recetario-100-recetas-peruanas.pdf" --path ./recetario.pdf --remote --metadata '{"size":TAMAÑO_EN_BYTES}'
```

El PDF nunca debe subirse a este repositorio: es público. `.gitignore` ignora `*.pdf`.

## Desarrollo local

Requisitos: Node.js 22.9 o superior.

```bash
npm install
```

```bash
npx wrangler kv key put --binding KV "file:recetario-100-recetas-peruanas.pdf" --path ./recetario.pdf --local
```

```bash
npm run dev
```

Abre http://localhost:8787, pulsa “Comprar” y elige “Simular pago aprobado” (modo demo, sin cobros).

Pruebas automáticas:

```bash
npm test
```

## Despliegue

```bash
npm run deploy
```

La tienda queda en `https://aji-tradicion.<tu-subdominio>.workers.dev`. Para usar un dominio propio: Cloudflare → Workers → `aji-tradicion` → Settings → Domains & Routes.

Plan gratuito de Cloudflare: 100 000 solicitudes al día y Workers KV con 100 000 lecturas y 1 000 escrituras diarias (cada venta usa unas 8 escrituras), sin tarjeta de crédito.

## Vista previa en GitHub Pages

GitHub Pages solo sirve archivos estáticos, así que publica una **vista previa del diseño** sin pagos (el botón de compra muestra un aviso). El workflow `.github/workflows/pages.yml` la publica en cada push; `docs/` contiene la misma vista previa para el modo “Deploy from a branch”. Tras cambiar la landing: `npm run build:pages` y commit de `docs/`.

## Fotografías

Las fotos de la landing son de **Pexels** (uso comercial gratuito, https://www.pexels.com/license/); créditos en `/legal#creditos`. La sección “Por dentro” muestra páginas reales del recetario. Para añadir imágenes: agrégalas a `scripts/images.json`, ejecuta `python3 scripts/optimize-images.py <carpeta>` e insértalas con `<x-img name="…" sizes="…" alt="…">`.

## Estructura

```
worker/index.js        Rutas del Worker (checkout, webhook, pedidos, descarga)
worker/lib.js          Mercado Pago, pedidos en KV, tokens, correo
wrangler.json          Configuración de Cloudflare y valores públicos
public/                Plantillas del sitio ({{VARIABLES}} y <x-img>) y assets
src/render.js          Renderizado de plantillas
scripts/build-site.js  Genera dist/ (tienda) o docs/ (vista previa)
test/                  Pruebas del Worker
docs/                  Vista previa para GitHub Pages
```

## Analítica

`app.js` y `gracias.js` envían los eventos `begin_checkout`, `add_payment_info` y `purchase` a `window.dataLayer`. Para usar Google Tag Manager o Meta Pixel, añade su script y amplía la CSP en `public/_headers` y `worker/index.js`.
