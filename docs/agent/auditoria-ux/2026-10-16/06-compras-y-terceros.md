# 06 · Compras y terceros

## 1. Alcance

- **Pantallas:** `frontend/app/pages/compras/index.vue` (lista), `compras/[id].vue` (nueva compra,
  borrador y detalle), `compras/por-pagar.vue`, `terceros.vue`, y los componentes de
  `frontend/app/components/compras/` (incluye `CargarDteModal.vue`, `PagarProveedorModal.vue`,
  `CompraConfirmada.vue` y los modales de corregir, descuento y anular).
- **Rol:** el encargado de compras que carga la factura del proveedor (a mano o desde el XML del DTE),
  la corrige, y quien la paga. Tarea principal: dejar la mercadería ingresada con su costo y saber qué
  se le debe a cada proveedor.
- **Usuarios (ninguno es admin):** `encargado.compras@paris.cl` (Leer, Crear, Actualizar, Anular; sin
  Pagar), `compras.paga@paris.cl` (las cuatro + Pagar + Mi caja) y `compras.lectura@paris.cl` (solo
  Leer). `compras.carga@paris.cl` no hizo falta. Permisos verificados en `seeder.service.ts`
  (`seedRolEncargadoCompras`, líneas 3015-3200). Ninguno tiene el módulo Terceros.
- **Cómo se revisó:** app corriendo (http://localhost:5173) con el arnés `frontend/e2e-auditoria/`:
  capturas a 1280 y 768, objetivos tocables, nombres accesibles, contraste con la fórmula WCAG sobre
  `getComputedStyle`, foco por Tab y el flujo completo cargar → confirmar → por pagar → pagar → anular
  un pago → pagar de nuevo. Creé UNA compra de prueba, `Factura AUDIT-001` (10 de Pan de hamburguesa a
  $500, total del documento $5.950), y solo pagué y anulé pagos de esa compra. Quedó confirmada y
  pagada. Un segundo borrador (`AUDIT-002`) lo armé en pantalla y no lo guardé.
- **Terceros:** ninguno de los usuarios asignados tiene el módulo, así que esa pantalla se revisó
  **por código** (confianza "código"), salvo lo que se ve sin permiso, que sí se midió.
- **Capas:** las cuatro de `criterios.md`. La capa 3 se aplicó sobre
  `.superpowers/auditoria-ux/vercel-guidelines.md` (texto literal de 191 líneas, bajado con `curl` el
  2026-10-16); no se volvió a bajar.
- **No se pudo medir:** pagar en efectivo con éxito (necesita una caja física abierta), una compra
  vencida o con saldo a favor persistente, la pantalla Terceros con permiso, y la tecla Enter sobre una
  fila de la tabla (las filas son enfocables, `tabindex=0`, pero no probé que abran la compra).

## 2. El flujo

Camino feliz del encargado: factura de un proveedor, una línea, a mano. Cada fila cuenta toques;
"tipeo" es escribir en un campo ya enfocado.

| Paso | Qué hace | Toques |
|---|---|---|
| 1 | Menú: abrir el grupo "Compras" y tocar "Recepciones" | 2 |
| 2 | "Nueva compra" | 1 |
| 3 | Proveedor (abrir el selector y elegir) | 2 |
| 4 | Documento: "Factura" (abrir y elegir) | 2 |
| 5 | Folio | 1 + tipeo |
| 6 | Total del documento (obligatorio en factura) | 1 + tipeo |
| 7 | Entra a: "Local" (abrir y elegir) | 2 |
| 8 | Producto (abrir, elegir) | 2 |
| 9 | Cantidad (la unidad se llena sola) | 1 + tipeo |
| 10 | Precio unitario | 1 + tipeo |
| 11 | "Confirmar recepción" y, en el modal, "Confirmar recepción" | 2 |
| | **Total hasta confirmar** | **16 toques + 4 tipeos** (con "Guardar borrador" en vez de confirmar: 15) |
| 12 | Quien paga: menú "Por pagar" | 1 |
| 13 | Tocar la fila del proveedor (el botón Pagar no aparece antes) | 1 |
| 14 | "Pagar" | 1 |
| 15 | Monto (no hay "pagar todo") | 1 + tipeo |
| 16 | Medio de pago (viene "Efectivo"; cambiarlo cuesta abrir y elegir) | 0 o 2 |
| 17 | "Pagar" del modal | 1 |
| | **Total para pagar** | **5 toques con efectivo, 7 con otro medio** (+1 tipeo) |

Variante con XML: "Cargar desde la factura (XML)" (1) + elegir el archivo (1-2). Después, cada línea
"Por asociar" pide producto (2) y unidad (2): con la factura de ejemplo de 3 líneas son unos 12 toques
más antes de confirmar. Pagar al confirmar (rol con Pagar): "Sí, la pagué" (1) + medio y monto.

## 3. La matriz de estados

Cada celda dice `ok`, el número del hallazgo (`06.n`) o `n/a` con el motivo.

| Paso | Vacío | Cargando | Error | Sin permiso / deshabilitado | Dato inválido | Éxito | Tablet 768 / escritorio 1280 | Dedo | Teclado y lector |
|---|---|---|---|---|---|---|---|---|---|
| Lista de compras | 06.17 | ok (barra de carga de la tabla) | ok (toast si falla la lista o los proveedores) | ok (sin Pagar no hay columna ni filtro de pago, medido) | n/a: solo filtros | n/a: solo lectura | 06.14 | 06.20 | 06.21 |
| Nueva compra: cabecera | ok (campos con asterisco y ayuda) | ok ("Cargando…" con ícono) | ok (folio repetido junto al campo; el resto, 06.3) | 06.10 | 06.3, 06.5 | ok (el borrador queda guardado y la URL pasa a la compra) | ok (3 columnas a 1280 y 768, sin scroll horizontal) | 06.20 | ok (Tab recorre los campos; los selectores muestran anillo de foco) |
| Nueva compra: líneas | ok ("Selecciona un producto", total de línea "—") | ok (el producto se resuelve sin parpadeo) | 06.1, 06.2 | n/a: mismo permiso que la cabecera | 06.1, 06.2 | ok (subtotal y total a la vista) | ok | 06.20 | 06.8 |
| Guardar y confirmar | ok | ok (`:loading` en Guardar y en el modal) | 06.2, 06.3, 06.4 | 06.4 | 06.1, 06.3 | ok (toast, insignia "Confirmada" y detalle) | ok | 06.20 | ok (el modal atrapa el foco) |
| Detalle confirmada y correcciones | ok ("Sin correcciones.") | ok ("Cargando…") | 06.10 | ok (sin Actualizar o Anular los botones no existen, medido) | ok (Corregir queda deshabilitado con una cantidad inválida; sin mensaje, como 06.2) | ok (toast e historial) | ok | 06.20 | ok |
| Por pagar: lista y detalle del proveedor | ok ("No hay deuda ni saldo a favor…") | ok ("Cargando…") | ok (toast) | 06.10 | n/a: solo lectura | 06.18 | ok | 06.20 | 06.21 |
| Pagar (modal) | ok ("Este proveedor no tiene compras abiertas.") | ok ("Cargando…") | 06.12 | 06.13 | 06.13 | 06.18 | ok | 06.20 | ok |
| Anular un pago | ok | ok | ok (toast) | 06.6 | ok (exige motivo, deshabilitado hasta escribirlo) | ok ("Pago anulado: la deuda vuelve a la compra") | ok | ok | ok |
| Cargar desde el XML | ok | ok ("Leyendo…") | 06.15 | n/a: aparece solo con Crear | 06.15 | ok (franja "Cargado desde la factura…") | ok | 06.20 | ok (el archivo entra por un `input[type=file]` nativo) |
| Terceros (por código, salvo sin permiso) | 06.11 | ok (carga con cola serial) | 06.16 | 06.11 | 06.16 | ok (toast "Tercero creado") | ok (código: tabla de 4 columnas) | 06.28 | 06.28 |

## 4. Hallazgos

Las confianzas "medido" salen de capturas (`e2e-auditoria/capturas/compras/<archivo>.png`, relativas
a `frontend/`) o de medidas por `page.evaluate`. Total: 31 hallazgos, ninguno P0.

| # | Severidad | Confianza | Dónde (`archivo:línea`) | Qué pasa (escena concreta) | Propuesta | Decide |
|---|---|---|---|---|---|---|
| 06.1 | P1 | medido | `pages/compras/[id].vue:364` (`lineasCargadas`), `:568-578` (`armarBody`) | El encargado elige "Pan de hamburguesa", se le olvida la cantidad y toca "Guardar borrador". Sale "Borrador guardado" y el producto desaparece de la línea (queda "Selecciona un producto"). Con "Confirmar" pasa lo mismo: `lineasCargadas` descarta en silencio toda línea sin producto o sin cantidad, y el modal dice "Entran 3 líneas" cuando en pantalla hay 4. Una compra confirmada no admite agregar líneas, así que lo descartado solo se arregla anulando y volviendo a cargar. Captura: `compras/borrador-guardado-sin-lineas-1280.png`. Misma familia que el hallazgo previo de traslados. | Marcar la línea incompleta junto al campo ("Falta la cantidad") y bloquear Guardar y Confirmar hasta completarla o quitarla. Nada se descarta sin avisar. | agente |
| 06.2 | P1 | medido | `components/compras/LineaCompraForm.vue:202-212`, `pages/compras/[id].vue:688` (`puedeConfirmar`) | El campo Cantidad acepta cualquier texto. Medido: `0`, `-3`, `abc` y `2,5` (la coma decimal chilena) dejan "Guardar" y "Confirmar" habilitados. Al guardar, el único aviso es un toast con el texto crudo de la API: "lineas.0.cantidad debe ser mayor a cero", "lineas.0.cantidad must be a number string" (en inglés) y, para `2,5`, "no puede ser de 100.000.000.000.000 o más: el sistema no puede guardar valores así", que no es el problema. El total de la línea queda en "—" sin explicación. El campo de precio trata la coma de otra forma: `500,5` pasa a `5.005` y el total de línea a $50.050 (el ×10 del separador, ya conocido). | Aceptar coma o punto en la cantidad y normalizar. Validar "mayor que 0" junto al campo con un texto propio ("La cantidad tiene que ser mayor que 0") y deshabilitar Guardar y Confirmar con ese motivo. Traducir los errores de la API a la línea afectada. | agente |
| 06.3 | P1 | medido | `pages/compras/[id].vue:688` (`puedeConfirmar`), `:1116-1184` (modal), `:786` (toast) | En una factura "Total del documento" es obligatorio (lleva asterisco), pero `puedeConfirmar` no lo mira. El encargado toca "Confirmar recepción", lee el modal, confirma, el modal se cierra y recién ahí sale un toast "Falta el total del documento". El campo no se marca ni se enfoca, y la compra quedó guardada como borrador. Son 2 toques perdidos y un error lejos del campo. | Tratar el total como requisito de Confirmar: deshabilitar con el motivo ("Falta el total del documento") o marcar el campo con su error antes de abrir el modal. | agente |
| 06.4 | P1 | medido | `pages/compras/[id].vue:287` (`cargarCatalogos` lee `puedePagar` antes de que los permisos estén cargados), `:1146-1155` | Quien tiene Pagar y entra a "Nueva compra" por dirección directa o recargando (F5), abre "Confirmar recepción", elige "Sí, la pagué" y encuentra "Medio de pago" **vacío y sin opciones**, con "Confirmar recepción" deshabilitado y sin ninguna explicación. Si llegó por el menú funciona (medido: "Efectivo" preseleccionado). `mediosPago` se pide solo si `puedePagar` ya es verdadero al montar, y tras una recarga todavía no lo es. Captura: `compras/modal-confirmar-paga-si-1280.png`. | Pedir los medios cuando `puedePagar` pase a verdadero (o al abrir el modal) y, si la lista queda vacía, decir por qué no se puede confirmar con pago. | agente |
| 06.5 | P2 | medido | `pages/compras/[id].vue:927-959` | El único error de campo que aparece junto al input es el folio repetido ("Ya cargaste Factura AUDIT-001 de Distribuidora Andina, con fecha 2026-10-16", medido, bien). Todo lo demás de la cabecera se resuelve apagando "Guardar borrador" sin decir qué campo falta: con Proveedor y Documento elegidos pero sin folio, el botón queda gris y nada dice "falta el folio". | Al intentar guardar con el botón deshabilitado, marcar los campos faltantes (o dejar el botón activo y mostrar el error junto a cada campo vacío). | agente |
| 06.6 | P1 | medido | `pages/compras/por-pagar.vue:242-280`; `components/compras/CompraConfirmada.vue:283-303` | Un pago hecho no se puede deshacer desde la pantalla, salvo que sobre plata. La tabla "Pagos" de Por pagar solo lista los pagos con saldo a favor (spec § 8, `backend/src/modules/compras/compras.service.ts:266`) y "Anular" vive solo ahí. Medido: pagué $1.000 por transferencia y el panel dijo "Sin pagos registrados." mientras el detalle de la compra mostraba ese pago como "Vigente", sin botón Anular. Si el pago hubiera sido de $10.000 por un cero de más, quien paga no tiene cómo corregirlo. El pago de $5.000 que dejó $50 a favor sí mostró "Anular" y su modal funciona bien (medido). | Dejar una vía para anular cualquier pago vigente, desde la fila del pago en el detalle de la compra y en Por pagar. Es una regla del spec (§ 8), por eso decide el dueño. | owner |
| 06.7 | P2 | medido | `pages/compras/por-pagar.vue:240,276-278` | El título "Pagos" y el vacío "Sin pagos registrados." son falsos: la tabla solo muestra pagos con saldo a favor. Tras pagar $1.000, quien paga lee que no hay pagos. | Rotular "Pagos con saldo a favor" y, vacío, "No hay pagos con saldo a favor." (o mostrar todos, según 06.6). | agente |
| 06.8 | P2 | medido | `components/compras/LineaCompraForm.vue:215-229,246-252` | Los botones de la línea no tienen nombre accesible: la papelera (28×28 px, medido) y el lápiz de la presentación; el selector de Unidad, vacío hasta elegir producto, tampoco (`botonesSinNombre` devuelve 2 en Nueva compra). Quitar una línea con todo lo tipeado es 1 toque, sin confirmar ni deshacer, pegado al total de la línea. | `aria-label` ("Quitar línea", "Editar presentación"), objetivo de 44 px y un deshacer en el toast ("Línea quitada. Deshacer"). | agente |
| 06.9 | P2 | medido | `pages/compras/index.vue:180`; `components/compras/CompraConfirmada.vue:138,146`; `pages/compras/por-pagar.vue:209,217` | La fecha sale en tres formatos: la lista muestra `2026-10-16` (el dato crudo, sin `formatFecha`), el detalle y Por pagar `16-10-2026`, y el mensaje de folio repetido `2026-10-16`. Quien compara una compra de la lista con su detalle ve dos fechas que parecen distintas. | Pasar la fecha de la lista por `formatFecha` y dejar de mandar fechas ISO en los textos del backend. | agente |
| 06.10 | P2 | medido | `pages/compras/[id].vue:899,1110`; `pages/compras/por-pagar.vue:14-19`; `pages/terceros.vue:5` | Sin el permiso, las pantallas fallan en silencio. Medido con `compras.lectura`: `/compras/nueva` muestra solo el título "Nueva compra" y una página en blanco (`v-else-if="editable"` falla y `v-else-if="compra"` también). `/compras/<id inexistente>` queda en blanco con un toast "Compra no encontrada" que se va. `/compras/por-pagar` sin Pagar redirige a `/ventas`, que ese usuario tampoco tiene, y llegan dos toasts "No tienes permiso para esta acción". Capturas: `compras/lectura-nueva-1280.png`, `compras/id-inexistente-1280.png`. | Una pantalla con el motivo ("No tienes permiso para registrar compras") y un botón "Volver a Compras". Redirigir a la primera pantalla que sí tenga, no a Ventas. | agente |
| 06.11 | P2 | medido | `pages/terceros.vue:5,345-418` | Sin el permiso de Terceros, `/terceros` entra igual (solo middleware `auth`) y muestra "No hay terceros registrados.", un vacío falso (hay un proveedor, "Distribuidora Andina", medido en el selector de compras), con un toast de error que se va. El encargado de compras no tiene este módulo, así que si el proveedor no existe tampoco puede crearlo: el modal del XML le dice que se lo pida a alguien. | Mismo tratamiento que 06.10: pantalla de "sin permiso". Revisar si quien carga compras debería poder crear un proveedor (regla de permisos). | agente (pantalla) / owner (permiso) |
| 06.12 | P2 | medido | `components/compras/PagarProveedorModal.vue:92,221-223`; `backend/src/modules/compras/compras.service.ts:2874` | El medio viene "Efectivo" por defecto y el modal no sabe si hay caja abierta. Medido sin caja: al tocar "Pagar" la API responde 400 y el único aviso es un toast "Para pagar en efectivo necesitás tu caja abierta" arriba a la derecha, lejos del botón, que se va en unos segundos y sin enlace a "Mi caja". El aviso fijo "si no tenés una, abrila antes de pagar" aparece aun con el monto vacío. Captura: `compras/pagar-efectivo-error-1280.png`. | Al abrir el modal consultar la caja: sin caja abierta, mostrar el aviso con un enlace "Abrir mi caja" y deshabilitar Efectivo con ese motivo; con caja, no mostrar el aviso. | agente |
| 06.13 | P2 | medido | `components/compras/PagarProveedorModal.vue:160-164,208-210,266-272,290-297` | El flujo más repetido de quien paga ("pagar todo lo que debo") no tiene atajo: hay que tipear el monto, y el reparto solo se propone al tipear. "Pagar" queda deshabilitado, sin decir por qué, con el monto vacío o cuando el reparto supera el monto (medido: monto $1.000, reparto $2.000 → deshabilitado y el texto de abajo sigue diciendo "queda a favor $0"). | Un botón "Pagar todo ($5.950)" que llene monto y reparto, y una línea bajo el botón con el motivo cuando está deshabilitado ("El reparto supera el monto en $1.000"). | agente |
| 06.14 | P2 | medido | `pages/compras/index.vue:109-118` (columna `pago`), 768 px | Para quien paga, la lista tiene 8 columnas. A 768 px "Estado" queda cortada y "Pago", la que importa, está fuera de vista dentro del scroll interno de la tarjeta (la página no desborda). Captura: `compras/paga-lista-768.png`. | Ocultar "Entra a" y "Líneas" en tablet, o juntar Estado y Pago en una sola celda. | agente |
| 06.15 | P2 | medido | `components/compras/CargarDteModal.vue:109-114,234-247` | Con un XML cuyo RUT de emisor no calza con el formato, el modal muestra el mensaje de validación crudo: "emisorRut must match /^[0-9.\s]{1,12}-?[0-9kK]\s*$/ regular expression". El estado "bloqueado" no tiene botón "Elegir otro archivo": hay que tocar Cancelar y reabrir el modal. | Traducir el rechazo ("El RUT del emisor del archivo no es válido") y agregar "Elegir otro archivo" que vuelva al paso 1. | agente |
| 06.16 | P2 | código | `pages/terceros.vue:426-431,202-205` | El formulario de Terceros no valida nada del lado del cliente: "Crear" está siempre habilitado, `UForm` no lleva esquema, y un nombre vacío, un RUT malo o un correo inválido solo se enteran por un toast con el mensaje de la API. Ningún campo se marca. | Nombre obligatorio, formato de RUT y de correo con el error junto al campo; deshabilitar con motivo. | agente |
| 06.17 | P2 | medido | `pages/compras/index.vue:225-230` | Con el filtro "Estado de pago: Vencida" activo y sin resultados la tabla dice "No hay compras registradas.", lo mismo que cuando de verdad no hay ninguna. Quien filtra cree que no hay compras. | Con filtros activos: "Ninguna compra coincide con los filtros" y un botón "Quitar filtros". | agente |
| 06.18 | P2 | medido | `components/compras/PagarProveedorModal.vue:185`; `pages/compras/por-pagar.vue:184-197` | Tras pagar, el único rastro es el toast "Pago registrado", sin monto ni medio. Con la última compra pagada, el panel del proveedor queda abierto con "Sin compras abiertas" y el botón "Pagar" activo aunque ya no deba nada, mientras la tabla de arriba dice "No hay deuda ni saldo a favor con ningún proveedor". Captura: `compras/por-pagar-vacio-1280.png`. | Toast con el dato ("Pago de $4.950 registrado a Distribuidora Andina") y, sin deuda, cerrar el panel o dejarlo en "Al día" sin botón Pagar. | agente |
| 06.19 | P2 | medido | `pages/compras/index.vue:189`, `pages/compras/por-pagar.vue:213`, `components/compras/PagarProveedorModal.vue:252` | El documento se lee "FacturaAUDIT-001", sin espacio entre el tipo y el folio, en la lista, en la tabla de Por pagar y en el modal de pago (captura `compras/paga-lista-1280.png`). Es la clave con la que se identifica la compra que se va a pagar. | Poner el espacio fuera del `<template v-if>` (`{{ tipo }} {{ folio }}`) o un `&nbsp;`. | agente |
| 06.20 | P2 | medido | transversal; casos de este grupo: `LineaCompraForm.vue:222,246`, `CompraConfirmada.vue:151-158,207-215`, `[id].vue:977` | Los objetivos de uso frecuente miden 24-32 px de alto, bajo los 44 px de tablet: "Corregir" 63×24, "Corregir total o vencimiento" 175×24, "Cargar descuento" 118×24, "Agregar línea" 110×24, la papelera 28×28, el interruptor de Terceros 36×20 y el radio "Sí, la pagué" 16×16 (medido con `tocablesChicos`). Los botones principales miden 32 px. | Tamaño `lg` o relleno táctil en los botones de acción en tablet; el radio con su etiqueta como área tocable. | agente |
| 06.21 | P3 | medido | `pages/compras/index.vue:173-174`; `pages/compras/por-pagar.vue:153-155` | Las filas de las tablas abren la compra o el proveedor con clic en la fila, pero no son enlaces: no se puede abrir en otra pestaña con Ctrl+clic y un lector de pantalla no las anuncia como navegación (`tabindex=0` en la fila, sin `<a>`). | El folio y el nombre del proveedor como enlaces. | agente |
| 06.22 | P2 | medido | `pages/compras/por-pagar.vue:149-155,184-197` | La acción principal de la pantalla, "Pagar", no se ve hasta tocar una fila de proveedor, y nada lo sugiere: a 768 y a 1280 la pantalla recién cargada muestra solo la tabla de deudas. | Texto guía bajo el título ("Toca un proveedor para ver sus compras y pagar") o un botón "Pagar" en cada fila. | agente |
| 06.23 | P2 | medido | `pages/compras/[id].vue:1116-1130` | El modal "¿Confirmar la recepción?" dice solo "Entran 1 línea a Local: el stock sube ahora." Para una acción que mueve stock y costo y que no se edita después, no muestra qué productos entran, cuánto ni a qué costo, ni el total del documento. Captura: `compras/modal-confirmar-1280.png`. | Una lista breve ("10 unidad de Pan de hamburguesa a $500") y el total antes del botón. | agente |
| 06.24 | P3 | medido | 9 textos en pantalla (comando abajo) | Voseo en el grupo: `terceros.vue:515` ("Podés recuperarlo"), `[id].vue:1163` y `PagarProveedorModal.vue:222` ("si no tenés una, abrila antes de…"), `CargarDteModal.vue:184,197,216,223` ("Arrastrá o elegí el XML", "elegí cuál cargar", "pedile a quien…", "Elegí el proveedor"), `composables/useDte.ts:444` ("revisalas para que se cargue") y el mensaje del backend `compras.service.ts:2874` ("necesitás tu caja abierta"). El conteo transversal es 00.3. | Tuteo: "Puedes recuperarlo", "si no tienes una, ábrela antes de pagar", etc. | agente |
| 06.25 | P3 | medido | menú lateral (`layouts/dashboard.vue`); `pages/compras/index.vue:124,130` | El menú dice Compras › "Recepciones" y la pantalla dice "Compras". Quien busca "Recepciones" abre una pantalla que se llama de otra forma. | Un solo nombre en el menú y en el título. | owner (el nombre) |
| 06.26 | P2 | medido | `components/crud/CrudTable.vue:10-13`; `pages/compras/index.vue:210-224` | **La columna "Pago" de la lista sale vacía al recargar** (medido: por el menú muestra "Pendiente de pago"; con F5 o entrando por la dirección la celda queda en blanco aunque la API trae `estadoPago: "pendiente"`). `tableSlots` se calcula una sola vez sobre `useSlots()` y no vuelve a leerlos cuando aparece el slot condicional `#pago-cell`. Quien paga pierde en la lista el dato que más mira; sigue en el detalle y en Por pagar. Afecta a cualquier `CrudTable` con un slot condicional. Misma familia que 06.4. | Que `tableSlots` dependa de los slots de forma reactiva (leerlos en el render, no en un `computed`). | agente |
| 06.27 | P3 | medido | todo el grupo | Contraste, con la fórmula WCAG: la insignia verde de estado (Confirmada, Pagada, Vigente) mide **2,02:1** (texto `rgb(0,201,80)` sobre `rgb(229,249,237)`) a 10 px en la lista y 12 px en el detalle; el botón "Confirmar recepción", blanco sobre verde, **2,22:1**; "Anular compra" 3,28:1; el placeholder de los campos usa `oklch(0.704 0.04 256.788)` (≈2,6:1, calculado desde su equivalente `#90a1b9`). El gris de texto secundario mide 4,76:1 (ok). | Texto de la insignia success en un tono más oscuro y 12 px mínimo; "Confirmar recepción" en el petróleo de marca (9,47:1, como "Guardar borrador"); placeholder más oscuro. Es una decisión de color, cabe con 00.2. | agente |
| 06.28 | P3 | código | `pages/terceros.vue:345,373-377,394-409` | Terceros: el interruptor "Activo" de cada fila no tiene nombre accesible y mide 36×20; editar y eliminar son íconos con solo `title`. La lista carga todos los terceros sin buscador ni paginación. | `aria-label` por fila ("Activar Distribuidora Andina"); un buscador por nombre o RUT si la lista crece. | agente |
| 06.29 | P3 | código | `pages/terceros.vue:316,323,339,222,255,478`; `components/compras/CargarDteModal.vue:216` | Jerga y texto interno en pantalla: "Terceros", "Nuevo tercero", "Tercero creado" (el local los llama proveedores); y la ayuda del plazo de pago dice "Vacío = 30 días (spec compras-deuda-proveedor § 2)", con el nombre de la especificación a la vista del usuario. | Quitar "(spec … § 2)" ya mismo ("Vacío = 30 días"). El nombre del módulo es una decisión de producto. | agente (texto) / owner (nombre) |
| 06.30 | P3 | medido | `pages/compras/[id].vue:828-831` | Salir de "Nueva compra" con datos tipeados a mano no avisa (medido: con proveedor y una línea, el vínculo "Compras" volvió a la lista sin preguntar). El aviso existe solo cuando la compra viene de un XML. | Avisar con el mismo mecanismo si hay proveedor o alguna línea con producto sin guardar. | agente |
| 06.31 | P3 | medido | `components/compras/CompraConfirmada.vue:140-143,203-206` | En la compra confirmada, "Total del documento" y "Total" muestran lo mismo ($5.950), uno sobre otro. | Mostrar solo uno, o rotular "Total" como "Total de la compra". | agente |

### Conteo (comandos)

Voseo en el grupo, solo texto que se muestra (se excluyen comentarios; ejecutado en `frontend/app/`):

```bash
grep -nE "tenés|Podés|podés|Arrastrá|elegí|Elegí|pedile|abrila|revisalas|necesitás" \
  pages/compras/*.vue pages/terceros.vue components/compras/*.vue composables/useDte.ts \
  | grep -v nuxt.spec | grep -vE "^\S*:[0-9]+:\s*(//|\*)"
```

Da 8 líneas en `frontend/app` (7 en páginas y componentes, 1 en `useDte.ts`) más 1 mensaje del backend
(`grep -n "necesitás" backend/src/modules/compras/compras.service.ts`, línea 2874): 9 en total.

Objetivos tocables y nombres accesibles: `tocablesChicos` y `botonesSinNombre` de `apoyo.ts`, en
`compras-01-recorrido.pw.ts`, `compras-07-confirmada.pw.ts`, `compras-08-paga.pw.ts` y
`compras-19-filas.pw.ts`. Contraste: `compras-17-contraste.pw.ts`.

## 5. Lo que está bien

- **El folio repetido sale junto al campo**, con quién, qué documento y qué fecha ("Ya cargaste Factura
  AUDIT-001 de Distribuidora Andina…"), y no crea nada.
- **Nada se paga ni se confirma dos veces:** "Confirmar recepción" y "Pagar" quedan bloqueados mientras
  corre la acción, y el pago lleva `Idempotency-Key`. El borrador que se crea al confirmar no se
  duplica aunque falle el confirmar (`[id].vue:640-700`).
- **Anular una compra y anular un pago piden motivo**, dicen qué pasa ("Sale de Local todo lo que
  entró: 10 unidad de Pan de hamburguesa…", "La deuda de las compras que cubría vuelve") y avisan del
  efecto en la caja. El botón queda gris hasta escribir el motivo.
- **Los permisos están bien repartidos:** sin Pagar, el encargado no ve columnas, filtros ni secciones
  de pago, ni el menú "Por pagar"; sin Actualizar o Anular los botones de corregir y anular no
  existen. Se midió con `encargado.compras`, `compras.lectura` y `compras.paga`.
- **"¿La pagaste ya?"** propone el monto y el medio, y el reparto parte de la compra más vieja y se
  puede editar ("Recalcular propuesta").
- **El XML calza el proveedor y pre-llena todo**, deja una franja que dice de dónde viene y qué falta
  ("Faltan 3 líneas por asociar"), y avisa si se va a reemplazar lo tipeado.
- **Las cifras de dinero** llevan punto de miles y signo de pesos, y la unidad viaja con la cantidad
  ("10 unidad").
- **A 768 px la pantalla de carga entra sin scroll horizontal** y los botones principales quedan a la
  vista.

## 6. Orden sugerido

1. **Frente propio de datos y plata (06.1, 06.2, 06.3):** validar la línea y el total antes de guardar
   o confirmar, con el error junto al campo. 06.1 y 06.2 comparten el campo de cantidad; 06.3 va en el
   mismo lote porque confirmar es irreversible.
2. **06.4 y 06.26 juntos:** nacen de lo mismo (los permisos todavía no están cargados cuando la página
   decide qué pedir y qué mostrar). Tocan `[id].vue` y `CrudTable.vue`; hay que revisar si otras
   pantallas con un slot condicional sufren lo mismo.
3. **Decidir con el dueño 06.6** (anular cualquier pago, no solo los que dejan saldo a favor) y 06.11
   (si quien carga compras puede crear un proveedor). Con 06.6 resuelto, 06.7 sale solo.
4. **Lote de Por pagar y Pagar (06.12, 06.13, 06.18, 06.22):** la caja abierta, el atajo "Pagar todo",
   el éxito del pago y el texto guía. Una sola pasada por `por-pagar.vue` y `PagarProveedorModal.vue`.
5. **Lote de estados y permisos (06.10, 06.11 en lo visual, 06.14, 06.15, 06.17):** pantallas de "sin
   permiso", vacío con filtros, la tabla a 768 y el modal del XML.
6. **Lote mecánico de textos (06.9, 06.19, 06.24, 06.29, 06.31, 06.25):** fechas, el espacio de
   "Factura AUDIT-001", el voseo, quitar "(spec … § 2)" y la jerga.
7. **Accesibilidad y tablet (06.5, 06.8, 06.16, 06.20, 06.21, 06.23, 06.27, 06.28, 06.30):** nombres,
   tamaños, contraste y el resumen del modal de confirmar. 06.27 se decide junto con 00.2.

Archivos del arnés que dejé: `frontend/e2e-auditoria/compras-01-recorrido.pw.ts`, `compras-02-flujo.pw.ts`, `compras-03-carga.pw.ts`, `compras-04-invalidos.pw.ts`, `compras-05-debug.pw.ts`, `compras-06-confirmar.pw.ts`, `compras-07-confirmada.pw.ts`, `compras-08-paga.pw.ts`, `compras-09-pago-lista.pw.ts`, `compras-10-pagar.pw.ts`, `compras-11-pagar2.pw.ts`, `compras-12-efectivo.pw.ts`, `compras-13-sobrepago.pw.ts`, `compras-14-xml.pw.ts`, `compras-15-folio.pw.ts`, `compras-16-permisos.pw.ts`, `compras-17-contraste.pw.ts`, `compras-18-salir.pw.ts`, `compras-19-filas.pw.ts`, `compras-20-modal-paga.pw.ts`, `compras-21-medio.pw.ts`, `datos-compras/andina.xml`, capturas en `frontend/e2e-auditoria/capturas/compras/`.
