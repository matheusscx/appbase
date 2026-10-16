# 08 · Ingreso y cuenta

Auditoría de UX del grupo "Ingreso y cuenta" de Venka (2026-10-16). Hace lo que dice la skill
`revisando-ux`: recorrido, matriz de estados, cuatro capas, evidencia. No arregla nada.

## 1. Alcance

- **Pantallas:** `login`, `register`, `forgot-password`, `select-tenant`, `no-tenant`,
  `confirmacion/[token]`, `verificar/[token]`, `invitacion/[token]` (y `recuperar/[token]`, que la
  reexporta), `auth/callback`, el componente `AppMarco`, Mi cuenta (`configuracion/perfil` con sus
  cuatro formularios) y `UserMenu`.
- **Quién y para qué (los tres roles del encargo):**
  1. *Quien entra por primera vez o vuelve a la mañana:* escribe correo y contraseña y llega a su local.
  2. *Quien olvidó la contraseña:* pide un link, elige una contraseña nueva y vuelve a entrar.
  3. *Quien fue invitada a un equipo:* abre el link del correo, elige contraseña (o acepta sumarse) y entra.
  Para Mi cuenta y el menú: `supervisor@paris.cl` (no es admin; el permiso real se verificó en el seed).
- **Cómo se revisó:** app corriendo en `http://localhost:5173` + código. Las públicas, sin sesión.
  Mi cuenta y el menú, con `supervisor@paris.cl`. Medidas con Playwright (`getComputedStyle`, contraste
  WCAG calculado con canvas porque Chrome devuelve los colores en `oklch()`), capturas a 1280 y 768
  (y el login a 1024×768, tablet horizontal).
- **Lo que se provocó en la base compartida:** 3 intentos de login fallidos con `audit+nadie@example.com`
  (cuenta inexistente), 1 registro de prueba `audit+ux-registro@example.com` (queda sin verificar), 1
  "olvidé mi contraseña" con `audit+olvido@example.com` (no existe), y en Mi cuenta: un guardado del perfil
  con los mismos valores y un cambio de contraseña con la contraseña actual equivocada (falló, no cambió nada).
- **Lo que se simuló** (con `page.route`, sin tocar la base): `/select-tenant` con dos y seis locales, cargando,
  error de lista, lista vacía y falla al elegir; la carga lenta de las pantallas de link y de `auth/callback`.
  Ese usuario no tiene dos locales y `admin@sistema.com` lo usa otro auditor.
- **Con token inventado** (`token-inventado`): los estados "cargando" y "link inválido" de
  `confirmacion`, `invitacion` y `recuperar`, y el clic de `verificar`. Los estados de éxito de esos links
  y de la lista real de locales quedan **por código**.
- **Capas:** 1 (POS/lenguaje del local), 2 (Nielsen), 3 (Vercel, texto literal de
  `.superpowers/auditoria-ux/vercel-guidelines.md`, bajado el 2026-10-16 con `curl`; no se volvió a bajar) y 4
  (WCAG 2.2 AA). Fuera de alcance: móvil, y las decisiones de identidad (paleta, fuentes).
- **Ya sabido y citado, no repetido:** los links en negro y no en petróleo son **00.2**; el voseo es el lote
  global **00.3** (abajo, 08.17, solo lo que confunde y lo que ese lote no ve); los overrides de `UCard` que
  no se aplican son **00.1**.

## 2. El flujo

| # | Flujo | Paso | Toques |
|---|---|---|---|
| A1 | Entrar | Abrir `/login` | 0 |
| A2 | | Tocar Email y escribir (no hay `autofocus`) | 1 |
| A3 | | Tocar Contraseña y escribir | 1 |
| A4 | | "Iniciar sesión" (o Enter) | 1 |
| A5 | | Con más de un local: elegir local en `/select-tenant` | 1 |
| | | **Total** | **3 con un local, 4 con varios** |
| B1 | Olvidé la contraseña | "¿Olvidaste tu contraseña?" en el login | 1 |
| B2 | | Correo (hay `autofocus`) y "Mandame el link" | 1 |
| B3 | | Abrir el link del correo → dos campos de contraseña → "Guardar y entrar" | 3 |
| B4 | | **Cae en `/login`**: correo, contraseña, "Iniciar sesión" | 3 |
| | | **Total** | **8 toques, dos formularios de contraseña seguidos** |
| C1 | Invitada (cuenta nueva) | Abrir link → contraseña, repetir, "Guardar y entrar" | 3 |
| C2 | | **Cae en `/login`**: correo, contraseña, "Iniciar sesión" | 3 |
| C3 | Invitada (ya tenía cuenta) | `/confirmacion/…` → "Sí, quiero sumarme" | 1 |
| C4 | | **Cae en `/login`** | 3 |
| D1 | Mi cuenta | Menú de usuario → "Mi Cuenta" | 2 |
| D2 | | Campo → "Guardar cambios" | 2 |

El cierre de B, C1 y C3 manda al login y no deja a la persona dentro: ver 08.3.

## 3. Matriz de estados

Columnas: **Vac**ío · **Car**gando · **Err**or · **Perm**iso/deshabilitado · **Inv**álido · **Éx**ito ·
**Pant**alla 768/1280 · **Dedo** · **Tec**lado y lector.

| Paso | Vac | Car | Err | Perm | Inv | Éx | Pant | Dedo | Tec |
|---|---|---|---|---|---|---|---|---|---|
| A · Login | ok (campos vacíos, botón atenuado hasta llenar) | ok (botón `loading`, campos bloqueados) | 08.10 | 08.7 | ok (validación nativa del `type=email`) | n/a: el éxito es salir de la pantalla | ok (1280 con panel de marca, 1024 con panel, 768 sin panel; no desborda) | 08.8 | 08.9 |
| A5 · Elegir local | 08.13 (lista vacía queda en blanco) | ok (spinner) | 08.11 | ok (las demás tarjetas se bloquean al elegir) | n/a: no hay campos | n/a: navega al inicio | 08.12 | 08.8 | ok (cada local es un `button` con foco visible) |
| B1–B2 · Pedir link | ok | ok (`loading`) | 08.10 (texto de error sobre blanco) | ok (botón deshabilitado sin correo) | 08.20 (sin errores propios, solo el nativo) | ok ("Vence en una hora"; sin el correo a la vista, 08.5 lo cubre en el registro) | ok | 08.8 | 08.20 |
| B3/C1 · Elegir contraseña | ok | 08.22 | 08.10 | ok (el mínimo está en el hint) | 08.26 | 08.3 | ok | 08.8 | 08.9 |
| C3 · Confirmar empresa | ok | 08.22 | 08.4 | n/a: los dos botones siempre disponibles | n/a: no hay campos | 08.3 | ok | 08.8 | ok |
| Verificar correo | ok (pide clic, no verifica al abrir) | ok (botón `loading`) | 08.4 | n/a: un solo botón | n/a: no hay campos | ok ("Correo verificado" + "Iniciar sesión") | ok | 08.8 | ok |
| Link inválido / vencido | n/a: no tiene lista | 08.22 | 08.4, 08.23 | n/a | n/a | n/a | ok (768 y 1280) | 08.8 | ok |
| Registro | ok | ok | 08.2 | ok | 08.2, 08.16 | 08.5 | ok (768×600 pide 62 px de scroll) | 08.8 | 08.9 |
| Mi cuenta | n/a: no hay listas; el bloque Mi PIN no sale si no eres garzón (por código) | ok (`loading` en cada botón) | 08.1, 08.2 | n/a: sin permiso especial, solo el PIN se esconde | 08.2 | ok (toast "Perfil actualizado") | 08.24 | 08.8 | ok (foco visible; labels asociados) |
| Menú de usuario | n/a: siempre 2 o 3 ítems | n/a: sin carga | n/a: sin error posible | n/a: "Cambiar Institución" aparece solo con 2+ locales | n/a: sin campos | n/a | ok | 08.8 | ok (Enter abre, Escape cierra) |
| `no-tenant` y `auth/callback` | ok | 08.22 | ok (vuelve al login con el aviso) | n/a | n/a | n/a | ok | 08.8 | ok |

## 4. Hallazgos

Ninguno es P0: aquí no hay cobros ni stock. El único P1 es salir echada de la sesión por tipear mal una
contraseña. Las capturas están en `frontend/e2e-auditoria/capturas/ingreso/` (se citan por nombre; cada una
existe en `-1280.png` y `-768.png`).

| # | Severidad | Confianza | Dónde | Qué pasa (escena concreta) | Propuesta | Decide |
|---|---|---|---|---|---|---|
| 08.1 | P1 | medido | `backend/src/modules/me/me.service.ts:72` (`UnauthorizedException`), `frontend/app/composables/useApiFetch.ts:19-47`; `ConfiguracionContrasenaForm` | La supervisora quiere cambiar su contraseña y tipea mal la "Contraseña actual". El servidor responde **401**; `useApiFetch` lo trata como sesión vencida, intenta el refresh, reintenta, vuelve a recibir 401 y hace `clearAuth()` + `navigateTo('/login')`. Resultado: aparece un toast "Contraseña actual incorrecta" que se va solo, ella queda en el login con la sesión cerrada y pierde lo que escribió (captura `micuenta-clave-actual-mala`). Un error de tipeo la saca del sistema. | Que el servidor responda 400 (mismo texto) cuando la contraseña actual no coincide, para que 401 siga significando solo "sesión inválida". No toca el sistema de tokens. Agregar un e2e del caso. Revisar si `MiPinForm` o cualquier otro "valor actual" usa 401 igual. | agente |
| 08.2 | P2 | medido (2 casos), código (el resto) | `backend/src/modules/auth/dto/register.dto.ts:15`, `me/dto/update-perfil.dto.ts:20`, `me/dto/update-contrasena.dto.ts:5,9,13`; `frontend/app/utils/api-error.ts`; `register.vue:65-71`; `PerfilForm.vue:26`; `ContrasenaForm.vue:15-18,48` | Los mensajes del validador salen **en inglés y con el nombre interno del campo**. En el registro, con 3 caracteres: "contrasena must be longer than or equal to 6 characters" (`register-clave-corta`). En Mi cuenta, con el nombre vacío (el campo lleva asterisco de obligatorio y el botón igual guarda): toast "nombre should not be empty". Por código, lo mismo para la contraseña nueva de menos de 8. Solo `elegir-contrasena.dto.ts:16` trae su mensaje en español, así que ahí se ve cómo debe ser. Además los errores de Mi cuenta van en un toast que se va, no junto al campo (la comparación de contraseñas ni siquiera llega al servidor y también es toast). | Mensajes en español en los DTOs (`{ message: 'Escribe tu nombre' }`, `'La contraseña debe tener al menos 8 caracteres'`) como ya hace `elegir-contrasena.dto.ts`. En el front, error junto al campo (`UFormField :error`) para nombre vacío y contraseñas que no coinciden. Probablemente es transversal a toda la app: conviene un barrido de DTOs sin `message`. | agente |
| 08.3 | P2 | código | `invitacion/[token].vue:84-85,135`; `confirmacion/[token].vue:82-86` | El botón dice "**Guardar y entrar**" y el toast "Listo, ya podés entrar", pero la pantalla manda al **login** y hay que volver a escribir correo y contraseña. Quien acaba de inventar una contraseña nueva la teclea otra vez. En `confirmacion` pasa igual: "Sí, quiero sumarme" termina en el login. | Cambiar el texto a lo que pasa: botón "Guardar contraseña", toast "Listo, ya puedes entrar" (tuteo). Iniciar sesión sola tocaría la emisión de tokens (invariante 4): no se propone sin el owner. | agente |
| 08.4 | P2 | medido | `invitacion/[token].vue:98-100`, `confirmacion/[token].vue:99-101`; textos en `backend/src/modules/auth/auth.service.ts:222,254,279` y `tenants.service.ts:1315` | El link vencido dice "Ese link ya no sirve… **Pedí uno nuevo**" (voseo) y el único botón es "Ir a iniciar sesión". Quien olvidó su contraseña y abre el link después de la hora (el propio texto de `forgot-password` dice "Vence en una hora") no tiene cómo pedir otro desde ahí: tiene que volver al login y acordarse de "¿Olvidaste?" (`recuperar-invalido`). Quien fue invitada no sabe a quién pedírselo. | En `/recuperar`: botón "Pedir otro link" a `/forgot-password`. En invitación y confirmación: "Pídele a quien te invitó que te envíe uno nuevo", sin botón al login como único camino. Cambiar el texto del backend a tuteo. | agente |
| 08.5 | P2 | medido | `register.vue:50-61` | Tras registrarse, el título sigue siendo "Crea tu cuenta" y el cuerpo dice "Si ese correo no tenía cuenta, te llega un link…": quien acaba de crearla lee un condicional que parece decir que quizá no se creó (la causa es legítima: no filtrar qué correos existen). No muestra a qué correo se mandó, así que un error de tipeo no se nota, ni sugiere mirar el spam. "Abrí el link" va en voseo (`register-enviado`). | Título "Revisa tu correo". Cuerpo: "Si {correo} no tenía cuenta, te enviamos un link para verificarla. Si no llega, revisa el spam." Mantener el condicional (la regla anti-enumeración no se toca). | agente |
| 08.6 | P2 | código | `invitacion/[token].vue:51`, `backend/src/modules/auth/auth.service.ts:248-260` (devuelve solo `{ correo }`) | La invitación dice "Te sumaron a un equipo con {correo}" y no nombra la empresa; `confirmacion` sí ("Te están sumando a {tenant}"). Quien recibe el correo de un local que no conoce no puede decidir si es legítimo antes de fijar su contraseña. | Que la consulta del link devuelva también el nombre de la empresa y el texto diga "Te sumaron a {empresa} con {correo}". | agente |
| 08.7 | P2 | código | `login.vue:9,143`; `backend/src/modules/auth/dto/login.dto.ts` (sin el campo); `auth.controller.ts:44` | "Mantener sesión iniciada" **no hace nada**: `state.keepSession` no se envía, el DTO no lo recibe y la cookie de sesión dura siempre 1 hora. Quien la marca en un computador compartido cree que va a quedar adentro (o la deja sin marcar y cree que se cierra sola). Es una promesa falsa en la pantalla más vista. | Quitar el checkbox (la maqueta lo trae, pero hoy no tiene respaldo), o definir qué significa. Lo segundo cambia la duración de la sesión, así que toca el sistema de tokens (invariante 4): lo decide el owner. | owner |
| 08.8 | P2 | medido | `login.vue`, `register.vue`, `forgot-password.vue`, `[token].vue`, `select-tenant.vue`, `UserMenu.vue`, Mi cuenta | Los controles miden **32 px** de alto: inputs y botón del login, 326×32; casilla "Mantener sesión" 16×16; "¿Olvidaste…?" y "Crear cuenta" 16–18 px de alto; "Cerrar sesión" de `select-tenant` 96×28; ítems del menú de usuario 175×32; el ícono "i" de Filas por página 24×24. La **maqueta aprobada** (`login-escritorio.png`) usa campos de ~42 px y botón de 44. A 768 (la tablet del local) el dedo falla más en el campo de contraseña pegado al ojo. | Para las públicas: `size="xl"` más `class="h-11"` en `UInput`/`UButton` (44 px), área tocable de 44 px en la casilla y los links. En el menú y Mi cuenta basta con 40 px: no es un flujo de mostrador. Aplicar solo al grupo; el resto de la app lo ve cada grupo. | agente |
| 08.9 | P2 | medido | `login.vue:131-139`, `register.vue:129-137` | El ojo de mostrar contraseña es un `<button tabindex="-1">` de 16×21 **sin nombre accesible**: no se llega con Tab y un lector de pantalla no lo anuncia (Tab del login: email → olvidaste → contraseña → casilla…; el ojo se salta). Y en `invitacion`/`recuperar`, `ContrasenaForm` y el registro no hay confirmación a ciegas distinta: se teclean 2 o 3 contraseñas sin poder verlas. | Un `UButton` ghost de solo ícono con `aria-label` "Mostrar contraseña"/"Ocultar contraseña", `aria-pressed`, sin `tabindex=-1` y de 44 px. Ponerlo también en los campos de `invitacion` y Mi cuenta. | agente |
| 08.10 | P2 | medido | `login.vue:92-98`, `register.vue:65`, `select-tenant.vue:39`; `forgot-password.vue:69`, `invitacion/[token].vue:124,130`, `confirmacion/[token].vue:123` | **Contraste:** el texto del aviso de error (`UAlert` subtle) mide **3,08:1** (rojo `#fb2c36` al 90 % sobre el fondo rosa); el texto de error suelto sobre blanco mide **3,81:1**. Mínimo: 4,5:1. **Lector:** el `UAlert` de login, registro y select-tenant no lleva `role="alert"` (se vio en el HTML), así que "Credenciales inválidas" no se anuncia (los de `forgot-password` e `invitacion` sí lo llevan). **Layout:** al aparecer, el aviso empuja el formulario 36 px hacia abajo justo cuando la persona va a reintentar (campo de email de 296 a 332 px). | `role="alert"` en los tres avisos. Un tono más oscuro de `error` para el texto (el 600 da 4,77:1 sobre blanco pero solo 4,14:1 sobre el rosa del aviso; el aviso necesita el 700, ≈5,6:1). Reservar el lugar del aviso o hacerlo `aria-live`. El color `error` es de Nuxt UI, no de la identidad: coordinar con 00 porque lo ve toda la app. | agente |
| 08.11 | P2 | medido (con la falla simulada) | `select-tenant.vue:38-48`, `frontend/app/stores/tenant.ts:31,58` | Quien elige su local y la llamada falla **pierde la lista**: la pantalla muestra solo el aviso rojo y "Reintentar", y ese botón vuelve a pedir la **lista**, no la elección; hay que elegir otra vez (2 toques extra y sin saber cuál falló). El texto de respaldo es jerga: "Error al cambiar de **tenant**" y "Error al cargar **tenants**" (`select-tenant-fallo-al-elegir`). | Mantener la lista visible y el aviso encima; reintentar la elección con un toque. Textos: "No pudimos entrar a ese local. Intenta de nuevo." y "No pudimos cargar tus locales." | agente |
| 08.12 | P2 | medido | `select-tenant.vue:25-29,75-77` | Con 4 locales o menos las tarjetas van en 2 columnas y el nombre se corta con `truncate` a unos 18 caracteres ("Almacén Los And…") sin `title` ni otra forma de leerlo completo. Dos locales como "Almacén Los Andes Centro" y "Almacén Los Andes Norte" se verían idénticos (`select-tenant-dos`). Quien elige el equivocado vende a nombre de otro local. | Una sola columna siempre (como ya hace con más de 4) o permitir 2 líneas (`line-clamp-2`) y poner el nombre completo en `title`. | agente |
| 08.13 | P3 | medido / código | `select-tenant.vue:14-17,54-83` | Los avatares toman uno de seis colores semánticos según la primera letra, **incluidos el rojo de error y el amarillo de advertencia**: el local "Ln" sale rojo y se lee como una alerta (`select-tenant-seis`). Ninguno es de la paleta de Venka. Y la lista vacía (solo por URL; el flujo normal manda a `/no-tenant`) deja la pantalla en blanco con solo "Cerrar sesión". | Avatares en tonos de la escala petróleo (o un solo tono) y, si la lista viene vacía, mandar a `/no-tenant`. | owner (el color es de identidad) |
| 08.14 | P3 | medido | `UserMenu.vue:13,21,29,38`; `layouts/dashboard.vue` (lateral) | Mayúscula en cada palabra donde la regla del proyecto es solo inicial: "Mi Cuenta", "Cerrar Sesión", "Cambiar Institución", "Super Administrador". El lateral dice "Cerrar sesión", y la pantalla de locales, "empresa" y "espacio de trabajo". Son tres palabras para lo mismo ("institución", "empresa", "espacio de trabajo") y hay **dos** "Cerrar sesión" a la vista (menú lateral y menú de usuario). | "Mi cuenta", "Cerrar sesión", "Cambiar de empresa" (la palabra de `select-tenant` y `no-tenant`), "Superadministrador". Dejar un solo "Cerrar sesión" o aceptar los dos a propósito. | agente |
| 08.15 | P3 | medido | `UserMenu.vue:21-23`; `pages/configuracion.vue` | El ítem "Mi Cuenta" lleva a una pantalla cuyo título de la barra es **"Configuración"** (el submenú recién dice "Mi cuenta › Perfil"). Quien busca "su cuenta" y llega a "Configuración" duda de haber llegado (`micuenta-1280`). | Título de la barra "Mi cuenta" cuando la ruta es `/configuracion/perfil`. | agente |
| 08.16 | P3 | código | `register.vue:123`, `register.dto.ts:15`; `elegir-contrasena.dto.ts:16`, `update-contrasena.dto.ts:9` | El registro pide mínimo **6** caracteres y no repite la contraseña; elegirla por link y cambiarla en Mi cuenta pide **8**. Una contraseña válida al registrarse puede ser rechazada si después se "recupera" con la misma. | Un solo mínimo para las tres entradas. Es regla de negocio. | owner |
| 08.17 | P3 | código | 15 líneas en este grupo (comando abajo); backend: `auth.service.ts:222,254,279`, `tenants.service.ts:1315` | Voseo del lote global **00.3**: "Ponés tu correo", "Mandame el link", "Abrí el link", "Confirmá que este correo es tuyo", "Elegí tu contraseña", "Repetila", "ya podés entrar", "Entrá de nuevo", "ya sos parte de", "vas a poder entrar… no tenés que crear", "Si cambiás de idea, volvé a abrir". **Ninguno confunde.** Dos cosas que ese lote no ve: (a) el voseo que llega **del backend** ("Pedí uno nuevo", "Volvé a registrarte y te mandamos uno nuevo"), porque el grep de 00.3 solo mira `frontend/app`; (b) el grep de 00.3, ejecutado en este shell, **no encuentra las palabras que terminan en vocal acentuada** ("Elegí", "Abrí", "Pedí", "Confirmá") porque `\b` no cuenta la `í` como letra en el locale por defecto: el 81 de 00.3 es un piso más bajo de lo que parece (en este grupo, con `LC_ALL=en_US.UTF-8`: 15 líneas; con el comando tal cual: 10). | Pasar los textos del grupo a tuteo en el lote de 00.3, incluyendo los cuatro del backend. Corregir el comando de 00.3 con `LC_ALL=en_US.UTF-8`. | agente |
| 08.18 | P3 | medido | `AppMarco.vue:66`, `login.vue:183` | Diferencias con la maqueta aprobada: los títulos y los links van en el gris casi negro de Nuxt UI (17,83:1) y no en el petróleo oscuro de la maqueta; los links como "Crear cuenta" no van en petróleo (**cita 00.2**); la tarjeta mide 384 px y la de la maqueta ~420; y los controles de 32 px (08.8). Lo demás —panel de marca, tarjeta del cierre, chips de línea, textos— coincide a 1280 y 768. | Resolver junto a 00.2 y 08.8. | owner (el color) / agente |
| 08.19 | P3 | medido | `login.vue:106,125`, `register.vue:100,123`, Mi cuenta | Los placeholders miden **2,63:1** (`#90a1b9` sobre blanco). Y el del campo de contraseña son puntos ("••••••••"), que parece una contraseña ya escrita. Es el color por defecto de Nuxt UI: lo ve toda la app. | Placeholder más oscuro (`text-muted`, 4,76:1) y sin los puntos en la contraseña. Coordinar con 00. | agente |
| 08.20 | P3 | medido | `forgot-password.vue:61-67`, `invitacion/[token].vue:113-122`, `ContrasenaForm.vue:46-54` | El campo de correo de `forgot-password` no tiene `name` ni `autocomplete="email"`, así que el navegador no ofrece el correo guardado; los correos de login, registro y recuperar quedan con corrector ortográfico activo (`spellcheck=true`). Las contraseñas de `invitacion` y de Mi cuenta no declaran `autocomplete="new-password"`/`"current-password"` (el gestor de claves no las reconoce como un cambio). | Agregar `name`, `autocomplete` y `spellcheck="false"` donde faltan. | agente |
| 08.21 | P3 | medido | `login.vue`, `register.vue`, `forgot-password.vue`, `no-tenant.vue` | Con la sesión abierta, abrir `/login` (un marcador del navegador) muestra el formulario como si no estuviera adentro, sin avisar ni mandar al inicio (`login-con-sesion`). Al revés, `/no-tenant` se abre sin sesión y dice "Tu cuenta no pertenece a ninguna empresa" a quien nunca entró. | Un middleware de invitado que lleve a `/` si hay sesión, y que `/no-tenant` pida sesión. | agente |
| 08.22 | P3 | medido | `confirmacion/[token].vue:57-64`, `invitacion/[token].vue:42-53`, `auth/callback.vue:19-26` | Los tres estados de "cargando" se ven distintos: las pantallas de link muestran solo el texto "Verificando el link…" en gris, sin título ni indicador (`confirmacion-cargando-real`); `select-tenant` usa un spinner; `auth/callback` es una pantalla aparte sobre gris claro y sin el logo ("Iniciando sesión…"). | Un solo estado de carga para el grupo: el marco con logo y un spinner pequeño. | agente |
| 08.23 | P3 | medido | `confirmacion`, `invitacion`, `verificar` (`titulo` y `subtitulo`); `auth.service.ts:222` | En el link inválido el título dice "Este link ya no sirve" y el párrafo de abajo empieza "Ese link ya no sirve: puede estar vencido…": la misma frase dos veces (`recuperar-invalido`). | Título "Este link ya no sirve" y el párrafo solo con la causa y la salida ("Puede estar vencido o ya usado."). | agente |
| 08.24 | P3 | medido | `PerfilForm.vue:48-66`, `ContrasenaForm.vue:46-60` | En Mi cuenta los inputs no llevan `class="w-full"` (los selects de Apariencia sí): miden 167 px mientras el selector de al lado mide 304 y el borde derecho no alinea con la tarjeta. A 768, "Repetí la nueva contraseña" se corta en el campo ("…contras"), y el teléfono guarda cualquier texto (placeholder "+56 9 1234 5678", valor guardado "987654325"). | `class="w-full"` en los inputs, un placeholder más corto ("Repite la nueva") y un `type="tel"` con `inputmode`. | agente |
| 08.25 | P3 | código (no medido en producción) | `login.vue:159-175`, `register.vue:74-90` | En desarrollo el botón "Continuar con Google" lleva a Google con `client_id=GOOGLE_CLIENT_ID_NOT_SET` (el 302 de `GET /api/auth/google`). No se pudo ver si producción tiene Google configurado; si no, el botón es un callejón de un toque a una página de error de Google, en las dos pantallas de ingreso. | Confirmar si Google está activo en producción; si no, esconder el botón. | owner |
| 08.26 | P3 | código | `invitacion/[token].vue:124-129` | "Las contraseñas no coinciden." aparece **mientras se teclea** la repetición, desde la primera letra (la condición es `confirmar.length > 0 && distintas`): quien escribe bien igual ve el error rojo hasta terminar. | Mostrarlo al salir del campo (`blur`) o cuando la repetición ya tiene el largo de la primera. | agente |

Comando del conteo de 08.17 (ejecutado en `frontend/app/`, lista acotada de verbos; es un piso):

```bash
LC_ALL=en_US.UTF-8 bash -c "grep -En '\b(Abrí|Ponés|Mandame|Confirmá|[Ee]legí|cambiás|[Vv]olvé|Pedí|[Pp]odés|[Tt]enés|Entrá|Poné|Repetila|Repetilo|aceptás|sos|usás)\b' pages/login.vue pages/register.vue pages/forgot-password.vue pages/select-tenant.vue pages/no-tenant.vue 'pages/confirmacion/[token].vue' 'pages/verificar/[token].vue' 'pages/invitacion/[token].vue' pages/auth/callback.vue components/AppMarco.vue components/UserMenu.vue components/configuracion/PerfilForm.vue components/configuracion/ContrasenaForm.vue components/configuracion/UserPreferencesForm.vue components/configuracion/MiPinForm.vue" | grep -vE ':[0-9]+:\s*(//|\*|/\*|<!--)' | wc -l
```

Medidas de contraste (cálculo WCAG con canvas desde `getComputedStyle`, colores normalizados de `oklch()` a RGB):
título 17,83:1; subtítulo `text-muted` 4,76:1; label 10,36:1; "¿Olvidaste tu contraseña?" 9,47:1; botón primario
(blanco sobre `#0E4D57`) 9,47:1 (deshabilitado, con `opacity: .75`: 4,78:1); panel de marca: párrafo 7,75:1, leyendas
de la tarjeta 9,65:1, chips 7,75:1; placeholder 2,63:1; texto de error sobre blanco 3,81:1; texto de error en el
aviso 3,08:1; casilla y "o" del separador 4,76:1. Conteo de controles: ver 08.8.

## 5. Lo que está bien

- **La maqueta del ingreso se reproduce fielmente** a 1280, 1024 y 768: panel de marca, tarjeta del cierre de caja,
  chips de línea, textos y orden. No desborda en ninguna (1280, 1024×768, 1024×600, 768).
- **El texto sobre petróleo** del panel mide 7,75 a 9,65:1, y el botón primario 9,47:1.
- **Anti-enumeración bien resuelta:** login con un solo "Credenciales inválidas"; registro y "olvidé mi contraseña" no
  dicen si el correo existe; el código lo explica en cada pantalla. No hay que tocarlo.
- **`verificar` pide un clic** en vez de verificar al abrir (los escáneres de correo no queman el token), y las demás
  pantallas de link **consultan el token antes de mostrar el formulario**: nadie teclea dos veces una contraseña para
  enterarse de que el link venció.
- `confirmacion` dice a qué empresa te suman, qué pasa si dices que no ("No hicimos nada") y avisa "Si no esperabas
  esto, no aceptes".
- El login bloquea los campos y el botón mientras envía (`loading`), el orden de Tab es lógico y el foco se ve en los
  campos, los links y los botones. Los labels están asociados a sus campos (login, registro, recuperar).
- Tras cambiar la contraseña en Mi cuenta, la app explica que se cierran todas las sesiones en vez de dejar que
  `useApiFetch` expulse sin aviso 15 minutos después.
- Apariencia guarda con un toast que dice qué cambió ("Tema actualizado: Claro").
- El tablet vertical (768) del login y de las pantallas de link queda centrado y a la vista, sin scroll.

## 6. Orden sugerido

1. **08.1** como frente propio: es lo único que echa a alguien de la sesión, y el arreglo es una línea en el backend
   más su e2e.
2. **Lote de textos** (un solo commit, con la lista de e2e que buscan esos textos): 08.2, 08.3, 08.4, 08.5, 08.6,
   08.14, 08.17 (junto al lote de 00.3 y 00.4) y 08.23.
3. **Lote de controles y accesibilidad** (`AppMarco` y las páginas públicas): 08.8, 08.9, 08.10 (coordinar con el color
   `error` global de 00), 08.19, 08.20, 08.26.
4. **`select-tenant`:** 08.11, 08.12 y, con el owner, 08.13. No se puede probar con un usuario de un solo local; el
   spec debe usar respuestas simuladas como el de este informe.
5. **Decisiones del owner antes de tocar:** 08.7 (¿se quita "Mantener sesión iniciada" o se define?), 08.16 (un
   mínimo de contraseña), 08.25 (¿Google activo en producción?), 08.18/00.2 (color de títulos y links).
6. **Pulido** al final: 08.15, 08.21, 08.22, 08.24.

Archivos del arnés que dejé: `frontend/e2e-auditoria/ingreso-01-publicas.pw.ts`, `ingreso-02-cuenta.pw.ts`,
`ingreso-03-tenant.pw.ts`, `ingreso-04-dom.pw.ts`, `ingreso-05-1024.pw.ts` y las capturas de
`frontend/e2e-auditoria/capturas/ingreso/`.
