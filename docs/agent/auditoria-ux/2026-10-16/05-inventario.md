# 05 · Inventario

Auditoría UX con la skill `revisando-ux`, 2026-10-16. Pantallas: stock (kardex), recuentos (lista y
detalle), traslados, stock mínimo y mermas.

## Alcance

- **Pantallas:** `frontend/app/pages/inventario/index.vue` (menú "Stock"; es el kardex),
  `inventario/recuentos/index.vue`, `inventario/recuentos/[id].vue`, `inventario/traslados.vue`,
  `inventario/stock-minimo.vue` y `mermas.vue`. Los componentes que usan (`AppItemSelect`,
  `AppDrawer`, `CrudTable`, `AppDateInput`) se revisaron por lo que muestran en estas pantallas.
  Lo leído antes: `docs/features/bodegas-y-traslados.md`, `recuento-inventario.md` y
  `mermas-valorizadas.md`.
- **Quién y para qué:** el encargado de bodega o de local que cuenta stock, traslada entre bodega y
  local y registra mermas. El seed no trae un usuario con todo eso junto: `seedRolesInventario` separa
  a propósito contar de aplicar.
  - `contador@paris.cl` (Inventario:Leer + Crear + Items:Leer): crea y cuenta recuentos, **traslada** y
    **registra mermas**. No aplica recuentos ni ajusta costo ni carga el mínimo.
  - `aprobador@paris.cl` (Inventario:Leer + Actualizar): **aplica** recuentos, ajusta costo y carga el
    stock mínimo. No cuenta, no traslada y no registra mermas. Ve esas pantallas solo en lectura.
  - Ningún rol del seed hace las dos mitades. Lo que ninguno puede (editar causas de diferencia,
    motivos de baja y traslado, bodegas) está bajo Configuración y queda fuera de este grupo.
- **Cómo:** app corriendo en localhost:5173 con los dos usuarios, capturas a 1280 y 768
  (`e2e-auditoria/capturas/inventario/`), medidas de tamaño, ancho y contraste con `getComputedStyle`
  (fórmula WCAG; los colores salen en oklch y se convirtieron con canvas) y lectura de código.
  Se hizo una merma (1 papas fritas), un traslado (1 pan, bodega a local) y un recuento sin diferencias
  (no movió stock). El mínimo que se cargó para ver el estado "bajo el mínimo" se dejó vacío otra vez.
- **Capas:** las cuatro de `criterios.md`. La capa 3 usa el texto literal de las Web Interface
  Guidelines de Vercel bajado con `curl` el 2026-10-16 (191 líneas) en
  `.superpowers/auditoria-ux/vercel-guidelines.md`, no una descarga nueva.
- **Hallazgo previo incluido:** "Traslados con líneas incompletas" (05.2). Quedó **reproducido en
  pantalla**; ya no es solo de código.
- **Por código, sin poder verlo:** traslado de productos por serie y por lote, checkbox de series,
  merma de un producto con serie, drawer "Ajustar costo" (se abrió, no se envió), el caso de un local
  sin bodegas, los errores 403 de un rol con solo Leer, y la respuesta del servidor a una merma mayor
  al stock (no la probé porque podía escribir en el kardex).
- **No medido:** foco visible de cada control, contraste de los badges sobre su fondo tintado y
  tiempos de carga.

## El flujo

Toques contados desde la pantalla ya abierta, con un caso de un producto.

| # | Flujo y paso | Toques | Nota |
|---|---|---|---|
| A1 | Traslado: "Nuevo traslado" y elegir origen, destino y motivo | 1 + 3 selectores (2 toques cada uno) | Origen, destino y motivo son obligatorios |
| A2 | Traslado: elegir producto y cantidad | 2 + teclear | Muestra "Disponible en Bodega Subsuelo: 20" |
| A3 | Traslado: "Confirmar traslado" | 1 | El drawer se cierra, toast "Traslado registrado", fila nueva |
| B1 | Recuento: "Nuevo recuento", ubicación y productos | 1 + 2 + (2 por producto) | Producto por producto, sin "todos" |
| B2 | Recuento: contar | 1 por producto + teclear | Se guarda al salir del campo |
| B3 | Recuento: causa de cada diferencia (contador) | 2 por línea o 2 en la causa por defecto | Obligatoria si hay diferencia |
| B4 | Recuento: "Aplicar" y confirmar (aprobador) | 2 | Mueve el kardex |
| C1 | Merma: "Registrar merma", ubicación, producto, cantidad, motivo | 1 + 2 + 2 + teclear + 2 | Comentario opcional |
| C2 | Merma: "Registrar" | 1 | Toast con el costo perdido |
| D1 | Consulta: kardex con filtros | 0 a 2 selectores | Producto, motivo y ubicación; sin fecha |
| D2 | Stock mínimo: ver y cargar un mínimo (aprobador) | 1 + teclear + salir del campo | Sin botón de guardar |
| D3 | Stock mínimo: "Trasladar desde Bodega" (contador) | 1 | Abre el traslado ya armado (cantidad y origen) |

## La matriz de estados

Cada celda dice `ok`, el número del hallazgo o `n/a` con motivo. "Dedo" y "Teclado" miden cada
paso con lo que tiene en pantalla.

| Paso | Vacío | Cargando | Error | Sin permiso | Dato inválido | Éxito | 768 y 1280 | Dedo | Teclado |
|---|---|---|---|---|---|---|---|---|---|
| A1 Traslado: datos de cabecera | 05.24 | ok (el selector de producto trae su búsqueda) | 05.20 | 05.24 | 05.9 | n/a (no hay éxito hasta A3) | ok | 05.18 | 05.19 |
| A2 Traslado: líneas | 05.2 | ok (aviso "Cargando disponibilidad…") | 05.8 | n/a (el drawer solo abre con permiso) | 05.8 | n/a | ok | 05.18 | 05.19 |
| A3 Traslado: confirmar | 05.10 | ok (`:loading` y doble guarda en `confirmar`) | 05.8 | n/a | 05.2 | 05.2, 05.11 | ok | ok (32 px) | ok |
| B1 Recuento: crear sesión | 05.5 | ok | 05.9 | 05.24 | 05.9 | ok (abre el detalle) | ok | ok (32 px) | 05.19 |
| B2 Recuento: contar | 05.4 | ok (el campo se bloquea mientras guarda) | ok (devuelve el valor y avisa) | 05.7 | 05.4 | ok (la diferencia se ve al salir del campo) | 05.13 | 05.18 | 05.3 |
| B3 Recuento: causas | n/a (con diferencia cero no se pide) | ok | 05.1 | 05.1, 05.7 | 05.1 | ok | 05.13 | 05.18 | 05.3 |
| B4 Recuento: aplicar y cancelar | 05.7 | ok (`:loading`) | 05.1 | 05.1 | 05.6 | 05.7 | ok | ok (32 px) | ok |
| C1 Merma: llenar el formulario | 05.9 | ok | 05.9, 05.20 | 05.24 | 05.8, 05.9 | n/a | 05.25 | 05.18 | 05.19 |
| C2 Merma: registrar | n/a | ok (`:loading`) | 05.9 | n/a | 05.8 | 05.11 | ok | ok | ok |
| D1 Kardex | 05.23 | ok (barra de carga de `UTable`; los datos viejos quedan hasta que llega la respuesta) | 05.20 | n/a (solo lectura) | n/a | n/a | 05.12 | ok | ok |
| D2 Stock mínimo: ver y cargar | 05.23 | ok | 05.15, 05.20 | 05.24 | 05.15 | 05.15 | ok | 05.18 | 05.19 |
| D3 Stock mínimo: trasladar desde | n/a | ok | ok | ok (sin permiso muestra "Hay 1 kg en Bodega Subsuelo", sin botón) | n/a | ok (abre el traslado armado) | ok | 05.18 | ok |

Las filas de color y de tamaño de letra (05.17), de acceso por tablet (05.13) y de "Lenguaje del
local" (05.21, 05.22) aplican a todos los pasos de la pantalla correspondiente.

## Hallazgos

Los números de la tabla salen de capturas y medidas; el comando de cada conteo va en su fila.

| # | Severidad | Confianza | Dónde | Qué pasa (escena concreta) | Propuesta | Decide |
|---|---|---|---|---|---|---|
| 05.1 | P1 | medido | `recuentos/[id].vue:394-413` (cabecera), `:518-521` (modal), `:474,:494` (campos); `e2e-auditoria/capturas/inventario/a-modal-aplicar-1280.png` | El contador cuenta el pan (-2) y no pone causa. El aprobador abre el recuento, ve todos los campos deshabilitados sin motivo y aprieta "Aplicar". El modal le dice, en amarillo, "la aplicación se rechazará hasta indicarla" y **deja el botón Aplicar activo**. Lo aprieta y el servidor contesta 400 "Falta la causa de la diferencia para Pan de hamburguesa". El aprobador no puede poner la causa (exige Inventario:Crear) y la pantalla no dice quién debe hacerlo: queda sin salida. | Con líneas sin causa, deshabilitar "Aplicar" en el modal y cambiar el aviso a "Falta la causa en Pan de hamburguesa. La pone quien contó, y después vuelves a aplicar". Nombrar cuáles líneas faltan (hoy solo el conteo). Si el owner quiere que el aprobador pueda poner la causa, es regla de permisos. | agente (aviso y botón); owner (si el aprobador pone causas) |
| 05.2 | P1 | medido | `traslados.vue:187-194` (`lineasValidas`), `:395`; `capturas/inventario/t-06-dos-lineas-segunda-sin-cantidad-768.png`, `t-08-exito.png` | Reproducido. El contador arma dos líneas: pan x 1 y papas fritas sin cantidad. "Confirmar traslado" sigue activo; al apretarlo viaja solo la línea del pan (el POST llevó una línea) y el toast dice "Traslado registrado". La fila nueva dice "Ítems 1". Nadie le avisó que las papas no se movieron: el local queda sin lo que creía haber traído. Lo mismo para serie sin unidades y lote sin elegir (por código). Es silencioso, reversible solo con otro traslado; borde con P0 (datos). | Si hay una línea con producto pero incompleta, no enviar: marcar la línea ("Falta la cantidad") y dejar el botón activo para que el error aparezca junto al campo. Las líneas totalmente vacías sí se pueden ignorar. El toast puede decir "Traslado registrado: 1 producto". | agente |
| 05.3 | P2 | medido | `recuentos/[id].vue:474,:494` | Contando 40 productos con el teclado: se escribe el conteo y se aprieta Tab. El campo y el selector de causa quedan deshabilitados mientras se guarda (`:disabled="readOnly \|\| row.original.guardando"`), así que el foco cae en `<body>` (medido: `document.activeElement` es `body`). Hay que volver a tocar el siguiente campo después de cada línea. En tablet con teclado en pantalla es un toque más por producto. | No deshabilitar el campo al guardar (basta un indicador `loading` y bloquear el reenvío), o devolver el foco al siguiente campo. Enter debería pasar al siguiente "Contado". | agente |
| 05.4 | P2 | medido | `recuentos/[id].vue:470-486`, `recuentos/index.vue:184-191`, `stock-minimo.vue:162-174`; `capturas/inventario/r-06-contado-768.png`, `r-05-lista-con-borrador-1280.png` | El contador escribe 49 y, al guardar, el campo pasa a "49.0000"; la diferencia sale "-2.0000" y la lista de recuentos trae "Diferencia neta 0.0000", con punto decimal y cuatro decimales, mientras el stock de al lado dice "51" y las demás pantallas "1,35 kg". El mínimo cargado queda "2.0000" en el campo y "2 kg" para quien solo lee. Además la "Diferencia neta" suma productos de unidades distintas (unidades y kg), que no significa nada. Ninguno trae unidad. | Formatear con `formatStock` (coma, sin ceros de más, con unidad) en contado, diferencia y mínimo; mostrar la unidad junto al campo. Para la lista, reemplazar la "neta" por "N líneas con diferencia" (sin regla nueva). | agente |
| 05.5 | P2 | código | `recuentos/index.vue:255-262` | Para contar toda la bodega hay que abrir el selector y marcar producto por producto (la captura `r-02-multiselect-abierto.png` muestra la lista de a uno). Con 80 productos son 160 toques, y el campo resume los elegidos como "Papas fritas, Pan de hamburguesa" hasta que se corta. No hay "todos los de esta ubicación". | Agregar "Todos los productos con stock en esta ubicación" (el servidor ya tiene el saldo por ubicación). Es una función nueva, no una corrección. | owner |
| 05.6 | P2 | medido | `recuentos/[id].vue:543-551`; `capturas/inventario/r-08-modal-cancelar-1280.png` | El modal de cancelar tiene dos botones: "Cancelar" (gris, para no cancelar) y "Cancelar recuento" (rojo, para cancelar). Con apuro, "Cancelar" suena a lo que se quiere hacer y es lo contrario. | Botón de salida "Volver" y botón rojo "Sí, cancelar el recuento". | agente |
| 05.7 | P2 | medido | `recuentos/[id].vue:78,:365-385,:280-285`; `capturas/inventario/r-10-aplicado-768.png` | Un recuento aplicado se ve igual que uno abierto con los campos grises: no dice cuántas líneas movió, quién lo aplicó ni cuándo (`aplicadoEl` viene de la API y no se muestra), y "Causa por defecto: Sin causa por defecto" ocupa una tarjeta entera sin sentido. Al aprobador, que no puede contar, los campos le aparecen deshabilitados sin decir por qué. Todo el resumen vive en un toast de pocos segundos. | Una línea bajo el título: "Aplicado el 16-10-2026 por Aprobador: 1 línea movida, 1 sin diferencia". Si el campo está deshabilitado por permiso, un texto "Lo carga quien cuenta". | agente |
| 05.8 | P2 | medido | `traslados.vue:665-667,:742`; `mermas.vue:472-477` | En traslados, con "Disponible en Bodega Subsuelo: 20" a la vista, se puede escribir 999 y "Confirmar traslado" sigue activo; recién el servidor contesta en un toast "Stock insuficiente de "Pan de hamburguesa": faltan 979 en Bodega Subsuelo (disponible 20, solicitado 999)". En mermas ni siquiera se muestra cuánto hay en la ubicación elegida. | Marcar la línea junto a la cantidad cuando supera lo disponible ("Hay 20") sin bloquear a ciegas; mostrar el disponible también en mermas. El tope lo sigue calculando el servidor (el dato `disponible` ya viene del backend). | agente |
| 05.9 | P2 | medido | `mermas.vue:217-224`; `recuentos/index.vue:91-98`; `capturas/inventario/m-03-listo-768.png` | Al enviar la merma incompleta sale siempre el mismo toast: "Completa producto, cantidad y motivo". Ni dice cuál falta ni nombra la ubicación (que también es obligatoria; hay un segundo toast distinto). Ningún campo se marca; el toast, además, queda arriba del título del drawer. Es lo que dice Vercel: errores junto al campo y foco al primero. | `UFormField` con `error` por campo y foco al primero que falta; dejar el toast solo para errores del servidor. | agente |
| 05.10 | P2 | medido | `traslados.vue:738-745`; `capturas/inventario/t-04-linea-con-producto-1280.png` | Con producto elegido y cantidad en blanco, "Confirmar traslado" aparece apagado y no dice qué falta (origen, destino, motivo, cantidad). El asterisco rojo de "Cantidad" es la única pista. | Dejarlo activo y marcar lo que falta (ver 05.9), o escribir al lado del botón "Falta la cantidad". | agente |
| 05.11 | P2 | código | `traslados.vue:416-417`; `mermas.vue:265-273` | Registrar una merma o un traslado no tiene resumen previo ni deshacer: 100 en vez de 10 queda en el kardex, y no hay pantalla para anularlo (se compensa con otro movimiento). El único cierre es un toast que se va ("Traslado registrado", "Merma registrada · costo perdido $800"). Criterio de `criterios.md`: lo chico se deshace en un toast. | Línea de resumen sobre el botón ("Vas a mover 1 Pan de hamburguesa de Bodega Subsuelo a Local"). Deshacer es regla de negocio. | agente (resumen); owner (anular) |
| 05.12 | P2 | medido | `inventario/index.vue:147-160`; `capturas/inventario/c-kardex-1280.png` | El kardex tiene 10 columnas y una tabla de 1284 px dentro de 992 px: a 1280 quedan fuera de la vista "Resultante", "Costo de la baja" y "Usuario" (Resultante empieza en x=1265, la vista termina en 1232) sin ninguna pista de que hay scroll. A 768 el contenedor mide 672 px: se corta desde "Motivo". Además el encabezado mide 88 px de alto y cada fila 55 px, así que en 1280x800 se ven 7 movimientos. "Costo" y "Costo de la baja" son "—" en casi todas las filas. | Unir "Costo" y "Costo de la baja" en una columna que solo aparece si hay valor, fijar la altura del encabezado y acortar la fila; si el saldo es lo que más se busca, "Resultante" va pegada a "Cantidad". | agente (forma); owner (qué columnas) |
| 05.13 | P2 | medido | `traslados.vue:456-464`, `mermas.vue:286-294`, `recuentos/[id].vue:322-328` | A 768 la columna "Comentario" queda fuera de la vista en traslados (tabla de 802 px en 672) y en mermas (741 en 672), y en el detalle de recuento el selector de causa se corta ("Usar la causa por de…", tabla de 772 en 672: `r-06-contado-768.png`). Para elegir la causa en tablet hay que desplazar la tabla de lado. Móvil está fuera de alcance, pero tablet no. | En el detalle de recuento, acortar las columnas (el contado a 128 px y la causa a 192 px) o pasar la causa a una segunda línea de cada fila. | agente |
| 05.14 | P2 | medido | `layouts/dashboard.vue` (menú), `inventario/index.vue:309-317` | El menú dice "Stock", la pantalla se llama "Inventario" y trae el "Kardex de movimientos de stock": una lista de entradas y salidas. Quien quiere saber "¿cuánto pan hay?" no lo encuentra ahí; el saldo por ubicación solo se ve en "Stock mínimo" (una pantalla pensada para otra cosa) y en Configuración > Items ("Stock total: 79.0000 unidad"). | Llamar al ítem de menú "Movimientos" (o "Kardex") y el título igual; el saldo por producto y ubicación es una pantalla nueva (o reutilizar Stock mínimo con otro nombre). | agente (nombre); owner (pantalla nueva) |
| 05.15 | P2 | medido | `stock-minimo.vue:84-99,:162-174`; `capturas/inventario/sm-aprobador-bajo-minimo-1280.png` | El aprobador escribe "abc" en un mínimo y sale el toast "minimo admite hasta 14 enteros y 4 decimales, sin signo, minimo must be a number string": mezcla un texto técnico con otro en inglés, con el campo "minimo" sin tilde, y el número vuelve a vaciarse. Cuando el número es válido no pasa nada visible salvo que el campo se reescribe a "2.0000" y aparece "Bajo el mínimo": no hay "Guardado". Tampoco hay unidad en el campo. | Validar junto al campo con "Escribe un número, por ejemplo 2 o 1,5"; filtrar los mensajes en inglés del servidor; confirmar con un check breve junto al campo. | agente |
| 05.16 | P2 | medido | `mermas.vue:339-340`; `capturas/inventario/m-05-comida-personal-1280.png` | Dos campos de fecha idénticos ("dd - mm - aaaa") sin "Desde" ni "Hasta". Hay que adivinar cuál es cuál. El botón del calendario de cada uno se llama igual: "Seleccionar fecha". | Etiquetas "Desde" y "Hasta" encima, y un `aria-label` distinto en cada botón. | agente |
| 05.17 | P2 | medido | `inventario/index.vue:395-400`, `mermas.vue:365-367`; `UBadge size="sm"` en las seis pantallas | Contraste medido: `text-success` (0,201,80) sobre blanco **2,22:1**, `text-warning` (240,177,0) **1,91:1**, `text-error` (251,44,54) **3,81:1** a 14 px, y el placeholder (144,161,185) **2,63:1**; el mínimo exigido es 4,5:1. Es justo el dato clave: la cantidad de cada movimiento en el kardex y en mermas va en esos colores, y los badges de tipo y estado son de 10 px (medido) con `text-success` sobre fondo tintado, aún más bajo. Solo `text-muted` (4,76:1) pasa. | Para texto, usar el matiz 700 del token (`text-success` ya es el 500 de Nuxt UI) y 12 px como mínimo en badges; no es cambio de paleta. Ver también 00.7 (DM Sans sin cifras tabulares: `tabular-nums` aparece 0 veces en estas seis pantallas; conteo: `grep -c tabular-nums` sobre los seis archivos). | owner (toca tokens) |
| 05.18 | P2 | medido | `traslados.vue:637-645`, `stock-minimo.vue:162-174,:205-215`, `recuentos/[id].vue:339-345`; `tocablesChicos` | Objetivos tocables bajo 44 px en tablet: el botón de quitar línea del traslado mide 28x28 y va rojo pegado al selector de producto; el campo de mínimo mide 96x28; "Agregar línea" 110x24; "Trasladar desde Bodega…" 228x24; "Volver a recuentos" 141x20; el switch "Solo bajo el mínimo" 36x20. Todos los botones, selectores y campos del grupo miden 32 px de alto. El de quitar línea no tiene confirmación ni deshacer. | Tamaño `lg` (≥44 px) en los controles de las líneas y de la fila, o aumentar el área de toque; separar "quitar" del selector. Los 32 px generales son transversales. | agente |
| 05.19 | P2 | medido | `traslados.vue:637-645`; selectores `USelectMenu` de las seis pantallas | Todos los selectores (origen, destino, motivo, producto, causa, ubicación) tienen nombre accesible "Show popup", en inglés, y no el de su etiqueta visible ("Origen", "Motivo"…). El botón de quitar línea (icono de papelera) no tiene nombre. Vercel: botones de solo icono llevan `aria-label` y los controles tienen etiqueta. El checkbox de cada serie en traslados mide 16 px y no está unido a su texto (código). | `aria-label` en español en cada selector y en la papelera ("Quitar línea de Pan de hamburguesa"); si es de `AppItemSelect`, se arregla en un solo lugar. | agente |
| 05.20 | P2 | código | `composables/usePaginatedList.ts:99-101`; usado por kardex, traslados, mermas, recuentos y stock mínimo | Si falla la carga de una lista, solo sale un toast y la tabla muestra su mensaje de vacío ("No hay traslados registrados.", "No hay movimientos registrados."). Quien mira la pantalla cuando el toast ya se fue cree que no hay nada. Es transversal (10 pantallas llaman a ese composable). | Estado de error propio en la tabla ("No se pudo cargar. Reintenta") con botón, sin reintento automático. | agente |
| 05.21 | P3 | código | `traslados.vue:617`, `recuentos/index.vue:143`, `mermas.vue:517` | Voseo en 3 líneas: "Elegí el origen para poder agregar líneas", "contá contra el stock del sistema y aplicá la diferencia", "dalo de baja desde Ajuste de stock". Comando: `grep -rnE "\b(Elegí\|Contá\|contá\|aplicá\|dalo\|Seleccioná\|Registrá\|Agregá)\b" app/pages/inventario app/pages/mermas.vue app/composables/useRechazoPorStock.ts app/composables/useRecuentoInventario.ts \| grep -v spec.ts` (3 líneas). La cuenta total de la app es de 00.3. | "Elige el origen…", "cuenta contra el stock del sistema y aplica la diferencia…" y "da de baja el producto desde Ajuste de stock, eligiendo la unidad". | agente |
| 05.22 | P3 | medido | `traslados.vue:485,:772,:778`; `recuentos/index.vue:143`; `inventario/index.vue:138-141` | Jerga y datos internos en pantalla: "las bodegas del tenant" (traslados), "kardex" en dos descripciones, "línea(s)" y "producto(s)" con paréntesis en los toasts y el modal de aplicar, y en el detalle de un traslado cada línea muestra el id interno del movimiento ("13620f57-b879-40c5-84ff-b1fb1b2c6434"). En el kardex, el motivo de una comida del personal sale duplicado: "Comida del personal · Comida del personal (dentro del local)". | "entre el local y las bodegas", "historial de movimientos", "1 línea" / "2 líneas", quitar los ids del detalle, y mostrar una sola vez el nombre del motivo. | agente |
| 05.23 | P3 | medido | `inventario/index.vue:425-433`, `stock-minimo.vue:233` | El mensaje de vacío no distingue "no hay nada" de "tu filtro no encontró nada": con el motivo "Recuento" el kardex dice "No hay movimientos registrados." (medido, `k-filtro-sin-resultados-1280.png`), y la búsqueda de stock mínimo dice "No hay productos con stock." | "Ningún movimiento con esos filtros" + botón "Quitar filtros" cuando hay filtro activo. | agente |
| 05.24 | P3 | código | `traslados.vue:488-496`; vistas del aprobador `capturas/inventario/a-traslados-768.png` | Sin permiso o sin bodegas, el botón simplemente falta o se apaga sin motivo visible: "Nuevo traslado" deshabilitado tiene su explicación en un `title` (no se ve en tablet), y el aprobador entra a Traslados y a Mermas y ve una lista sin ninguna acción y sin texto que diga que solo puede mirar. | Texto bajo el título: "Para trasladar necesitas al menos una bodega" / "Solo puedes ver los traslados; los registra quien cuenta". | agente |
| 05.25 | P3 | medido | `mermas.vue:472-476,:529-535`; `capturas/inventario/m-03-listo-768.png` | En el formulario de merma, "Cantidad" (167 px) y "Comentario" (176 px) son angostos y los demás campos ocupan el ancho completo: parece que faltara algo. Además un toast de error previo cubre el título del drawer ("Registrar merma") hasta que se va. | `class="w-full"` en los dos campos. | agente |

Conteos: P0 0 · P1 2 · P2 18 · P3 5 (25 en total).

## Lo que está bien

- **El traslado precargado desde Stock mínimo** (D3): "Trasladar desde Bodega Subsuelo" abre el drawer
  con origen, destino, producto y cantidad ya puestos y el disponible a la vista; el aprobador, sin
  permiso de trasladar, ve "Hay 1 kg en Bodega Subsuelo" en vez de un botón que rebotaría.
- **El disponible por línea** en el traslado ("Disponible en Bodega Subsuelo: 20") sale del servidor,
  no se calcula en el cliente.
- **El aviso de origen igual a destino** aparece junto al selector en rojo, antes de enviar.
- **La merma dice cuánto costó**: el toast trae el costo perdido ("Merma registrada · costo perdido
  $800") y el aviso de producto sin costo cargado deja registrar igual sin engañar.
- **El recuento guarda al salir del campo y devuelve el valor viejo si falla**; la diferencia aparece
  en la misma fila, con el color del faltante y el sobrante.
- **Permisos por botón** (`recuentos/[id].vue:394-413`): contar y aplicar se separan de verdad y cada
  botón lleva su permiso, sin esconder "Aplicar" tras "contar".
- **Doble envío**: "Confirmar traslado" y "Registrar" se bloquean con `:loading` y el traslado tiene una
  segunda guarda en `confirmar` (no se puede mandar dos veces con Enter).
- **El estado del recuento** se ve a la primera (Borrador, Aplicado y Cancelado con color y texto) y la
  ubicación aparece en el título solo cuando hay bodegas.
- **Los textos de ayuda** de los formularios explican el porqué ("No se puede cambiar después de crear
  la sesión", "Solo productos por cantidad") y no inventan reglas.
- **Menú del rol**: el contador ve las cinco pantallas de su trabajo y el aprobador, además, Reportes.

## Orden sugerido

1. **Frente propio, 05.2 y 05.1 (P1).** Son errores de la tarea principal: el traslado que se registra a
   medias sin decirlo y el aprobador que no puede terminar de aplicar. Ambos son de presentación y
   validación del formulario, sin tocar el motor de stock. 05.1 pide al owner una sola decisión (si el
   aprobador puede poner la causa).
2. **Lote "formularios de inventario"** (mismo patrón en traslados y mermas): 05.8, 05.9, 05.10, 05.11,
   05.25 y 05.21. Un solo cambio de error junto al campo resuelve cuatro de ellos.
3. **Lote "detalle de recuento"**: 05.3, 05.4, 05.6, 05.7 y 05.13. Es la pantalla que más pesa en tablet.
4. **Lote "tablas y filtros"**: 05.12, 05.16, 05.20, 05.23 y 05.24; 05.14 se puede cambiar de nombre sin
   pantalla nueva.
5. **Lote de accesibilidad y tamaño** (se arregla en `AppItemSelect`, `UBadge` y los botones de línea):
   05.17, 05.18 y 05.19; 05.17 espera la decisión del owner sobre tokens.
6. **Decisiones del owner**: 05.5 (contar todo lo de una ubicación), 05.11 (deshacer o anular) y la
   pantalla de saldo de 05.14. Hasta que se decida, no entran.

Archivos del arnés que dejé: `frontend/e2e-auditoria/inventario-01-contador.pw.ts`, `inventario-02-medidas.pw.ts`, `inventario-03-traslado.pw.ts`, `inventario-04-traslado-lineas.pw.ts`, `inventario-05-mermas.pw.ts`, `inventario-06-recuento-contador.pw.ts`, `inventario-07-conteo.pw.ts`, `inventario-08-aprobador.pw.ts`, `inventario-09-minimo.pw.ts`, `inventario-10-revertir.pw.ts`, `inventario-11-aplicar.pw.ts`, `inventario-12-medidas.pw.ts`, `inventario-13-linea-tocables.pw.ts`, `inventario-14-cuanto-hay.pw.ts`, `inventario-15-overflow.pw.ts` y las capturas en `frontend/e2e-auditoria/capturas/inventario/`.
