# Ají Tradición — identidad de marca

## 1. Exploración de nombre

| Nombre | Recordación | Pronunciación | Potencial comercial | Identidad peruana | Ampliación futura | Total |
|---|---|---|---|---|---|---|
| **Ají Tradición** | 5 | 5 | 5 | 5 | 5 | **25** |
| Sazón Andina | 4 | 5 | 4 | 4 | 3 (deja fuera costa y selva) | 20 |
| Mesa Criolla | 4 | 5 | 4 | 4 | 3 (lo “criollo” es un estilo concreto) | 20 |
| Fogón Peruano | 3 | 4 | 4 | 4 | 4 | 19 |
| Cocina Chalaca | 3 | 4 | 3 | 4 | 2 (muy regional) | 16 |

**Elegido: Ají Tradición.**

- **Ají** es el ingrediente más reconocible de la cocina peruana y da color, calidez y un isotipo inmediato.
- **Tradición** aporta confianza y respaldo editorial, sin caer en lo folclórico.
- Escala bien a una colección: *Ají Tradición · Postres*, *· Cocina Criolla*, *· Ceviches*, *· Navidad*, etc. El descriptor “Recetarios peruanos” ya funciona como paraguas.
- Es fácil de pronunciar en español y también para hispanohablantes fuera del Perú.

## 2. Logotipo

Archivos en `public/assets/brand/` (texto convertido a trazos, sin dependencia de fuentes):

| Archivo | Uso |
|---|---|
| `logo.svg` / `logo-claro.svg` | Logo principal apilado (fondos claros / oscuros) |
| `logo-horizontal.svg` / `logo-horizontal-claro.svg` | Cabecera web, firmas, documentos |
| `isotipo.svg` / `isotipo-claro.svg` | Sello con ají: redes, sellos, marcas de agua |
| `avatar-redes.svg`, `apple-touch-icon.png` | Foto de perfil en redes sociales |
| `favicon.svg`, `favicon-32.png`, `icon-192.png`, `icon-512.png` | Favicon y app icons |
| `og-image.jpg` | Imagen al compartir el enlace (1200×630) |

**Concepto.** Un ají estilizado dentro de un sello circular: una forma simple y cálida que se lee incluso a 16 px. El tallo en amarillo ají y el sello en rojo ají remiten al producto; el anillo interior da el acabado de “sello de calidad” editorial. El wordmark combina **Ají** en serif romana con **Tradición** en itálica, como una portada de libro de cocina.

Regenerar: `pip install fonttools brotli && python3 scripts/build-brand.py` y `node scripts/build-social.js`.

**Área de respeto:** la altura de la “A” alrededor del logo. **Tamaño mínimo:** isotipo 16 px; logo horizontal 120 px de ancho.

## 3. Paleta

| Token | Hex | Uso |
|---|---|---|
| Marfil | `#FAF4EA` | Fondo principal |
| Crema | `#F2E7D5` | Secciones alternas |
| Papel | `#FFFCF6` | Tarjetas |
| Rojo ají | `#B23A1E` | Acento, botones de compra, isotipo |
| Rojo ají profundo | `#8E2C15` | Hover de botones |
| Amarillo ají | `#E9A23B` | Destacados sobre fondos oscuros |
| Oliva | `#56683A` | Color secundario, etiquetas, checks |
| Cacao | `#2A1C14` | Titulares y fondos oscuros |
| Texto | `#45352A` | Texto corrido |
| Noche | `#1C130E` | Galería y pie de página |

El botón principal (blanco sobre `#B23A1E`) tiene un contraste de 5.97:1 (WCAG AA); el texto secundario `#6E5B4B` sobre marfil, 5.89:1.

## 4. Tipografía

- **Fraunces** (serif editorial variable, eje óptico): titulares, precios, nombres de platos. Itálica para el énfasis emocional (“*en tu cocina*”).
- **Manrope** (sans geométrica humanista): textos, botones, etiquetas.

Ambas con licencia SIL Open Font License, auto-alojadas en `public/assets/fonts/` (sin llamadas a Google Fonts).

## 5. Sistema visual

- Radios: 10 / 18 / 28 px. Botones en píldora.
- Sombras suaves de una sola capa; nada de gradientes genéricos.
- Fotografía cálida, con fondo oscuro o madera, encuadre cerrado sobre el plato.
- Etiquetas en mayúsculas con tracking amplio (`.eyebrow`) para jerarquía editorial.
- Microanimaciones: aparición al hacer scroll, hover con elevación de 2–4 px, zoom lento en fotos. Todo se desactiva con `prefers-reduced-motion`.
