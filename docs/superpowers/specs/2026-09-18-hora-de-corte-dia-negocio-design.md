# El día del negocio termina en una hora de corte

**Fecha:** 2026-09-18 · **Tipo:** spec de diseño
**Frente:** entrada *El día del negocio termina en una hora de corte* (`docs/agent/pendientes.md` § 3).
**Insumo:** [`investigaciones/2026-09-18-hora-de-corte-dia-negocio.md`](../../agent/investigaciones/2026-09-18-hora-de-corte-dia-negocio.md).
**Decisiones del owner:** las del brainstorm del 2026-09-18, en § 2.

---

## 1. El problema

Un bar abre el sábado a las 19:00 y cierra el domingo a las 03:00. Hoy "el día" es el calendario
local del tenant y corta a medianoche, así que la cuenta que se cobra a la 01:30 cae en el
domingo: el sábado sale partido en dos y el domingo tiene ventas de un local que ese día no
abrió.

La solución es la misma que usa el mercado (Toast, Clover, Aloha): cada tenant configura la hora
a la que **termina su día**. Con corte a las 05:00, el sábado va del sábado a las 05:00 al
domingo a las 05:00.

## 2. Las decisiones que lo sostienen

| Decisión (owner, 2026-09-18) | Por qué importa |
|---|---|
| **El día se calcula al consultar, con el corte vigente. Cambiar el corte recalcula el pasado** | Revierte la decisión anterior del mismo día ("congelar"). Congelar obligaba a grabar el día del negocio en cada tabla que un reporte lee: ventas, pagos, cajas, movimientos de inventario, órdenes de pasarela, anulaciones, sesiones de garzón y propinas. Recalcular es enseñarle el corte a los helpers que ya resuelven el día. El costo, aceptado: el sábado que se vio en $450.000 puede mostrar otro total después de mover el corte, sin que nadie toque una venta. En el mercado el corte se cambia muy rara vez (en Toast hay que pedírselo a soporte) |
| **Una sola hora para toda la semana** | Como Toast, Clover y Aloha. Entre el cierre y el corte casi no hay ventas, así que una hora por día resolvía un caso que casi no aparece |
| **El corte se elige entre 00:00 y 06:00** | Cubre bares y discos. Impide que un error de tipeo (17:00) pase las ventas de la tarde al día anterior |
| **Horas enteras** | Un selector sin nada que tipear. La media hora no cambia ningún número, porque en esa franja el local ya cerró |
| **Por defecto 00:00, igual que hoy** | Nada cambia para quien no lo configura. Una tienda 24 horas o una venta online de las 02:00 no se mueven de día sin que el dueño lo pida |
| **Los reportes con filtro de fecha muestran una nota si el corte no es 00:00** | Quien filtra el sábado ve una venta de "dom 21, 01:30", que es la hora real y la de la boleta. La nota ("Tu día va de 05:00 a 05:00") se lo explica también al encargado o al contador que no configuró el corte |

**Lo que no depende de ninguna decisión:** la boleta electrónica lleva siempre la fecha
calendario real (`FchEmis`). El SII no tiene concepto de día de negocio (investigación § 6.2). El
día de negocio es solo una vista de reporte.

## 3. Alcance

### 3.1 Qué cambia

Todo lector que resuelve "a qué día pertenece algo" cambia a la vez. La entrada del backlog lo
pedía entero: si una pantalla cortara a las 05:00 y el reporte al que enlaza a medianoche, el
mismo sábado daría dos números al hacer clic.

**Backend: filtros de rango por fecha** (fecha pura del cliente, que el servidor expande):

| Lector | Endpoint | Columna |
|---|---|---|
| `pagos.service.ts` → `listar` | `GET /pagos` | `p.fecha` |
| `caja.service.ts` → tendencia de descuadres | `GET /caja/tendencia` | `COLUMNA_VENTANA` |
| `inventario.service.ts` → movimientos | `GET` de movimientos (`find-movimientos.dto.ts`) | `mv.creado_el` |
| `mermas.service.ts` → listado y resumen | `find-mermas.dto.ts` | `mv.creado_el` |
| `pasarela/services/cobros.service.ts` → órdenes | `query-ordenes.dto.ts` | `o.creado_el` |
| `salones/anulaciones-reporte.service.ts` → listado y resumen | `find-anulaciones.dto.ts`, `resumen-anulaciones.dto.ts` | `cla.creado_el` |
| `turnos/sesiones-garzon.service.ts` → historial | `query-sesiones.dto.ts` | `s.inicio_el` (SQL propio, no usa los helpers) |
| `propinas/propina-reportes.service.ts` → reportes y liquidaciones del período | `query-propina-reporte.dto.ts` | `creado_el`, `l.fecha_desde`, `l.fecha_hasta` (SQL propio) |

**Backend: "hoy", calculado en el servidor:**

| Lector | Qué es "hoy" |
|---|---|
| `resumen-negocio.service.ts` → `hoy` | El día del dashboard y el mismo día de la semana pasada. Arrastra a anulaciones y mermas, que el service llama con esa fecha |
| `pagos.service.ts` → `resumen` | La tarjeta "Hoy" de pagos |
| `caja.service.ts` → resumen de descuadres del día | `GET /caja/resumen-descuadres-dia`, por `COALESCE(fecha_cierre, fecha_apertura)` |

**Backend: agrupar por día.** La serie diaria de `propina-reportes.service.ts` (`GROUP BY
(creado_el AT TIME ZONE zona)::date`) pasa a agrupar por el día de negocio.

**Backend: liquidación de propinas.** Hoy el navegador arma el período con su propia medianoche
(`inicioDiaIso`/`finDiaExclusivoIso` en `pages/propinas/index.vue`) y el backend lo recibe como
instante (`rango-liquidacion.ts`). Así el período no conoce el corte, y tampoco la zona del
tenant si el navegador está en otra. Pasa a mandar fechas puras y el servidor las expande con
zona y corte, igual que los filtros. Se sigue aceptando un timestamp completo, que se respeta tal
cual. Las liquidaciones ya hechas no se tocan: guardan sus bordes, y son plata pagada. Liquidar
dos veces una propina ya está impedido por propina ("ya fueron liquidadas por otra corrida"), así
que un período desplazado por un cambio de corte no paga doble.

**Frontend:**

- **Configuración → Empresa** (`pages/configuracion/empresa.vue`): selector 00:00 … 06:00 junto a
  la provincia, porque las dos definen "cuándo es hoy". Texto de ayuda: *"Una venta a la 01:30 con
  corte a las 05:00 cuenta en el día anterior. Si lo cambias, los reportes pasados se recalculan
  con el corte nuevo."*
- **Nota junto al filtro de fecha**, visible solo si el corte no es 00:00, en las pantallas que
  filtran por fecha: `sesiones-garzon.vue`, `mermas.vue`, `ordenes.vue`, `propinas/index.vue`,
  `salones/anulaciones.vue` y `components/caja/CajaTendencia.vue`.
- **Anulaciones arranca en el hoy del negocio**, no en el `hoyLocal()` del navegador.
- **Propinas** manda fechas puras al liquidar y previsualizar.

### 3.2 Qué queda fuera

- **El motor de precios y las promociones.** La vigencia de una regla por horario (un happy hour
  de sábado 23:00 a 02:00) y por fecha ("válida hasta el 30") es hora de reloj y calendario, no
  día de negocio. `calculo-precios.service.ts`, `promociones.*` y `useVigenciaRegla.ts` no se
  tocan. Además tocar el motor es frente propio.
- **La boleta** (§ 2).
- **Cierre automático de cajas o turnos al llegar el corte** (Toast, Aloha). El corte cambia cómo
  se *lee* el día, no cuándo se *fuerza* un cierre.
- **`GET /pagos` y los movimientos de inventario no tienen filtro de fecha en pantalla.** Cambian
  en la API, y no llevan nota porque no hay filtro donde ponerla.

## 4. El dato

- **`tenants.hora_corte`**: `smallint NOT NULL DEFAULT 0`, con `CHECK (hora_corte BETWEEN 0 AND
  6)`. Es la hora local a la que termina el día; 0 es medianoche, igual que hoy. Columna en la
  entity `Tenant` (el esquema sale de las entities, no del `.sql`); `startup-pos.sql` se actualiza
  como documentación.
- **API:** `GET /tenants/me` devuelve `horaCorte` y `diaNegocioHoy` (`YYYY-MM-DD`, calculado en el
  servidor). `PATCH /tenants/me` acepta `horaCorte`, con `@IsInt() @Min(0) @Max(6)`: 7, -1 o 2,5
  dan 400. El PATCH ya es admin-only (`TenantAdminGuard`) y el tenant sale del token.
- **Seed:** los tenants del seed quedan en 0. El e2e configura su propio corte y lo restaura.

## 5. Cómo se calcula

Todo vive en `backend/src/common/utils/rango-fecha.util.ts`, que ya es el lugar único del día.

- **Una sola consulta trae la zona y el corte.** `diaNegocioTenant(db, tenantId) → { zona,
  horaCorte }` hace la consulta que hoy hace `zonaHorariaTenant`, más la columna nueva.
  `zonaHorariaTenant` pasa a devolver `(await diaNegocioTenant(...)).zona`, para que no haya dos
  copias de la consulta (el docblock de `zonaHorariaTenant` cuenta por qué eso ya costó un bug).
- **Fecha a rango, en SQL.** `bordeFechaSql` y `bordeHastaSql` reciben la posición del parámetro
  del corte además de la de la zona:
  `(($v::date::timestamp + make_interval(hours => $c)) AT TIME ZONE $z)`. `hasta` sigue inclusivo
  del día (`$v::date + 1`). Un timestamp completo se sigue respetando tal cual, sin zona ni corte.
  `requiereZonaTenant` sigue siendo la guarda que decide si se empujan zona y corte: los dos o
  ninguno, porque pasar un parámetro que la consulta no usa tira un 500 (docblock de
  `requiereZonaTenant`).
- **Instante a día, en SQL:** `((instante AT TIME ZONE $z) - make_interval(hours => $c))::date`.
  Sirve para "hoy" (`NOW()`) y para el `GROUP BY` de la serie de propinas. El util lo expone como
  fragmento, así los services dejan de escribir `AT TIME ZONE` a mano.
- **Instante a día, en TypeScript:** `diaNegocioEnZona(zona, horaCorte, instante)` colapsa con
  `instanteLocalEnZona` y, si la hora local es anterior al corte, resta un día a la fecha.
- ⚠️ **El orden importa: primero a hora local, después restar el corte.** Restar horas al instante
  UTC y después colapsar falla la noche del cambio de horario: el domingo 6 de septiembre de 2026 a
  las 05:30 (corte 05:00), el instante menos 5 horas cae el sábado a las 23:30, y es domingo. La
  resta sobre el `timestamp` sin zona de Postgres y la comparación de hora en TypeScript son
  aritmética de reloj de pared, que es la correcta.
- **Cambio de horario.** Chile salta de 00:00 a 01:00 la noche del sábado 5 de septiembre de 2026 y
  repite la hora 23:00–23:59 del sábado en abril. Con cortes entre 00:00 y 06:00 nunca se cae en
  la hora repetida. La hora que no existe solo afecta al corte 00:00, que queda igual que hoy
  (medido en la sesión de pagos del 2026-09-18). El día de negocio del sábado 5 de septiembre dura
  23 horas, y eso es correcto.

## 6. Pruebas

- **Unitarios** del util:
  - bordes con corte 0 y 5;
  - `diaNegocioEnZona` a las 04:59 y a las 05:00;
  - la noche del 2026-09-06 (el caso del § 5);
  - un timestamp completo que no se expande.
- **e2e** con un tenant en corte 05:00 y una venta cobrada el domingo a la 01:30 hora local. Se
  verifica que cuenta en el sábado en:
  - el dashboard. `/resumen-negocio/hoy` usa `NOW()`, así que no se le puede fijar el sábado. Se
    mueve la venta 30 minutos antes y 30 minutos después del borde donde empezó el día de negocio
    de hoy (las 05:00 locales de hoy o de ayer, según la hora a la que corra la suite): la de
    después cuenta, la de antes no. Es el molde de `pagos-dia-local.e2e-spec.ts` con la
    medianoche local;
  - `GET /pagos` por fecha;
  - la serie diaria de propinas;
  - la liquidación con fechas puras.

  Un control con corte 0 debe dar el domingo. `afterAll` devuelve el tenant a 0.
- **Protección contra olvidos:** un test que falla si un archivo de `backend/src/modules` escribe
  `AT TIME ZONE $` fuera del util. Hoy lo hacen `sesiones-garzon`, `propina-reportes`, `pagos` y
  `caja`, y todos pasan al util en este frente. Así, un reporte nuevo no puede nacer cortando a
  medianoche sin que nadie lo note. El motor de precios no escribe ese SQL (usa `Intl`), así que no
  necesita excepción.
- **Mutante:** poner el corte en 0 dentro del util debe romper el e2e.

## 7. Documentación en el mismo commit

- `docs/PRODUCTO.md`: la regla del día de negocio y que el corte recalcula.
- `docs/ESTADO.md`: fila de la hora de corte.
- `docs/features/pagos.md`: "Hoy" pasa a ser el día del negocio.
- `docs/patterns/backend.md`: los helpers reciben zona y corte, y ningún service arma un día a
  mano.
- `docs/agent/pendientes.md`: la entrada se muda a `resueltos.md`.
- La investigación queda como está: es una foto.
