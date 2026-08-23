# El `valor` de descuentos y recargos se parte en dos columnas — diseño

**Fecha:** 2026-08-23 · **Estado:** Diseño aprobado, sin implementar · **Plan:** pendiente

## De dónde sale

De la entrada *"El `valor` de descuentos y recargos se parte en dos columnas"* de
[`pendientes.md`](../../agent/pendientes.md) § 3, medida el 2026-08-21 y **decidida por el
owner el 2026-08-22**: se elige la **opción (2)** —`valor_monto` / `valor_porcentaje`, cada
una con su marca—. El owner descartó el validador que lee al campo hermano **aun siendo el
más barato**, con este criterio: partir la columna es lo único que hace que el dato deje de
ser ambiguo también para **quien lo lee**, no solo para quien lo escribe.

## El problema, en una línea

El borde de escala valida la plata con un decorador **por campo**
(`@EsMontoCobrado` / `@EsCosto`, `common/decorators/escala-moneda.decorator.ts`) que
`EscalaMonedaPipe` lee del metadata. El campo `valor` **no se puede marcar con ninguno de los
dos**: es monto fijo **o** porcentaje según el valor del hermano `modo`, y ni el decorador ni
el pipe leen campos hermanos.

El punto ciego cae justo en el módulo donde la confusión valor-vs-porcentaje **ya produjo un
bug**: un `19` leído como tasa multiplica el impuesto por cien. Y deja a `form.valor` y
`tramo.valor` de `configuracion/descuentos.vue` y `configuracion/recargos.vue` como los
únicos inputs de plata del inventario que no pueden apoyarse en el rechazo del backend.

## El hallazgo que ordena el diseño

**La venta ya guarda el dato partido en dos.** `venta_descuentos` / `venta_recargos` congelan
`modo`, `valor_aplicado` (plata) y `porcentaje_aplicado`, y `porcentajeDe()`
(`ventas.service.ts:583`) pone `null` explícito cuando la regla era de monto fijo, con el
comentario de que un `0` se leería después como *"valía 0%"*.

O sea: **el rastro congelado ya resolvió esta ambigüedad; el catálogo es el que quedó atrás.**
Por eso el diseño no inventa una forma nueva — copia la que el proyecto ya eligió una vez.

## Los tres roles de `modo` (medidos antes de decidir)

No tiene uno, tiene tres. Cualquier diseño que ignore los dos últimos rompe algo:

1. **Discriminador de unidad** — el que se quiere desambiguar.
2. **Clave de orden del motor** — `calculo-precios.engine.ts:518` ordena los pasos poniendo
   los `monto_fijo` después de los porcentajes.
3. **Dato congelado en la venta** — `venta_descuentos.modo`, parte del rastro auditable.

## Decisiones

### D1 — Una regla, una unidad (owner, 2026-08-23)

Una regla sigue siendo **toda en pesos o toda en porcentaje**, tramos incluidos. El caso mixto
("hasta $30.000 → $2.000 fijos, sobre $30.000 → 3%") se arma con **dos reglas separadas**.

**Por qué:** el motor sabe en qué orden aplicar los pasos porque cada regla tiene una unidad
sola (rol 2). Dejar que cada tramo elija obligaría a decidir el orden de una regla mixta y a
validar cada tramo con su propia vara — bastante más trabajo y más superficie para
equivocarse, a cambio de un caso que se expresa con dos reglas.

### D2 — `modo` sobrevive como discriminador; las columnas lo obedecen

**Enfoque A.** `modo` sigue `NOT NULL` y sigue siendo quien dice la unidad de la regla. Las
dos columnas nuevas no lo reemplazan: le dan al pipe algo que marcar.

**La alternativa considerada y descartada (enfoque B: `modo` desaparece, manda la columna
llena)** se rompe justo donde importa: **una regla por tramos tiene las dos columnas de la
regla en NULL**, así que su unidad solo se derivaría leyendo sus tramos. Eso convierte la
invariante en una condición **entre filas** que un CHECK de tabla no puede expresar, y hace
que el orden del motor necesite una derivación por regla en vez de leer un campo. Con D1 ya
decidido, paga más y compra menos.

**También descartado: partir solo el `valor` de la regla y dejar los tramos.** Es lo más
barato y falla el objetivo — `tramo.valor` es uno de los dos inputs ciegos que la entrada
nombra.

## Modelo de datos

`valor` se parte en dos columnas en las **cuatro** tablas: `descuentos`, `recargos`,
`descuento_tramos`, `recargo_tramos`.

| Columna | Tipo | De dónde sale el tipo |
|---|---|---|
| `valor_monto` | `decimal(18,4)` nullable | igual que `venta_descuentos.valor_aplicado` |
| `valor_porcentaje` | `decimal(7,4)` nullable | igual que `venta_descuentos.porcentaje_aplicado` |

El `(7,4)` no es cosmético: hoy un porcentaje vive en un `(18,4)` que admite `500000`. El tipo
pasa a decir por sí solo que ahí no entra plata.

`modo` no cambia: sigue siendo el enum `modo_regla` (`porcentaje` | `monto_fijo`), NOT NULL.

## La invariante, y dónde vive cada mitad

Se dice separada a propósito, porque **las dos mitades no tienen la misma fuerza** y
presentarlas juntas haría creer que el esquema garantiza más de lo que garantiza.

**Mitad de tabla (CHECK, la garantiza Postgres):**

- En `descuentos` / `recargos`: la columna llena es la que dice `modo`, la otra es NULL.
  Una regla por tramos las tiene **las dos** NULL, que es el estado válido de hoy (`valor` nulo).
- En `descuento_tramos` / `recargo_tramos`: **exactamente una** de las dos está llena.

`@Check()` ya se usa en 6 entidades del proyecto (`moneda`, `tenant`, `movimiento-caja`,
`caja-testigo`, `garzon-pin-evento`, `impuesto`), así que es la forma existente y no una
arquitectura nueva.

**Mitad de service (NO es expresable como CHECK):** que **todos los tramos usen la columna que
dice el `modo` de su regla** es una condición entre tablas. Queda en el service, que es
exactamente donde vive hoy — `validarMontosDeRegla` ya valida todos los tramos con el modo de
la regla. **No es una regresión ni una mejora: es lo mismo, movido.**

Lo que el enfoque A sí compra sobre el B es que la invariante **de la regla** pasa a ser de
tabla, y que los roles 2 y 3 de `modo` no se tocan.

## Borde de escala

- `valor_monto` lleva `@EsMontoCobrado()` en `CreateDescuentoDto`, `CreateRecargoDto` y en los
  **dos** `TramoDto`.
- `valor_porcentaje` **no** lleva marca de escala —no es plata— y conserva su regla propia:
  `0.10 = 10%`, mayor a 0 y menor a 1 (`validarMonto` en `common/utils/monto-regla.util.ts`).
- Los dos controllers pasan a `@Body(EscalaMonedaPipe)` y los dos módulos importan
  `MonedasModule`. Hoy ninguno de los dos lo hace: el pipe está en ventas, caja, items, pagos,
  inventario, mermas, propinas, grupos-modificadores y tenants, y **no** en descuentos ni
  recargos.

✅ **La trampa (c) de la entrada del backlog NO aplica, verificado.** Decía que `tramo.valor`
vive en un DTO anidado y que *"el pipe no recorre anidados sin `@Type()` en el padre"*. El
padre **ya lo tiene**: `create-descuento.dto.ts:49` declara `@Type(() => TramoDto)`. Los
tramos se recorren sin trabajo extra.

## Motor de precios

`ReglaResuelta` pasa de `{ modo, valor }` a `{ modo, valorMonto, valorPorcentaje }`.
`aplicarValor` deja de ramificar sobre un `valor` ambiguo y lee la columna que corresponde.

**Lo que NO cambia, y es deliberado:**

- El **orden** (`engine.ts:518`) sigue saliendo de `modo`.
- `valorEfectivo` / `valorSolicitado` conservan su forma, así que lo que se congela en la
  venta no se mueve.

## Servicios — y un bug que se muere solo

- `TIPOS_CON_VALOR_UNICO` pasa a exigir **la columna que corresponde al modo resultante**.
- Los tres tipos que fuerzan porcentaje (`pronto_pago`, `interes_simple`, `interes_compuesto`)
  exigen `valor_porcentaje` y rechazan `valor_monto`.
- **Regla nueva del PATCH:** mandar la columna que no corresponde al `modo` resultante es
  **400**.

Esa última mata sin esfuerzo el peligro que hoy `validarEstadoResultante` esquiva a mano y que
está documentado en su propio comentario: *"un PATCH que solo cambia el modo reinterpreta los
valores ya guardados — un tramo de 5000 legítimo como monto fijo pasa a ser 500.000%"*. Con
columnas partidas, ese PATCH deja la columna nueva vacía y **falla ruidoso en vez de
reinterpretar**.

## Frontend

Las dos pantallas **ya** ramifican por `form.modo === 'monto_fijo'` para elegir `MoneyInput` vs
`UInput` (`recargos.vue:591` y `:656`). El cambio:

- Cada rama escribe **su** campo: `form.valorMonto` / `form.valorPorcentaje`, y lo mismo en
  `tramo`.
- Al cambiar de modo se **limpia** el campo de la otra unidad, en vez de reinterpretarlo.
- `reglas-form-config.ts` no cambia: su `modo: 'libre' | 'porcentaje'` sigue diciendo qué
  ofrece cada tipo.

## Seeder y esquema documental

12 reglas seedeadas —10 en `porcentaje`, 2 en `monto_fijo` (`seeder.service.ts:2914` y
`:3068`)— se reparten a la columna que les toca.

**Sin backfill ni migración incremental:** no hay datos productivos. Se cambia el esquema, se
actualiza el seeder y se resetea. `startup-pos.sql` se actualiza como **documentación** — el
esquema real lo manda `synchronize` desde las entities.

## Verificación

Gate completo, con `./scripts/reset-db.sh` **antes** del e2e:

```
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

**El `test:e2e` va entero, no un subconjunto.** Este cambio toca DTOs compartidos por dos
módulos y el motor: es justo la forma que un subset local no ve.

Tests que ya cubren esto y hay que mover: `common/utils/monto-regla.util.spec.ts`,
`calculo-precios.engine.spec.ts`, `descuentos.service.spec.ts`, `recargos.service.spec.ts` y
el e2e `test/reglas-valor.e2e-spec.ts`.

**El mutante que prueba que el test sirve:** revertir a la columna única, no solo romperla.
Un test que sigue verde con el `valor` viejo no estaba fijando el cambio.

⚠️ **Entidad nueva o columna nueva:** no hay `autoLoadEntities`. No se agregan entidades acá,
pero si el plan terminara agregando alguna, va también al array `entities` de `app.module.ts`
— unit y typecheck no lo cazan, solo el e2e real.

## Fuera de alcance — explícito

- **El rastro congelado de la venta no se toca.** Ya está partido y es hecho consumado.
- **Permitir que un tramo valga cero NO entra**, aunque `validarMontosDeRegla` se toque igual y
  sea tentador aflojar el `> 0` de paso. Es su propia entrada de `pendientes.md` y su propia
  decisión del owner (2026-08-23).
- **Los cinco tipos de regla que no hacen lo que la pantalla promete** son otro frente.

## Condición de entrada

**Toca el motor de cálculo de precios: va sola y con el sistema quieto** (`CLAUDE.md` →
*"Detenerse y preguntar"*). No se toma de arrastre con ninguna otra tarea.

## Documentación viva a actualizar en el mismo commit

- [`docs/features/descuentos-recargos.md`](../../features/descuentos-recargos.md) — la forma
  del dato y la invariante.
- [`docs/features/motor-calculo-precios.md`](../../features/motor-calculo-precios.md) — de
  dónde lee el motor el valor de una regla.
- [`docs/agent/pendientes.md`](../../agent/pendientes.md) — la entrada se muda a
  [`resueltos.md`](../../agent/resueltos.md) con el texto de su cierre.
