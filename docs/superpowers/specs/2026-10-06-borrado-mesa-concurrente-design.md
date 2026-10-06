# Spec: borrar una mesa (o su salón) mientras se abre una cuenta en ella

- **Status:** Approved (frente lanzado por la orquestadora, sin revisión del documento)
- **Date:** 2026-10-06
- **Origen:** `docs/agent/pendientes.md` § 5, *"Borrar una mesa mientras se abre una cuenta en ella
  puede dejar unidades con serie sin apartar"* (leído, no corrido).

## Lo medido antes de tocar código

`backend/test/borrado-mesa-concurrente.e2e-spec.ts`, con `correrCarrera`: la compuerta retiene con
`FOR UPDATE` la fila de la mesa; la apertura se dispara primero y el borrado 800 ms después.

| Paso | Resultado (código de `19a18cc2`) |
|---|---|
| sesiones frenadas por la compuerta | 2 |
| `POST /mesas/:id/cuentas` | 201 |
| `DELETE /mesas/:id` | **200**, y la mesa queda borrada con la cuenta abierta |
| la cuenta huérfana pide la unidad U | 201 |
| `vendibles` ofrece U | no |
| otra mesa pide la misma U (2 unidades en stock) | **201** |
| el POS vende U | **201** |
| cobrar la cuenta huérfana | 400 *"no está disponible (estado: vendido)"* |
| `DELETE /salones/:id` en lugar del de la mesa | **200**, mismo resultado |

Con una sola unidad en stock la otra mesa rebota por la reserva de stock (`validarStockAlPedir`,
que no une `mesas`), no por lo apartado: por eso la escena usa dos.

**Por qué pasa.** `abrirCuenta` toma `FOR UPDATE` sobre la mesa viva y recién después inserta la
cuenta. `eliminarMesa` cuenta las cuentas abiertas sin lock (la apertura todavía no commiteó: da 0),
y su `UPDATE mesas` espera al lock de la apertura; cuando esta commitea, el `UPDATE` re-evalúa la
fila —sigue viva— y pasa. `eliminarSalon` es el gemelo que la entrada no nombraba: mismo conteo
sin lock, mismo `UPDATE mesas` después. El orden contrario (el borrado commitea primero) ya
rechazaba la apertura con 404: su `FOR UPDATE … eliminado_el IS NULL` re-evalúa la fila al despertar.

## Decisión

**El par de locks sobre la fila de `mesas`, en los dos borrados. El `JOIN mesas` de lo apartado no
se cambia.**

1. `eliminarMesa` abre `db.transaccion`, toma `SELECT … FROM mesas WHERE … AND eliminado_el IS NULL
   FOR UPDATE` **antes** de contar, cuenta y marca, todo adentro. Es el mismo lock que ya toma
   `abrirCuenta` (lado compartido no hace falta: la apertura ya lo toma en exclusivo).
2. `eliminarSalon` hace lo mismo sobre todas las mesas vivas del salón, en un solo statement con
   `ORDER BY mesa_id`, y el `UPDATE mesas` se acota a **las que lockeó** (`mesa_id = ANY`): una mesa
   creada en el salón después del lock no se borra con él (ese hueco —crear una mesa en un salón
   que se está borrando— existe hoy por su lado y no es de este frente).
3. **Por qué no el `LEFT JOIN`.** Con el lock, una cuenta abierta sobre una mesa borrada deja de ser
   alcanzable: `abrirCuenta` es el único escritor de `estado = 'abierta'` (grep de
   `EstadoCuenta.ABIERTA`), lo hace con la mesa viva lockeada, ninguna cuenta cambia de mesa, y los
   dos únicos escritores de `mesas.eliminado_el` cuentan con el lock tomado. Sobre los estados
   alcanzables las dos consultas (lo apartado y `vendibles`) coinciden. El `LEFT JOIN` solo, sin el
   lock, **no arregla** la carrera: la cuenta queda abierta en una mesa que la pantalla no muestra,
   con su unidad apartada para siempre; y con el lock no tiene caso que lo ejercite sin armar el
   estado por SQL (un test de estado inalcanzable). Lo que sí cambia: los comentarios de las dos
   consultas, que hoy dicen *"una mesa con cuentas abiertas no se puede eliminar"* sin decir qué lo
   garantiza, pasan a nombrar el lock.

## Orden de bloqueo

`eliminarMesa` toma una sola fila (la mesa) y no espera ningún otro lock mientras la tiene. La
apertura toma la misma fila y después solo inserta filas nuevas (`cuentas`, `cuenta_asignaciones`,
sin FKs declaradas). No hay ciclo entre los dos.

`eliminarSalon` toma varias mesas en un statement ordenado, y `guardarLayout` escribe esas filas
una por una en el orden de la pantalla (el de nombre): se abrazan (`40P01`, 500 sin corrupción).
**Medido:** en un plano con los nombres al revés del id, 2 de 3 rondas sobre el código anterior
(el `UPDATE mesas` del salón ya tomaba las filas en orden de plan) y 3 de 3 con el lock ordenado.
Ya era alcanzable; el lock lo volvía determinístico en esos planos. **Decisión de la orquestadora:
entra a este frente** — `guardarLayout` escribe en orden de `mesa_id` (minúsculas antes de
comparar), el mismo orden que el borrado del salón; `abrirCuenta` y `eliminarMesa` toman una sola
mesa.

## Pruebas

- e2e `borrado-mesa-concurrente`: las dos carreras (mesa, salón), con `esperando: 2`, el 400, la
  mesa viva, y la unidad apartada para la mesa de al lado con el mismo mensaje de siempre.
- Unitarios de `salones.service.spec.ts`: el lock precede al conteo y la transacción se abre antes
  del primer query (las dos mitades, como `validarCambioDeNivel`); el `ORDER BY mesa_id` del salón;
  el `UPDATE` acotado a las mesas lockeadas.
- e2e caso 3: el layout en orden inverso al id contra el borrado del salón, sin `40P01`.
- Mutantes: revertir cada lock, y el orden del layout, pone rojo su caso, en loop.
