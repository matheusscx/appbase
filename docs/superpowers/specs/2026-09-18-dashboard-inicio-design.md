# El dashboard de inicio: el turno en vivo y el día del dueño

**Fecha:** 2026-09-18 · **Tipo:** spec de diseño
**Frente:** feature nueva. Hoy `/` (`frontend/app/pages/index.vue`) es solo un saludo.
**Decisiones del owner:** las del brainstorm del 2026-09-18, en § 2.

---

## 1. El problema

El inicio no dice nada del negocio. Dos personas lo abren con preguntas distintas:

- **El encargado de turno**, con el local lleno, quiere saber qué está pasando **ahora**: cuántas
  mesas tiene ocupadas, qué cajas están abiertas y quién las tiene, si algún cierre descuadró.
- **El dueño**, al final del día, quiere saber **cómo le fue hoy**: cuánto vendió y cobró, cuánto
  le deben, cuánto perdió y qué se vendió.

Un dashboard es para **mirar de un vistazo**, no para analizar: pocos números del día, sin
filtros, y cada número lleva al reporte que tiene el detalle. Los reportes siguen viviendo en su
propio módulo (el de anulaciones pide `Salones: Ver todas`, el de propinas `Propinas: Leer`).

## 2. Las decisiones que lo sostienen

| Decisión (owner, 2026-09-18) | Por qué importa |
|---|---|
| **Cada bloque aparece según los permisos de quien entra** | El encargado no ve la plata del día; el dueño que también es encargado ve las dos zonas en una sola pantalla |
| **Los bloques del dueño van con un permiso nuevo**, `Resumen del negocio: Leer`, no con `Ventas: Leer` | La cajera tiene `Ventas: Leer` para buscar una boleta y reimprimirla. Con ese permiso vería también cuánto factura el local, y no habría forma de darle una cosa sin la otra |
| **"Resumen del negocio" es un módulo propio, contratado junto con Ventas** | Todo permiso cuelga de un módulo contratado (`tenant_modulos`). No se llama "Reportes": un dashboard no es un reporte, y los reportes ya viven en su módulo |
| **"Hoy" corta a medianoche por ahora.** La hora de corte configurable quedó decidida y va entera, más adelante *(cerrado 2026-09-19: `resumen-negocio.service.ts` ya calcula "hoy" con el corte del tenant — ver `docs/agent/resueltos.md`)* | Hay otras pantallas que ya cortan a medianoche. Si solo el dashboard usara otro corte, el mismo "sábado" daría dos números al hacer clic. Entrada: *El día del negocio termina en una hora de corte* (`pendientes.md` § 3) |
| **Solo hoy, comparado con el mismo día de la semana pasada** | Es el vistazo. La semana y el mes son trabajo de un reporte de ventas, que no existe |
| **Se muestran Vendido y Cobrado** | La diferencia entre los dos es lo que el dueño tiene que salir a cobrar |
| **La zona del turno se refresca sola**; la del dueño, no | Un tablero de turno que no se actualiza termina mostrando información vieja. Recalcular ventas y pérdidas cada minuto no aporta |
| **El bloque Salón muestra solo la ocupación, sin plata** | Una cuenta abierta no tiene total guardado: guarda el precio de carta, y descuentos, recargos e impuestos se calculan al cobrar con el motor. Sumar precio de carta infla sin avisar, y correr el motor por cuenta cada minuto es tocar el motor |
| **Sin biblioteca de gráficos** | Ningún bloque la necesita. Ver § 8 |

## 3. Qué muestra

### 3.1 Zona "Ahora" (el turno)

| Bloque | Qué muestra | Permiso | Fuente |
|---|---|---|---|
| Salón | Mesas ocupadas de un total, y cuentas abiertas | `Salones: Ver todas` | `GET /salones/ocupacion` (**nueva**) |
| Cajas | Cajas abiertas ahora y quién tiene cada una. **Sin montos**: el modo ciego ya decide quién ve el esperado, y el dashboard no lo repite | `Cajas: Leer` | `GET /caja/cajones-estado` (existe) |
| Cierres del día | Cierres, cuántos descuadraron y la suma con signo del efectivo | `Cajas: Leer` | `GET /caja/resumen-descuadres-dia` (existe) |

### 3.2 Zona "Hoy" (el dueño)

Todos con `Resumen del negocio: Leer`, en una sola llamada: `GET /resumen-negocio/hoy`.

| Bloque | Qué muestra |
|---|---|
| Ventas | Vendido, cobrado, cantidad de ventas, ticket promedio, y vendido en el local y online. Cada uno con el valor de hoy, el del mismo día de la semana pasada y la variación |
| Por cobrar | Ventas `pendiente` o `pagada_parcial`, **de cualquier fecha**, cuántas y cuánto falta. Es lo que se debe ahora, no lo que se vendió hoy |
| Pérdidas | Anulaciones de hoy por tipo (merma, cortesía, no elaborado) y mermas de hoy valorizadas (§ 4.4) |
| Lo más vendido | Los 5 ítems con más plata en sus líneas de venta de hoy |

## 4. La plata

### 4.1 Qué es "vendido" y qué es "cobrado"

- **Vendido:** `Σ ventas.total_final` de las ventas de hoy, **sin las canceladas y sin las notas
  de crédito**. Las notas de crédito se excluyen igual que en `GET /ventas/resumen`: por
  `tipo_documento_id`, con el mismo cuidado cuando el país no tiene ese tipo sembrado (el filtro se
  cae entero; un `IS DISTINCT FROM NULL` dejaría afuera casi todas las ventas). La pantalla lo
  rotula **"antes de notas de crédito"**.
- **Cobrado:** `Σ pago_aplicaciones.monto` (`tipo = 'venta'`) de los pagos registrados hoy, sean
  de ventas de hoy o de antes. Es la misma cuenta con la que `/ventas/resumen` saca el saldo, y
  deja el vuelto afuera. **El plan mide** cómo quedan registrados el pago de una nota de crédito y
  el de una venta cancelada, antes de decidir si hay que excluirlos.
- **Ticket promedio:** vendido / cantidad, como **proyección de lectura a `ESCALA_COSTO` (4)**,
  igual que el costo perdido de Mermas y el precio de carta de Anulaciones: nadie paga este
  número, así que no se cuantiza con la configuración del tenant (eso obligaría a importar
  `cuantizar` del motor), y el formateo a los decimales de la moneda lo hace la pantalla con
  `formatMonto`. Con cantidad 0, `null`.

⚠️ **Si el vendido resta las notas de crédito es una pregunta fiscal**, y no se decidió acá: lo
fiscal va en su propio frente (`CLAUDE.md`, ADR-010). Queda como entrada en `pendientes.md`.

### 4.2 Moneda y tipos

Montos como texto decimal. Ventas y pagos ya están en la moneda oficial del tenant, así que se
suman directo. Nada con `number`.

### 4.3 La variación

La calcula **el backend**, con Decimal, como número decimal (`0.13` = 13%). Si el valor de la
semana pasada es 0, la variación es `null` y la pantalla muestra "—". El frontend no hace cuentas
con porcentajes.

### 4.4 Las pérdidas no se suman entre sí

- **Anulaciones:** se reusa el resumen del reporte de anulaciones
  (`AnulacionesReporteService`, forma `porTipo` de su spec), con el rango de hoy. Muestra platos y
  precio de carta por tipo, y el costo **por moneda**, como lo devuelve ese reporte.
- **Mermas:** costo por moneda —la del ítem, como agrupa el reporte de anulaciones
  (`i.moneda_id`)— y, **aparte, cuántas quedaron sin valorizar**. Es la primera
  agregación de mermas del sistema, y le aplica la regla 6 de la spec del costo sin tipear
  (`pendientes.md` § 3): un `SUM` que ignora las filas con costo `null` informa menos pérdida que
  la real sin decirlo. La entrada **no se cierra** con esto: habla de un reporte de mermas, que
  sigue sin existir.
- **No hay "total de pérdidas".** Un plato quemado en la mesa es a la vez una anulación de tipo
  merma y una merma de cocina (así lo definió la spec del reporte de anulaciones). Sumar los dos
  bloques lo contaría dos veces. Además, los costos vienen en más de una moneda.

## 5. API

### 5.1 `GET /api/resumen-negocio/hoy` (nueva)

Módulo nuevo `backend/src/modules/resumen-negocio/`, registrado en `app.module.ts`.
`@RequiresPermiso('Resumen del negocio', 'Leer')`. La acción es la `Leer` que ya existe: el catálogo
de permisos no suma una acción "Ver" para decir lo mismo. Sin parámetros: `tenant_id` sale del token.

```
{
  fecha: 'YYYY-MM-DD',                 // el día local del tenant
  ventas: {
    vendido:        { hoy, semanaPasada, variacion | null },
    cobrado:        { hoy, semanaPasada, variacion | null },
    cantidad:       { hoy, semanaPasada, variacion | null },
    ticketPromedio: { hoy | null, semanaPasada | null, variacion | null },
    porCanal:       { fisico, online }  // vendido de hoy
  },
  porCobrar:  { cantidad, saldo },
  perdidas: {
    anulaciones: [{ tipo, platos, precioCarta, costo: [{ monedaId, monto }], sinValorizar }],
    mermas:      { cantidad, costo: [{ monedaId, monto }], sinValorizar }
  },
  masVendidos: [{ itemId, itemNombre, cantidad, monto }]   // hasta 5
}
```

"Hoy" y "el mismo día de la semana pasada" se resuelven con `rango-fecha.util.ts`
(`zonaHorariaTenant`): el día local, no el UTC.

### 5.2 `GET /api/salones/ocupacion` (nueva)

`@RequiresPermiso('Salones', 'Ver todas')`. Devuelve `{ mesasOcupadas, mesasTotal,
cuentasAbiertas }`. **El plan define** qué es una mesa ocupada (con al menos una cuenta abierta),
leyendo cómo lo resuelve hoy `listarSalonesOperacion`. Ruta estática: se declara antes de las
`:id/...` si el controller lo exige.

### 5.3 Consultas

Un número fijo de consultas por ruta, sin importar cuántas filas haya: una por bloque, con
`JOIN`/agregación, nunca una por fila. Toda consulta nueva filtra `eliminado_el IS NULL`. Si
alguna excepción deliberada aparece (como las del reporte de anulaciones), el porqué va escrito
en la consulta.

### 5.4 Seed

El seeder crea el módulo "Resumen del negocio" con el permiso "Leer" y lo contrata para el tenant
de demo junto con Ventas (IDs fijos, siguiente número libre). El rol admin lo recibe como
cualquier otro módulo. Igual que con `MiCaja` y `Cajas`, **el código no obliga a contratar los dos
juntos**: es una regla comercial, y se documenta en `PRODUCTO.md` al lado de esa.

## 6. Pantalla

- **`pages/index.vue` pasa a ser el dashboard.** El saludo queda arriba, más chico. Sin permiso
  para ningún bloque, se ve lo de hoy: solo el saludo.
- **Dos zonas**, "Ahora" y "Hoy". Cada bloque se muestra con `esAdmin || can(módulo, permiso)`,
  como el resto de la app. **Un bloque que no se muestra no hace su llamada.** Es solo experiencia
  de usuario: la seguridad la da el guard de cada ruta.
- **Un componente por bloque** en `components/inicio/`. La página solo los ordena y no tiene
  lógica de negocio.
- **Cada bloque lleva a su detalle:** Salón → `/salones`; Cajas y Cierres → la bandeja de
  `/cajas`; Ventas y Por cobrar → `/ventas`; Pérdidas → `/salones/anulaciones` y `/mermas`.
- **Refresco de "Ahora":** cada 60 segundos, solo con la pestaña visible, con "Actualizado HH:MM"
  a la vista. Si una llamada falla, queda el último dato con un aviso "Sin conexión", y se vuelve a
  pedir en el próximo ciclo, **no enseguida** (el owner no quiere reintentos automáticos). Composable
  nuevo `useRefrescoPeriodico` con `setInterval` y `visibilitychange`: no suma dependencias. Es el
  primer refresco periódico del sistema.
- **"Hoy"** carga una vez y tiene un botón "Actualizar".
- Montos con `useFormatters`, y en la vista solo tokens semánticos de Nuxt UI.

⚠️ **Medido al escribir el plan: el admin de un tenant que no contrató el módulo ve el bloque y
recibe 403.** El backend trata el módulo como borde duro también para el admin
(`rbac.service.ts`, rama del rol fijo), pero `/rbac/mis-permisos` le devuelve `[]` al admin y el
frontend lo deja pasar por `esAdmin`: no tiene cómo saber qué módulos contrató el tenant. Es la
misma conducta que hoy tienen los links del menú. Por eso **una zona o un bloque que recibe 403
se oculta**, sin aviso de error: un módulo que no se contrató no es una falla.

## 7. Fuera de alcance

- **La hora de corte.** Decidida, va entera y en su frente (`pendientes.md` § 3) — cerrado
  2026-09-19, ver `docs/agent/resueltos.md`.
- **Restar las notas de crédito del vendido.** Pregunta fiscal, frente propio.
- **Plata de las cuentas abiertas.** Necesita el motor (§ 2).
- **Stock bajo.** No existe el stock mínimo. Entrada *Aviso de stock bajo* (`pendientes.md` § 4).
- **Ventas por hora, por semana o por mes, y ventas y propinas por garzón.** Son de un reporte de
  ventas. Las propinas, además, se liquidan por ciclo: "propinas de hoy" no es un dato que exista.
- **Envío programado del resumen.** Ya es entrada propia (el envío diario del resumen de
  descuadres, `pendientes.md` § 3).

## 8. La biblioteca de gráficos, diferida

Ningún bloque la necesita y el frontend no tiene ninguna. Sumar una es una dependencia nueva, y
se elige el día que haya un gráfico que la justifique (el reporte de ventas). Las candidatas
anotadas:

- **Unovis** (`@unovis/vue`): dibuja en SVG y se colorea con variables CSS, así que respeta
  directo los tokens y el modo oscuro. Sería la de la plantilla oficial de dashboard de Nuxt UI:
  **confirmarlo al elegir**. Es la primera a evaluar.
- **Chart.js:** madura y liviana, pero dibuja en canvas, que no lee variables CSS. Los tokens y el
  cambio de tema habría que pasárselos a mano.
- **ECharts:** la más completa, pesada para lo que se necesita.

## 9. Cómo se prueba

**Unitario (service de `resumen-negocio`):** fixtures que discriminan, con montos distintos de 1,
y ventas y pagos con valores distintos entre sí. Cada regla con un mutante que **revierte al error
real** y un test que lo mata:

| Mutante | Qué rompe |
|---|---|
| Sacar el filtro de notas de crédito | Vendido las cuenta como venta |
| Contar las canceladas | Vendido sube con ventas que no existen |
| Sumar `pagos.monto` en vez de las aplicaciones | Cobrado cuenta el vuelto |
| Omitir las mermas sin costo en vez de contarlas | La pérdida baja sin avisar |
| Sacar `eliminado_el IS NULL` | Lo borrado vuelve a sumar |

La comparación con 7 días antes y la variación `null` con semana pasada en 0 se prueban acá: una
venta "de la semana pasada" no se puede crear por la API, porque el tiempo no se fabrica.

**e2e de API:**
- Sin `Resumen del negocio: Leer`, 403. Sin `Salones: Ver todas`, 403 en la ocupación. El admin
  recibe 200. Un tenant no ve datos de otro.
- Una venta hecha durante la corrida suma al total de hoy (delta antes/después: la suite corre
  con `maxWorkers: 1`). **El borde de la zona no se prueba acá**: la ruta no recibe fecha y el
  e2e no controla la hora del reloj, así que "una venta a las 22:00 de Chile" solo se puede
  armar en el unitario, afirmando que el día sale de `fechaLocalTenant` y el rango de
  `bordeFechaSql`/`bordeHastaSql` con la zona del tenant.
- Los escenarios se arman por el camino de la app (venta, pago, anulación, merma), con un garzón
  propio, no con el del seed.

**Frontend:**
- Un bloque sin permiso no hace su llamada.
- Variación `null` se muestra "—".
- `useRefrescoPeriodico` con timers simulados: se pausa con la pestaña oculta, ante un fallo
  conserva el dato y no reintenta hasta el próximo ciclo.
- Los bodies simulados tienen la forma que devuelve el backend real, no una inventada.

**Navegador:** prueba en Chrome con devtools, con la base reseteada antes de empezar.

**Gate completo** y `verify-feature`, con la revisión independiente.

## 10. Documentación que cambia

| Archivo | Qué |
|---|---|
| `docs/features/dashboard-inicio.md` (nuevo) + link en `docs/README.md` | La feature |
| `docs/ESTADO.md` | Fila nueva |
| `docs/PRODUCTO.md` | El módulo "Resumen del negocio" y que se contrata con Ventas |
| `docs/ARCHITECTURE.md` | El módulo `resumen-negocio` en el mapa |
| `docs/patterns/frontend.md` | `useRefrescoPeriodico`, el primer refresco periódico |
| `docs/agent/pendientes.md` | La pregunta fiscal: ¿el vendido del día resta las notas de crédito? |
