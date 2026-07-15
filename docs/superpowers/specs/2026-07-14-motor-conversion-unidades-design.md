# Diseño — Motor de conversión de unidades de medida

**Status**: Done (implementado 2026-07-14)
**Date**: 2026-07-14
**Owner**: Cesar Matheus
**Cluster**: Recetas/costos food-service — **pieza 2 de 5** (ver
[análisis de alineamiento](./2026-07-14-alineamiento-cliente-foodservice-analisis.md))

## Context

`item_producto.unidad_medida` es **texto libre** (`TEXT NOT NULL DEFAULT 'unidad'`,
`startup-pos.sql:490`): la API acepta cualquier string y nada sabe que `kg` y `g` son la
misma magnitud. Hoy conviven **tres catálogos hardcodeados**, parciales y desconectados:

- el seeder siembra productos en `'unidad'`, `'kg'`, `'l'`, `'m'`
  (`seeder.service.ts:2056-2061`);
- `frontend/app/utils/stock-format.ts:3-5` declara `type UnidadMedida =
  'unidad' | 'kg' | 'l' | 'm'` y `UNIDADES_FRACCIONARIAS = {kg, l, m}`;
- `items.vue:149-154` tiene su propio `unidadesMedidaOpts` con las mismas cuatro.

Ninguno conoce `g` ni `ml`, ninguno sabe de magnitudes ni factores, y los tres hay que
editarlos a mano para agregar una unidad.

Sin un catálogo con magnitud y factor no hay conversión posible, y sin conversión las
recetas (pieza 3) no pueden expresar "200 g de un insumo stockeado en kg". Es el
prerrequisito directo de la pieza 3.

Esta pieza cierra el punto 3.2 del análisis y entrega comportamiento **usable por sí
solo**: un producto stockeado en kg puede recibir una merma de 500 g y descontar 0,5 kg.

## Scope

**Incluido:**
- Tabla global `unidades_medida` (catálogo sembrado, sin `tenant_id`).
- Servicio de conversión (`cantidad × factor_desde / factor_hacia`) con Decimal.js.
- Conversión en el ajuste de stock: la cantidad se ingresa en cualquier unidad compatible
  y el kardex se registra siempre en la unidad base del producto.
- Validación de `unidad_medida` del producto contra el catálogo (crear y editar).
- `GET /catalog/unidades-medida` como **única fuente de verdad**, reemplazando los tres
  catálogos hardcodeados (`items.vue:149-154`, `stock-format.ts:3-5`, y el default del
  seeder).

**NO incluido:**
- Recetas y consumo de ingredientes (pieza 3).
- Mermas valorizadas (pieza 4) — aquí solo la conversión que la merma usará.
- Unidades propias por tenant (el catálogo es global; ver Fases futuras).
- Conversión entre magnitudes vía densidad (`l → kg` de un insumo). Rechazada por diseño.
- Conversión de la unidad de venta / precio por unidad distinta a la de stock.

## Decisions

| Decisión | Elección | Razón |
|---|---|---|
| Alcance del catálogo | **Matriz estándar global** (sin `tenant_id`) | Espeja `moneda`/`pais`: son hechos físicos, no configuración de tenant. Un kg es un kg en todos los tenants |
| Modelo de conversión | **`factor_base` por magnitud** | Una sola columna resuelve N×N conversiones dentro de la magnitud; sin tabla de pares |
| Vínculo `item_producto.unidad_medida` → catálogo | **TEXT con el `codigo`, validado en el servicio; sin FK dura** | Compatibilidad con el texto libre histórico: una FK exigiría migrar datos y podría fallar al arrancar. La validación aplica a escrituras nuevas |
| Dónde ocurre la conversión | **En `ajustarStock`, antes de `registrarMovimiento`** | `registrarMovimiento` (`inventario.service.ts`) queda agnóstico de unidades y el kardex siempre en unidad base — una sola representación de la verdad |
| Conversión cross-magnitud | **`BadRequest`** | Convertir litros a kilos requiere densidad por insumo, que no existe. Fallar es más honesto que adivinar |
| Modos serie/lote | **Rechazan unidad distinta a la base** | Son conteos de unidades con identidad; "0,5 unidades serializadas" no existe |
| Magnitud `longitud` (`m`) | **Sembrada, por compatibilidad** | `stock-format.ts:3` ya declara `'m'` válido. Si el catálogo no lo incluye, la validación rompería productos existentes con `unidad_medida = 'm'`. Se siembra `m` solo (no `cm`): YAGNI hasta que alguien lo pida |
| `stock-format.ts` | **Deriva de la magnitud del catálogo** | Ver abajo |

### Hallazgos que ajustan el diseño aprobado

1. **El endpoint va en el módulo `catalog` existente**, no en un módulo nuevo. Ya existe
   `@Controller('catalog')` con `@Get('paises')` / `@Get('modulos')`
   (`catalog.controller.ts:9-31`) y las entidades globales viven en
   `catalog/entities/` (`moneda.entity.ts`, `pais.entity.ts`). Ruta final:
   **`GET /catalog/unidades-medida`**.

2. **El form de item no es texto libre: ya es un `USelectMenu`** alimentado por un
   `unidadesMedidaOpts` hardcodeado (`items.vue:149-154`, template `:893-900`). El
   trabajo no es "reemplazar un input por un selector" sino **cambiarle la fuente**: de
   la constante local al catálogo. El texto libre real está en la API (`CreateItemDto`,
   `UpdateItemDto`), que es donde falta la validación.

3. **`stock-format.ts` entra en alcance.** Su set `UNIDADES_FRACCIONARIAS = {kg, l, m}`
   quedará desalineado en el momento en que sembremos `g` y `ml`: un producto en gramos
   mostraría `500` redondeado a entero y sin sufijo, en vez de `500 g`. Es una regresión
   visible que introduce esta pieza, así que la arregla esta pieza. La regla correcta ya
   no es una lista: **fraccionaria = `magnitud !== 'conteo'`**.

4. **`m` no es hipotético: el seeder ya crea productos en metros**
   (`seeder.service.ts:2060`). Sin `m` en el catálogo, la validación nueva rompería
   datos del propio seed. Confirma la decisión de sembrarlo.

## Backend

### Modelo de datos

**`unidades_medida`** (nueva tabla global — sin `tenant_id`):

| Columna | Tipo | Notas |
|---|---|---|
| `unidad_medida_id` | `UUID` PK | `type: 'uuid'` explícito (ADR-004) |
| `codigo` | `TEXT` UNIQUE NOT NULL | Lo que se guarda en `item_producto.unidad_medida` (`kg`, `g`, …) |
| `nombre` | `TEXT` NOT NULL | Etiqueta para UI ("Kilogramo") |
| `magnitud` | `TEXT` NOT NULL | `masa` \| `volumen` \| `conteo` \| `longitud` |
| `factor_base` | `NUMERIC(18,6)` NOT NULL | Cuántas unidades base equivale 1 de esta |
| `creado_el` / `actualizado_el` / `eliminado_el` | `TIMESTAMPTZ` | Convención transversal; lecturas filtran `eliminado_el IS NULL` |

Semilla (IDs fijos, patrón `550e8400-e29b-41d4-a716-446655440XXX`):

| codigo | nombre | magnitud | factor_base |
|---|---|---|---|
| `g` | Gramo | masa | 1 |
| `kg` | Kilogramo | masa | 1000 |
| `ml` | Mililitro | volumen | 1 |
| `l` | Litro | volumen | 1000 |
| `unidad` | Unidad | conteo | 1 |
| `m` | Metro | longitud | 1 |

Incluye los tres códigos ya en uso (`unidad`, `kg`, `l`) más `m` → **cero migración de
datos**: todo producto existente sigue siendo válido.

### Servicio de conversión

En el módulo `catalog` (donde vive el catálogo que consulta):

```
convertir(cantidad, codigoDesde, codigoHacia) → string
```

**Cableado:** `CatalogModule` exporta el servicio; `ItemsModule` lo importa (hoy solo
importa `InventarioModule`, `items.module.ts:23`). Consecuencia en tests: el
`Test.createTestingModule` de `items.service.spec.ts` gana un provider mockeado más
junto a `InventarioService` (`items.service.spec.ts:50`).

- `codigoDesde === codigoHacia` → devuelve la cantidad tal cual (sin tocar la BD).
- Unidad desconocida → `BadRequest` ("Unidad de medida no reconocida: X").
- Magnitudes distintas → `BadRequest` ("No se puede convertir de masa a volumen").
- Cálculo con **Decimal.js**: `new Decimal(cantidad).mul(factorDesde).div(factorHacia)`.
- El resultado se redondea a **4 decimales** (la escala de `item_producto.stock` y
  `movimientos_inventario.cantidad`), coherente con NUMERIC(18,4).

**Precisión — decisión explícita:** convertir 1 g a kg da `0.001`, exacto en 4 decimales.
Pero cantidades chicas en magnitudes con salto de 1000 pueden perder resolución
(0,00005 kg → `0.0001`). Se acepta: la escala de stock ya es 4 decimales, así que el
límite es preexistente, no lo introduce la conversión. La conversión nunca redondea a
cero silenciosamente: si el resultado redondeado es 0 y la cantidad original era > 0 →
`BadRequest` ("La cantidad convertida es menor a la precisión de stock").

### Conversión en el ajuste de stock

`AjusteStockDto` + `unidadCodigo?: string` — la unidad en que viene `cantidad`.

> **Nota de naming:** el DTO ya tiene `unidadIds` (IDs de `item_unidad`, las unidades
> serializadas). Son cosas distintas. El campo nuevo es `unidadCodigo` (código del
> catálogo) para que no se confundan al leer.

En `ItemsService.ajustarStock` (`items.service.ts:560-595`), dentro de la transacción
existente y **antes** de llamar a `registrarMovimiento`:

1. Si `unidadCodigo` no viene o es igual a la unidad base del producto → sin conversión
   (comportamiento actual, intacto).
2. Si viene y el producto es `modo_inventario !== 'cantidad'` → `BadRequest`
   ("Los productos por serie/lote solo admiten su unidad base").
3. Si viene y difiere → leer `item_producto.unidad_medida` (unidad base) y convertir;
   pasar la cantidad convertida a `registrarMovimiento`.

`registrarMovimiento` **no cambia**: sigue recibiendo una cantidad ya en unidad base. El
kardex nunca guarda una unidad, porque solo hay una posible: la del producto.

> El costo (pieza 1) no se toca: `costoUnitario` sigue siendo el costo por **unidad
> base**. Comprar 500 g a $2.000 el kg se ingresa como cantidad 500 `g` + costo 2000 —
> stock +0,5 kg, `costo_actual` 2000/kg. Que el costo se pueda expresar en otra unidad
> es trabajo de la pieza 3, no de esta.

### Validación de la unidad del producto

`CreateItemDto.unidadMedida` (`create-item.dto.ts:90`) y `UpdateItemDto.unidadMedida`
(`update-item.dto.ts:56`) siguen siendo `string` opcional, ahora validados contra el
catálogo en `ItemsService` (create `items.service.ts:262-267`, update `:459-461`):
código desconocido → `BadRequest` con la lista de códigos válidos.

**Cambiar la unidad de un producto con movimientos**: el stock guardado está en la unidad
vieja; cambiar el código sin convertir el saldo lo corrompe silenciosamente (100 kg
pasarían a leerse como 100 g). Decisión: **rechazar el cambio de `unidad_medida` si el
producto ya tiene movimientos** (`BadRequest`). Convertir el saldo histórico es un
problema de kardex (¿se reescriben los movimientos?) que no vale la pena resolver ahora;
si alguien lo pide, se diseña aparte.

### Cambios de API

- `GET /catalog/unidades-medida` → lista agrupable por magnitud
  (`{ codigo, nombre, magnitud, factorBase }`), ordenada por magnitud y factor.
- `PATCH /items/:id/stock` + `unidadCodigo?`.
- La respuesta de items no cambia: `unidadMedida` ya se expone (`items.service.ts:97`).

## Frontend

- **Form de item** (`items.vue:893-900`): el `USelectMenu` existente deja de leer la
  constante `unidadesMedidaOpts` (`:149-154`) y pasa a alimentarse de
  `GET /catalog/unidades-medida`, cargado en `cargarCatalogos()` (`:363-373`) junto a
  categorías/impuestos. Deshabilitado (con hint) si el producto ya tiene movimientos,
  por la regla de arriba.
- **Modal de ajuste de stock** (`items.vue`, form inline): selector de unidad junto a la
  cantidad, limitado a las unidades **de la misma magnitud** que la del producto, con la
  unidad base preseleccionada. Oculto si `modo_inventario !== 'cantidad'`.
  Feedback: "500 g → 0,5 kg" visible antes de confirmar, para que el usuario no descubra
  la conversión después del hecho.
- **`stock-format.ts`**: `UNIDADES_FRACCIONARIAS` deja de ser un set hardcodeado; la
  fraccionalidad se decide por `magnitud !== 'conteo'` usando el catálogo cargado.
- Tokens semánticos de Nuxt UI, sin Tailwind hardcodeado.

## Verification

### Unit
- `catalog.service.spec.ts`: conversión misma magnitud (kg→g, g→kg, l→ml); identidad;
  unidad desconocida → BadRequest; cross-magnitud → BadRequest; redondeo a 4 decimales;
  cantidad que redondearía a 0 → BadRequest.
- `items.service.spec.ts`: `ajustarStock` con `unidadCodigo` distinto convierte antes de
  `registrarMovimiento` (el mock `inventarioServiceMock.registrarMovimiento` ya existe
  en el spec — assert sobre la cantidad convertida); sin `unidadCodigo` no
  convierte; serie/lote con unidad distinta → BadRequest; crear/editar con código
  inválido → BadRequest; cambiar unidad con movimientos existentes → BadRequest.

### E2E (`inventario.e2e-spec.ts` o nuevo `unidades.e2e-spec.ts`)
1. Crear producto en `kg` → entrada por compra de `500 g` → stock `0.5000`.
2. Merma de `250 g` → stock `0.2500`, movimiento en unidad base.
3. Ajuste con `unidadCodigo = 'l'` sobre producto en `kg` → 400.
4. Crear item con `unidadMedida = 'inventada'` → 400.

### Manual
- Swagger: `GET /catalog/unidades-medida`; `PATCH /items/:id/stock` con `unidadCodigo`.
- Frontend: crear producto en kg → ajustar stock en g → ver la conversión previa y el
  stock resultante correcto.

## Open questions

- ¿El selector de unidad en el ajuste debería recordar la última unidad usada por
  producto? (mejora de UX, no bloquea).
