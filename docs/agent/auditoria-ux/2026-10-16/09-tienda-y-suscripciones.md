# 09 · Tienda online, suscripciones y administración

Auditoría UX del grupo 09, 2026-10-16. No se tocó código de la app. Las capturas se citan por ruta
relativa a `frontend/` (`e2e-auditoria/capturas/tienda/<archivo>.png`, a 1280 y a 768: el archivo termina
en `-1280` o `-768`).

## 1. Alcance

- **Pantallas:** `pages/tienda/index.vue` (catálogo y carrito), `tienda/medios-pago.vue`,
  `tienda/pasarela.vue` (pasarela simulada), `tienda/retorno.vue` (regreso desde Webpay),
  `tienda/suscripciones.vue` ("Mis suscripciones" y el drawer "Nueva suscripción"), `suscripciones.vue`
  (administración de las suscripciones del local), `admin.vue` (administración del SaaS) y
  `components/tienda/CarritoOnline.vue`. Antes se leyeron `docs/features/tienda-online.md` y
  `pasarela-pagos.md` (el flujo de alta y de retorno).
- **Roles:**
  - **El dueño que usa la tienda y las suscripciones.** Compra desde "Tienda Online", inscribe tarjetas,
    se suscribe y, con el módulo "Suscripciones", pausa o cancela las de sus clientes.
  - **El superadmin del SaaS** (`admin.vue`): lee las boletas con problemas de todos los locales.
- **Usuario con el que se midió:** `admin.paris@paris.cl` (admin de Demo Restaurante). Es admin, así que
  **no ve el efecto de los permisos**: las filas "Sin permiso" van por código. No se usó otro usuario.
- **Cómo se revisó, y qué NO se hizo a propósito:**
  - **Medido contra el backend real:** las siete rutas a 1280 y 768, el carrito con ítems reales,
    la búsqueda sin resultados, el drawer de nueva suscripción hasta el total (sin confirmar), la
    recarga de la página, objetivos tocables, nombres accesibles, foco por teclado y contraste.
  - **No se configuró ninguna pasarela ni medio de pago, no se pagó, no se inscribió ninguna tarjeta, no
    se activó ni se canceló ninguna suscripción.** El local de prueba no tiene tarjetas ni suscripciones,
    así que la tabla con filas, el modal de eliminar tarjeta, el de cancelar y "Cambiar tarjeta" van
    **por código**.
  - **`/tienda/retorno`** se abrió con parámetros inventados (sin `ordenId` y con uno que no existe: el
    backend responde 404). Los otros seis estados (aprobada, sin venta, devuelto, pendiente, rechazada y
    el cargando) van por código, con `useRetornoTienda.ts`.
  - **`/tienda/pasarela`** exige un checkout en memoria que solo existe tras `POST /online/pagar`; con una
    `ref` inventada redirige. La pantalla con datos va por código.
  - **`admin.vue`** exige superadmin (lo usa otro auditor): se revisó **por código** y con lo que ve un
    no-superadmin al entrar a `/admin` (lo redirigen a Inicio, medido).
- **Capas aplicadas:** las cuatro de `criterios.md`. La capa 3 con el texto literal bajado con `curl`
  el 2026-10-16 (`.superpowers/auditoria-ux/vercel-guidelines.md`, 191 líneas), sin volver a bajarlo.
  Excepciones aplicadas: mayúscula solo inicial, móvil fuera de alcance.
- **Contraste medido:** "Pagar" blanco sobre `rgb(14, 77, 87)` = 9,47:1. El gris de texto secundario
  (`text-muted`, `oklch(0.554 0.046 257)`, equivale a `#64748b`) sobre blanco = 4,76:1 por la fórmula WCAG:
  pasa AA justo, incluso a 12 px. No hay hallazgo de contraste.
- **Hallazgo transversal ya sabido, no se repite:** `app.config.ts` de la raíz sin cargar (00.1). Los
  textos en voseo de este grupo se cuentan acá (09.18) y el índice los suma al 00.3.
- **Hallazgos previos:** los dos de `auditoria-ux-hallazgos-previos` (POS, traslados) no son de este grupo.

## 2. El flujo

### Comprar en la tienda (catálogo → carrito → pagar → resultado)

| # | Paso | Toques | Qué se ve |
|---|---|---|---|
| 1 | Entrar a Tienda Online › Catálogo | 2 (grupo del menú + Catálogo) | Grilla de ítems "vendibles online" y carrito vacío (`p-_tienda-1280`) |
| 2 | Agregar un ítem | 1 por unidad | La línea aparece, "Disponible" baja de 36 a 34 tras dos toques (`q-tienda-carrito-1280`) |
| 3 | Ajustar cantidad o quitar | 1 (+/−) o teclear; 1 para quitar | Neto, descuentos, recargos, impuestos y total se recalculan |
| 4 | Pagar | 1 | Webpay: sale de la app. Sin Webpay y con demo prendida: `/tienda/pasarela` |
| 5 | Aprobar o rechazar (solo la simulada) | 1 | "Pago aprobado" con enlace a la venta |
| 6 | Volver de Webpay | 0 | `/tienda/retorno?ordenId=…`: una de seis vistas según el estado de la orden |

Camino feliz con un ítem: 2 toques de menú + 1 para agregar + 1 para pagar = 4 toques hasta salir a Webpay.
A 768 el carrito queda **debajo** del catálogo (09.16).

### Inscribir y gestionar tarjetas (Medios de pago)

| # | Paso | Toques | Qué se ve |
|---|---|---|---|
| 1 | Entrar a Medios de pago | 2 | Tabla de tarjetas, vacía en el local de prueba (`p-_tienda_medios_pago-1280`) |
| 2 | Agregar tarjeta | 1 | El botón queda cargando y el navegador sale a Webpay |
| 3 | Volver | 0 | Un toast "Tarjeta inscrita correctamente" o "…fue rechazada" y la URL se limpia |
| 4 | Marcar preferida | 1 (la estrella) | Estrella rellena y toast |
| 5 | Eliminar | 2 (basurero + Eliminar) | Modal que avisa cuántas suscripciones se cancelarían |

### Suscribirse (Mis suscripciones › Nueva suscripción)

| # | Paso | Toques | Qué se ve |
|---|---|---|---|
| 1 | Abrir el drawer | 3 (grupo + Mis suscripciones + Nueva suscripción) | Drawer con un solo campo (`q-susc-drawer-vacio-768`) |
| 2 | Elegir el producto | 2 | Aparece el día, el medio de pago y "Total a cobrar por período $35.700" (`r-susc-item-1280`) |
| 3 | Elegir el día | 0 a 2 | Por defecto el día 1 |
| 4 | Con tarjeta: Suscribirme y pagar | 1 | Cobro del primer período y toast |
| 4b | Sin tarjeta: Agregar tarjeta | 1 | Sale a Webpay, y **al volver cobra solo** (09.1) |
| 5 | Pausar, reanudar, cancelar, cambiar tarjeta | 1 / 1 / 2 / 3 | Insignia de estado y toast |

Camino feliz con tarjeta y día por defecto: 3 + 2 + 1 = 6 toques.

### Administrar las suscripciones del local (dueño)

| # | Paso | Toques | Qué se ve |
|---|---|---|---|
| 1 | Entrar a Suscripciones | 1 | Tabla con cliente, suscripción, estado y acciones (`q-suscripciones-admin-menu-768`) |
| 2 | Filtrar por estado | 2 | Las filas del estado |
| 3 | Pausar o reanudar | 1 | Cambia al instante y toast |
| 4 | Cancelar | 2 (Cancelar + confirmar) | Modal con la fecha en que se cancela |
| 5 | Eliminar una cancelada | 2 | Modal y la fila se va |

### Leer las boletas con problemas (superadmin, `admin.vue`, por código)

| # | Paso | Toques | Qué se ve |
|---|---|---|---|
| 1 | Entrar a Administración | 1 | Una tarjeta con la tabla de nueve columnas |
| 2 | Ver el detalle de una boleta | 1 por fila | Último error, estado del envío y el JSON del SII |

## 3. La matriz de estados

Columnas: **Vac** vacío · **Car** cargando · **Err** error · **Per** sin permiso/deshabilitado ·
**Inv** dato inválido · **Éxi** éxito · **Tab** 768 y 1280 · **Ded** dedo · **Tec** teclado y lector.

| Paso | Vac | Car | Err | Per | Inv | Éxi | Tab | Ded | Tec |
|---|---|---|---|---|---|---|---|---|---|
| A. Catálogo: buscar y agregar | 09.13 | ok: "Cargando catálogo..." (código) | 09.4 | 09.14 | n/a: el único campo es una búsqueda libre | ok: la línea aparece y "Disponible" baja (medido) | 09.16 | ok: tarjetas de ~190×120 px (medido) | 09.12 |
| B. Carrito: cantidad, quitar, total | ok: "Agregá ítems…" dice qué hacer (voseo, 09.18) | 09.17 | ok: `avisoCalculoFallido` al pagar y el botón no se traba (código) | 09.14 | ok: `AppCantidadInput` es compartido con el POS, fuera del grupo | n/a: agregar o quitar se ve al instante | 09.16 | 09.10 | 09.11 |
| C. Pagar y pasarela simulada | n/a: "Pagar" deshabilitado con carrito vacío, el motivo se ve | ok: botón cargando y bloqueado, clave de intento única (código) | 09.20 | 09.14 | n/a: no hay campos | 09.5 | ok: tarjeta centrada `max-w-md` (código) | ok: botones de 36 px de alto, ver nota en 09.10 | ok: dos botones con nombre (código) |
| D. Retorno desde Webpay | n/a: sin `ordenId` cae a "no pudimos verificar" | ok: spinner "Confirmando tu pago…" (código) | 09.6 | n/a: el backend lee la orden del usuario | n/a: no hay campos | 09.5 | ok: tarjeta centrada, sin desborde (medido) | ok: un botón de ancho completo (medido) | ok: un solo botón o enlace (código) |
| E. Medios de pago | 09.21 | ok: "Cargando…" (código) | 09.4 | 09.14 | n/a: la tarjeta se escribe en Webpay | ok: toast y fila nueva (código) | 09.21 | 09.11 | 09.11 |
| F. Mis suscripciones: lista y acciones | 09.21 | ok: `CrudTable :loading` (código) | 09.4 | 09.14 | n/a: sin campos en la lista | ok: la insignia cambia y hay toast (código) | ok: tres botones `sm` caben a 1280; a 768 no medible sin filas | 09.7 | ok: botones con texto (código) |
| G. Nueva suscripción (drawer) | ok: el drawer parte con un solo campo (medido) | ok: "Calculando…" y `asegurarVigente` (código) | ok: toast con motivo, la clave de intento se conserva (código) | ok: el botón deshabilitado tiene su motivo a la vista, "No tenés tarjetas registradas" (medido) | ok: el botón se bloquea sin ítem ni tarjeta (medido) | 09.9 | ok: drawer de 384 px cabe a 768 (medido) | 09.22 | ok: campos con etiqueta (medido) |
| H. Suscripciones del local (admin) | 09.23 | ok: `CrudTable :loading` (código) | 09.4 | ok: `puedeActualizar` y `puedeEliminar` esconden los botones (código) | n/a: sin campos | 09.8 | ok: sin desborde a 768 (medido) | 09.7 | ok: botones con texto (código) |
| I. Administración del SaaS | ok: "Ningún local tiene boletas con problemas" (código) | 09.24 | 09.24 | ok: un no-superadmin va a Inicio sin aviso (medido, 09.24) | n/a: sin campos | n/a: es una pantalla de lectura | 09.24 | ok: el único botón es `size sm` en la fila, ver 09.24 | 09.24 |

Notas de la matriz:

- "Dedo" de las pantallas D, E, F, H e I: el menú lateral mide 32 px de alto en todas las pantallas
  (medido, es transversal y no se repite acá). Los botones `size="sm"` miden ~32 px; no hay ninguno de
  plata que se pueda tocar sin querer junto a otro frecuente salvo lo de 09.7.
- La fila F no tuvo filas reales: el local de prueba no tiene suscripciones y crear una cobra de verdad.

## 4. Hallazgos

| # | Severidad | Confianza | Dónde | Qué pasa (escena concreta) | Propuesta | Decide |
|---|---|---|---|---|---|---|
| 09.1 | P1 | código | `tienda/suscripciones.vue:230-242` (`agregarTarjetaDesdeAlta`), `:306-337` (`reanudarAltaPendiente`), `:339-353`; `docs/features/tienda-online.md` § "Reanudar el alta" | El dueño abre "Nueva suscripción", elige el plan ($35.700) y, como no tiene tarjeta, el único botón habilitado es "Agregar tarjeta". Lo toca, inscribe la tarjeta en Webpay y **al volver la página cobra el primer período sola**: no pasa por "Suscribirme y pagar", no vuelve a mostrar el total ni confirma. El botón que apretó no dice que va a cobrar. Además `reanudarAltaPendiente` no llama a `asegurarVigente()`: el cobro usa el total que calcula el servidor al volver, no el que él vio. La doc lo describe como decisión ("cobro del primer período sin clic extra"). Si el dueño considera cualquier cobro sin clic como plata en riesgo, sube a P0. | Al volver de Webpay, reabrir el drawer con el plan, el día y la tarjeta nueva ya elegidos, y el total vigente; el cobro solo con "Suscribirme y pagar $35.700". Si se mantiene el cobro automático, que el botón diga "Agregar tarjeta y suscribirme" y que el drawer avise "Te cobraremos $35.700 al volver". | owner |
| 09.2 | P1 | medido + código | `composables/useTiendaCarrito.ts:43` (carrito en `useState`, solo memoria), `tienda/retorno.vue:137` | Medido: se agregan papas fritas, se recarga la página y el carrito queda vacío ("Agregá ítems desde el catálogo", `tras recargar` en el spec). Pagar con Webpay sale de la app con una redirección completa, así que **volver de Webpay equivale a recargar**. Si el pago se rechaza, `retorno.vue` dice "Tu carrito sigue disponible para reintentar", y no es cierto: el carrito está vacío y hay que armarlo de nuevo. Lo mismo si el comprador vuelve atrás desde Webpay o cierra la pestaña a medio pago. | Guardar las líneas en `sessionStorage` (con `try/catch`; la pantalla ya funciona sin él) y vaciarlas solo cuando la orden quedó cobrada (`limpiaCarrito`). Si no se hace, cambiar el texto a "Vuelve a armar tu carrito para reintentar". | agente |
| 09.3 | P2 | medido | `suscripciones.vue:13-15` | El dueño está en Suscripciones y aprieta F5 (o abre el favorito): la página lo manda a Inicio sin decir nada. Medido: por el menú entra (`SPA /suscripciones => /suscripciones`) y al recargar termina en `/`. El `if` corre en el `setup`, antes de que lleguen los permisos, y `puedeVer` todavía es falso incluso para el admin. `propinas/index.vue:160-168` espera `fetchPermisos()` antes de decidir; este no. | Esperar los permisos antes de redirigir (`await permissionsStore.ensureCargado()`, como el middleware `admin.ts`) y no redirigir si la carga falló. | agente |
| 09.4 | P2 | código | `tienda/medios-pago.vue:123-136`, `useTarjetas.ts:56-61`; `tienda/suscripciones.vue:384`; `suscripciones.vue:128`; `tienda/index.vue:13-17` | Una lectura fallida se ve como "no hay nada". En Medios de pago, si `GET /online/medios-pago` falla, queda `oneclickDisponible = false` y la pantalla muestra la alerta **"Inscripción no disponible: el tenant no tiene una pasarela…"**, que es falsa, y "No tenés tarjetas inscritas". En Mis suscripciones, Suscripciones del local y el catálogo, la falla es un toast que se va y debajo queda "No hay … para mostrar". `admin.vue:140-146` sí lo hace bien (`errorLectura`). Además, antes de que arranque la carga `loading` es falso, así que la alerta de Medios de pago parpadea un cuadro al entrar. | Un estado de error en la propia pantalla, como el de `admin.vue`: "No se pudieron cargar las tarjetas. Reintentar" con botón (sin reintento automático). En Medios de pago, que `oneclickDisponible` parta en `null` y la alerta salga solo con `false` confirmado. | agente |
| 09.5 | P2 | código | `tienda/retorno.vue:83-100`; `tienda/pasarela.vue:132-146` | La pantalla de éxito no muestra cuánto se pagó ni el número de la venta: "Pago aprobado. Tu compra fue registrada correctamente", más tipo de tarjeta y cuotas en el retorno. El dueño que acaba de pagar $9.520 no ve $9.520. En la pasarela simulada el resumen con el total desaparece justo al aprobar. Solo queda el botón "Ver detalle de la venta". | Mostrar el total pagado y el número de la venta en la tarjeta de éxito. El retorno ya trae la orden; pedir el monto al mismo `GET /online/orden/:id` es lo único que habría que sumar (cambio de contrato: lo decide quien tome el frente). | agente |
| 09.6 | P2 | medido + código | `tienda/retorno.vue:120-140` | Dos callejones sin salida en la pantalla de resultado del pago. **Error:** con `ordenId` inventado el backend da 404 y se ve un círculo rojo con "No pudimos verificar el pago… Revisa tus compras o reintenta" (`p-_tienda_retorno-1280`); no hay botón para volver a consultar ni enlace a las compras, solo "Volver a la tienda". Es la misma pantalla para un 404, un corte de red y una URL sin `ordenId`. **Pendiente:** dice "Te avisaremos cuando se acredite"; en `backend/src/modules/online` y `pasarela` no hay envío de correo ni aviso (grep de `mail`/`notific`), así que la promesa no se cumple, y tampoco hay botón "Actualizar". | En error: botón "Consultar de nuevo" (acción del usuario) y enlace a Ventas › Historial. En pendiente: botón "Actualizar" y cambiar el texto por lo que de verdad pasa ("Revisa Ventas › Órdenes en unos minutos"). Distinguir 404 ("No encontramos esta orden") del corte de red. | agente |
| 09.7 | P2 | código | `tienda/suscripciones.vue:446-453` y `:427-435`; `suscripciones.vue:204-211` y `:175-183` | Cancelar una suscripción tiene dos botones que dicen "Cancelar" en el mismo modal: el gris que cierra el modal (de `CrudModal`) y el rojo "Cancelar suscripción" que cancela. El dueño apurado lee "Cancelar" y no sabe cuál sale del modal y cuál cancela. En la fila, además, "Cancelar" (destructivo) queda a 8 px de "Pausar" y "Cambiar tarjeta", que son los frecuentes. | En este modal, rotular el que cierra "Volver" (`CrudModal` hoy no deja cambiarlo: sería una prop nueva) o el destructivo "Sí, cancelar suscripción". Separar el botón destructivo de la fila. | agente |
| 09.8 | P2 | código | `tienda/suscripciones.vue:409-426`; `suscripciones.vue:157-174`; `composables/useSuscripciones.ts:149-169` | "Pausar" y "Reanudar" actúan al instante, sin confirmar ni decir qué pasa con el cobro. El dueño pausa la suscripción de un cliente y no sabe si el próximo cobro se salta o se corre; al reanudar no sabe si cobra de inmediato. Es plata y la pantalla no lo dice. Lo bueno: el cambio es optimista y se revierte si falla. | Una línea bajo el botón o un modal corto con la regla ("Mientras esté pausada no se cobra. Al reanudar, el próximo cobro es el …"). La regla de cobro al reanudar es de negocio. | owner |
| 09.9 | P2 | medido | `tienda/suscripciones.vue:183-186` y `:577-606`, `r-susc-item-1280` | En el drawer, el selector dice "Plan mensual demo — **$30.000** / Mensual" (el neto) y debajo "Total a cobrar por período **$35.700**". Dos cifras distintas para la misma cosa en la misma pantalla; el código ya comenta que el neto fue un error de cobro antes. Tampoco dice que **el primer cobro es hoy** ni cuándo es el segundo, aunque el botón se llama "Suscribirme y pagar". | En el selector, mostrar el total con impuestos (o solo el nombre y la frecuencia). Bajo el total: "Se cobra hoy. El siguiente cobro es el 1 de noviembre." | agente |
| 09.10 | P2 | medido | `components/tienda/CarritoOnline.vue:75-87` | Los controles del carrito son chicos para el dedo: basurero 24×24 px, más y menos 28×28 px, campo de cantidad 112×28 px (medido en `carrito chicos`). El basurero queda a 8 px del "+", y quitar la línea es inmediato, sin deshacer. A 768 la pantalla se usa con el dedo. "Pagar" mide 36 px de alto. | Subir los controles de línea a 44 px (basurero y ±), separar el basurero de la cantidad y, si quitar duele, un toast con "Deshacer". | agente |
| 09.11 | P2 | medido + código | `components/tienda/CarritoOnline.vue:81-87`; `tienda/medios-pago.vue:146-157` y `:160-167` | Botones de solo ícono sin nombre accesible: los dos basureros del carrito (medido: `botonesSinNombre` devolvió dos), el basurero de cada tarjeta y la estrella de "preferida", que además es un `<button>` pelado de ~28 px cuyo estado (preferida o no) solo se distingue por el color amarillo y el relleno. Un lector de pantalla dice "botón" y nada más. | `aria-label` en cada uno ("Quitar Papas fritas", "Eliminar tarjeta Visa 1234", "Marcar como preferida") y `aria-pressed` en la estrella. | agente |
| 09.12 | P2 | medido | `components/ventas/CatalogoGrid.vue:81-93` (usado en `tienda/index.vue:80`) | La tarjeta del ítem es un `<div>` con `@click`: no recibe foco con Tab, no tiene rol de botón (medido: `tag DIV, tabindex null, role null`). Con teclado o lector **no se puede agregar nada al carrito**; la tienda no tiene otro camino. El componente es compartido con el POS (otro grupo). | Hacerla un `<button>` o darle `role="button"`, `tabindex="0"` y Enter/Espacio. Revisar el mismo componente en el POS. | agente |
| 09.13 | P2 | medido | `components/ventas/CatalogoGrid.vue:74-76`; `tienda/index.vue:13-17` | "No hay ítems para mostrar" sale igual cuando el catálogo online está vacío y cuando la búsqueda no encontró nada (medido con "zzzzqq", `s-busqueda-sin-resultados-1280`). El dueño que aún no marcó ningún ítem como vendible online ve un mensaje que no le dice qué hacer ni dónde; el que escribió mal no lo sabe. | Dos mensajes: con búsqueda, `Nada coincide con "zzzzqq"`; sin búsqueda, "Aún no hay ítems a la venta online. Márcalos en Configuración › Items." | agente |
| 09.14 | P2 | código | `tienda/index.vue` (sin `usePermisosCrud`), `tienda/medios-pago.vue:112-120`, `tienda/suscripciones.vue:373-380` y `:400-435` | Solo "Nueva suscripción" se esconde si falta `Tienda Online:Crear` (`puedeCrear`). "Pagar", "Agregar tarjeta", "Pausar", "Cancelar" y "Cambiar tarjeta" se ven y se pueden tocar, y el backend responde 403: el usuario sin permiso arma un carrito entero y recién al pagar ve un toast de error. No se pudo medir: `admin.paris` es admin y el permiso real no se ve con él. | Gatear con `usePermisosCrud('Tienda Online')` como ya hace la página de suscripciones del local, y deshabilitar "Pagar" con el motivo ("Tu rol no puede comprar en la tienda"). | agente |
| 09.15 | P2 | código | `tienda/medios-pago.vue:109` y `:129`; `tienda/suscripciones.vue:501`; `suscripciones.vue:116` | Jerga en pantalla: "tenant" ×3, "pasarela con tokenización (Oneclick)" y "Webpay Oneclick". La alerta "El tenant no tiene una pasarela con tokenización (Oneclick) configurada y activa" no le dice al dueño qué hacer ni dónde. Conteo: `grep -n "tenant\|Oneclick\|tokeniz" pages/tienda/*.vue pages/suscripciones.vue` (solo textos visibles). | "Tu local aún no tiene el cobro con tarjeta inscrita activo. Actívalo en Configuración › Pasarelas." (o "Pídelo a quien administra el local" si no es admin). | agente |
| 09.16 | P2 | medido | `tienda/index.vue:78-91` | A 768 el carrito queda **debajo** del catálogo (la grilla se parte en dos filas bajo el punto `lg`, `p-_tienda-768`, `q-tienda-carrito-768`). Con 48 ítems por página (`pageSize=48`), el total y "Pagar" quedan lejos de los ítems que se está agregando: el dueño agrega, no ve el total y tiene que bajar. A 1280 el carrito va a la derecha, fijo. Además el nombre del ítem en el carrito se corta ("Producto dem…", 1280) porque comparte la fila con cantidad, unidad y basurero. | A 768, carrito en una barra inferior con el total y "Pagar" siempre a la vista. Dejar el nombre en dos líneas, no truncado. | agente |
| 09.17 | P3 | medido + código | `components/tienda/CarritoOnline.vue:94-114` | El panel del carrito: (a) muestra "Descuentos -$0" y "Recargos +$0" como filas aunque valgan cero (medido); (b) el "Total" mide 16 px frente a 14 px de las otras líneas (medido), así que no es "lo más grande del panel"; (c) mientras se recalcula, el total se queda con el valor anterior sin atenuarse (el botón "Pagar" sí se bloquea y espera `asegurarVigente`). | Ocultar filas en $0; subir el total a 20-24 px; atenuar el total mientras `loadingCalculo`. | agente |
| 09.18 | P3 | código | 11 líneas en `tienda/medios-pago.vue:171`, `tienda/suscripciones.vue:59,370,441,459,465,513,552,566`, `components/tienda/CarritoOnline.vue:63`, `suscripciones.vue:76` | Textos en voseo: "Agregá ítems", "No tenés tarjetas", "pausá, reanudá o cancelá", "Elegí una tarjeta", "¿Confirmás la cancelación?". Comando (en `frontend/app/`): `grep -rEn --include='*.vue' '\b(Agregá\|Elegí\|Confirmás\|[Pp]ausá\|[Rr]eanudá\|[Cc]ancelá\|[Tt]enés)\b' pages/tienda pages/suscripciones.vue components/tienda`. | "Agrega ítems", "No tienes tarjetas", "pausa, reanuda o cancela", "Elige una tarjeta", "¿Confirmas la cancelación?". Actualizar los e2e que busquen esos textos. | agente |
| 09.19 | P3 | medido | `composables/useMenuLateral.ts:74-81` | En el menú, dentro de "Tienda Online", "Mis suscripciones" y "Medios de pago" se cortan ("Mis suscripci…", "Medios de p…", medido en todas las capturas) y al lado hay una entrada "Suscripciones" que es otra pantalla (la del local). Dos nombres casi iguales para dos cosas. Y "Tienda Online" es una pantalla de compra para quien usa la app, no una vitrina del local: el dueño que "vende online" no ve acá sus ventas (están en Ventas › Órdenes). | Renombrar la del dueño ("Suscripciones de clientes") y acortar las hijas ("Mis planes", "Tarjetas"). Decidir si "Tienda Online" se llama "Comprar". | owner |
| 09.20 | P3 | medido + código | `tienda/pasarela.vue:32-39` y `:87-95` | Con una `ref` inventada, o al recargar la pasarela, la pantalla redirige a `/tienda` sin decir por qué (medido: `ref=inventado` terminó en `/tienda`). Si aprobar falla, `estado` vuelve a "rechazada" y la tarjeta muestra el mismo formulario de antes: solo queda un toast que se va. | Un aviso en `/tienda` ("Esa compra ya no está abierta") y el motivo del fallo dentro de la tarjeta. | agente |
| 09.21 | P3 | medido + código | `tienda/medios-pago.vue:169-173`; `tienda/suscripciones.vue:439-443`; `tienda/medios-pago.vue:111-120` | El estado vacío no dice qué hacer: "No tenés tarjetas inscritas" y "No tenés suscripciones activas" (medido), con el botón lejos, arriba a la derecha. A 768 "Agregar tarjeta" se parte en dos líneas (`p-_tienda_medios_pago-768`). El botón no avisa que sale de la app hacia Webpay. | "Aún no tienes tarjetas. Agrega una para suscribirte; saldrás a Webpay y volverás aquí." con el botón dentro del vacío. | agente |
| 09.22 | P2 | código | `tienda/suscripciones.vue:26`, `:235`, `:306-316`, `:344-346` | La intención de alta queda en `localStorage` con una clave fija, sin usuario, local ni caducidad. Si el dueño abandona Webpay y no vuelve, la intención sigue ahí. Cualquier visita posterior a `/tienda/suscripciones?estado=activa&inscripcionId=…` (un enlace guardado, un retorno de otra inscripción) **cobra la suscripción vieja**. Hoy el retorno de Medios de pago va a otra ruta, así que depende de que nadie reutilice esa URL. | Guardar la intención con el usuario, el local y la hora, descartarla pasada una hora y no cobrar sin el clic (ver 09.1). | agente |
| 09.23 | P3 | código | `suscripciones.vue:20-32`, `:197-201` | Con muchas suscripciones solo hay un filtro por estado: no se busca por cliente, y el dueño que busca a un cliente recorre la tabla. Con un filtro sin resultados (por ejemplo "Canceladas") el texto es el mismo "No hay suscripciones para mostrar" que si no hubiera ninguna. | Un campo de búsqueda por cliente o correo y un vacío que nombre el filtro ("No hay suscripciones canceladas"). | agente |
| 09.24 | P3 | medido + código | `admin.vue:55-157` | La pantalla del superadmin: (a) mientras carga queda la tarjeta en blanco, sin esqueleto ni "Cargando…" (`cargando` solo evita el mensaje de "ningún local"); (b) si la lectura falla hay un texto y un toast, pero no un botón "Reintentar"; (c) no tiene `UserMenu` en el encabezado, a diferencia del resto de las pantallas; (d) el botón de desplegar tiene siempre `aria-label="Ver detalle"` y no `aria-expanded`; (e) nueve columnas a 768 px casi seguro obligan a desplazar de lado (no medible sin superadmin); (f) un no-superadmin que escribe `/admin` va a Inicio **sin aviso** (medido). La pantalla es correcta en lo central: distingue "ningún local tiene problemas" de "no se pudo leer". | Cargando visible; botón "Volver a leer" en el error; `aria-expanded` y "Ocultar detalle"; revisar las columnas a 768; un aviso en Inicio si entró sin permiso. | agente |

## 5. Lo que está bien

- **El total del drawer y del carrito es el que cobra el servidor**, con IVA, no el neto: `tienda/suscripciones.vue:165-181`
  usa el mismo motor y no un número inventado. Medido: $30.000 neto, $5.700 de impuestos, $35.700 total.
- **Nada se cobra dos veces**: "Pagar" se bloquea con `pagando`, la pasarela con `estado === 'procesando'` y una
  clave de intento por checkout (`useIntentoCobro`), y el alta de suscripción lleva `Idempotency-Key` y se
  protege del doble `submit` (`confirmando`, `:249`).
- **`retorno.vue` no dice "rechazado" cuando no sabe**: seis vistas según el estado real de la orden, y un
  estado desconocido cae a "No pudimos verificar", no a "rechazado" (`useRetornoTienda.ts`). Un cobro sin venta
  y uno devuelto tienen su propio texto.
- **El modal de eliminar tarjeta avisa el efecto**: cuántas suscripciones se cancelarían
  (`medios-pago.vue:22-30`). El de cancelar dice la fecha exacta.
- **Pasarela simulada, sin cartel que prometa**: "No se cobra a ninguna tarjeta" y encabezado "(simulada)".
- **`admin.vue` distingue "sin problemas" de "no se pudo leer"** (`errorLectura`), y los botones de plata y
  de eliminar de la administración de suscripciones se gatean por permiso.
- **Sin desborde horizontal** a 1280 ni a 768 en las siete rutas (medido, `desborda`). El texto secundario
  pasa AA (4,76:1) y el botón primario llega a 9,47:1.

## 6. Orden sugerido

1. **09.1** como frente propio, **antes que nada**, y con el owner: es plata cobrada sin el último clic. Va con
   **09.22**, que es la otra mitad de la misma puerta (la intención vieja que cobra).
2. **09.2** (carrito que se pierde y texto que miente): lo ve cualquiera que pague y se rechace.
3. Lote de **estados de la pantalla de pago**: 09.5, 09.6, 09.20 (todo `retorno.vue` y `pasarela.vue`).
4. Lote de **errores y vacíos** en el mismo patrón que `admin.vue`: 09.4, 09.13, 09.21, 09.23.
5. Lote de **accesibilidad y dedo**: 09.10, 09.11, 09.12 (el último toca `CatalogoGrid`, que comparte con el POS:
   avisar al grupo del POS), 09.16.
6. Lote de **textos**: 09.7, 09.8 (la regla de cobro la decide el owner), 09.9, 09.15, 09.18, 09.19.
7. **09.3** suelto (una línea, igual que el resto de las pantallas) y **09.14**, **09.17**, **09.24** al final.

Archivos del arnés que dejé: `frontend/e2e-auditoria/tienda-01-recorrido.pw.ts`, `tienda-02-estados.pw.ts`, `tienda-03-detalles.pw.ts`, `tienda-04-contraste.pw.ts` y las capturas de `frontend/e2e-auditoria/capturas/tienda/`.
