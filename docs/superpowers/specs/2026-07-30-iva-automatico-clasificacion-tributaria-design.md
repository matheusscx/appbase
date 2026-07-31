# Diseño: IVA automático según clasificación tributaria

**Status**: Draft
**Owner**: Cesar Matheus
**Date**: 2026-07-30

---

## Contexto

Un ítem declara su tratamiento fiscal en `items.clasificacion_tributaria`
(`'afecto' | 'exento'`), y sus impuestos salen de la tabla puente `item_impuestos`.
Las dos cosas son independientes hoy, y esa independencia deja pasar un estado que el
modelo fiscal quiere imposible.

**El agujero, medido:** el default de la clasificación es `'afecto'`
(`items.service.ts:812`) y `impuestosIds` arranca vacío
(`frontend/app/pages/configuracion/items.vue:460-461`). El camino por default
**crea un ítem declarado afecto que se vende sin IVA**. ADR-010 y ADR-011 se cuidaron
de que "exento" no significara "sin impuesto"; nada impide el simétrico, que es
"afecto sin impuesto".

**Lo que ya funciona y no hay que tocar:** el motor suprime solo los `tipo='iva'` en
líneas exentas y deja aplicar los `tipo='otro'` (`calculo-precios.service.ts:184-191`,
DL 825 / IndExe del DTE). El dinero de las líneas exentas está bien calculado hoy.

**Hay una segunda puerta al mismo agujero.** El motor acepta que la línea de venta pise
los impuestos del ítem:

```ts
const impuestoIds = linea.impuestoIds ?? reglas?.impuestosIds ?? []
```

Como `??` solo cae con `null`/`undefined`, un `POST /ventas` con `impuestoIds: []` en la
línea (`create-venta.dto.ts:53` → `ventas.service.ts:318`) **vende un ítem afecto sin
IVA** por más que la fila esté asociada en `item_impuestos`. Cualquier solución que solo
arregle la lista guardada del ítem deja esta puerta abierta.

## Regla de negocio (fijada por el owner)

Un ítem `afecto` lleva el IVA sí o sí y no se le puede quitar; uno `exento` no lo lleva.

⛔ **La trampa del alcance:** `afecto`/`exento` habla **solo del IVA**. Un ítem puede
tener varios impuestos, y ser exento de IVA **no** lo deja sin impuestos: puede seguir
teniendo uno o más `tipo='otro'`. El automatismo actúa sobre el IVA y nada más; el resto
de las asociaciones se agregan y se quitan libremente en las dos clasificaciones.
Implementar "exento → limpiar `impuestosIds`" o "afecto → dejar solo el IVA" sería
romper la regla, no cumplirla.

## Alcance

- El IVA deja de almacenarse y pasa a derivarse de la clasificación, en el motor.
- `item_impuestos` cambia de significado: pasa a ser **los impuestos adicionales** que
  eligió el usuario, y nunca contiene el IVA.
- El IVA no se acepta nunca por payload, en ningún endpoint.
- `tipo='ingrediente'` deja de tener clasificación tributaria.
- La UI del ítem muestra el IVA como chip fijo no removible cuando es `afecto`.

### Fuera de alcance

- **Sembrar el IVA de países nuevos.** Se agrega a medida que se habilitan los países
  (decisión del owner, 2026-07-30). No se construye registro ni chequeo *proactivo* de
  cobertura —nada que barra los países y avise cuál no tiene IVA—. Distinto es el
  fail-loud del §4: ese no busca el hueco, solo se niega a vender callado si se lo topa.
- **`tenants.pais_id` denormalizado.** Evaluado y descartado acá; ver
  [Alternativas descartadas](#alternativas-descartadas). Queda como entrada propia en
  `docs/agent/pendientes.md`.
- **Backfill de ítems existentes.** No hay datos productivos: se cambia el esquema, se
  actualiza el seeder y se resiembra.
- **Exponer `impuestos.tipo` en la API de escritura.** Sigue sin poder crearse un
  impuesto `tipo='iva'` por API; ver la invariante de abajo.

---

## Decisión: derivar, no materializar

El IVA **no se guarda en `item_impuestos`**. El motor lo agrega al resolver la línea,
cuando la clasificación es `afecto`.

### Por qué

La alternativa era auto-asociar la fila de IVA en `item_impuestos` al crear o editar el
ítem. Se descartó porque deja **dos fuentes de verdad** —la clasificación y la fila
puente— que hay que mantener sincronizadas en cada camino de escritura, presente y
futuro.

Lo que inclinó la decisión no fue la elegancia sino el modo de fallar, cruzado con los
errores que este repo repite (olvidarse de una regla en una query nueva: los filtros de
soft delete, los N+1):

- **Materializando**, el olvido está en la **escritura** y produce un ítem que se vende
  sin IVA: plata mal cobrada, en silencio.
- **Derivando**, el olvido está en la **lectura** y produce, como mucho, un formulario
  que muestra de menos: visible, y no toca la plata.

Eso se apoya en una asimetría medida: de los dos lectores de `item_impuestos`
—`cargarReglasPorIds` (`items.service.ts:515`) y `findOne` (`:562`)— **uno solo mueve
plata**. La regla vive en una función y el camino del dinero queda cubierto entero.

Además, derivar sobre la lista **ya resuelta** cierra la segunda puerta (la línea que
pisa impuestos), que materializar no cerraba.

Y no cuesta ninguna query: `impuestoMap` se arma con `impuestosService.findAll(tenantId)`,
que ya trae el catálogo completo visible al tenant **incluidas las filas del sistema por
país** (`calculo-precios.service.ts:52-63`). El IVA ya está cargado en cada cálculo.

### Qué IVA es "el IVA"

La fila `tipo='iva'` del país del tenant (`tenants.provincia_id → provincia.pais_id`).
No hay ambigüedad posible, y esto vale la pena entenderlo porque el diseño se apoya en
ello:

- `impuestos.tipo` tiene default `'otro'` y **no está expuesto en `CreateImpuestoDto` ni
  en `UpdateImpuestoDto`**: un tenant no puede crear un impuesto `tipo='iva'` por la API.
- La única fila `'iva'` la siembra el seeder, una por país (Chile,
  `550e8400-e29b-41d4-a716-446655440280`, `0.19`).
- `tenants.provincia_id` es NOT NULL y obligatorio en el DTO, así que todo tenant tiene
  país.

⚠️ Hoy esa unicidad es **emergente** (nadie expuso el campo), no una regla escrita. El
diseño se apoya en ella, así que pasa a ser explícita: **`tipo` no se expone en la API de
escritura de impuestos.** Si alguna vez se expone, esta decisión se revisa primero.

---

## Backend

### 1. Derivación en el motor

Toda la mecánica queda en `resolverLinea` (`calculo-precios.service.ts`), en el mismo
punto donde hoy está el filtro de exentas, y queda simétrica: sobre la lista de impuestos
ya resuelta —venga del ítem o pisada por la línea—

- si la clasificación es `'exento'`, se sacan los `tipo='iva'` (ya lo hace hoy);
- si es `'afecto'`, se agrega el IVA del país.

⚠️ **La condición nueva tiene que ser positiva (`=== 'afecto'`), no la negación del
filtro que ya existe (`!== 'exento'`).** Con la columna nullable (ver §3), un `NULL`
pasa el `!==` y derivaría IVA sobre un ingrediente. Es un `!==` contra un `===` y decide
si un ítem que no tiene tratamiento fiscal termina pagando impuesto.

### 2. El IVA no entra nunca por payload

Un `tipo='iva'` en una lista de impuestos que manda el cliente es **400**, en cualquier
endpoint: `impuestosIds` en `POST`/`PATCH /items`, e `impuestoIds` por línea en
`POST /ventas` y en el simulador de precios.

Omitirlo es el caso normal y no falla nunca. Con la derivación no queda **nada que
normalizar** —el IVA ya no se guarda—, así que la regla que el owner eligió
("normalizar la omisión, rechazar la contradicción") se reduce sola a la mitad del
rechazo.

El mensaje tiene que decir el porqué, no solo que está mal:

> "El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria."

Esto además hace innecesario deduplicar: si el IVA no puede llegar de afuera, derivarlo
no puede producirlo dos veces.

### 3. `ingrediente` sin clasificación tributaria

`items.clasificacion_tributaria` pasa de `NOT NULL DEFAULT 'afecto'` a **nullable**. Un
ítem `tipo='ingrediente'` se guarda con `NULL`: no tiene tratamiento fiscal porque no se
vende (su `precio_base` se fuerza a `'0'` y nunca llega al motor).

Mandar `clasificacionTributaria` junto a `tipo: 'ingrediente'` es **400**, por la misma
razón que el IVA por payload: lo que no aplica no se acepta en silencio.

### 4. Si no hay IVA que derivar

Si el motor encuentra una línea `afecto` cuyo país no tiene fila `tipo='iva'`, **lanza un
error nombrando el país** en vez de vender sin IVA. Es un "no puede pasar" —hoy solo
existe Chile y tiene su fila—, y la elección es entre que sea ruidoso o silencioso.
Silencioso es exactamente el bug que esta spec cierra.

### 5. Seeder

- Se saca el `INSERT INTO item_impuestos` que asocia el IVA al ítem demo
  (`seeder.service.ts:3043`). El ítem es `afecto`, así que deriva el mismo 19%.
  **El comportamiento sembrado no cambia**, y por eso las aserciones de totales del e2e
  siguen valiendo: si alguna se rompe, es señal real y no ruido del refactor.
- `remapImpuestosOficialesDuplicados` cambia de propósito. Existe porque un tenant puede
  crear un impuesto propio llamado "IVA" con el mismo porcentaje que el oficial —que,
  al no poder ser `tipo='iva'`, es un `'otro'`—. **Con la derivación ese impuesto se
  sumaría al IVA derivado: doble tributación.** El remapeo deja de reapuntar la fila al
  IVA oficial y pasa a **borrar la asociación**, porque el IVA ya no se asocia.
- Los ingredientes del seed se siembran con `clasificacion_tributaria` en `NULL`.

---

## Frontend

El selector de impuestos del formulario de ítem pasa a manejar **solo los adicionales**:
`form.impuestosIds` ya no contiene ni puede contener el IVA.

Cuando la clasificación es `afecto`, se dibuja delante un **chip fijo** con el nombre y
el porcentaje del IVA del país, sin la `×`. Al pasar a `exento` desaparece solo. El chip
sale de la clasificación, no del dato guardado, así que no puede quedar desincronizado
con lo que va a cobrar el motor.

```
Impuestos
┌────────────────────────────────┐
│ [IVA 19%] [Impuesto verde ×]   │
│  ↑ sin ×, no se puede quitar   │
└────────────────────────────────┘
```

Para eso el front necesita dos campos que **ya viajan** en la respuesta de `/impuestos`
y hoy descarta: `tipo` (para saber cuál es el IVA) y `porcentaje` (para rotularlo). Hoy
`items.vue:742` pide `any[]` y lo colapsa a `{label, value}`. Se tipa la respuesta y se
separa la lista en "el IVA" y "el resto".

El campo de clasificación tributaria se esconde cuando el tipo es `ingrediente`.

**Esto es UX, no enforcement** (invariante 6): el candado real es el 400 del backend.

---

## Tests

Cada uno con **mutante verificado revirtiendo al código anterior**, no con un `throw`.

**E2E (`backend`, el corazón):** crear un ítem afecto sin tocar impuestos y venderlo. Hoy
ese camino cobra sin IVA; después tiene que cobrar 19% y dejar la traza en
`ventas_impuestos`. Es el bug de la entrada, extremo a extremo, por el camino por default.

**Unitarios del motor** (`calculo-precios.service.spec.ts`), las dos direcciones y los
bordes:

| Caso | Esperado |
|---|---|
| `afecto` sin impuestos asociados | lleva el IVA |
| `afecto` con adicionales `'otro'` | lleva los adicionales **más** el IVA |
| `exento` con adicionales `'otro'` | lleva los adicionales **sin** IVA |
| línea con `impuestoIds: []` sobre ítem `afecto` | lleva el IVA igual (segunda puerta) |
| clasificación `NULL` | no deriva nada (fija el `===` contra el `!==`) |
| `afecto` y el país sin fila `'iva'` | error que nombra el país |

**`items.service`:** un `tipo='iva'` en `impuestosIds` da 400; un
`clasificacionTributaria` junto a `tipo: 'ingrediente'` da 400; un ingrediente se guarda
con `NULL`.

**`ventas`:** el mismo 400 para `impuestoIds` por línea.

**Frontend:** el chip fijo aparece con `afecto` y desaparece con `exento`, y no forma
parte de `form.impuestosIds`.

---

## Documentación

| Archivo | Qué cambia |
|---|---|
| `docs/features/impuestos.md` | `item_impuestos` = adicionales; el IVA se deriva (§ motor y § tablas) |
| `docs/features/impuestos.md:173` | Corregir: dice que los impuestos del sistema "entran automáticamente al cálculo porque `findAll` ya los incluye". Quedan **disponibles en el mapa**, que no es lo mismo que aplicarse — hoy no se aplican solos, y a partir de esto el IVA sí |
| `docs/adr/018-iva-derivado-de-la-clasificacion.md` (nuevo) + índice `docs/adr/README.md` | El IVA se deriva y nunca se almacena. 018 es el próximo libre al 2026-07-30; si otro ADR se adelanta, corre |
| `docs/PRODUCTO.md` | La regla de negocio |
| `docs/ESTADO.md` | Fila de la funcionalidad |
| `docs/agent/pendientes.md` → `resueltos.md` | Al cerrar, más la entrada nueva de `tenants.pais_id` |

**Va un ADR nuevo (018), no una edición de ADR-011.** Los ADR son registro de decisiones y
ADR-011 fijó `'iva'` vs `'otro'`; esto decide algo distinto encima. Editar el viejo
borraría el rastro de que hubo dos decisiones.

---

## Alternativas descartadas

### Materializar el IVA en `item_impuestos`

Auto-asociar la fila al crear/editar el ítem. Descartada: ver
[Decisión](#decisión-derivar-no-materializar). Si alguna vez se revive, el test que barre
la BD buscando ítems `afecto` sin fila de IVA es parte del trato, no un extra.

### `tenants.pais_id` denormalizado

Idea del owner, evaluada y descartada el 2026-07-30. El país sale hoy de
`tenants.provincia_id → provincia.pais_id`, y **once queries en ocho módulos** hacen ese
JOIN, así que la molestia es real. Dos hechos la descartan igual:

1. **`provinciaId` es mutable** (`update-my-tenant.dto.ts:21`), así que una columna
   copiada se desincroniza en cuanto alguien cambie de provincia y olvide actualizarla
   — y desincroniza justo el país que determina el IVA. Es el mismo trade que esta spec
   rechaza para el IVA, en el mismo dominio.
2. **El JOIN repetido no está causando bugs.** Los once filtran `eliminado_el` de
   `provincia`, que es el olvido que más se repite en este repo. Es boilerplate correcto:
   molesta a la vista, no produce daño.

Si algún día duele de verdad, el arreglo sin divergencia es una vista `tenant_pais`, no
una columna.

---

## Riesgos

**El significado de `item_impuestos` cambia.** Cualquier lector nuevo que asuma "acá está
todo lo que se le cobra al ítem" va a mostrar de menos. Se mitiga con el comentario en la
tabla y en `docs/features/impuestos.md`, y el daño está acotado a presentación: el único
lector que mueve plata deriva.

**Doble tributación por impuestos "IVA" caseros.** Un tenant puede llamar "IVA" a un
`tipo='otro'` y quedar con 38%. Lo cubre el cambio de
`remapImpuestosOficialesDuplicados`, pero solo para los que coinciden en nombre y
porcentaje con el oficial. Uno llamado "I.V.A. 19" no matchea. No se resuelve acá; se
anota.

**El `!==` contra el `===`.** Documentado arriba y cubierto por el test de clasificación
`NULL`, porque es un error de una tecla con consecuencia fiscal.
