# Recuento de inventario (conteo físico)

**Fecha:** 2026-07-26
**Estado:** diseño aprobado, pendiente de plan
**Alcance:** sesión de conteo físico con ciclo de vida (borrador → aplicado), que compara lo
contado contra el stock del sistema y aplica la diferencia al kardex con una causa tipificada.
Incluye la extracción del CRUD de catálogos por tenant, hoy triplicado. Backend + frontend.
**Investigación de origen:** [`docs/agent/investigaciones/2026-07-26-inventario.md`](../../agent/investigaciones/2026-07-26-inventario.md) §4
**Depende de:** [`2026-07-26-costeo-cpp-design.md`](2026-07-26-costeo-cpp-design.md) — el costo que valoriza la diferencia

---

## 1. Contexto y problema

`movimientos_inventario` registra entradas y salidas, pero **no hay forma de decir "conté y hay
esto"**. El único ajuste disponible es `PATCH /items/:id/stock` con `motivo='ajuste_manual'`,
que es **relativo** (sumá 5, restá 3) e inmediato: no hay conteo, no hay revisión, no hay
registro de por qué el sistema y la realidad no coincidían.

Eso deja dos huecos:

1. **Operativo.** El stock deriva de la realidad sin que nadie lo detecte hasta que una venta
   falla por stock insuficiente.
2. **De negocio.** El reporte de varianza teórico-vs-real (AVT) —la razón por la que un
   restaurante paga por un módulo de inventario— necesita tres insumos: recetas costeadas ✅,
   mermas tipificadas ✅ y **conteos por período ❌**. Falta solo el tercero.

---

## 2. Decisiones de diseño

1. **Solo modo `cantidad` en esta versión.** Contar en modo `lote` es un número por lote;
   contar en modo `serie` es una **diferencia de conjuntos** (qué identificadores esperaba,
   cuáles aparecieron, y qué significa un identificador que el sistema no tenía). Son otra
   lógica y otra UI. Los productos serie/lote no entran al recuento; queda anotado en
   [`docs/agent/pendientes.md`](../../agent/pendientes.md).

2. **Sesión con ciclo de vida, no operación inmediata.** Contar lleva tiempo y puede cruzar
   turnos; quien cuenta no debería ser necesariamente quien aprueba; y el AVT necesita un
   **corte de inventario a una fecha** para un conjunto de productos, no conteos sueltos que
   haya que reconstruir. Es lo que hacen Square (full count con revisión y aprobación) y Odoo.

3. **La diferencia se tipifica con un catálogo propio, no reusando `causas_merma`.**
   Tres razones, en orden de peso:
   - **El espacio de causas es distinto, no un subconjunto.** Un recuento puede dar
     **sobrante** — contaste más de lo que decía el sistema. Ninguna causa de merma explica un
     sobrante. Y las causas típicas de un desajuste (error de recepción, error de registro)
     no son mermas: son desincronización entre sistema y realidad.
   - **Reusar ensuciaría el reporte de mermas**, mezclando pérdida observada con desajuste de
     inventario — dos métricas que se leen distinto.
   - **Hay precedente explícito de separar por dominio:** la tabla de caja se llama
     `motivo_diferencia_caja`, nombrada por su dominio a propósito.

   El movimiento resultante conserva `motivo='recuento'`: **la causa es un atributo, no
   reclasifica el movimiento**. Así el AVT sigue leyendo `recuento` como su propio bucket y
   además puede desglosar la varianza por causa.

4. **Causa por defecto de la sesión + override por línea.** En un conteo real casi todo cae en
   una misma causa y una o dos líneas tienen explicación propia. Exigir causa en cada línea
   produce el problema que queríamos evitar: el operador elige lo primero de la lista para
   poder terminar. Se persiste **por línea**, así que el reporte no pierde granularidad.

5. **La diferencia es un delta, no un absoluto** — ver §4, es el punto no obvio del diseño.

6. **El recuento usa `tipo='entrada'`/`'salida'`, no `tipo='ajuste'`.** Un recuento **mueve
   stock**, así que respeta la convención del kardex: `cantidad` siempre positiva, el `tipo`
   lleva el signo. `tipo='ajuste'` quedó reservado para movimientos que **no** mueven cantidad
   (hoy solo `ajuste_costo`). Lo que identifica al recuento es `motivo='recuento'`.

7. **El CRUD de catálogos por tenant se extrae.** Este sería el **tercer** catálogo con forma
   idéntica (`causas_merma`, `motivo_diferencia_caja`, `motivo_diferencia_inventario`).
   `CLAUDE.md`: *"duplicar dos veces es aceptable, se extrae a la tercera"*. Se extrae el
   **código**, no las tablas: cada catálogo conserva la suya (una tabla polimórfica sacrificaría
   claridad de dominio y complicaría los FK).

---

## 3. Modelo de datos

### `motivo_diferencia_inventario` (catálogo por tenant)

Misma forma que `causas_merma` (`startup-pos.sql:711-722`) y `motivo_diferencia_caja`:

| Columna | Tipo | Notas |
|---|---|---|
| `motivo_diferencia_inventario_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `nombre` | TEXT | Único por `(tenant_id, lower(nombre))` donde `eliminado_el IS NULL` |
| `activo` | BOOLEAN | Default `true` |
| `es_fijo` | BOOLEAN | Los del sistema no se editan ni eliminan |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | |

**Causas fijas sembradas** (`es_fijo=true`), al crear tenant y en el seeder de desarrollo:
**Merma no declarada**, **Robo**, **Error de recepción**, **Error de registro**,
**Sobre-porcionado**, **Otro**. Las tres primeras explican faltantes; *Error de recepción* y
*Error de registro* explican faltante **y** sobrante.

### `recuento_inventario` (la sesión)

| Columna | Tipo | Notas |
|---|---|---|
| `recuento_id` | UUID PK | |
| `tenant_id` | UUID FK | Del token |
| `estado` | TEXT | `'borrador'` \| `'aplicado'` \| `'cancelado'` |
| `motivo_diferencia_default_id` | UUID FK NULL | Requerido solo al aplicar, si hay líneas con diferencia sin override |
| `comentario` | TEXT NULL | |
| `usuario_creador_id` | UUID FK | |
| `usuario_aplicador_id` | UUID FK NULL | Quién aplicó — puede no ser quien contó |
| `aplicado_el` | TIMESTAMPTZ NULL | |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | |

### `recuento_inventario_linea`

| Columna | Tipo | Notas |
|---|---|---|
| `linea_id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `recuento_id` | UUID FK | |
| `item_id` | UUID FK | |
| `stock_sistema` | NUMERIC(18,4) | **Congelado al agregar la línea** — la base del delta (§4) |
| `cantidad_contada` | NUMERIC(18,4) NULL | NULL = todavía sin contar |
| `motivo_diferencia_id` | UUID FK NULL | Override; NULL = usa el default de la sesión |
| `movimiento_id` | UUID FK NULL | El movimiento del kardex generado al aplicar |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | |

Único por `(recuento_id, item_id)` donde `eliminado_el IS NULL` — un producto no se cuenta dos
veces en la misma sesión.

### `movimientos_inventario` — columna nueva

| Columna | Tipo | Notas |
|---|---|---|
| `motivo_diferencia_id` | UUID FK NULL | Solo poblada en `motivo='recuento'`; NULL en el resto |

`motivo` suma el valor `'recuento'`.

---

## 4. La diferencia es un delta, no un absoluto

**El caso que lo obliga:** contás 11.800 g a las 10:00 y aplicás a las 14:00, habiendo vendido
500 g en el medio. Si el recuento **setea** el stock a 11.800, pisás las ventas de la mañana y
el stock queda inflado en 500.

**La regla:**

```
Al contar (cargar la línea):   delta = cantidad_contada − stock_sistema     [congelado ahí]
Al aplicar:                    stock_final = stock_vigente + delta
```

El conteo descubrió un faltante de 600 g; ese faltante es real **independientemente** de lo que
se haya vendido después. Odoo setea absoluto porque asume que la ubicación se bloquea durante el
conteo; un POS sigue vendiendo, así que el delta es la única semántica que nunca está mal.

El movimiento generado lleva `cantidad = |delta|` y `tipo = 'entrada'` si el delta es positivo,
`'salida'` si es negativo.

---

## 5. Flujo y API

| Endpoint | Qué hace | Permiso |
|---|---|---|
| `POST /api/recuentos` | Crea la sesión en `borrador` con sus líneas. Congela `stock_sistema` de cada una | `Inventario/Crear` |
| `GET /api/recuentos` | Lista sesiones con estado, fecha y diferencia neta | `Inventario/Leer` |
| `GET /api/recuentos/:id` | Detalle con líneas, stock del sistema, contado y diferencia | `Inventario/Leer` |
| `PATCH /api/recuentos/:id/lineas/:lineaId` | Carga `cantidadContada` y opcionalmente `motivoDiferenciaId` | `Inventario/Crear` |
| `PATCH /api/recuentos/:id` | Cambia `motivoDiferenciaDefaultId` y `comentario` | `Inventario/Crear` |
| `POST /api/recuentos/:id/aplicar` | Genera los movimientos y pasa a `aplicado` | **`Inventario/Actualizar`** |
| `POST /api/recuentos/:id/cancelar` | Pasa a `cancelado` sin tocar stock | `Inventario/Crear` |
| CRUD `/api/motivos-diferencia-inventario` | Catálogo de causas | `TenantAdminGuard` |

`tenant_id` y `usuario_id` salen siempre del token.

**Aplicar** corre en **una sola transacción**: por cada línea contada con delta ≠ 0 llama a
`inventarioService.registrarMovimiento` con `motivo='recuento'`, el `motivo_diferencia_id`
resuelto (override o default), y guarda el `movimiento_id` en la línea. Si cualquier línea
falla, **no se aplica ninguna**.

El catálogo va bajo `TenantAdminGuard` siguiendo la regla del proyecto: catálogos y
configuración son admin-only con lectura abierta; las features operativas usan
`@RequiresPermiso`.

---

## 6. El CRUD compartido

Hoy `causas-merma.service.ts` y `motivos-diferencia.service.ts` implementan el mismo CRUD con
distinta tabla. El tercero se extrae en vez de copiarse.

**Qué se comparte:** listar (con filtro `soloActivas`), crear validando nombre único por tenant,
editar rechazando los `es_fijo`, desactivar, y eliminar por soft delete rechazando los `es_fijo`
y los que estén en uso.

**Qué NO se comparte:** la tabla, la entidad, el DTO, el controller y la ruta de cada catálogo.
Cada dominio conserva los suyos.

`causas_merma` y `motivo_diferencia_caja` **migran a usarlo en este mismo trabajo** — si se deja
la migración para después, quedan tres implementaciones en vez de una y el ejercicio pierde
sentido. Sus tests existentes son la red: deben seguir pasando sin cambios de comportamiento.

**Nota:** `causas-merma.service.ts` tiene un latente registrado en `pendientes.md` — tipa directo
el resultado de `INSERT/UPDATE ... RETURNING` sin el `unwrap()` que `motivos-diferencia.service.ts`
sí aplica. Al unificar, **gana la versión con `unwrap()`**, y el pendiente queda cerrado.

---

## 7. Casos borde

| Caso | Resolución |
|---|---|
| Línea sin contar al aplicar (`cantidad_contada` NULL) | Se ignora. No se puede inferir un conteo que no ocurrió |
| Delta = 0 | No genera movimiento ni exige causa |
| El delta dejaría el stock negativo | Rechazo con el producto nombrado. La prohibición de stock negativo es invariante del proyecto |
| Hay líneas con diferencia y no hay causa default ni override | 400: no se aplica sin causa |
| Producto eliminado entre contar y aplicar | La línea se descarta y el resto se aplica igual. La respuesta de `aplicar` devuelve `lineasDescartadas` con item y motivo, y el frontend lo muestra en el toast de resultado |
| Aplicar una sesión ya aplicada o cancelada | 400 — `aplicado` y `cancelado` son terminales |
| Agregar un producto en modo `serie` o `lote` | 400 al crear la línea |
| Agregar un item que no es `producto`/`ingrediente` | 400 — no tiene stock |
| Dos sesiones en borrador con el mismo producto | Permitido. El delta de cada una se calcula contra su propio `stock_sistema` congelado, así que aplicarlas en cualquier orden da el mismo resultado |

---

## 8. Frontend

- **`/inventario/recuentos`** — listado de sesiones con estado, fecha, cantidad de líneas y
  diferencia neta.
- **`/inventario/recuentos/[id]`** — detalle: selector de causa por defecto, tabla con una fila
  por producto (stock del sistema, input de contado, diferencia calculada en vivo, selector de
  causa para override), y el botón de aplicar con un resumen de cuántas líneas se van a mover.
- **Configuración** — pantalla del catálogo de causas, siguiendo la de causas de merma.
- Tokens semánticos de Nuxt UI. La diferencia se muestra con color semántico
  (`text-error` faltante / `text-success` sobrante), no con Tailwind hardcodeado.
- La aritmética del delta en vivo usa Decimal.js, igual que el backend.

---

## 9. Fuera de alcance

- **Modos `serie` y `lote`** — anotado en `docs/agent/pendientes.md`.
- **Cycle count programado** (recordatorio de "contá esto cada 90 días"). El modelo no lo impide.
- **Conteo ciego** — ocultar el stock del sistema mientras se cuenta, como el modo ciego de caja.
  Es una decisión de UI que se puede agregar después sin migrar datos.
- **Reporte de varianza (AVT)** — sub-proyecto siguiente, con su propia spec. Este trabajo es el
  insumo que le faltaba.
- Importar conteos desde CSV o lectora de códigos.

---

## 10. Testing

- **Unit**: el cálculo del delta y su signo; que una línea sin contar se ignora; que el delta se
  aplica sobre el stock vigente y no sobre el congelado; el rechazo por stock negativo
  resultante; la resolución override-o-default de la causa.
- **Unit del CRUD compartido**: nombre duplicado por tenant, `es_fijo` protegido, soft delete,
  filtro `soloActivas`. Una sola batería para los tres catálogos.
- **E2E**: crear sesión → cargar conteos → aplicar → verificar que el stock cambió por el delta,
  que hay un movimiento `motivo='recuento'` por línea con su `motivo_diferencia_id`, y que la
  sesión quedó `aplicado`. Más el caso de venta concurrente entre contar y aplicar (§4), que es
  el que justifica todo el diseño.
- **Regresión**: los tests de `causas_merma` y `motivo_diferencia_caja` deben pasar **sin cambios**
  tras migrar al CRUD compartido.
- **Smoke de navegador** de la pantalla de detalle antes de cerrar.

---

## 11. Documentación a actualizar (mismo commit)

| Archivo | Qué cambia |
|---|---|
| `docs/features/recuento-inventario.md` | Nuevo, desde `TEMPLATE.md` |
| `docs/README.md` | Link a la feature |
| `docs/ESTADO.md` | Fila de la funcionalidad |
| `docs/PRODUCTO.md` | Regla de negocio: qué es un recuento y por qué la diferencia es un delta |
| `docs/patterns/backend.md` | El CRUD de catálogos por tenant compartido |
| `docs/features/inventario-kardex.md` | `motivo='recuento'` y la columna `motivo_diferencia_id` |
| `docs/agent/pendientes.md` | Cierra el latente de `causas-merma` (`unwrap()`); abre serie/lote |
| `startup-pos.sql` | Tres tablas nuevas + columna en el kardex |
| `backend/src/modules/seeder/seeder.service.ts` | Causas fijas + permisos; siguiente ID libre desde `...440292` |
