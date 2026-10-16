# La app con la identidad de Venka

**Fecha:** 2026-10-13 · **Tipo:** spec de diseño
**Frente:** solo frontend. Hoy la app se llama "Prueba Técnica", su logo es el ícono `i-lucide-zap`
y usa la paleta por defecto de Nuxt UI.
**Fuente de la marca:** `/Users/m2pro/cmatheus/publicidad/marca/IDENTIDAD.md` (proyecto aparte, fuera
del monorepo). Las maquetas aprobadas están en `publicidad/propuestas/login/` y
`publicidad/propuestas/inicio/`.
**Decisiones del owner:** § 2, tomadas el 2026-10-13 en una ronda de AskUserQuestion, con las
maquetas renderizadas a la vista.

---

## 1. El problema

La marca comercial es **Venka** (Venka Restaurante, Venka Almacén) y la publicidad va a mostrar la
app. Hoy la app no tiene identidad: el ingreso dice "Prueba Técnica", el logo es un rayo genérico
repetido en cuatro lugares y el color principal es el verde por defecto de Nuxt UI, que no es el de
la marca. Un video de la app así contradice la publicidad que la presenta.

## 2. Las decisiones que lo sostienen

| Decisión | Elegida | Descartada y por qué |
|---|---|---|
| Alcance | Tema global + pantallas de marca + layout | Rediseñar las tarjetas del Inicio: ~8 componentes más; las tarjetas toman la paleta solas |
| Tipografías | Dentro de la app (archivos propios) | Google Fonts: cada carga depende de Google y le dice qué local abrió la app |
| Línea bajo el local ("Venka Restaurante") | No se muestra; queda en `desarrollo-nuevo.md` | Deducirla de los módulos: regla de negocio nueva que etiqueta mal a un local con las dos cosas |
| Tarjeta de ejemplo en el ingreso | Se queda, como ilustración | Quitarla: pierde la prueba concreta de la promesa |
| Paleta | **Petróleo y menta**, fondo blanco | La primera, "Libreta de almacén" (verde bosque, crema, mostaza): muy oscura y antigua, sin energía. "Verde vivo": la recomendaba el agente por la energía; el owner prefirió petróleo |
| Mecanismo del color | Paleta `venka` completa asignada a `primary` | Pisar solo `--ui-primary`: los unos 20 archivos que usan `primary-50`…`primary-600` quedarían con el verde de Nuxt. Agregar `brand` aparte: los botones seguirían con el verde genérico |

Las cinco primeras filas son del owner; la sexta la propuso el agente y el owner la aprobó con el
diseño completo. La paleta se cambió el 2026-10-15, después de escrita esta spec: el owner comparó
cuatro direcciones y después dos aplicadas al ingreso, el inicio y un post (`publicidad/propuestas/paletas/`).

## 3. Qué cambia

### 3.1 Tema global (`app/assets/css/main.css`, `app.config.ts`)

- **Paleta `venka`, del 50 al 950**, definida con `@theme` y asignada como `primary`. Requisito
  medible: en modo claro, **`--ui-primary` resuelve exactamente a `#0E4D57`** (el petróleo de marca),
  y el texto de un botón sólido sobre él pasa **WCAG AA (≥ 4,5:1)**. Cómo se arma la escala para
  que eso se cumpla (en qué tono cae la marca, o si se pisa `--ui-primary` hacia otro tono) lo
  decide la implementación midiendo.
- **`neutral` queda en `slate`**, el gris frío por defecto de Nuxt UI, que combina con el petróleo.
- **Un token de marca suelto, `menta` (`#7FD8C3`)**, para el sello, la marca de la sección activa y
  los acentos sobre petróleo. El fondo de las pantallas de marca es **blanco** (`bg-default`), sin
  token propio. `design:check` solo prohíbe neutrales hardcodeados (`check-design-tokens.mjs`), así
  que admite `menta`; igual va como token, nunca como `bg-[#…]`.
- **Tipografías:**
  - **DM Sans** como `--font-sans`: la letra de toda la interfaz.
  - **Bricolage Grotesque** como `font-display`: **solo** títulos de pantalla, titulares de las
    pantallas de marca y la palabra del logo cuando va como texto.
  - Archivos **woff2, subconjunto latino** (cubre á é í ó ú ñ ü ¿ ¡), variables, servidos por la
    app con `@font-face` y **precargados**, para que la letra no salte al cargar. Cada uno con su
    licencia OFL al lado.
  - Sin dependencia nueva: nada de `@nuxt/fonts`.
- **Lo que no cambia de color:** los colores financieros de Caja y el verde y rojo de "sube/baja".
  El petróleo de marca es un azul verdoso y no se confunde con el verde de "subió" ni con el de
  éxito, así que los números siguen con el verde y el rojo estándar. Así lo vio el owner en la
  maqueta del inicio.

### 3.2 El marco de las pantallas de marca (componente nuevo)

Las ocho páginas con `layout: false` se dividen en dos:

| Hoy | Páginas | Qué pasa |
|---|---|---|
| El rayo **como logo** | `login`, `register`, `select-tenant` | Se reemplaza por el logo de Venka |
| Un ícono **de la acción** (llave, sobre, check) | `forgot-password`, `invitacion/[token]`, `confirmacion/[token]`, `verificar/[token]`, `no-tenant` | El ícono se queda, porque dice qué pasa; el logo de Venka va arriba |

El marco común (fondo blanco, logo positivo arriba, título en `font-display`) se repite en siete de
las ocho, así que va en **un componente compartido** (regla de `CLAUDE.md`: se extrae a la tercera).
El ingreso lo usa en tablet y en escritorio agrega el panel de marca.

### 3.3 El ingreso (`login.vue`)

Como la maqueta `publicidad/propuestas/login/`:

- **Escritorio (≥ 1024 px):** dos columnas. A la izquierda, panel petróleo con el logo en negativo,
  *"Tu caja, a la vista."*, la bajada *"Cada cortesía y anulación queda con nombre, hora y motivo.
  Cierras el local tranquilo."*, la tarjeta de ejemplo del cierre (decorativa, `aria-hidden`) y los
  dos chips de línea. A la derecha, el formulario sobre blanco.
- **Tablet (768 px):** solo el marco y el formulario.
- **Título** *"Ingresa a tu caja"* y debajo *"Las cuentas claras conservan la amistad."*
- **"¿Olvidaste tu contraseña?"** pasa a la fila del rótulo de la contraseña; el checkbox queda solo.

### 3.4 El layout (`layouts/dashboard.vue`, `AppNavbar.vue`)

- **Menú lateral petróleo de marca:**
  - el logo en negativo arriba (el sello solo cuando el menú está colapsado);
  - debajo, **solo el nombre del local**, sin la línea;
  - la sección activa con fondo más claro y una marca menta a la izquierda.
- **Encabezado:** el título de la pantalla en `font-display`.
- El fallback `'Prueba Técnica'` del nombre del local pasa a `'Venka'`.

### 3.5 Archivos de marca

Copiados de `publicidad/marca/logos/` (generados con el texto convertido a trazos, sin depender de
la fuente) a `frontend/public/`: logo positivo y negativo, sello, `favicon.ico`,
`apple-touch-icon.png`, `icon-192.png` e `icon-512.png`. El título de la pestaña pasa a **"Venka"**.

## 4. Fuera de alcance

- La forma de las tarjetas del Inicio (§ 2).
- **El rubro del local:** va como entrada en `docs/agent/desarrollo-nuevo.md`: guardar si un local es
  restaurante o almacén, para mostrar su línea bajo el nombre.
- Modo oscuro: la app fuerza modo claro (`nuxt.config.ts`, `colorMode.preference: 'light'`) y sigue
  así.
- Móvil (~375 px): fuera de alcance declarado en `docs/PRODUCTO.md`.

## 5. Contratos que no se rompen

`e2e/auth.setup.ts` entra a la app buscando, y esto sigue igual:

- el placeholder `tu@email.com`;
- un `input[type="password"]`;
- un `button[type="submit"]` habilitado con los campos llenos;
- en `/select-tenant`, un botón con el nombre de cada local;
- en `/`, el texto `Bienvenido`.

`data-qa="menu-lateral"` se conserva en el menú.

## 6. Cómo se verifica

- **Gate de `CLAUDE.md`:** `npm run build`, `npm test`, `npm run typecheck:ratchet` y
  `npm run design:check` en el frontend, más la revisión independiente de `verify-feature`.
- **Playwright de lo relacionado (🎭):**
  - `e2e/auth.setup.ts` (ingreso y elegir local);
  - `e2e/layout/menu-lateral.spec.ts`;
  - `e2e/layout/desborde.spec.ts` (sin scroll horizontal a 1280 y 768);
  - `e2e/inicio/dashboard.spec.ts` y `e2e/smoke/dashboard.smoke.spec.ts`;
  - `e2e/tenants/aislamiento.spec.ts` (cambia de local).
- **Unitarios que tocan lo mismo:** `app/composables/useMenuLateral.nuxt.spec.ts` y
  `app/middleware/auth.spec.ts`.
- **Contraste medido, no afirmado:** el texto sobre `primary`, el blanco sobre el petróleo del menú y el
  texto atenuado del menú, con la cifra en el cierre.
- **Capturas de la app real** a 1280 y 768 px del ingreso y del inicio, comparadas con las maquetas.

## 7. Documentación que cambia (mismo commit)

- `frontend/docs/DESIGN-SYSTEM.md`: la paleta `venka`, el token `menta`, las dos tipografías y cuándo va `font-display`. La tabla "Branding Exceptions" se
  reescribe con el componente del marco en vez de los cinco archivos sueltos.
- `docs/ESTADO.md`: fila nueva.
- `docs/agent/desarrollo-nuevo.md`: la entrada del rubro del local (§ 4).
