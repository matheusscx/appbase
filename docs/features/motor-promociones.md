# Feature: Motor de promociones

**Status**: Construido (backend + frontend). **Gate con stack diferido**: el desarrollo
corrió en un worktree aislado mientras otra sesión ocupaba Docker (`docs/agent/pendientes.md`
§4 del 2026-08-27), así que el e2e completo, `--verificar` y el smoke de navegador **no
corrieron todavía** — quedan para la fase con stack (T14 del plan). No marcar esta fila como
cerrada en `ESTADO.md` hasta que corran.
**Owner**: Cesar Matheus
**Last Updated**: 2026-08-27

---

## Overview

### Qué es

Un módulo `promociones` con tres piezas: **CRUD de campañas** (2x1/NxM, happy hour %, combo
a precio fijo), un **evaluador puro** que decide qué unidades del carrito gana cada promo, y
la **aplicación dentro del motor de precios** como familia propia de descuento — trazable,
congelable y medible como promoción, nunca fundida con los descuentos de catálogo
(`descuentos`/`recargos`).

El diseño completo, con el porqué de cada decisión y la investigación de mercado que lo
respalda, vive en
[`docs/superpowers/specs/2026-08-27-motor-promociones-design.md`](../superpowers/specs/2026-08-27-motor-promociones-design.md).
Este documento no lo repite: describe lo que el código construido **hace hoy**, incluido lo
que cambió respecto del diseño durante la implementación.

### Por qué existe

El análisis de julio (`docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md`)
cerró el alcance de Fase 1: familia (A) — descuentos sobre líneas ya pedidas — activada
solo automáticamente, sin acumulación entre promos por default. El módulo de descuentos ya
podía expresar una regla acotada por fecha (`directo` con `fechaInicio`/`fechaFin`), pero no
tenía forma de expresar 2x1, NxM ni un combo a precio fijo — y mezclar esos casos en
`descuentos` habría fundido en una sola traza y un solo congelado dos cosas que el negocio
mide distinto: "cuánto descontamos" vs. "cuánto regalamos en promos".

### Scope

- Incluido en esta versión: los tres tipos (`porcentaje`, `nxm`, `precio_fijo`), scope por
  ítems/categoría/venta, vigencia por fecha+hora+día+canal, el interruptor de tenant
  promo-vs-descuento de catálogo, congelado en `ventas_promociones`, pantalla de
  configuración, desglose en el drawer de venta y en el ticket.
- NO incluido (diferido a Fase 2, ver la spec §"Qué NO entra en Fase 1"): regalar un ítem no
  pedido, combos automáticos que agregan líneas, cupones, activación manual, grupos de
  exclusión configurables, prioridad manual, tope de aplicaciones por ticket, sucursales,
  fidelización, representación fiscal específica por país.

---

## Las 4 decisiones del owner (2026-08-27)

1. **Promo vs. descuento común: un solo interruptor por TENANT**, no por promo. Vive en
   Preferencias financieras.
2. **Default: NO acumula.** Si nadie tocó el interruptor, el día de la promo aplica solo la
   rebaja mayor entre la promo y el descuento de catálogo que tocarían la misma línea.
   Protege la plata del local por defecto.
3. **Criterio pro-cliente al armar aplicaciones**: cuando hay más candidatas que cupo, gana
   el cliente — al combo entran las unidades más caras, el 2x1 regala la más barata del par
   más caro.
4. **El instante que decide la promo es cuándo se PIDE el ítem**, no la apertura de la
   cuenta ni el pago — ver "El instante por línea" abajo. Reabierta y re-decidida el mismo
   día tras el cruce con la investigación de mercado (Toast documenta exactamente este
   instante).

Investigación de mercado completa (Toast/Square/Lightspeed/Clover + norma chilena SII/SERNAC)
y el cruce contra cada decisión: spec §"Investigación de mercado".

---

## El interruptor: `promosAcumulanDescuentos`

Columna `promos_acumulan_descuentos` en `tenants` (default `false`), editable por
`PUT /tenants/preferencias-financieras` junto a fórmula y redondeo — es conducta de precio,
no configuración de catálogo. Viaja al motor por `ConfigCalculo.promosAcumulanDescuentos`
(campo **requerido**, no opcional: un default silencioso cambiaría plata sin que nadie lo
decidiera) y se **congela** en `ventas.config_calculo` como el resto de la config de cálculo.

**La comparación es POR APLICACIÓN, no por línea.** Un combo que toca dos líneas se compara
entero contra la suma de los descuentos de catálogo de esas líneas: dejarlo ganar en una
línea y perder en la otra cobraría medio combo, que no es un producto que exista. Empate:
gana el catálogo (no cambia la plata que el cliente paga, y es la opción que menos
sorprende). La promo perdedora se descarta **entera y sin traza** — no es "aplicó 0", es que
en este tenant las dos familias no conviven, y eso lo explica la pantalla de configuración,
no una línea del ticket. El catálogo perdedor, en cambio, sí deja traza con monto `'0'` (el
patrón ya existente de "la regla que no aportó").

Implementación: `resolverPromociones` en
`backend/src/modules/calculo-precios/calculo-precios.engine.ts`.

---

## El instante por línea, y la asimetría con la vigencia de reglas comunes

La promo se evalúa contra el instante en que **se pidió** cada línea, no contra cuándo se
cobra la cuenta:

- Con `cuentaId` (salones): cada línea evalúa con el `creado_el` de su fila de
  `cuenta_lineas`. La cerveza pedida a las 18:30 lleva el happy hour de 17–20 aunque la mesa
  cobre a las 22:00; la pedida a las 20:15 no, aunque se cobre en el mismo ticket.
- Sin cuenta (POS directo, tienda, suscripciones): todas las líneas evalúan con **ahora** —
  pedir y cobrar son el mismo acto.
- El instante **nunca viaja por valor desde el cliente**: sale siempre de la BD
  (`instantesDeLineas` en `calculo-precios.service.ts`).

✅ **La asimetría se cerró el 2026-08-31, y la cerró el owner.** Hasta entonces la vigencia
por fecha de las reglas comunes (`descuentos`/`recargos`) se decidía por `cuenta.abierta_el`
mientras la de las promos ya era por línea, y esta nota decía que unificarlas era "una
decisión aparte del owner". Lo fue: al decidir que **lo pedido se cobra como se pidió**, la
línea pasó a congelar sus descuentos y recargos al pedirse, con su vigencia ya resuelta. Los
dos instantes son ahora el mismo — cuándo se pidió la línea.

Lo que eso cambia en la práctica, y está fijado por test
(`vigencia-cuenta.e2e-spec.ts`): una cuenta abierta la semana pasada con una línea pedida
hoy **ya no** lleva la promo de la semana pasada; y una línea pedida con el descuento vivo
lo conserva aunque venza antes de cobrar.

⚠️ **Queda una asimetría más chica, y es la grieta abierta del frente**: `fechaLocal` —el
día que decide **qué promos se cargan**— sigue saliendo de `cuenta.abierta_el`. La hora es
por línea, pero si el día no cargó la promo, la hora nunca se mira. Mesa que se sienta el
lunes 23:30 y pide el martes 00:30: el 2x1 de los martes no se evalúa. Detalle en
[`../agent/pendientes.md`](../agent/pendientes.md).

---

## Modelo de datos

| Tabla | Qué guarda |
|---|---|
| `promociones` | La campaña: vigencia (fecha+hora+día+canal), `tipo` (`porcentaje`\|`nxm`\|`precio_fijo`) y las columnas de su beneficio, el resto `NULL` (CHECK de forma por tipo). `fecha_fin` es **obligatoria** — guardarraíl heredado del frente de vigencia, que perdió el suyo al eliminar el tipo `promocional`. |
| `promocion_scopes` | Los "slots" (la Condición): `items`\|`categoria`\|`venta`. `porcentaje`/`nxm` llevan exactamente 1; `precio_fijo` lleva 1..N (cada uno un componente del combo, AND entre sí). |
| `promocion_scope_items` | Bridge scope↔ítem, solo para `tipoScope='items'`. |
| `ventas_promociones` | El congelado — molde de `ventas_descuentos`: nombre/tipo/valor efectivo congelados, `aplicacion` agrupa (1-based por promo), un solo camino de escritura (`crearEnTransaccion`). `SUM(monto)` sobre esta tabla es "cuánto descontamos en promos", sin filtrar `ventas_descuentos` por ningún flag — la razón de ser del enfoque, ver ADR-023. |

Detalle de columnas y CHECKs: spec §"Modelo de datos". Entidades:
`backend/src/modules/promociones/entities/`.

---

## El evaluador

`backend/src/modules/promociones/promociones.evaluator.ts` — función **pura**, sin BD ni
NestJS, mismo molde que `calculo-precios.engine.ts`. Recibe promos elegibles + líneas
resueltas, devuelve las aplicaciones que ganan el conflicto entre promos, en plata fina.

⚠️ **Vive en el dominio del precio de LISTA, no del neto** — decisión tomada durante la
implementación, distinta de lo que el diseño original asumía (ver "Cambios respecto al
diseño" abajo). Un "20%" es 20% de la etiqueta y un combo de $9.990 es lo que el cliente paga
por el conjunto; el motor convierte cada monto a neto al aplicarlo, con el mismo factor con
que esa línea desbrutea.

**Conflicto promo-vs-promo: greedy por CONTEO DE UNIDADES por línea** (no por presencia de
línea — ver "Cambios respecto al diseño"). Todas las candidatas de todas las promos se
ordenan por monto total descendente (desempate por id de promo) y se recorren en ese orden:
una candidata entra si le alcanza el cupo de unidades libres en cada línea que toca.
`porcentaje` sigue operando a nivel línea entera — pide la línea completa, no unidades
sueltas — lo que es una **limitación aceptada de F1**: una línea parcialmente consumida por
otra promo queda indisponible para `porcentaje` aunque en teoría le quedara una unidad libre.

Por tipo (detalle y ejemplos en el docblock de cada función):

- **`porcentaje`**: cada línea del scope, dentro de su franja, recibe `valorPorcentaje ×
  precioLista × cantidad`. Único tipo que admite cantidad fraccionaria (venta al peso).
- **`nxm`**: explota unidades enteras, ordena por precio de lista descendente, arma grupos
  de `cadaN`; en cada grupo la más barata recibe el descuento. Repetible.
- **`precio_fijo`** (combo): arma combos con las unidades **más caras** de cada slot
  (decisión 3 del owner) mientras el descuento resultante sea positivo — una promoción nunca
  encarece —, y reparte el descuento a prorrata del precio aportado entre las líneas del
  combo (residuo por mayores restos). Repetible.

Tests: `promociones.evaluator.spec.ts` (43 casos: agrupación, empates, franja que cruza
medianoche, cantidades fraccionarias, greedy entre promos y dentro de la misma promo, etc.).

---

## Integración con el motor

```
CalculoPreciosService.calcular
  1. resuelve líneas (precio de lista unitario, convertido a moneda oficial)
  2. cargarVigentes: 1 query batch (promos + scopes + items del tenant, vigentes por fecha)
  3. instantesDeLineas: 1 query a cuenta_lineas (si hay cuentaId) + 1 a la zona del tenant
  4. evaluarPromos (puro) → aplicaciones candidatas
  5. calcularVenta({ …, promociones, config }) — el motor aplica y cierra
```

Cero costo para un tenant sin promos: si `cargarVigentes` vuelve vacía, se corta antes de
tocar `cuenta_lineas` o resolver la zona horaria.

**Dentro del paso `descuentos` de cada línea**: primero las reglas de catálogo, después los
montos de promo como monto fijo. Piso en cero y cuantización al cierre del paso aplican por
construcción — la promo es un descuento más para esa aritmética.

### El ancla del combo (por qué cierra exacto en su precio)

Un descuento de nivel venta no apaga el cierre por resta del motor (el mecanismo que deriva
el impuesto restando en vez de multiplicar `tasa × base`, adoptado el 2026-08-21 porque
`tasa × base` no cierra en el 15,6% de los casos barridos) — le mueve el **ancla**. Las
promociones corren el mismo mecanismo: el ancla de la línea pasa a ser `etiqueta − promo`, y
sobre esa cifra se aplica el descuento de documento si lo hay. Es la razón por la que un
combo declarado "$9.990" cierra en exactamente $9.990 (IVA adentro) y no en $9.991, y por la
que un 2x1 sobre una etiqueta de $993 no le cuesta un peso a la unidad "gratis". Detalle:
`calculo-precios.engine.ts`, sección "El ancla del cierre".

---

## Congelado y dónde se ve

- **`ventas.service.ts`** persiste `ventas_promociones` desde `resultado.lineas[].trazas.promociones`,
  cruzando línea→detalle **por índice** (nunca por `itemId` — el mismo ítem puede estar en
  dos líneas con personalizaciones distintas), en la misma transacción que el resto del
  congelado. `config_calculo` gana `promosAcumulanDescuentos`.
- **Drawer de venta** (`frontend/app/components/ventas/VentaDetalleDrawer.vue`): familia
  propia `'Promoción'` en el desglose expandido de la línea, mismo formato que
  descuento/recargo/impuesto, y **después** de las reglas de catálogo dentro del paso
  `descuentos` — el orden en que el motor las restó. Una aplicación cross-línea (combo) se
  lee línea por línea, con el nombre repetido — es la derivación del total de ESA línea; el
  campo `aplicacion` viaja en el congelado y esta pantalla **no** agrupa por él.
  ⚠️ El total rotulado **"Descuentos"** del panel de totales **incluye la plata de las
  promos** (`totalDescuentos` ya las trae sumadas), al revés que el ticket, que las resta del
  agregado y las nombra aparte. Es deliberado: acá el desglose por línea ya nombra cada
  promo, así que restarlas dejaría un agregado que no cuadra con nada. Congelado en
  `VentaDetalleDrawer.nuxt.spec.ts` desde el 2026-08-28.
- **Ticket** (`frontend/app/utils/ticket-builder.ts`): cada promo se imprime **nombrada**
  (`2x1 martes  −$5.000`), separada del agregado `Descuento` — `agregarPromocionesVenta`
  funde las aplicaciones de la misma promo en una sola fila, y
  `descuentoCatalogo = totalDescuentos − Σ promociones` evita contar la plata de promo dos
  veces (una en el agregado, otra en su fila nombrada). Igual que los recargos en cero: una
  promo sin monto no se imprime — y esa promo **no** es la que perdió el interruptor (esa se
  descarta entera y sin traza, ver arriba), sino la que el **piso en cero** recortó hasta la
  nada porque el catálogo ya se había llevado la línea.
- **Carrito (POS / Salones / Tienda)**: la previsualización corre el mismo cálculo; la promo
  aparece en el desglose con su nombre (`PromocionesAplicadas.vue`, el mismo componente en
  las tres pantallas). Sin toasts nuevos. **Una promo con monto `'0'` no se dibuja**, igual
  que en el ticket: la produce el piso en cero cuando el catálogo ya se llevó la línea
  entera, y lo que hay que contar en ese caso lo cuenta el aviso de al lado, no una fila
  `-$0`. Alineado desde el 2026-08-28; hasta entonces el carrito la mostraba y el ticket no.

---

## Pantalla de configuración

`/configuracion/promociones` (`frontend/app/pages/configuracion/promociones.vue`) — molde de
descuentos/recargos: `CrudTable` + drawer con formulario por tipo
(`frontend/app/utils/promociones-form-config.ts`). Guard `TenantAdminGuard` (catálogo/config:
escritura admin-only, lectura abierta a cualquier autenticado del tenant — mismo mapa de
permisos que descuentos). Badges derivados `Programada`/`Vigente`/`Vencida`/`Pausada` con
fecha del navegador (etiqueta, no plata — misma limitación asumida que las reglas de
descuento).

**Por qué cambiar de tipo avisa con un toast y no con un modal, a diferencia de
`descuentos`**: en `descuentos`, cambiar de tipo puede dejar guardado un valor que el motor
sigue leyendo aunque ya no se vea en el formulario — el 400 no lo frena porque el campo
válido sigue lleno. Acá el campo requerido del tipo nuevo **siempre** queda vacío tras el
cambio (`onTipoChange` lo limpia), así que el submit ya lo frena con un 400 legible antes de
que se pierda algo guardado de verdad — el toast solo evita la sorpresa de "¿por qué
desapareció el combo?" a mitad de la edición, no protege ningún dato. No es una
inconsistencia con `descuentos`: son dos riesgos distintos y cada pantalla responde al suyo.

**El interruptor de tenant** vive en Preferencias financieras, con el texto: *"Cuando una
promoción y un descuento tocan el mismo producto: ¿se suman, o aplica solo la rebaja
mayor?"*

---

## API Endpoints

```
GET /api/promociones
Authorization: Bearer <token>
Response (200): PromocionConScopes[] — incluye scopes[] con sus itemIds

POST /api/promociones
Authorization: Bearer <token> (TenantAdminGuard)
Body: CreatePromocionDto
Response (201): Promocion

PATCH /api/promociones/:id
Authorization: Bearer <token> (TenantAdminGuard)
Body: UpdatePromocionDto
Response (200): Promocion

DELETE /api/promociones/:id
Authorization: Bearer <token> (TenantAdminGuard)
Response (200)
```

No hay `GET /api/promociones/:id` — el drawer de edición reusa la fila ya cargada por el
`findAll`, mismo patrón que `descuentos`/`recargos`.

Las promos **nunca viajan en el request de cálculo** — se resuelven server-side siempre. Lo
único que `CalcularVentaDto` agrega es `canal?: 'fisico' | 'online'` (default `'fisico'`),
para que la previsualización filtre igual que la venta real; el cobro nunca lo toma del
body (`crearEnTransaccion` pasa el canal real de la venta).

---

## Backend

- **Módulo**: `backend/src/modules/promociones/promociones.module.ts`
- **Controller**: `promociones.controller.ts`
- **Service**: `promociones.service.ts` — `findAll`, `cargarVigentes` (batch para el motor:
  promos + scopes + items en 1 query, filtradas por `activo`+fecha; hora/día/canal se afinan
  en memoria en el evaluador), `create`/`update`/`remove`, validaciones de forma y
  cardinalidad de scopes por tipo.
- **Evaluador**: `promociones.evaluator.ts` (puro, ver arriba).
- **Entidades**: `entities/promocion.entity.ts`, `promocion-scope.entity.ts`,
  `promocion-scope-item.entity.ts`; el congelado vive en
  `backend/src/modules/ventas/entities/venta-promocion.entity.ts`.
- **Integración**: `calculo-precios.service.ts` (`resolverPromociones`,
  `instantesDeLineas`) y `calculo-precios.engine.ts` (`resolverPromociones` — el arbitraje
  del interruptor, y el ancla del cierre).
- **DTOs**: `dto/create-promocion.dto.ts` (con `ScopePromoDto` anidado),
  `dto/update-promocion.dto.ts`.

## Frontend

- **Página**: `app/pages/configuracion/promociones.vue`
- **Composable**: `app/composables/usePromociones.ts`
- **Config declarativa por tipo**: `app/utils/promociones-form-config.ts`
- **Desglose en carrito**: `app/components/PromocionesAplicadas.vue`
- **Desglose en detalle de venta**: `app/components/ventas/VentaDetalleDrawer.vue`
  (`filaDePromocion`, familia `'Promoción'`)
- **Ticket**: `app/utils/ticket-builder.ts` (`agregarPromocionesVenta`,
  `lineasTotalesConImpuestos`)

---

## Cambios respecto al diseño original

El diseño (`2026-08-27-motor-promociones-design.md`) se escribió antes de implementar; dos
decisiones cambiaron durante la ejecución, las dos por bugs medidos en revisión y resueltas
con el owner en el momento — quedan documentadas acá para que no se lean como desvíos sin
explicación:

1. **Dominio de la promesa: LISTA, no neto.** El evaluador originalmente calculaba sobre el
   neto. Medido: un 20% de promo sobre una etiqueta de 993 (bruto) cobraba **756**, donde un
   20% de descuento de catálogo — que sí opera en el dominio correcto — cobraba **794** sobre
   la misma etiqueta. Se corrigió a que el evaluador prometa en LISTA (lo que el cliente ve)
   y el motor convierta a neto al aplicar, mismo patrón que ya usan las reglas de nivel
   documento. Con esto, un 20% de promo y un 20% de descuento cobran lo mismo, y el combo
   cierra exacto en su precio declarado.
2. **Conflicto entre promos: por CONTEO de unidades, no por LÍNEA.** El primer greedy
   descartaba una candidata completa si tocaba una línea ya usada por otra, así que dos
   grupos de un mismo 2x1 sobre una línea de 4 unidades (`cadaN=2`) colisionaban entre sí y
   solo se cobraba la mitad del descuento esperado ($5.000 en vez de $10.000, medido). Se
   corrigió a contar unidades consumidas por línea en vez de marcar la línea entera como
   tomada.

---

## Testing

```bash
cd backend
npm test -- --testPathPattern=promociones          # evaluador + service, unit
npm run test:e2e -- promociones.e2e-spec.ts         # requiere reset-db.sh antes

cd frontend
npm test -- --testPathPattern=promociones           # composable + form-config + render spec
```

Cobertura, además de la unit del evaluador (ver arriba): el motor con el interruptor en las
dos posiciones (incluida la aplicación cross-línea comparada entera), traza propia, la
familia perdedora dejando "No aplicó"; el service con elegibilidad (fecha/hora/día/canal) e
instantes por línea; el e2e cubre una promo congelándose en `ventas_promociones`, que
previsualización y venta coincidan, y — punta a punta, la única forma de probar la decisión
4 — que en una cuenta de salón la línea pedida dentro de la franja lleve la promo y la
pedida fuera no, aunque se cobren juntas.

⚠️ El e2e (`promociones.e2e-spec.ts`) está escrito pero **no corrió todavía**: el desarrollo
fue con el stack Docker ocupado por otra sesión (orden explícita del owner, ver el ledger de
la task). Correrlo con `reset-db.sh` antes es parte del cierre del frente (T14), no de esta
task.

---

## Related

- [`docs/superpowers/specs/2026-08-27-motor-promociones-design.md`](../superpowers/specs/2026-08-27-motor-promociones-design.md) — el diseño completo, con la investigación de mercado
- [`docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md`](../superpowers/specs/2026-07-22-motor-promociones-analisis.md) — el análisis de alcance de Fase 1 (julio 2026), promovido a este diseño
- [ADR-023](../adr/023-promociones-familia-propia-del-motor.md) — por qué el evaluador vive afuera del motor y la aplicación/conflicto adentro
- [`docs/features/descuentos-recargos.md`](./descuentos-recargos.md) — la familia de reglas de catálogo con la que promociones compite (y de la que se separó, ver ADR-023)
- [`docs/features/motor-calculo-precios.md`](./motor-calculo-precios.md) — el motor que aplica y cierra
- [`docs/features/combos.md`](./combos.md) — la otra forma de "paquete a precio propio"; ver `docs/PRODUCTO.md` §7 para el criterio de cuándo usar cada uno
- `docs/PRODUCTO.md` — la regla producto-vs-promo
