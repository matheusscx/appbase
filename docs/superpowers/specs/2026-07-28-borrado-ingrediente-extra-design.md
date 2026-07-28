# Borrado informado de un ingrediente usado como extra

**Fecha:** 2026-07-28
**Estado:** diseño aprobado, pendiente de plan
**Alcance:** `GET /items/:id/uso` devuelve dónde se usa un item, clasificado en bloqueos y
advertencias; `remove()` deja de ignorar `receta_extras_permitidos` y limpia sus filas al
borrar; el modal de confirmación del catálogo pasa a decir qué se rompe antes de que el
usuario confirme. Backend + frontend.
**Origen:** pendiente abierto en [`docs/agent/pendientes.md`](../../agent/pendientes.md)
§"Decidido por el owner", surgido de la auditoría de 8 lentes sobre items (commit `8357f10`).

---

## 1. Contexto y problema

Un **extra** no es una entidad propia: es una fila de `receta_extras_permitidos` que une una
receta (Hamburguesa) con un ingrediente del catálogo (Queso cheddar) más `cantidad`,
`unidad_codigo` y `precio_extra`.

`remove()` ([`items.service.ts:1527`](../../../backend/src/modules/items/items.service.ts))
bloquea el borrado de un item si es **ingrediente fijo** de una receta, **componente** de un
combo u **opción** de un grupo de modificadores. Nunca consulta `receta_extras_permitidos`.

Consecuencia hoy: borrás Queso cheddar sin fricción y

- la fila del extra **queda viva** apuntando a un item muerto;
- pero las dos lecturas de extras (`items.service.ts:565` y `:1791`) hacen
  `JOIN items … AND i.eliminado_el IS NULL`, así que el extra **desaparece de la carta de la
  Hamburguesa sin avisarle a nadie**;
- si alguien intenta venderlo igual, `resolverPersonalizacionReceta:1852` responde
  `400 "Extra no permitido para esta receta"`;
- las ventas ya emitidas guardan snapshot propio: el historial y la auditoría no se tocan.

**Esto no es un bug de corrección, es de integridad de catálogo.** Un extra borrado produce
*ausencia*, no un dato equivocado.

> **Corrección de una nota previa.** `pendientes.md` afirmaba que este hueco era "la condición
> habilitante del bug de conversión de unidad" del extra. Tras el fix de ese bug (commit
> `51df04c`) la afirmación es **falsa**: el `JOIN` filtra el item borrado antes de que la ruta
> de la unidad se ejecute. La nota se corrige al cerrar este pendiente.

El agravante real está en el frontend: `configuracion/items.vue:1926` ya muestra un modal de
confirmación, pero con texto **fijo y genérico** ("¿Estás seguro…? Esta acción no se puede
deshacer"). Cuando el backend bloquea, el 400 llega como **toast** (`items.vue:939`) — el
usuario ya confirmó y recién entonces se entera de que no se podía. La confirmación no informa.

---

## 2. Decisiones de diseño

1. **La consulta reporta los cuatro usos, no solo los extras.** Un ingrediente puede ser extra
   de una receta *y* componente de un combo. Si el modal solo supiera de extras, diría "se
   ofrece como extra en X, ¿confirmás?", el usuario confirmaría y recibiría igual el 400 del
   combo: la confirmación mentiría. Reportar los cuatro además arregla que hoy los tres
   bloqueos se descubren por toast después de confirmar.

2. **El backend clasifica; el frontend solo renderiza.** La respuesta son dos arrays
   (`bloqueos`, `advertencias`), no una lista plana con flag. La regla de qué bloquea la tiene
   que aplicar el backend igual en `remove()`; devolverla ya clasificada evita una segunda
   copia de esa regla en la página, que se separaría de la primera en el siguiente cambio.
   Se eligió sobre la alternativa `usos: [{ tipo, nombre, bloqueante }]`, más extensible pero
   sin un tercer nivel a la vista que la justifique.

3. **El borrado confirmado limpia las filas de extras.** Aunque las lecturas ya las filtran y
   no existe restaurar un item borrado —o sea, la fila es **inerte**—, dejarla viva es basura
   referencial visible para cualquier reporte futuro que consulte la tabla sin el `JOIN`.
   Limpiar es higiene barata: el `UPDATE … SET eliminado_el = NOW()` ya existe en la edición de
   recetas (`items.service.ts:1386`).

4. **`/uso` va detrás de `Items:Eliminar`, no de `Leer`.** Solo quien puede borrar necesita
   conocer el impacto; abrirla a lectura crearía una vía lateral para inventariar el catálogo.

5. **Una sola query, no cuatro.** `remove()` hoy dispara tres queries secuenciales. La versión
   nueva necesita cuatro usos, y se resuelven con un `UNION` único, mismo patrón que
   `cargarReglasPorIds:440`. `UNION` y no `UNION ALL`: el dedupe es exactamente el `DISTINCT`
   que hoy hace cada query por separado.

---

## 3. Backend

### 3.1 `obtenerUsoItem()` — método privado, fuente única

Reemplaza las tres queries sueltas de `remove()` (`items.service.ts:1533-1572`) por una:

```sql
SELECT 'ingrediente' AS clase, r.nombre
  FROM receta_ingredientes ri
  JOIN items r ON r.item_id = ri.receta_item_id
   AND r.tenant_id = $2 AND r.eliminado_el IS NULL
 WHERE ri.ingrediente_item_id = $1 AND ri.eliminado_el IS NULL
UNION
SELECT 'combo', c.nombre
  FROM combo_componentes cc
  JOIN items c ON c.item_id = cc.combo_item_id
   AND c.tenant_id = $2 AND c.eliminado_el IS NULL
 WHERE cc.componente_item_id = $1 AND cc.eliminado_el IS NULL
UNION
SELECT 'opcion', g.nombre
  FROM grupo_modificador_opciones o
  JOIN grupos_modificadores g ON g.grupo_modificador_id = o.grupo_modificador_id
   AND g.tenant_id = $2 AND g.eliminado_el IS NULL
 WHERE o.item_id = $1 AND o.eliminado_el IS NULL
UNION
SELECT 'extra', r.nombre
  FROM receta_extras_permitidos re
  JOIN items r ON r.item_id = re.receta_item_id
   AND r.tenant_id = $2 AND r.eliminado_el IS NULL
 WHERE re.ingrediente_item_id = $1 AND re.eliminado_el IS NULL
ORDER BY 1, 2
```

El `ORDER BY` es por **determinismo**, no porque el orden signifique algo: sin él el orden lo
decide el plan de ejecución y el modal lista los motivos distinto entre llamadas.

Dos diferencias respecto de hoy, ambas deliberadas:

- **Acota por `tenant_id` en el `JOIN`.** Las tres queries actuales confían solo en el
  `findOne({ id, tenantId })` previo. Es la misma defensa que ya se agregó en
  `cargarReglasPorIds` (ver su comentario en `:436-439`). El filtro va sobre la **entidad
  padre** de cada rama —`items` en tres, `grupos_modificadores` en la de opciones—, no sobre la
  tabla puente; las cuatro tienen la columna, así que sale sin excepciones.
- **Devuelve el cuarto uso**, `extra`, que hoy no se consulta en ningún lado.

Clasificación, y vive **solo acá**:

| `clase` | destino |
|---|---|
| `ingrediente`, `combo`, `opcion` | `bloqueos` |
| `extra` | `advertencias` |

### 3.2 `remove()`

Pasa a envolverse en `dataSource.transaction` (hoy es una query suelta) y:

- si `bloqueos` no está vacío → `BadRequestException` **con los textos actuales sin tocar**
  (`"No se puede eliminar: es ingrediente de …"`, `"… es componente de …"`,
  `"… es opción de …"`), para no romper los e2e que ya los afirman;
- si no → soft-delete del item **y** de sus filas de `receta_extras_permitidos`, en la misma
  transacción.

Sigue siendo la defensa real del servidor: que el frontend consulte `/uso` antes no lo exime.

### 3.3 Ruta

`@Get(':id/uso')` en `items.controller.ts`, con `@RequiresPermiso('Items', 'Eliminar')`.
Respuesta:

```json
{
  "bloqueos":     [{ "tipo": "combo", "nombre": "Menú del día" }],
  "advertencias": [{ "tipo": "extra", "nombre": "Hamburguesa" },
                   { "tipo": "extra", "nombre": "Completo" }]
}
```

---

## 4. Frontend

`CrudModal.vue` gana un **slot opcional** para el detalle. Es compatible hacia atrás: ninguno
de sus ~20 consumidores actuales lo pasa, y sin slot el modal se comporta idéntico a hoy.

`confirmarEliminar()` (`items.vue:923`) pasa a `async`: consulta `/uso`, guarda el resultado y
abre el modal, que toma una de tres formas según la respuesta:

| Respuesta | Modal |
|---|---|
| `bloqueos` no vacío | Título "No se puede eliminar", lista los motivos; el botón de confirmar se reemplaza por un único "Entendido" que cierra — no hay acción destructiva disponible |
| solo `advertencias` | "Se ofrece como extra en Hamburguesa, Completo. Si lo eliminás dejará de estar disponible en esas recetas." + confirmar |
| ambos vacíos | El mensaje genérico de hoy, sin cambios |

Si `/uso` falla, toast de error y el modal **no** abre.

---

## 5. Testing

**El test que no prueba nada:** "borrar un ingrediente usado solo como extra funciona" pasa
igual **antes y después** del cambio — hoy también funciona. Incluirlo solo como regresión, no
como evidencia del fix. (Es la lección de `51df04c`: el mutante válido revierte al código
anterior, no rompe la línea nueva.)

Los que sí revierten con el código actual:

- **e2e** (`backend/test/recetas.e2e-spec.ts`) — tras borrar el ingrediente-extra, su fila en
  `receta_extras_permitidos` quedó con `eliminado_el` no nulo. Hoy sigue viva → falla.
- **e2e** — `GET /items/:id/uso` de un ingrediente que es extra **y** componente de combo
  devuelve el combo en `bloqueos` y la receta en `advertencias`. La ruta no existe → 404.
- **unit** (`items.service.spec.ts`) — la clasificación de las cuatro clases.
- Los e2e actuales de bloqueo por combo y por opción quedan como regresión de que las guardas
  no se aflojaron.

Las páginas no tienen test unit: **smoke test en navegador** del modal en sus tres formas antes
de cerrar.

---

## 6. Documentación (mismo commit)

| Archivo | Qué |
|---|---|
| `docs/features/recetas.md` | La asimetría extra = advertencia (no bloqueo) y el endpoint `/uso` |
| `docs/ESTADO.md` | Fila de la funcionalidad |
| `docs/agent/pendientes.md` → `resueltos.md` | Cerrar el ítem, **corrigiendo** la afirmación sobre "condición habilitante del bug de unidad" (§1) |

---

## 7. Fuera de alcance

- **Que el item haya sido vendido** no bloquea ni advierte nada. Hoy tampoco, y no se toca.
- **Los otros tres usos siguen siendo bloqueos duros.** Este diseño mejora cómo se comunican,
  no los convierte en advertencias.
- **Restaurar un item borrado** no existe y no se agrega.
