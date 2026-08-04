# Feature: Catálogo de impuestos del sistema + clasificación tributaria

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-31

---

## Overview

### What is it?

Catálogo de impuestos con dos orígenes que conviven en la misma tabla:

- **Sistema**: impuestos oficiales por país (ej. IVA Chile 19%), compartidos por
  todos los tenants de ese país, administrados solo vía seeder — sin CRUD.
- **Personalizado**: impuestos propios de un tenant (como antes de este cambio).

Además, cada item lleva una **clasificación tributaria** explícita (`afecto` |
`exento`) que se congela por línea al vender, y que el motor de precios usa para
decidir qué impuestos aplicar en esa línea.

**El IVA se deriva de esa clasificación, nunca se asocia al item.** `item_impuestos`
guarda solo los **impuestos adicionales** (`tipo='otro'`) que el usuario eligió para
ese item; un item `afecto` lleva el IVA del país sí o sí, agregado por el motor al
resolver la línea, y un item `exento` no lo lleva nunca — ver
[ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md).

### Why does it exist?

Antes, los impuestos eran 100% por tenant: cada tenant chileno creaba su propio
"IVA 19%" (el seeder mismo sembraba uno por tenant), sin ninguna fuente única de
verdad ni garantía de que coincidieran entre sí. Tampoco existía una forma
explícita de marcar un item como exento — sería equivalente a "no tiene impuestos
asignados", ambiguo entre "exento por ley" y "olvidaron asignarle impuesto"
(prohibido por [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md): "exento"
debe ser un estado explícito).

Ver el razonamiento completo (alternativas descartadas, base legal) en
[ADR-011](../adr/011-catalogo-impuestos-sistema.md).

### Scope

- **Incluido**: catálogo de impuestos del sistema por país (hoy: IVA Chile);
  convivencia con impuestos personalizados por tenant; campo `tipo` (`'iva'` |
  `'otro'`), no expuesto en la API de escritura de impuestos; clasificación
  tributaria `afecto`/`exento`/`NULL` (`NULL` solo en `tipo='ingrediente'`, que no
  se vende); congelamiento de la clasificación en `venta_detalles` al vender (venta
  normal y nota de crédito); el motor **deriva** el IVA del país en líneas `afecto`
  y lo excluye en `exento`/`NULL` — nunca se acepta por payload, en ítem ni en línea
  (400); soft delete idempotente de duplicados de IVA por tenant que colisionarían
  con el derivado (ver [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)).
- **NO incluido (futuro)**: CRUD superadmin para administrar el catálogo del
  sistema (agregar un país nuevo = agregar su catálogo al seed); impuestos
  adicionales chilenos concretos (ILA, bebidas analcohólicas, suntuarios) en el
  seed — el modelo ya los soporta (`tipo='otro'`) pero no se siembran hoy;
  indicador "Exento" impreso en boletas/recibos y emisión DTE (diferido por
  ADR-010); nuevas clasificaciones tributarias más allá de afecto/exento.

---

## API Endpoints

```
GET /impuestos
Authorization: Bearer <token>   (JwtAuthGuard + TenantGuard)

Response (200):
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440280",
    "tenantId": null,
    "paisId": "550e8400-e29b-41d4-a716-446655440000",
    "tipo": "iva",
    "nombre": "IVA",
    "porcentaje": "0.1900",
    "activo": true,
    "origen": "sistema"
  },
  {
    "id": "...",
    "tenantId": "<tenant>",
    "paisId": null,
    "tipo": "otro",
    "nombre": "Impuesto verde",
    "porcentaje": "0.0500",
    "activo": true,
    "origen": "personalizado"
  }
]
```

```
POST   /impuestos          (TenantAdminGuard) — crea impuesto PERSONALIZADO del tenant
PATCH  /impuestos/:id       (TenantAdminGuard) — 404 si :id es del sistema (tenant_id NULL no matchea el WHERE)
DELETE /impuestos/:id       (TenantAdminGuard) — idem, soft delete

Request (POST/PATCH):
{
  "nombre": "Impuesto verde",
  "porcentaje": "0.05",     // decimal: 0.19 = 19%
  "activo": true
}
// `tipo` NO es aceptado en este DTO: todo impuesto creado/editado por un
// tenant queda forzado a 'otro' en el servicio. 'tipo=iva' es exclusivo de
// filas del sistema, sembradas solo por seeder.service.ts.
```

No existe endpoint para crear impuestos del sistema — se siembran solo vía
`seeder.service.ts` (ver más abajo).

---

## Backend

### Módulo & Servicios

- **Module**: `src/modules/impuestos/impuestos.module.ts`
- **Controller**: `src/modules/impuestos/impuestos.controller.ts`
- **Service**: `src/modules/impuestos/impuestos.service.ts`
- **Entity**: `src/modules/impuestos/entities/impuesto.entity.ts`

### Entity & Database

**Tabla**: `impuestos`

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `impuesto_id` | UUID | PK | |
| `tenant_id` | UUID | nullable | `NULL` en filas del sistema |
| `pais_id` | UUID | nullable, FK `pais` | `NULL` en filas personalizadas |
| — | — | `CHECK (tenant_id IS NULL) <> (pais_id IS NULL)` | exactamente uno de los dos |
| `tipo` | TEXT | default `'otro'` | `'iva'` \| `'otro'` |
| `nombre` | TEXT | | |
| `porcentaje` | NUMERIC(7,4) | | decimal: `0.19` = 19% |
| `activo` | BOOLEAN | default `true` | pausa. **No aplica al IVA** — ver abajo |
| `creado_el`/`actualizado_el`/`eliminado_el` | TIMESTAMPTZ | | soft delete estándar |

**Sistema**: `(tenant_id NULL, pais_id set)` — ej. IVA Chile, id fijo del seeder
`550e8400-e29b-41d4-a716-446655440280`, `tipo='iva'`, `porcentaje='0.19'`.
**Personalizado**: `(tenant_id set, pais_id NULL)`.

### El IVA no se pausa: se es afecto o exento (2026-08-03)

Desde 2026-08-03 el motor de precios **descarta los impuestos pausados** (`activo = false`) y
emite una advertencia. Esa regla tiene una excepción explícita: **`tipo='iva'` se cobra
siempre que el ítem sea afecto**, sin mirar `activo`.

Lo que decide si se cobra IVA es la `clasificacion_tributaria` del ítem —afecto o exento— y
nada más ([ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)). El interruptor no
participa. `CalculoPreciosService` lo fuerza en un solo lugar, al derivar el IVA del país, y
hay un test que lo fija: *un ítem afecto paga IVA aunque la fila del IVA esté en
`activo = false`*.

**Por qué se blindó:** una fila de IVA con `activo = false` —mal sembrada, o tocada por SQL
directo— dejaría de cobrar IVA en silencio. Eso es un problema fiscal, no un descuento mal
aplicado. En la práctica un tenant no puede llegar ahí (la fila del IVA es del país, su
`update()` busca por `tenant_id` y devuelve 404, y `tipo` no está expuesto en los DTOs), pero
el motor no depende de esas tres protecciones para hacer lo correcto.

Los impuestos **personalizados** del tenant (`tipo='otro'`) sí se pausan con normalidad, con
el mismo comportamiento que descuentos y recargos:
[descuentos-recargos.md](./descuentos-recargos.md).

**Tabla `items`** — columna en la base (todos los tipos: producto, servicio,
suscripción, receta, combo, ingrediente):

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `clasificacion_tributaria` | TEXT | nullable, default `'afecto'` | `'afecto'` \| `'exento'` \| `NULL` |

`NULL` significa **"no aplica"**, no "afecto" — es el valor de `tipo='ingrediente'`
(no se vende, no tiene tratamiento fiscal) y el motor lo trata como tal (ver
[ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md): la condición que agrega el
IVA es `=== 'afecto'`, positiva, para que un `NULL` no derive IVA por accidente). El
`DEFAULT 'afecto'` sigue existiendo para todos los demás tipos: protege la escritura
(un `INSERT` que omita la columna no cae en `NULL`), mientras la condición positiva del
motor protege la lectura — son complementarios, no alternativas.

**Tabla `venta_detalles`** — snapshot congelado al vender:

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `clasificacion_tributaria` | TEXT | default `'afecto'` | copiado del item al crear el detalle; ventas históricas quedan `'afecto'` |

`item_impuestos` no cambió de forma (mismas FKs de siempre), pero sí de **significado**:
guarda solo los impuestos **adicionales** (`tipo='otro'`) que el usuario asoció al item.
El IVA nunca vive ahí — se deriva en el motor a partir de `clasificacion_tributaria`. Un
lector que asuma "acá está todo lo que se le cobra al item" muestra de menos.
`ventas_impuestos` (snapshot de lo efectivamente cobrado por venta) sin cambios.

### DTOs

- `CreateImpuestoDto` / `UpdateImpuestoDto` (`dto/`) — no declaran `tipo`; el
  servicio lo fuerza a `'otro'` en `create()` para toda fila creada por un
  tenant, sin importar qué envíe el cliente (enforcement en backend, no en UI).

### `ImpuestosService`

- `findAll(tenantId)`: resuelve el país del tenant
  (`tenants.provincia_id → provincia.pais_id`) y devuelve
  `WHERE tenant_id = :t OR pais_id = :pais` (`AND eliminado_el IS NULL`), con
  `origen: 'sistema' | 'personalizado'` derivado de si `tenantId` es `null` en la
  fila.
- `create`/`update`/`remove`: siempre filtran por `tenant_id = :tenantId` — las
  filas del sistema (`tenant_id NULL`) nunca matchean ese filtro, así que
  cualquier intento de mutarlas devuelve 404 sin necesidad de un guard adicional.

### Motor de precios (`CalculoPreciosService`) — el IVA se deriva, no se lee de una lista

`ImpuestosService.findAll` deja el catálogo completo del tenant (sistema + personalizado,
IVA incluido) **disponible en el mapa** de reglas que arma el service. Eso no es lo mismo
que aplicarse: quedar en el mapa solo lo hace resoluble por id, no lo suma a ninguna
línea. Lo que decide si el IVA se cobra es exclusivamente `resolverLinea`
(`calculo-precios.service.ts`, ver [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)):

1. Sobre la lista de impuestos ya resuelta de la línea —venga del ítem o pisada por el
   payload— **se saca** cualquier `tipo='iva'` (defensa contra `item_impuestos` viejo; la
   API ya rechaza con 400 que llegue uno explícito, ver más abajo).
2. Si `item.clasificacionTributaria === 'afecto'` (condición **positiva**, no
   `!== 'exento'`: la columna es nullable y un `NULL` no debe derivar IVA), se agrega el
   IVA del país del tenant.
3. Si ese país no tiene fila `tipo='iva'`, revienta con un error nombrando el país en vez
   de vender sin IVA en silencio.

```ts
// calculo-precios.service.ts — resolverLinea() (resumen)
const impuestosLinea = impuestoIds
  .map((id) => this.requerir(impuestoMap, id, 'impuesto'))
  .filter((imp) => imp.tipo !== 'iva');

if (item.clasificacionTributaria === 'afecto') {
  if (!ivaDelPais) throw new BadRequestException(/* nombra el país */);
  impuestosLinea.push(ivaDelPais);
}
```

**El IVA no se acepta nunca por payload.** Un `tipo='iva'` en `impuestosIds` (`POST`/
`PATCH /items`) o en `impuestoIds` por línea (`POST /calculo-precios/calcular`,
`POST /ventas`) es 400: "El IVA no se asigna por ítem ni por línea: sale de la
clasificación tributaria." Omitirlo es el camino normal — con la derivación no queda nada
que normalizar, porque el IVA ya no se guarda. Del mismo modo, mandar
`clasificacionTributaria` junto a `tipo: 'ingrediente'` es 400: lo que no aplica no se
acepta en silencio.

### `VentasService`

Al persistir cada `venta_detalle` en una venta normal, copia
`clasificacionTributaria` del item (`item.clasificacionTributaria ?? 'afecto'`).
En una **nota de crédito**, el detalle se genera a partir de
`validarDevolucionesReembolso`, que **lee la clasificación directamente del
`venta_detalles` de la venta original** (no vuelve a leer el item actual) — así
la NC refleja fielmente lo que se vendió, aunque el item haya cambiado de
clasificación después.

### Seeder (`seeder.service.ts`)

1. **Catálogo del sistema**: siembra IVA de Chile con id fijo
   `550e8400-e29b-41d4-a716-446655440280`, `paisId` = Chile, `tipo='iva'`,
   `porcentaje='0.19'` (si no existe ya).
2. **Desasociación idempotente de duplicados** (`remapImpuestosOficialesDuplicados`):
   detecta impuestos personalizados por tenant cuyo `porcentaje` coincide con el IVA
   oficial del país del tenant y cuyo `nombre` contiene "IVA" (case-insensitive);
   borra sus asociaciones en `item_impuestos` y soft-deletea el impuesto duplicado.
   Corre en cada arranque del backend; correrlo dos veces no produce cambios nuevos.
   `ventas_impuestos` histórico no se toca (el snapshot ya congeló porcentaje y
   valor; la fila soft-deleteada sigue existiendo).
   Con el IVA derivado (ADR-018) ese duplicado es un `tipo='otro'` —porque `tipo` no
   se expone en la API de escritura— y el motor no filtra los `'otro'`, así que se
   sumaría al IVA derivado (doble tributación, 38%). Lo que evita eso es el **soft
   delete del duplicado**, no un remapeo: reapuntar la asociación hacia la fila
   oficial sería inofensivo (esa fila es `tipo='iva'` y el motor la descarta antes de
   derivar) pero ya no tiene sentido, porque el IVA no se asocia.

---

## Frontend

### `configuracion/impuestos.vue`

- Lista unificada con badge de **origen**: "Sistema" (color `info`) /
  "Personalizado" (color `neutral`).
- Filas de origen `'sistema'`: solo lectura — sin editar, sin eliminar, sin
  toggle de activo (los handlers de editar/eliminar retornan temprano si
  `origen === 'sistema'`).
- Form de alta/edición (solo aplica a personalizados): sin campo de tipo — todo
  impuesto creado por el tenant queda `tipo='otro'` (forzado en backend);
  `tipo='iva'` es exclusivo de las filas del sistema.
- **`AppInfoButton` en el campo Nombre**: avisa que el IVA no se crea acá y que uno
  llamado "IVA" se **suma** al automático (38%). Va en esta pantalla porque es donde
  se comete el error, no en la del ítem. Placeholders `"Impuesto verde"` / `"0.05"`,
  nunca `"IVA"` / `"0.19"` — la UI no debe guiar al duplicado.
  **No se bloquea la creación a propósito** (owner, 2026-07-31): el tenant es dueño de
  su catálogo y una heurística de nombre tendría falsos positivos. Ver ADR-018.

### `configuracion/items.vue`

- Selector de impuestos: **solo adicionales** (`tipo='otro'`); el IVA no puede
  seleccionarse ni forma parte de `form.impuestosIds`. Cada opción muestra
  `"${nombre} (Sistema)"` cuando `origen === 'sistema'`, sin sufijo para
  personalizados.
- Delante del selector, un **chip fijo** (sin `×`, no removible) muestra el IVA del
  país con su porcentaje cuando la clasificación es `afecto`; desaparece solo al
  pasar a `exento`. El chip sale de la clasificación en memoria, no de un dato
  guardado, así que no puede quedar desincronizado con lo que va a cobrar el motor.
- Campo **Clasificación tributaria** (`Afecto` default | `Exento`), visible para
  todos los tipos de item **excepto `ingrediente`** (se esconde: un ingrediente no
  se vende y no tiene tratamiento fiscal), con ayuda: "Exento: no se aplica IVA (los
  demás impuestos sí). Se congela en cada venta." Un `AppInfoButton` en el label
  explica que `Afecto` ya trae el IVA del país —con el porcentaje real, interpolado
  desde `ivaLabel`, no escrito a mano— y que no hay que agregarlo como impuesto.
- **Esto es UX, no enforcement** (invariante 6): el candado real es el 400 del
  backend (`validarImpuestos`, ver arriba).

### POS / tienda / salones

Sin cambios — el cálculo viene íntegro del backend
(`POST /calculo-precios/calcular`). Mostrar "Exento" en boletas/recibos queda
fuera de alcance (llegará con la emisión fiscal, ver ADR-010).

---

## Data Flow

### Ejemplo: vender un item afecto (el IVA nunca está en `item_impuestos`)

```
[Item catálogo: clasificacionTributaria='afecto', impuestos asociados = [] (sin IVA)]
  ↓
[POS agrega la línea al carrito]
  ↓ POST /calculo-precios/calcular
[CalculoPreciosService.resolverLinea: item.clasificacionTributaria === 'afecto' → agrega el IVA del país]
  ↓
[POST /ventas: VentasService copia clasificacionTributaria del item al venta_detalle]
  ↓
[venta_detalles.clasificacion_tributaria = 'afecto' (congelado); ventas_impuestos registra el IVA cobrado]
```

### Ejemplo: vender un item exento con un impuesto adicional (`tipo='otro'`)

```
[Item catálogo: clasificacionTributaria='exento',
 impuestos asociados = [Impuesto verde (tenant, tipo='otro')] — nunca IVA]
  ↓
[POS agrega la línea al carrito]
  ↓ POST /calculo-precios/calcular
[CalculoPreciosService.resolverLinea: item.clasificacionTributaria !== 'afecto' → no agrega IVA;
 el 'otro' asociado igual aplica]
  ↓
[POST /ventas: VentasService copia clasificacionTributaria del item al venta_detalle]
  ↓
[venta_detalles.clasificacion_tributaria = 'exento' (congelado, no cambia aunque el item cambie después)]
```

### Combos y recetas — la clasificación del padre es la única palanca

Un combo o una receta se vende como **una sola línea**: `VentasService` resuelve la
personalización (`resolverPersonalizacionReceta`/`resolverPersonalizacionCombo`) a un
único `precioExtraTotal` (componentes + opciones de grupo elegidas) que se suma al
`precioBase` del ítem padre, y esa suma es el `precioUnitario` de la línea que entra al
motor. El motor nunca ve los componentes ni las opciones por separado — solo
`item.clasificacionTributaria` del padre (combo o receta), que es lo único que decide si
la línea entera lleva IVA.

Consecuencia: un combo/receta tributa **todo o nada** según su propia clasificación, sin
importar la de sus componentes — un combo `exento` con componentes `afecto` (o al revés)
no prorratea ni desagrega, y los `precioExtra` de los grupos de modificadores heredan la
clasificación del padre, no la del ítem que representa cada opción. Es la única palanca
fiscal disponible en combos/recetas hoy: no hay forma de que un componente individual
lleve su propio IVA dentro de la línea.

---

## Testing

### Unit Tests (Backend)

```bash
cd backend && npm test -- modules/impuestos/impuestos.service.spec.ts
cd backend && npm test -- modules/calculo-precios/calculo-precios.service.spec.ts
cd backend && npm test -- modules/items/items.service.spec.ts
cd backend && npm test -- modules/ventas/ventas.service.spec.ts
cd backend && npm run test:e2e
```

- `impuestos.service.spec`: `findAll` devuelve la unión sistema+tenant con
  `origen` correcto; `create`/`update`/`remove` no alcanzan filas del sistema
  (404); `create()` persiste `tipo='otro'` aunque el caller intente forzar
  `'iva'` (DTO no lo declara — enforcement en backend).
- `calculo-precios.service.spec` (ADR-018, mutante = revertir al filtro
  `!== 'exento'` o al código previo a la derivación): item `afecto` sin impuestos
  asociados igual lleva el IVA; `afecto` con adicionales lleva los adicionales
  **más** el IVA; `exento` con adicionales lleva los adicionales **sin** IVA; una
  línea que pisa impuestos con `impuestoIds: []` sobre un item `afecto` igual lleva
  el IVA (segunda puerta); `clasificacionTributaria: null` no deriva nada (fija el
  `===` contra el `!==`); `afecto` en un país sin fila `'iva'` revienta nombrando el
  país en vez de vender sin IVA.
- `items.service.spec`: un `tipo='iva'` en `impuestosIds` es 400;
  `clasificacionTributaria` junto a `tipo: 'ingrediente'` es 400; un ingrediente se
  guarda con `clasificacion_tributaria = NULL`.
- `ventas.service.spec`: `clasificacion_tributaria` congelada en el detalle (venta
  normal y nota de crédito, usando el valor original de la venta referenciada). El
  400 de `impuestoIds` por línea no se duplica acá: `VentasService` calcula a
  través de `CalculoPreciosService.calcular`, que es donde vive y se testea (arriba).
- **E2E, el camino por default** (el bug de entrada de ADR-018): crear un item
  `afecto` sin tocar impuestos y venderlo — cobra el 19% de IVA y deja la traza en
  `ventas_impuestos`, sin haber asociado nada en `item_impuestos`.

### Manual

1. `docker-compose down -v && docker-compose up -d --build` (seed desde cero).
2. `/configuracion/impuestos` → IVA aparece con badge "Sistema", solo lectura.
3. POS: vender un item `afecto` (sin asociar nada) → suma el IVA igual, derivado;
   vender un item `exento` → no suma IVA pero sí impuestos `tipo='otro'` que tenga
   asociados.
4. Segundo arranque del backend sin `down -v` → sin cambios nuevos en
   `impuestos` (verifica idempotencia de la desasociación de duplicados).

---

## Related Features

- [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md) — el IVA se deriva de
  `clasificacion_tributaria` en el motor, nunca se materializa en `item_impuestos`.
- [ADR-011](../adr/011-catalogo-impuestos-sistema.md) — decisión completa: modelado, semántica de exento, alternativas descartadas.
- [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) — regla transversal: capturar/congelar el hecho fiscal ahora, diferir DTE.
- [motor-calculo-precios.md](./motor-calculo-precios.md) — motor que consume estos impuestos.
- [ventas.md](./ventas.md) — persistencia de `venta_detalles` y notas de crédito.
