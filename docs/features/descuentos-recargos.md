# Feature: Descuentos y Recargos — Formularios dinámicos por tipo

**Status**: Implemented
**Owner**: Cesar Matheus
**Last Updated**: 2026-08-23

---

## Overview

### What is it?

Las pantallas de gestión de descuentos y recargos adaptan dinámicamente sus formularios
según el `tipo_regla` seleccionado. Cada uno de los 10 tipos muestra únicamente los campos
relevantes: tabla de tramos, multi-select de métodos de pago, días de vencimiento, fechas
de vigencia, o un valor fijo simple.

### Why does it exist?

Los formularios previos eran estáticos y mostraban todos los campos sin importar el tipo,
generando confusión y datos incompletos. El spec de descuentos/recargos requiere que cada tipo
capture exactamente los datos que necesita para que el motor de precios pueda evaluarlos.

### Scope

- Incluido en esta versión:
  - 10 `tipos_regla` en seeder (PORCENTAJE, MONTO_FIJO, POR_MAYOR, POR_MONTO_VENTA, METODO_PAGO, PRONTO_PAGO, MORA, RECARGO_METODO_PAGO, RECARGO_FIJO, RECARGO_PORCENTAJE)
  - Almacenamiento relacional de tramos y bridges de métodos de pago
  - Formularios dinámicos en frontend (descuentos y recargos)
  - Endpoint `nombre-disponible` para validación en tiempo real
  - 122 tests TDD (unitarios + integración)

- NOT included (future):
  - UI para gestión de la tabla `tipos_regla` (es solo seed por ahora — verificado el
    2026-08-23: `tipos-regla.controller.ts` es solo `GET`)

⚠️ **Esta lista decía dos cosas más que dejaron de ser ciertas, y la corrección importa
más que el dato** (2026-08-23). Decía que la *"evaluación de condiciones en el motor"* y la
*"aplicación de tramos y métodos a ventas"* eran futuro. **Las dos están construidas**: el
motor evalúa tramos por cantidad y por monto y filtra por método de pago
(`calculo-precios.engine.ts` → `evaluarRegla`), y `calculo-precios.service.ts` carga las
reglas de cada ítem y las aplica al vender.

El costo de no haberlo corregido antes está medido: el análisis del motor de promociones
(`docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md`) **citó estas líneas** y
arrancó de la premisa de que los descuentos estaban *"definidos pero NO aplicados al vender"*.
Quien retomara ese frente iba a diseñar contra un sistema que no existe.

**Qué se evalúa hoy, sin adornos** (verificado el 2026-08-23):

| Se aplica bien | Se aplica MAL | No se aplica |
|---|---|---|
| `directo`, `general`, `por_mayor`, `por_monto_venta`, `recargo_por_monto_venta`, `recargo_fijo`, `recargo_porcentaje` | `metodo_pago` y `recargo_metodo_pago` (ignoran sus tramos); `interes_simple` e `interes_compuesto` (cobran la tasa una sola vez y sin mirar plazo — y son idénticos entre sí) | `mora`, `pronto_pago` (en `DIFERIDAS`) |

⚠️ **`promocional` se eliminó del catálogo (2026-08-23):** su caso —un descuento con
vigencia obligatoria— se mudó al futuro módulo de promociones. La capacidad de expresar
*"10% del 15 al 20 de septiembre"* no desapareció: `directo` ganó `fechaInicio`/`fechaFin`
opcionales. Detalle: `docs/superpowers/specs/2026-08-23-vigencia-por-fecha-design.md`.

El detalle de cada hueco y qué hace falta para cerrarlo está en
[`pendientes.md`](../agent/pendientes.md) § 6, *"Cinco tipos de regla no hacen lo que la
pantalla promete"*.

---

## Pausar no es eliminar (2026-08-03)

`activo` es un interruptor de **pausa**, no un borrado. Son dos operaciones distintas y
no hay que confundirlas:

| | Qué significa | Cómo se deshace |
|---|---|---|
| **Pausar** (`activo = false`) | La regla deja de aplicarse pero sigue existiendo, **con todas sus asociaciones intactas** | Reactivar: vuelve exactamente como estaba |
| **Eliminar** (`eliminado_el`) | La regla se va del catálogo | Restaurar desde la papelera |

Reglas de la pausa:

- **No se aplica y avisa.** El motor descarta la regla pausada al resolver la línea y emite
  una `AdvertenciaPrecio` (`titulo: Descuento "X"`, `detalle: está en pausa y no se aplicó`).
  La venta sale igual, con el monto correcto: sigue el precedente del tope de descuento, que
  tampoco frena la venta.
- **Vale igual si la piden a mano.** Da lo mismo que la regla venga heredada del ítem o
  explícita en el request (`descuentosVentaIds`, `descuentoIds` de línea): pausada no aplica.
- **Nunca se tocan las tablas puente.** `item_descuentos` / `item_recargos` / `item_impuestos`
  quedan intactas. Borrar esas filas y no poder devolverlas sería *eliminar* las asociaciones
  con otro nombre.
- **La regla pausada sigue en el mapa del motor**, aunque no se aplique. Sacarla de la carga
  haría que `requerir()` tirara 400 por id ausente en cada ítem asociado, y el POS dejaría de
  vender.
- **El selector no la ofrece**, pero la pantalla de administración sí la sigue mostrando: si
  desapareciera de la lista, el toggle para reactivarla se iría con ella.

En la UI, pausar abre un modal que dice a cuántos ítems afecta (`GET /api/descuentos/:id/uso`)
y promete la reversibilidad. Con cero ítems asociados no hay modal. Reactivar no pregunta.
El flujo vive en `usePausaRegla()` + `CrudPausarModal.vue`, compartidos por las tres
pantallas (descuentos, recargos, impuestos). Lo que **no** vive ahí es el guard del
catálogo oficial de impuestos (`origen === 'sistema'`): es regla de impuestos, no de
pausar, y se queda en su pantalla.

**El IVA queda fuera de todo esto**: no se pausa, se es afecto o exento. Ver
[impuestos.md](./impuestos.md).

## Recargo por escalones de monto (2026-08-22)

Hasta esta fecha **ningún tipo de recargo pedía tramos**, pero la plomería estaba: el
service los persistía y el motor los evaluaba. O sea que un recargo por escalones era
alcanzable por API y no existía en ninguna pantalla. El owner decidió **construirlo en vez
de borrarlo**: `recargo_por_monto_venta`, espejo del `por_monto_venta` de descuentos.

- **No lleva `valor` único**: el monto lo dicen los tramos, y pedir las dos cosas sería
  pedir dos veces lo mismo. `TIPOS_CON_TRAMOS` en `recargos.service.ts` lo exige al crear y
  también **al cambiar el tipo por `PATCH`** — sin eso, mover una regla a este tipo la
  dejaba sin ningún escalón y el motor no le cobraba nada.
- **El motor no necesitó cambios**, y eso se midió antes de escribir: `evaluarRegla`
  ramifica por `tramos.length > 0` sin mirar la clase, y un código que no está en
  `DIFERIDAS` ni en `METODO_PAGO_CODIGOS` llega a esa rama con la magnitud del monto.

### El cero: lo admite el tramo, no el valor plano (2026-08-24)

Los tramos son **abiertos hacia arriba** —solo el mínimo, sin `maximo`— y esa parte no
cambió. Lo que cambió es el piso del importe:

| Dónde | Piso | Por qué |
|---|---|---|
| Cada **tramo** | `>= 0` | Es la única forma de expresar el escalón que deja de cobrar |
| El **valor plano** de la regla | `> 0` | Apagar una regla ya se dice pausándola, y pausada **avisa** |

Sin el cero, **"envío gratis sobre $30.000" no era expresable**: el recargo podía *bajar*
por escalones ($2.000 bajo $30.000 → $500 arriba) pero nunca **llegar a cero**, que es la
forma del caso más común. Con los tramos abiertos hacia arriba, el escalón que no cobra
solo se puede escribir poniéndolo en 0.

La asimetría con el valor plano es deliberada (decisión del owner). Una regla plana en 0
queda **prendida**, se aplica en cada venta y no cobra nada, sin decirle nada a nadie —
mientras que la regla pausada hace lo mismo y el POS le avisa al cajero *"está en pausa y
no se aplicó"*. Permitir las dos dejaría dos maneras de apagar una regla, una silenciosa y
a simple vista idéntica a una rota. Quien intente guardar una regla plana en 0 recibe un
400 que le dice que la pause.

⚠️ **Que un tramo pueda valer 0 no lo vuelve indistinguible de un tramo SIN importe.** El
backlog afirmaba que sí y **se midió que no**: los dos campos son `string` —`@IsNumberString`
rechaza un número de JSON, y TypeORM devuelve `numeric` como string— y `'0'` es *truthy*,
así que el chequeo de presencia de `validarTramo` sigue separando los dos casos sin una
línea de más.

**Lo que NO hubo que tocar, y se midió antes de tocarlo:** el motor ya aplicaba un `'0'`
bien (`aplicarValor` corta por `== null`, no por falsy) y la boleta ya omite el recargo en
cero (`ticket-builder.ts` imprime la línea solo con `.gt(0)`, y muestra el agregado, no una
línea por regla). El drawer de auditoría **sí** lo muestra, atenuado (`sinEfecto`), que es
lo correcto: son dos superficies distintas —el documento del cliente y la pantalla de quien
explica un descuadre— y el cero es información en la segunda.

### Lo que sigue sin salir

`mora` y `recargo_metodo_pago` **no** son candidatos a tramos todavía, y no por falta de
configuración: hoy con tramos **el cálculo no los mira**. Pero no del mismo modo, y la
diferencia importa —medido el 2026-08-24—:

| Tipo | Qué hace el motor con sus tramos | Qué cobra |
|---|---|---|
| `mora` | los ignora: está en `DIFERIDAS` y `evaluarRegla` corta antes | **cero** |
| `recargo_metodo_pago` | los ignora: está en `METODO_PAGO_CODIGOS` y retorna antes del `if` de tramos | **el valor plano** |

⚠️ Este párrafo decía que **los dos** *"cobran cero en silencio"*. Es cierto solo del primero:
`recargo_metodo_pago` está en `TIPOS_CON_VALOR_UNICO`, así que el backend le **exige** valor y
el motor cobra ése. Es la tercera copia del mismo dato viejo —`pendientes.md` ya lo había
corregido contra el código el 2026-08-23— y sobrevivió acá.

Habilitarles el campo sin tocar el motor daría recargos que el admin configura, la UI muestra
y la venta cobra por otro lado. Detalle y medición por tipo en `docs/agent/pendientes.md`.

---

## API Endpoints

### Descuentos

```
GET /api/descuentos
Authorization: Bearer <token>
Response (200): Descuento[] — incluye tramos[] y metodosPago[]

POST /api/descuentos
Authorization: Bearer <token>
Body: CreateDescuentoDto
Response (201): Descuento

PATCH /api/descuentos/:id
Authorization: Bearer <token>
Body: UpdateDescuentoDto
Response (200): Descuento

DELETE /api/descuentos/:id
Authorization: Bearer <token>
Response (200): { message: 'Descuento eliminado' }

GET /api/descuentos/nombre-disponible?nombre=<str>&excludeId=<uuid>
Authorization: Bearer <token>
Response (200): { disponible: boolean }
```

### Recargos

Mismos endpoints bajo `/api/recargos`.

---

## Backend

### Modules & Services

- **Módulo descuentos**: `src/modules/descuentos/`
- **Módulo recargos**: `src/modules/recargos/`
- **Módulo tipos-regla**: `src/modules/tipos-regla/`

### Entities & Database

**Tablas principales (preexistentes, extendidas):**

| Tabla | Cambio |
|-------|--------|
| `descuentos` | el importe vive en `valor_monto` / `valor_porcentaje`, las dos nullable |
| `recargos` | ídem |

#### El importe se expresa en dos columnas (2026-08-23)

`valor` se partió en **`valor_monto`** (`numeric(18,4)`, plata) y **`valor_porcentaje`**
(`numeric(7,4)`, decimal: `0.10` = 10%). El `(7,4)` no es cosmético: dice por sí solo que
ahí no entra plata.

**Por qué**, y no es preferencia de estilo: el borde de escala valida la plata con un
decorador **por campo** (`@EsMontoCobrado`) que un pipe lee del metadata, y un campo que es
monto **o** porcentaje según el hermano `modo` no se puede marcar — ni el decorador ni el
pipe leen campos hermanos. Con el campo partido, `valor_monto` sí se marca, y el borde
rechaza con 400 la plata que no cabe en la moneda del tenant.

`modo` **sobrevive** y no es redundante: es la clave de orden del motor (los `monto_fijo` se
aplican después de los porcentajes) y es lo que se congela en la venta.

**La invariante, y dónde vive cada mitad** —se dice separada porque no tienen la misma
fuerza—:

| Regla | Quién la garantiza |
|---|---|
| En la regla: la columna llena es la que dice `modo`, la otra NULL (las dos NULL = usa tramos) | `CHECK` de tabla |
| En el tramo: exactamente una de las dos | `CHECK` de tabla |
| Que todos los tramos usen la columna que dice el `modo` de **su regla** | el service (`validarMontosDeRegla`) — es entre tablas y un CHECK no lo puede expresar |

**Consecuencia buscada:** cambiar solo el `modo` por `PATCH` ya no reinterpreta lo guardado
—un tramo de `5000` legítimo como monto fijo no puede pasar a leerse como 500.000%—, porque
el importe vive en una columna que el modo nuevo deja fuera de juego. Ese `PATCH` **falla con
400** en vez de reinterpretar.

**Nuevas tablas:**

| Tabla | Descripción |
|-------|-------------|
| `descuento_tramos` | Tramos de descuento (`minimo_cantidad` \| `minimo_monto`, `valor_monto` \| `valor_porcentaje`, `orden`). PK UUID, FK descuento_id. Dos CHECK: exactamente un mínimo y exactamente un importe |
| `recargo_tramos` | Tramos de recargo. Misma estructura |
| `descuento_metodo_pago` | Bridge descuento ↔ metodo_pago. PK compuesta |
| `recargo_metodo_pago` | Bridge recargo ↔ metodo_pago. PK compuesta |

Todas con soft delete (`eliminado_el`) y timestamps.

### DTOs (extendidos)

- `CreateDescuentoDto` / `UpdateDescuentoDto`: nuevos campos `metodoPagoIds?: string[]`,
  `tramos?: TramoDto[]`, `diasVencimiento?: number`, `fechaInicio?: string`, `fechaFin?: string`
- `TramoDto`: `{ minimoCantidad?, minimoMonto?, valorMonto?, valorPorcentaje? }` (strings
  para `@IsNumberString`). Los cuatro son opcionales **en el DTO** porque cuál corresponde
  depende de un hermano que un decorador no puede leer; que llegue exactamente uno de cada
  par lo exige el service.
  ⚠️ Esa opcionalidad se llevó puesto el guardia que daba el `valor` obligatorio: sin la
  validación propia del service, un tramo sin importe llegaba al CHECK de tabla y salía un
  **500** en vez de un 400.
  **No hay `maximo`** —este documento lo afirmaba y nunca existió, ni en las entidades ni en
  el esquema (verificado 2026-08-22)—: los tramos son **abiertos hacia arriba** y gana el de
  mínimo más alto que la magnitud alcance.

### El mínimo de un tramo: dos columnas, dos ejes (2026-08-24)

`minimo` era **una** columna que significaba dos cosas: en un `por_mayor` son unidades, en un
`por_monto_venta` es plata. Quién decidía cuál era un `if` con el string del tipo adentro del
motor, y la consecuencia práctica es que **ninguna de las dos unidades se podía validar en el
borde**: marcarla como plata habría rechazado un "2,5 kg" legítimo de un local que vende al
peso.

Partido en `minimo_cantidad` / `minimo_monto`:

- **El tramo dice qué mide.** El motor elige la magnitud por la columna que está llena, no
  por el código de la regla — ese `if` con el string ya no existe.
- **El umbral en plata pasa por el borde de escala** (`@EsMontoCobrado()`): en un tenant CLP,
  `20.000,50` es 400. El de cantidad conserva sus decimales.
- **Son dos ejes independientes:** el importe lo decide `modo` (monto fijo vs porcentaje) y
  el mínimo lo decide el `codigo` del tipo. Un `por_mayor` puede descontar un porcentaje.

⚠️ **Quien agregue un tipo con tramos tiene que decidir cuál mide**, y el único lugar donde
se declara es `CODIGOS_MINIMO_POR_CANTIDAD` en `monto-regla.util.ts`. Se usa **solo al
escribir**: al leer, el dato ya lo dice.

📌 **Un caso que la validación tiene que dejar pasar, y por qué:** un `PATCH` que cambia el
tipo a uno **sin tramos** deja huérfanos los guardados. Se pasa `codigo: null` para eso, y ahí
se valida **toda la forma y solo la forma**: un solo mínimo por tramo, no negativo, y **todos
los tramos de la regla midiendo lo mismo**. Lo único que NO se exige es la correspondencia con
el tipo, que no significa nada cuando el tipo no mide.

⚠️ **La tercera de esas tres no es decorativa** y se agregó el 2026-08-24 al levantarla la
revisión independiente: sin ella, un `POST` a un tipo sin tramos podía mandar uno en cantidad y
otro en monto —medido, entraba con 201— y el motor comparaba *"500 unidades"* contra *"$100"*
para decidir cuál tramo gana. Es regla de **forma**, no de negocio: no dice cuál columna, dice
que no se mezclen.

### Key Methods

- `service.create(dto, tenantId)` — crea descuento/recargo + hijos (tramos, bridges) en transacción
- `service.update(id, dto, tenantId)` — reemplaza hijos completos (delete all → insert new)
- `service.findAll(tenantId)` — trae entidades con relaciones `tramos` y `metodosPago`
- `service.nombreDisponible(nombre, tenantId, excludeId?)` — check unicidad de nombre

---

## Frontend

### Pages

- `app/pages/configuracion/descuentos.vue` — lista + formulario dinámico inline
- `app/pages/configuracion/recargos.vue` — igual estructura

### Utilities

- `app/utils/reglas-form-config.ts` — configuración declarativa por tipo de regla:
  qué campos mostrar, labels, validaciones. Consultar este archivo para agregar nuevos tipos.

### Data Flow

```
[Usuario abre modal crear/editar]
  ↓
[Selecciona tipo_regla]
  ↓
[reglas-form-config.ts devuelve { campos: [...] } para ese tipo]
  ↓
[Template renderiza campos condicionalmente con v-if]
  ↓
[guardar() arma payload con { tipoReglaId, valorMonto? | valorPorcentaje?, tramos?, metodoPagoIds?, diasVencimiento? }]
  ↓
[POST/PATCH /api/descuentos|recargos]
  ↓
[Backend valida, persiste transaccionalmente, devuelve entidad enriquecida]
  ↓
[cargar() re-fetch → lista actualizada]
```

---

## Testing

### Unit Tests (Backend)

```bash
cd backend
npm test -- --testPathPattern=descuentos
npm test -- --testPathPattern=recargos
```

122 tests passing (service + controller, descuentos + recargos).

### Manual Testing

1. `docker-compose up`
2. Login como admin → `/configuracion/descuentos`
3. Crear descuento con tipo POR_MAYOR → debe mostrar tabla de tramos
4. Crear descuento con tipo METODO_PAGO → debe mostrar multi-select de métodos
5. Editar → los campos pre-cargan correctamente
6. Verificar en Swagger: `GET /api/descuentos` retorna `tramos` y `metodosPago`

---

## Acceptance Criteria

- [x] 10 tipos_regla en seeder
- [x] 4 nuevas tablas relacionales
- [x] valor nullable en descuentos y recargos
- [x] DTOs extendidos con validación class-validator
- [x] Servicio transaccional (create/update con reemplazo de hijos)
- [x] Endpoint nombre-disponible
- [x] 122 tests TDD passing
- [x] Formularios dinámicos en frontend
- [x] reglas-form-config.ts como fuente de verdad de la lógica de campos

---

## Related

- [ADR-006: Modelado relacional de tramos y métodos de pago](../adr/006-relational-tramos-and-metodos-pago.md)
- [Preferencias financieras](./preferencias-financieras.md) — fórmula de precios que consume estas reglas
