# Plan: tendencia de descuadres por cajero — la lectura que hoy nadie tiene

**Status:** Done — 2026-08-22
**Date:** 2026-08-22
**Owner:** Cesar Matheus

## Context

Al cerrar por descarte *"Ocultar el resultado post-cierre al cajero"* (2026-08-22,
[`resueltos.md`](../../agent/resueltos.md)) quedó nombrado el agujero real: **el descuadre lo
justifica quien lo produjo y no lo revisa nadie.** El cajero cuenta, se entera, elige el
motivo, escribe la explicación y cierra su caja. Queda registrado, pero nada le avisa a nadie
que vaya a mirarlo.

Esta entrada es el **control crónico** de ese agujero —el descuadre chico y repetido—; el
**agudo** es el umbral de aprobación, que es entrada aparte. **Y va primero que el umbral a
propósito:** el umbral necesita un número, y hoy nadie conoce la distribución real de
descuadres de la operación.

Diseño completo, con el porqué de cada decisión:
[`specs/2026-08-22-tendencia-descuadres-design.md`](../specs/2026-08-22-tendencia-descuadres-design.md).

**Decisiones del owner (2026-08-22):** la ve **solo el supervisor**; v1 **solo muestra**, no
avisa.

✅ **No toca el flujo de cierre.** Es lectura pura — propiedad buscada, después de que el
intento del 2026-08-16 dejara al cajero sin poder cerrar su caja.

## Scope / Out of scope

**In scope:** un endpoint agregado en el módulo `caja`, filtros de fecha en su DTO, una página
de supervisión, y la doc de la feature.

**Out of scope:** el umbral de aprobación y cualquier aviso, señal o badge; el promedio con
signo (arrastra la división de dinero — ver spec); separar por cajón; que el cajero vea la
propia.

⛔ **No se toca `enviarConteo` ni `cerrar`.** Si alguna tarea parece pedirlo, es señal de que
el plan está mal: parar y reportar.

## Backend

- [x] **1. Filtros de fecha en `QueryHistorialCajaDto`** (o un DTO propio si conviene, decidir
  al implementar). `desde` / `hasta` opcionales, con la validación que ya usan mermas y cobros
  — **no inventar una nueva**: mirar cómo lo declaran ellos y copiar esa forma.
- [x] **2. `tendenciaDescuadres` en `caja.service.ts`.** Una sola consulta agregada:
  `GROUP BY` por `usuario_id` + `JOIN usuarios` para el nombre. **Nunca una query por cajero.**
  - Ventana con `bordeFechaSql` / `bordeHastaSql` de `common/utils/rango-fecha.util.ts` —
    la razón de que existan está en `patterns/backend.md` §10b; `<= hasta` con fecha pura se
    come el día entero.
  - Filtra `c.diferencia IS NOT NULL` (= el conteo se congeló), `c.tipo = 'fisica'`,
    `c.eliminado_el IS NULL` y `am.eliminado_el IS NULL` en el `LATERAL`.
  - `tenant_id` **del token**, jamás del query.
  - Devuelve `cierres`, `efectivoSuma`, `otrosMediosSuma`, `conFaltante`, `conSobrante`,
    `cuadrados`. Montos como **string**.
  - La fila se atribuye al **dueño del turno** (`usuario_id`), no a `cerrada_por`: en un
    cierre forzado el descuadre sigue siendo del turno de quien lo trabajó.
- [x] **3. Ruta `GET /caja/tendencia` con `@RequiresPermiso('Cajas', 'Leer')`.**
  ⚠️ **Declararla ANTES de `@Get(':id')`** o la ruta literal se la come el parámetro.
- [x] **4. Unit spec del service.** ⚠️ **Reescrita al ejecutarla, porque como estaba pedida
  era imposible.** El service arma SQL crudo y el spec mockea `db.query`: con la consulta
  mockeada **el unit no puede probar ninguna agregación** —eso lo ejecuta Postgres—. Lo que
  sí prueba es el mapeo de la fila, el armado de parámetros y que las cláusulas que no se
  pueden perder estén en el SQL (con la del soft-delete del cajero fijada al `ON`, porque en
  el `WHERE` el LEFT JOIN degenera a INNER). **La agregación real se prueba en el e2e**, que
  corre contra la base de verdad. Escribir el plan pidiéndole al unit lo que solo el e2e
  puede dar fue un error de redacción, no de implementación.
  ⚠️ **Mutante obligatorio por cada aserción nueva**: no alcanza con romper la línea — hay que
  **revertirla al código anterior** y ver el test fallar. Y si el test afirma sobre el SQL,
  acotar el mutante a la cláusula, que un `toContain` puede estar matcheando el comentario.

## Frontend

- [x] **5. Página `/cajas/tendencia`** con `permiso: 'Cajas:Leer'` en `definePageMeta`,
  enlazada desde `/cajas` como ya se enlaza `/cajas/historial`.
  - Filtros `desde`/`hasta` con `AppDateInput` (ver `mermas.vue`), default 30 días.
  - Tabla ordenada por `efectivoSuma` ascendente: el faltante más grande arriba.
  - Columnas separadas para **efectivo** y **otros medios** — nunca sumados en una sola cifra
    (el porqué, en la spec: mostrar solo efectivo ya fue un bug acá).
  - Colores financieros verde/rojo siguiendo `CajaHistorial.vue` (excepción documentada del
    módulo Caja al design system). **Ningún Tailwind hardcodeado fuera de eso.**
  - Cada fila navega a `/cajas/historial?usuarioId=<id>`, que **ya funciona sin tocar nada**.
  - Estado vacío para "ninguna caja cerrada en la ventana".
- [x] **6. Store + test.** El fetch va por `useApiFetch` (nunca axios), en el store de caja
  existente. Test de componente en la línea de los que ya hay en `components/caja/`.

## Verification

- [x] **7. Gate completo, ejecutado y en verde** — no un subconjunto:
  ```
  cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
  cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
  ```
  `./scripts/reset-db.sh` **antes** del e2e y `--verificar` después. Y ojo con el exit code:
  un `| tail` descarta el status y el verde reportado es falso.
- [x] **8. e2e del endpoint**: que un usuario con `Cajas:Leer` lo lea, que uno con solo
  `MiCaja` reciba 403, y que un cierre de otro tenant no aparezca.
  ⚠️ **No usar a Ana del seed** si hace falta un garzón; y ojo con el stock acumulativo en
  corridas locales repetidas.
- [x] **9. Revisión independiente** (`domain-reviewer`, paso 7 de `verify-feature`) sobre el
  diff staged. El pre-commit la exige porque el diff toca un `.service.ts` y `.vue` de páginas.
  **Nunca `--no-verify`.**
- [x] **10. Smoke en el navegador** con el stack real: build y typecheck no ven bugs de
  runtime (auto-imports de Nuxt, drift de duplicados). Resetear la BD **antes**, no después.

## Documentación (mismo commit)

- [x] **11.** Sección nueva en [`features/gestion-cajas.md`](../../features/gestion-cajas.md),
  con la atribución al dueño del turno explicada y el link a la spec.
- [x] **12.** Fila en [`ESTADO.md`](../../ESTADO.md); anotar en la entrada del **umbral** que
  ya hay datos para elegir el número.
  ⚠️ **La entrada NO se mudó a `resueltos.md`, y es correcto que no.** El plan lo daba por
  hecho, pero esta feature construye la **mitad** de esa entrada: la tendencia deja *ver* el
  sesgo, y lo que la entrada pide —que la justificación del descuadre **la revise alguien**—
  sigue abierto. La entrada quedó en `pendientes.md` con la mitad construida marcada.

## Lo que la revisión independiente encontró (2026-08-22)

Bloqueó, con razón, y por algo que el gate propio también marcó: **el e2e nuevo fallaba 9/9**
porque el helper de login se copió a medias — sin reenviar la cookie de refresh que
`switch-tenant` exige, y afirmando 201 donde la ruta responde 200. El archivo *parecía*
cobertura y no lo era: ni el 403 del cajero ni la precedencia de la ruta se estaban
ejecutando.

Y cinco hallazgos no bloqueantes que igual se corrigieron, porque los cinco eran reales:

- Los colores financieros estaban en `pages/`, fuera del alcance de la excepción del design
  system → la tabla se extrajo a `components/caja/CajaTendencia.vue`.
- `toContain('u.eliminado_el IS NULL')` pasaba **igual** con el predicado movido del `ON` al
  `WHERE` — que es justo la mutación que hace desaparecer al cajero borrado. La aserción
  ahora fija la cláusula entera, y el mutante lo confirma.
- El `COALESCE` de la ventana no tenía **ninguna** cobertura. Ahora sí, con mutante.
- Los tres conteos son de la línea de efectivo y el rótulo no lo decía: una caja con el
  efectivo exacto y −500 en tarjeta figuraba como *"Cuadrados"* a secas.
- `gte(0)` pintaba el cero de verde y con `+`. Son tres estados, no dos.

Además dejó anotado en la doc de la feature un límite del control que **no** es de este
diff: el cajero ya puede sumar sus propios cierres desde su historial, así que ocultarle el
acumulado es **fricción, no una barrera de datos**.

**Y hubo una tercera pasada**, porque corregir los hallazgos de la segunda invalidó el recibo
del hook — que es exactamente para lo que existe. Volvió a bloquear, y encontró algo que las
dos anteriores no habían visto: **una carrera entre cargas**. Son dos `AppDateInput` y un
`watch` sobre los dos, así que mover `desde` y después `hasta` deja dos GET en vuelo y gana
el que responde último, no el que se disparó último. El agravante lo reprodujo: una respuesta
vieja que llega tarde repuebla la tabla y **borra el cartel de error** —el `#empty` deja de
renderizarse porque la lista ya no está vacía—, o sea que **anulaba justo la protección que
la segunda pasada había pedido agregar**, y encima mostraba los agregados de otro rango como
si fueran los pedidos.

El proyecto ya tenía el patrón, con cuatro call sites y un comentario que describe este bug
palabra por palabra (`usePaginatedList.ts` → `fetchEnCurso`, `categorias.vue` →
`cargaEnCurso`). `CajaTendencia` se escribió a mano y se saltó esa parte; `CajaHistorial` no
la tiene porque delega en `usePaginatedList`. Ahora hay cola serial.

Con eso: el toast pasó a `apiErrorMsg` (se perdía el mensaje del backend), y el mapper
normaliza a escala 4 como su vecino en vez de devolver el texto crudo de Postgres.

**Y una cuarta pasada, que encontró que el test de esa corrección mentía.** Estaba escrito
como *"una respuesta vieja que llega tarde no pisa a la nueva"* y resolvía dos promesas en
orden inverso — pero **con la cola puesta nunca hay dos promesas en vuelo**, así que la
segunda resolución caía sobre un resolver ya settleado y la aserción *"no muestra LA VIEJA"*
no podía fallar bajo ninguna implementación. Cazaba el mutante, sí, pero por una razón
distinta de la que declaraba. Reescrito sobre la propiedad que la cola **sí** garantiza: que
no se dispare una carga con la anterior en vuelo.

De la misma pasada salieron otras dos: la limpieza del mock vivía al final de un `it`, así
que un fallo la filtraba al test siguiente —con el mutante fallaban **dos** tests y el
segundo por contaminación, con un mensaje sin relación con su causa; ahora falla uno—; y el
estado vacío de la tabla decía *"Ninguna caja con el conteo cerrado en este rango"* **mientras
el GET estaba en vuelo**, que es la misma lectura invertida que el `catch` previene, corrida
a la ventana de carga.

## Decisions / Open questions

**Decidido (owner, 2026-08-22):** solo el supervisor; solo muestra.

**Decidido (diseño, ver spec):** la señal es el sesgo y no la magnitud; efectivo y otros
medios separados; ventana por rango de fechas; vive en el módulo `caja` y no en un módulo
`reportes` nuevo; `diferencia IS NOT NULL` en vez de enumerar estados.

**Abierto — no bloquea empezar, sí conviene contestar antes de la tarea 5:**

1. **¿Ventana por defecto de 30 días?** Es un cambio de una línea si preferís otra.
2. **¿Promedio con signo?** Queda afuera de v1 porque es una división de dinero y arrastra la
   cuantización por moneda. Se agrega después sin romper el contrato.
3. **¿Separar por cajón?** Hoy un cajero que rota se agrega en una sola fila.
