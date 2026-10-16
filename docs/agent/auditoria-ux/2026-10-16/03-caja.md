# 03 · Caja

Auditoría UX del grupo Caja, 2026-10-16. No se tocó código de la app. Las capturas se citan por ruta
relativa a `frontend/` (`e2e-auditoria/capturas/caja/<archivo>.png`, a 1280 y a 768: el archivo termina
en `-1280` o `-768`).

## 1. Alcance

- **Pantallas:** `pages/caja/index.vue` (solo redirige), `mi-caja/index.vue`, `mi-caja/historial.vue`,
  `mi-caja/[id].vue`, `cajas/index.vue`, `cajas/[id].vue`, `cajas/historial.vue`,
  `cajas/pendientes-revision.vue`, `cajas/tendencia.vue` y los 14 componentes de `components/caja/`.
  Antes se leyó `docs/features/gestion-cajas.md` (apertura, movimientos, cierre en dos fases, cuadratura,
  modo ciego, historial de supervisión).
- **Roles:**
  - **La cajera** abre su caja, registra movimientos, cierra contando el efectivo y ve si cuadró.
  - **El encargado** ve las cajas abiertas, fuerza un cierre ajeno y revisa los descuadres.
- **Usuario con el que se midió:** `encargado@paris.cl` (rol "Cajas · Encargado": `Cajas:Leer` +
  `Cajas:Actualizar`, no admin; `seedRolEncargadoCajas`, `seeder.service.ts:2852`). No se usó otro.
- **Cómo se revisó, y por qué hay dos tipos de evidencia:**
  - **Medido contra el backend real** (encargado): `/cajas`, `/cajas/historial`, `/cajas/tendencia`,
    `/cajas/pendientes-revision`, detalle de una caja abierta real (la que abrió otro auditor), teclado,
    objetivos tocables, contraste, tamaños de texto.
  - **Medido con API simulada** (marcado `medido (sim.)`): el encargado **no tiene `MiCaja`**, así que no
    puede abrir caja ni operar un turno, y la cajera real la usa otro auditor. Las pantallas de la cajera
    (apertura, turno, movimiento, cierre, conciliación, resultado) y los casos del encargado que
    necesitan datos que no hay (caja ajena en modo ciego, bandeja con filas) se vieron en el navegador
    interceptando las llamadas `/api/caja/*` con respuestas de la forma del contrato de
    `gestion-cajas.md` y agregando `MiCaja:*` a la respuesta de `mis-permisos` en el navegador. La base y
    el backend no se tocaron. Lo que depende del backend real (reglas de saldo, umbrales, firmas) no se
    midió así.
  - **Código:** lo que no se pudo provocar; cada fila lo dice.
- **Capas aplicadas:** las cuatro de `criterios.md`. La capa 3 se aplicó con el texto literal bajado
  con `curl` el 2026-10-16 (`.superpowers/auditoria-ux/vercel-guidelines.md`, 191 líneas), sin volver a
  bajarlo. Excepción aplicada: mayúscula solo inicial, móvil fuera de alcance.
- **Colores financieros:** verde/rojo/azul del módulo son excepción aprobada. Solo se proponen cambios
  donde el contraste está **medido** y falla (03.8, 03.9, 03.10).
- **Hallazgos previos:** los dos de `auditoria-ux-hallazgos-previos` (POS al imprimir, traslados) no son
  de este grupo.

## 2. El flujo

### La cajera (abrir, mover, cerrar contando, ver si cuadró)

| # | Paso | Toques | Qué se ve |
|---|---|---|---|
| 1 | Entrar a Mi caja | 1 (menú) | Grilla de cajones disponibles (`10-apertura-grid`) |
| 2 | Elegir el cajón | 1 | Drawer "Abrir caja — Mostrador" (`11-apertura-drawer`) |
| 3 | Saldo inicial y abrir | 1 + teclear | Toast "Caja abierta correctamente" y redirección al turno (`14-turno-abierto`) |
| 4 | Registrar un movimiento | 3 si es salida (+ Movimiento, Salida, Registrar) + 2 campos | Saldo esperado y tabla se actualizan al instante (`18-turno-con-movimiento`) |
| 5 | Cerrar contando | 2 (Cerrar caja, Enviar conteo) + 1 campo | Drawer con "Esperado", diferencia en vivo (`20-cierre-descuadre`) |
| 6 | Si descuadró: conciliar | 4 (Continuar conciliación, abrir lista, motivo, Confirmar cierre) | El drawer se cierra solo y la página cambia a "En conciliación" (`21-conciliacion`, `21b-conciliacion-drawer`) |
| 7 | Ver si cuadró | 0 | Solo un toast de unos 5 s ("Diferencia de efectivo: -$1.500"); en modo ciego, una tarjeta que queda (`23-tras-cierre-toast`, `52-resultado-cierre-ciego`) |

Camino feliz con el efectivo cuadrado: 8 toques y 4 campos tecleados (saldo, concepto, monto, efectivo
contado).

### El encargado (ver cajas abiertas, revisar un descuadre)

| # | Paso | Toques | Qué se ve |
|---|---|---|---|
| 1 | Ver las cajas | 1 (menú Cajas) | Grilla de cajones con usuario, saldo y apertura (`40-cajas-abiertas`) |
| 2 | Abrir una caja ajena | 1 | Detalle con "Caja de otro cajero" y el botón "Cerrar por el cajero" bajo la tabla de movimientos (`41-caja-ajena-ciego`, `30-detalle-caja-cerrada`) |
| 3 | Forzar el cierre | 1 + conteo | Drawer de conteo a ciegas (`42-cierre-forzado-conteo`) |
| 4 | Ir a pendientes | 2 (Cajas, "Pendientes de revisar") | Resumen "Hoy" y bandeja (`43-pendientes-con-filas`) |
| 5 | Revisar un descuadre | 3 (Ver cierre, volver, Marcar visto) | "Ver cierre" no trae el motivo ni el botón de marcar (03.18) |
| 6 | Ver un patrón | 3 (Cajas, Tendencia, fila del cajero) | Historial filtrado que no dice a quién (`53-historial-filtrado-por-cajero`) |

## 3. La matriz de estados

Cada celda: `ok`, el número del hallazgo o `n/a` con el motivo.

| Paso | Vacío | Cargando | Error | Sin permiso / deshabilitado | Dato inválido | Éxito | 768 y 1280 | Dedo | Teclado y lector |
|---|---|---|---|---|---|---|---|---|---|
| Elegir cajón y abrir caja | ok ("No hay cajas disponibles…", voseo 03.19) | ok ("Cargando cajones…") | ok (toast con el mensaje del backend) | 03.27 (rebote sin permiso) | 03.13 | ok (toast + redirección) | 03.24 | 03.7 | 03.11 |
| Turno abierto (resumen y movimientos) | ok ("Sin movimientos registrados en este turno") | 03.29 | ok (toast "Error al cargar resumen del turno") | ok (acciones solo si la caja es propia y abierta) | n/a (no hay campos) | ok (saldo y tabla al instante, medido) | ok | 03.7 | ok (0 botones sin nombre) |
| Registrar movimiento | n/a (el formulario nace vacío) | ok (`:loading` en el botón) | ok (toast con el mensaje del backend) | n/a (la cajera con `MiCaja:Actualizar` siempre puede) | 03.13 | ok (toast + fila nueva) | ok | 03.7 | 03.25 |
| Contar y enviar conteo | n/a (el conteo nace vacío) | ok ("Cargando arqueo…") | ok (toast con el mensaje del backend) | 03.14 | 03.13 | 03.4 | ok (drawer `md`) | 03.7 | ok (foco en el primer campo, Tab en orden) |
| Conciliar el descuadre | ok (sin motivos: pide comentario) | ok (`loading`) | ok (toast) | 03.14 | 03.13 | 03.4 | 03.15 (badge crudo `EN_CONCILIACION`) | 03.7 | ok |
| Ver si cuadró (cajera) | n/a (siempre hay un resultado) | n/a (sale de lo que devolvió el cierre) | n/a (el cierre ya respondió) | n/a (el 403 del historial es regla de negocio del 2026-09-29) | n/a | 03.4 | ok | ok (solo texto) | ok |
| Cajas abiertas (encargado) | ok ("No hay cajones activos definidos") | ok ("Cargando cajones…") | ok (toast) | ok (la ruta exige `Cajas:Leer`) | n/a (no hay campos) | ok | ok (3 columnas a 1280, 2 a 768) | ok (la tarjeta es grande) | 03.11 |
| Detalle de caja ajena y cierre forzado | n/a (siempre hay detalle) | ok ("Cargando…") | ok (toast "No tenés acceso…", voseo 03.19) | ok (el panel solo con `Cajas:Actualizar`) | 03.13 | 03.4 | 03.6 | 03.7 | ok |
| Pendientes de revisar | ok ("No hay cierres pendientes de revisar") | ok (spinner de `UTable` y "Cargando…") | ok (distingue "no se pudo cargar" de "no hay nada") | ok (el botón se esconde sin `Cajas:Actualizar`) | n/a (no hay campos) | ok (toast "Cierre marcado como revisado") | 03.1 | 03.7 | ok (0 botones sin nombre) |
| Historial y tendencia | ok ("No hay cajas en el historial", "Ninguna caja con el conteo cerrado") | ok | ok (tendencia distingue fallo de vacío) | ok | 03.12 | n/a (son pantallas de lectura) | 03.2 | ok (filas, no botones) | 03.12 (fechas sin etiqueta); las filas sí son enfocables (ok) |

## 4. Hallazgos

Severidades: **0 P0**, 3 P1, 15 P2, 11 P3. No hay P0: todas las acciones de plata del grupo (abrir,
registrar, enviar conteo, confirmar cierre, marcar visto) quedan con el botón bloqueado mientras el
POST está en vuelo (`:loading`), y el esperado y la diferencia los calcula el servidor.

| # | Severidad | Confianza | Dónde (`archivo:línea`) | Qué pasa (escena concreta) | Propuesta | Decide |
|---|---|---|---|---|---|---|
| 03.1 | P1 | medido | `components/caja/CajaPendientesRevision.vue:144` (tabla), `:177-187` (explicación), `:189-210` (acciones) | El encargado abre "Pendientes de revisar" en la tablet (768): la tabla es más ancha que la tarjeta y **"Ver cierre" y "Marcar visto", las únicas acciones de la pantalla, quedan fuera de la vista**, sin barra ni pista de que hay más a la derecha. A 1280, con dos filas y una explicación larga, "Marcar visto" se corta contra el borde de la tarjeta. Capturas `43-pendientes-con-filas-768` y `-1280` (sim.). | Que la fila entera lleve a "Ver cierre" y que "Marcar visto" quede en una columna fija al final con ancho propio: limitar "Qué dijo el cajero" a unas 2 líneas con `line-clamp-2`, ocultar la columna "Cajón" a 768 o juntar "Cajero · Cajón" en una celda. Quitar el `max-w-xs` que empuja el ancho. | agente |
| 03.2 | P1 | medido | `components/caja/CajaHistorial.vue:38-46` (columnas), `:81-90` (fechas) | En el historial a 768, la tabla mide 822 px en un contenedor de 672: **la columna "Diferencia", la que responde "¿cuadró?", queda fuera de la vista** (medido: su borde derecho está en x=870 con la pantalla de 768 px). "Apertura" y "Cierre" gastan dos columnas con fecha y hora completas. Captura `05-historial-768`. | Poner "Diferencia" justo después de "Caja"; dejar una sola columna de fecha (cierre, y apertura solo en el detalle) o dar fecha corta; ocultar "Saldo inicial" a 768. Con la columna nueva de cajero (03.16) conviene decidir todo el orden junto. | agente |
| 03.3 | P1 | medido (sim.) | `components/caja/CajaCierreDrawer.vue:172-212` (`enviarConteo`) y `:483-492` (botón) | "Enviar conteo" **congela el conteo sin pedir que se confirme el número tecleado**: un cero de más (450.000 en vez de 45.000) queda como diferencia permanente y, si supera el límite, aparece en la bandeja del encargado como un cierre sospechoso. Con el modo ciego es peor: la cajera no tiene referencia mientras teclea. Lo único que lo frena es `saving`. Capturas `20-cierre-descuadre`, `51-cierre-ciego-conteo`. | Un paso de confirmación dentro del mismo drawer, con el monto contado en grande: "Contaste $45.000 en efectivo. Después de enviarlo no se puede cambiar." con "Corregir" y "Enviar conteo". Es un frente propio: toca el cierre de caja. | agente (el paso); owner si además se quiere permitir recontar tras enviar |
| 03.4 | P2 | medido (sim.) | `components/caja/CajaCierreDrawer.vue:144-170` (`finalizarExito`, línea 153 `if (!ciego.value) return`) | En modo normal, al terminar el cierre el drawer se cierra, la cajera cae en la grilla de apertura y **el resultado queda solo en un toast de unos 5 s** ("Diferencia de efectivo: -$1.500") que además cuenta solo el efectivo y se pinta verde para cualquier valor ≥ 0, aunque una tarjeta con conteo obligatorio haya descuadrado. En modo ciego sí queda la tarjeta "Resultado de tu cierre" con el desglose. Como la cajera sin `Cajas:Leer` no puede volver a abrir la caja cerrada, no hay dónde releerlo. Capturas `23-tras-cierre-toast` y `52-resultado-cierre-ciego`. | Mostrar la misma tarjeta "Resultado de tu cierre" (`CajaCierreResumen` + `CajaArqueoTable`) también cuando no es ciego, con "Listo". El toast queda solo como "Caja cerrada". | agente |
| 03.5 | P2 | medido | `components/caja/CajaCierreForzadoPanel.vue:187-190` | En una caja ajena abierta del tenant sin modo ciego, la pantalla muestra "Saldo esperado $20.000" y justo debajo dice "podés cerrarla vos **con el conteo a ciegas**". El texto afirma algo que la pantalla contradice. Medido sobre la caja real abierta de "Vendedor Paris" (`30-detalle-caja-cerrada-768`). | Hacer el texto depender del modo: sin ciego, "Si el cajero ya no está, puedes cerrar su caja tú contando el efectivo. Si nadie firma como testigo, tendrás que explicar qué pasó." Con ciego, agregar "sin ver el esperado". | agente |
| 03.6 | P2 | medido | `pages/cajas/[id].vue:71-86`, `components/caja/CajaCierreForzadoPanel.vue:176-201` | La acción principal del encargado en una caja abierta ajena, "Cerrar por el cajero", está **después** de las tarjetas de resumen y de la tabla de movimientos: a 768 queda a unos 900 px de alto, bajo el pliegue. El encargado que viene a cerrar una caja olvidada tiene que bajar para encontrarla. | Subir la tarjeta "Caja de otro cajero" justo debajo del encabezado, antes de los movimientos. | agente |
| 03.7 | P2 | medido | `components/caja/CajaTurnoHeader.vue:56-73`, `CajaCierreDrawer.vue:479-493`, `CajaPendientesRevision.vue:191-208`, `CajaCierreDetalle.vue:38-46`, `CajaMovimientosTable.vue:88-97` | En tablet los controles de la tarea principal miden menos de 44 px de alto: "Cerrar caja" 119×32, "+ Movimiento" 135×32, "Enviar conteo" 137×32, "Confirmar cierre" 154×32, "Cerrar por el cajero" 174×32, "Continuar conciliación" 148×28, "Marcar visto" 112×28, "Ver cierre" 97×28, el expansor de movimientos 24×24. Además "Cerrar caja" (rojo, irreversible en la práctica) está a 8 px de "+ Movimiento", lo que se usa todo el turno. Medido con `tocablesChicos` en `/mi-caja/c1`, la conciliación y la bandeja. | Subir los botones de la tarea (`size="xl"` más `class="min-h-11"`) y separar "Cerrar caja" de "+ Movimiento" (grupo aparte, o "Cerrar caja" al final de la tarjeta). El expansor del historial a `size="md"`. | agente |
| 03.8 | P2 | medido | `CajaMovimientosTable.vue:168`, `CajaCierreDrawer.vue:336,365,450`, `CajaTendencia.vue:97`, `CajaHistorial.vue:117`, `CajaPendientesRevision.vue:83`, `CajaTurnoResumen.vue:54`, `CajaArqueoTable.vue:137` | El verde de las cifras de plata (`text-green-600`) mide **3,22:1 sobre blanco** y 3,08:1 la etiqueta "Entradas" sobre `bg-green-50`; el rojo de la etiqueta "Salidas" sobre `bg-red-50` mide 4,36:1. Todos bajo 4,5:1 para texto de 12 a 14 px. El rojo sobre blanco (4,77:1) y el azul de "Saldo esperado" (4,82:1) pasan. Medido con `getComputedStyle` convertido a RGB (`caja-5-contraste.pw.ts`). La excepción de colores financieros no cubre un contraste medido que falla. | Mantener el verde pero bajarlo un paso: `text-green-700` (4,95:1 sobre blanco, 4,72:1 sobre `green-50`) y `text-red-700` en las etiquetas sobre fondo rojo. | agente |
| 03.9 | P2 | medido | `CajaMovimientoDrawer.vue:122-127` (Registrar entrada, `color` success), `CajaCierreDrawer.vue:483-492` y `CajaCierreForzadoPanel.vue:285-293` (error y warning sólidos), `CajaCierreDetalle.vue:38-46` | Los botones sólidos con texto blanco no llegan a 4,5:1: **success 2,22:1** ("Registrar entrada"), **error 3,81:1** ("Enviar conteo", "Confirmar cierre"), **warning 1,91:1** ("Continuar conciliación"). "Cerrar caja", en variante suave, queda en 3,30:1 (calculado a partir del color medido). El primario petróleo mide 9,47:1. Captura `21-conciliacion-1280`. | En el cierre, usar `color="primary"` (petróleo) para "Enviar conteo", "Confirmar cierre" y "Continuar conciliación": el rojo ya lo lleva "Cerrar caja" que abre el flujo. "Registrar entrada/salida" en primario también, y el verde/rojo se queda en el selector de tipo. Si el owner prefiere conservar el color de estado en los botones, es una decisión de tema (transversal), no de este grupo. | agente (owner si se quiere cambiar el tema) |
| 03.10 | P2 | medido | `CajaArqueoTable.vue:154,170`, `CajaAperturaGrid.vue:81`, `CajaAperturaForm.vue:87`, `CajaCierreDrawer.vue:420,465`, `CajaCierreForzadoPanel.vue:222`, `CajaPendientesRevision.vue:111`, `CajaCierreDetalle.vue:32` | El texto ámbar (`text-warning`) mide **1,91:1 sobre blanco**: "Sin justificar", "No hay cajas disponibles…", "Nivel aviso", los avisos de conciliación; el cartel "En conciliación — falta finalizar el cierre" sobre su fondo ámbar suave queda en unos 1,8:1 (calculado). Se lee mal justo en lo que le pide acción a la cajera. Capturas `21-conciliacion-1280`, `24-despues-del-toast-1280`. | Texto de aviso en un tono oscuro (`amber-700`) o en `text-default` con el ícono ámbar; la alerta suave con texto `text-default`. | agente |
| 03.11 | P2 | medido | `CajaAperturaGrid.vue:87-91` y `CajaCajonesGrid.vue:46-53` | Las tarjetas de cajón son un `div` con `@click` y `cursor-pointer`, **sin `tabindex` ni rol** (medido en `/cajas`: tres `DIV` sin tabindex): no se llegan con Tab ni las anuncia un lector. La cajera no puede abrir su caja con teclado externo, y el encargado no puede entrar a una caja. | Envolver la tarjeta en un enlace (`NuxtLink`/`ULink`) o un `button` con foco visible; el cajón de apertura como botón que abre el drawer. | agente |
| 03.12 | P2 | medido | `components/caja/CajaTendencia.vue:131-132` | Los dos campos de fecha de la tendencia **no tienen etiqueta**: se leen "16 - 09 - 2026" y "16 - 10 - 2026" sin "Desde" ni "Hasta", y los dos botones del calendario tienen el mismo nombre accesible, "Seleccionar fecha". Captura `04-tendencia-768`. | `UFormField` con "Desde" y "Hasta" encima de cada campo. | agente |
| 03.13 | P2 | medido (sim.) | `CajaAperturaGrid.vue:49-52`, `CajaMovimientoDrawer.vue:31-39`, `CajaCierreDrawer.vue:173-176,260-267`, `CajaArqueoTable.vue:73-75` | Los datos que faltan se avisan con un **toast** ("Ingresa el saldo inicial", "Ingresa el concepto del movimiento"), no junto al campo, y el toast cae sobre el título del drawer. Capturas `12-apertura-vacio-toast` y `16-movimiento-vacio`. Además "Saldo inicial" y "Concepto" llevan asterisco, pero el campo no se marca en error. | `UFormField :error="…"` bajo el campo vacío y el foco en él; el toast solo para errores del servidor. | agente |
| 03.14 | P2 | medido (sim.) | `components/caja/CajaCierreDrawer.vue:489` | "Enviar conteo" y "Confirmar cierre" quedan **deshabilitados sin decir qué falta** (medido: `isDisabled` verdadero con el efectivo vacío y con el motivo sin elegir). La cajera ve un botón apagado y ninguna indicación; solo si lo toca por otro camino aparece el toast. Capturas `19-cierre-conteo`, `21b-conciliacion-drawer`. | Una línea bajo los botones con el motivo: "Falta el efectivo contado" / "Falta el motivo de la diferencia en Efectivo". | agente |
| 03.15 | P2 | medido | `CajaTurnoHeader.vue:39-41`, `CajaHistorial.vue:94-102` | El estado se muestra **crudo**: el encabezado dice `EN_CONCILIACION` (con guion bajo y mayúsculas) y el historial `cerrada` / `abierta` en minúscula y a **10 px** (medido). Es jerga de base de datos en pantalla. Capturas `21-conciliacion-1280`, `05-historial-1280`. | Un mapa de etiquetas: "Abierta", "En conciliación", "Cerrada"; badge a `size="sm"` (12 px). | agente |
| 03.16 | P2 | medido | `components/caja/CajaHistorial.vue:38-46,61-66`, `stores/caja.ts:33` | El historial del supervisor **no tiene columna de cajero** (el listado no trae `usuarioNombre`, solo el detalle) y **no dice por quién está filtrado**: desde la tendencia, tocar la fila de un cajero abre `/cajas/historial?usuarioId=…` con el mismo título "Historial de cajas (2)" que sin filtro. Tampoco hay filtros de fecha ni de estado en la pantalla. Capturas `05-historial-1280`, `53-historial-filtrado-por-cajero`. | Columna "Cajero" y, cuando hay `usuarioId` o `cajonId`, un chip "Cajero: Rosa Pérez · Quitar filtro". Requiere que el listado devuelva el nombre (pequeño cambio de backend, fuera de este documento). | agente |
| 03.17 | P2 | medido | `pages/cajas/index.vue:22-28` | El botón "Pendientes de revisar" **no dice cuántos hay**: el encargado entra a la bandeja solo para enterarse de que está vacía. El número ya existe en `resumen-descuadres-dia` (`nivelAlto`) y en `pendientes-revision`. | Contador en el botón (badge con la cantidad de la bandeja); sin número cuando es cero. | agente |
| 03.18 | P2 | código | `pages/cajas/[id].vue:71-100`, `CajaPendientesRevision.vue:189-210` | Revisar un descuadre es un ida y vuelta: la bandeja manda a "Ver cierre" (`/cajas/:id`), y esa pantalla **no muestra lo que explica el descuadre**: ni "Qué dijo el cajero" (`explicacionDescuadre`), ni el nivel, ni "Marcar visto"; para marcar hay que volver a la bandeja. `grep -rn "explicacionDescuadre\|nivelDescuadre\|marcarRevisado" pages components` no encuentra ningún uso fuera de la bandeja y del drawer de cierre. | En el detalle de una caja cerrada o en conciliación con diferencia: una tarjeta "Revisión" con la explicación del cajero, el motivo por línea y "Marcar visto" (con `Cajas:Actualizar`). | agente |
| 03.19 | P3 | medido | 14 líneas (comando abajo) | Voseo en 8 archivos de este grupo: `CajaCierreDrawer.vue:263,385,388,403,404,466` ("explicá", "Justificá", "pedile", "Podés", "Si querés, dejá", "contá", "describí"), `CajaAperturaGrid.vue:82,99` ("Pedí", "Hacé click"), `CajaAperturaForm.vue:88`, `CajaCierreForzadoPanel.vue:188` ("podés cerrarla vos"), `CajaPendientesRevision.vue:214` y `CajaTendencia.vue:158` ("Volvé a intentar"), `pages/cajas/[id].vue:36` y `pages/mi-caja/[id].vue:43` ("No tenés acceso…"). | "Toca para abrir tu caja", "Pide al administrador que te habilite una", "Justifica cada diferencia para confirmar el cierre", "Puedes cerrar igual. Si quieres, deja una nota de lo que pasó", "Vuelve a intentarlo: esto no significa que no haya descuadres", "No tienes acceso a esta caja o no existe". En tablet "Haz clic" no es el verbo: "Toca". | agente |
| 03.20 | P3 | medido | `pages/cajas/index.vue:19`, `pages/mi-caja/[id].vue:64`, `CajaCierreResumen.vue:44`, `CajaPendientesRevision.vue:71,110,114` | Palabras de sistema en pantalla: "Cajones del **tenant**"; la misma cosa se llama "Caja" (encabezado, historial), "Cajón" (resumen del cierre, bandeja) y "caja" (botones); a la cajera, al entrar a "Mi caja", la pantalla de su turno le dice "Detalle de caja"; "Nivel aviso" y "Nivel alto" no son palabras del local. | "Cajas del local y su estado"; unificar en "Caja" para el mueble y "turno" para la sesión (ya lo usa "Movimientos del turno"); título "Mi caja" en `/mi-caja/[id]` cuando es la propia; "Aviso" / "Alto" como "Diferencia grande" / "Diferencia muy grande". | agente |
| 03.21 | P3 | medido | 11 `font-mono` en `components/caja/`, 0 `tabular-nums` | Las cifras de plata de las tablas usan `font-mono`, que cae en la pila del sistema (`ui-monospace, Menlo…`; medido), así que "$46.500" (DM Sans) y "- $3.500" (Menlo en negrita) se ven de dos familias en la misma pantalla (`18-turno-con-movimiento-768`). Ningún monto del grupo tiene `tabular-nums`: las columnas no alinean los dígitos en DM Sans. | Quitar `font-mono` y poner `tabular-nums` en las columnas de plata y en las cifras grandes. | agente |
| 03.22 | P3 | medido (sim.) | `components/caja/CajaTurnoResumen.vue:44-79` | Cuando no hubo movimientos el resumen pinta "+ $0" en verde y "- $0" en rojo: dos de las cuatro tarjetas gritan por nada, y el cero de la columna "Diferencia" del historial sale "+$0" en verde. Captura `14-turno-abierto-1280`. | Cero en gris y sin signo. | agente |
| 03.23 | P3 | medido | `CajaCierreForzadoPanel.vue:184-185` | La frase termina con la fecha y un punto: "abierta desde 16-10-2026, 12:36 a. m.**.**" (doble punto, medido en la caja real). | Sacar el punto final de la plantilla o escribir "Abierta desde …" sin cerrar la frase. | agente |
| 03.24 | P3 | medido (sim.) | `CajaAperturaGrid.vue:104` (`width="40%"`) | El drawer de apertura mide 40 % del ancho: a 768 son unos 300 px y el campo "Comentario" corta su texto ("Observaciones del turno (opcion…"). Los demás drawers del grupo usan `md`. Captura `13-apertura-lleno-768`. | `width="md"`, como el de movimiento y el de cierre. | agente |
| 03.25 | P3 | código | `CajaMovimientoDrawer.vue:70-92` | El selector Entrada/Salida son dos botones sueltos; el elegido no se anuncia (`aria-pressed` ausente) y solo lo distingue el relleno. | `URadioGroup` horizontal o `aria-pressed` en cada botón. | agente |
| 03.26 | P3 | medido (sim.) | `CajaPendientesRevision.vue:53-66,199-208` | "Marcar visto" actúa al primer toque, saca la fila y no hay forma de deshacerlo; registra quién y cuándo. Una fila bajo el dedo (28 px, 03.7) se marca por accidente. Captura `44-pendientes-tras-marcar-1280`. | Toast con "Deshacer" unos segundos, o confirmar solo si la fila no se abrió con "Ver cierre". | agente |
| 03.27 | P3 | medido | `middleware/permiso.ts:44` | Cruza a otro grupo. Un usuario sin `MiCaja` que entra a `/mi-caja` (o a `/caja`, que redirige ahí) termina en `/ventas` con tres avisos seguidos: "No **tenés** acceso al módulo Mi caja" y dos "No **tienes** permiso para esta acción" (los dos últimos aparecen al caer en Ventas, pantalla a la que el encargado tampoco accede de verdad). Mezcla voseo y tuteo en la misma pantalla. Captura `01-mi-caja-encargado-1280`. | Redirigir al inicio y no a una pantalla que tampoco puede ver; un solo aviso. | agente |
| 03.28 | P3 | código | `CajaAperturaGrid.vue:51-53`, `CajaMovimientoDrawer.vue:95-102` | Dos reglas de negocio que la cajera repite cada turno: el saldo inicial arranca vacío y el concepto del movimiento es texto libre. El local suele dejar un fondo fijo y mover las mismas cosas ("Compra de insumos", "Retiro de efectivo"). | Idea para el owner: fondo sugerido por caja y atajos de concepto. No se diseña. | owner |
| 03.29 | P3 | código | `CajaMovimientosTable.vue:124-129` | Cada vez que se pagina, se filtra o llega un movimiento, la tabla se reemplaza por "Cargando movimientos…" (`v-if="loading"`) y vuelve a pintarse: parpadeo y se pierde el punto de lectura. | Mantener la tabla con `:loading` de `UTable` y atenuarla. | agente |

**Comando del conteo de 03.19** (en `frontend/app/`): `grep -rEn --include='*.vue' '\b(Hacé|Pedí|Pedile|pedile|Volvé|Justificá|justificá|explicá|describí|Podés|podés|querés|dejá|tenés|Tenés|contá)\b' pages/caja pages/mi-caja pages/cajas components/caja | grep -vE ':[0-9]+:\s*(\*|<!--|//)' | wc -l` da 14. El conteo de `font-mono` (11) sale de `grep -rn --include='*.vue' 'font-mono' components/caja | wc -l`, y el de `tabular-nums` (0) de `grep -rn 'tabular' components/caja pages/cajas pages/mi-caja | wc -l`.

## 5. Lo que está bien

- **Nada se envía dos veces:** "Abrir caja", "Registrar", "Enviar conteo", "Confirmar cierre", "Pedir firma" y "Marcar visto" quedan en `:loading` mientras el POST está en vuelo.
- **El esperado lo calcula el servidor** y el modo ciego no filtra el dato: la cajera en ciego solo ve "Saldo inicial", el drawer de cierre no trae "Esperado" y la tabla de movimientos no se monta (medido, `50-turno-ciego`, `51-cierre-ciego-conteo`, sim.).
- **La diferencia se ve mientras se teclea:** en modo normal "−$1.500" aparece en rojo, con signo, al escribir 45.000 contra un esperado de 46.500 (medido, sim.).
- **Un movimiento nuevo se refleja al instante:** la salida de $3.500 baja el esperado de $50.000 a $46.500 y aparece primera en la tabla (`18-turno-con-movimiento`).
- **El motivo de la diferencia es categorizado**, con comentario obligatorio solo cuando el motivo lo pide, y existe una salida si no hay motivos configurados.
- **La bandeja y la tendencia distinguen "no pude cargar" de "no hay nada"** (`fallo` aparte del vacío): en una pantalla de control es lo correcto.
- **La bandeja marca los cierres forzados y sin finalizar** con badge, y separa la peor diferencia del efectivo.
- **El historial es enfocable:** las filas son `tr tabindex=0 role=button` y se llega a ellas con 7 Tab (medido).
- **Sin botones sin nombre** en las seis pantallas medidas, sin scroll horizontal de la página a 1280 ni a 768.
- **El primario petróleo** en "Abrir caja" y "Marcar visto" mide 9,47:1.
- **El faltante lleva signo y color:** no depende solo del color.

## 6. Orden sugerido

1. **03.3 solo, como frente propio:** toca el cierre de caja (la plata que se congela), igual que el resto del drawer de cierre, y conviene hacerlo con el sistema quieto y con su revisión independiente.
2. **Lote "tablas de supervisión a 768"**: 03.1, 03.2, 03.16, 03.17. Es el mismo problema (la tabla no cabe y lo importante queda fuera de la vista) y toca `CajaHistorial`, `CajaPendientesRevision` y `cajas/index.vue`. 03.2 y 03.16 se deciden juntos (orden de columnas).
3. **Lote "cierre de la cajera"** en `CajaCierreDrawer`/`CajaCierreDetalle`: 03.4, 03.13, 03.14, 03.15, 03.9 (los botones del cierre). 03.4 reutiliza la tarjeta de resultado que ya existe.
4. **Lote "cierre forzado del encargado"**: 03.5, 03.6, 03.18, 03.26, que viven en `cajas/[id].vue` y `CajaCierreForzadoPanel`.
5. **Lote de accesibilidad y contraste:** 03.7, 03.8, 03.10, 03.11, 03.12, 03.25. 03.8 y 03.10 son un reemplazo de clases; 03.9 es de tema si el owner quiere conservar los botones de color de estado.
6. **Lote mecánico de textos y estilo:** 03.19, 03.20, 03.21, 03.22, 03.23, 03.24, 03.27, 03.29. 03.19 puede ir junto al lote 00.3 del documento transversal.
7. **03.28** queda como pregunta al owner.

## Qué no se pudo medir

- La cajera con su rol real: el encargado no tiene `MiCaja` y la cajera real la usa otro auditor. Todo lo marcado `(sim.)` depende de respuestas simuladas, no del backend: no valida reglas de saldo, umbrales ni mensajes reales de error.
- El cierre forzado de punta a punta: se abrió el drawer de conteo (`42-cierre-forzado-conteo`) pero no se envió, para no alterar la caja real abierta por otro auditor. La firma del garzón vive en `/salones`, de otro grupo.
- El modo ciego con el backend real (depende de `tenants.arqueo_ciego`, configuración global que no se toca).
- Foco visible, lector de pantalla y navegación completa con teclado: solo se midió que las filas del historial se alcanzan con Tab y que las tarjetas de cajón no.
- Modo oscuro (fuera de alcance de esta pasada) y móvil (fuera de alcance del producto).

Archivos del arnés que dejé: `frontend/e2e-auditoria/caja-mock.ts`, `caja-1-encargado.pw.ts`, `caja-2-cajera-sim.pw.ts`, `caja-3-encargado-real.pw.ts`, `caja-4-encargado-sim.pw.ts`, `caja-5-contraste.pw.ts`, `caja-6-ciego-y-filtro.pw.ts`, `caja-7-tamanos.pw.ts`, la carpeta `frontend/e2e-auditoria/datos-caja/` (resultados en JSON; `resultados/` la borra cada corrida de Playwright, por eso no se usó) y `frontend/e2e-auditoria/capturas/caja/`.
