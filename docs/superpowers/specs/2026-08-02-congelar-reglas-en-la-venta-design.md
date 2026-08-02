# Diseño: congelar las reglas aplicadas en la venta

**Status**: Diseño — pendiente de cerrar 2 preguntas abiertas antes de promover a plan
**Owner**: Cesar Matheus
**Last Updated**: 2026-08-02

> **Objetivo del owner (2026-08-02):** poder decir *"este descuento era 10% cuando se hizo
> la venta, aunque hoy sea 20%"*, y lo mismo para recargos e impuestos. No es un dato de
> operación diaria: es **auditoría**, con la idea de una vista especial de auditoría de
> ventas más adelante.

---

## Punto de partida

Salió de la pregunta del backlog *"el recorte de un descuento no queda auditado en ninguna
parte"* (auditoría `items` + `calculo-precios`, 2026-07-28). Al medir el código apareció que
el hueco era más ancho que el recorte: **la venta no congela la regla, solo su resultado.**

Dos propuestas anteriores se descartaron **antes de escribir código**, y conviene que quede
por qué:

1. **Dos columnas (`detalle_id` + `valor_solicitado`)** — no cubría el objetivo del owner:
   guarda dónde y cuánto, no *cuánto valía la regla*.
2. **Snapshot JSON** — decidido y luego revertido al medir que el enfoque de columnas ya
   existe en el repo, a medias y con consumidor (ver "Por qué columnas").

---

## Qué se congela hoy y qué no

Medido sobre `ventas.service.ts:426-486` (persistencia) y el esquema de las tres tablas.

| Dato | Descuentos | Recargos | Impuestos |
|---|---|---|---|
| Qué regla fue (`*_id`) | ✅ | ✅ | ✅ |
| Cuánto aportó (`valor_aplicado`) | ✅ | ✅ | ✅ |
| **En qué línea** | ❌ | ❌ | ❌ |
| **Cuánto valía la regla** | ❌ `null` | ❌ `null` | ✅ `traza.tasa` |
| **Modo (% vs monto fijo)** | ❌ | ❌ | n/a (siempre %) |
| **Nombre al momento** | ❌ | ❌ | ❌ |
| Lo que pedía antes del tope | ❌ | n/a | n/a |

Dos hechos que explican la tabla:

- **`porcentaje_aplicado` ya existe en las tres tablas**, pero solo los impuestos la pueblan
  (`ventas.service.ts:459`). Descuentos y recargos escriben `null` explícito (`:435`, `:447`,
  `:474`, `:486`).
- **Ninguna de las tres tiene `detalle_id`.** El bucle recorre líneas
  (`ventas.service.ts:426`) pero al guardar solo escribe `ventaId`. Confirmado en
  `venta-descuento.entity.ts`. Si una regla aplica a tres líneas quedan tres filas
  **idénticas salvo la PK** cuando los montos coinciden.

O sea: **los impuestos ya cumplen el objetivo del owner; descuentos y recargos no.**

## Por qué no se puede derivar después

No alcanza con leer la regla hoy ni con dividir monto ÷ base:

1. **Las reglas son editables y borrables.** La venta congela el hecho; la regla no. Editar
   la regla reescribe el pasado de todas las ventas que la usaron.
2. **Sin `modo`, el número es ambiguo.** Un `valor_aplicado` de 150 puede ser "10% de 1.500"
   o "$150 fijos".
3. **Las reglas por tramos no tienen un valor único.** `ReglaResuelta.valor` es `null` cuando
   usa `tramos` (`calculo-precios.engine.ts:27-29`); el valor efectivo lo elige
   `seleccionarTramo()` según la cantidad o el monto **de esa venta**, y se descarta. Leer la
   regla hoy no dice qué tramo aplicó entonces.
4. **La base no está guardada.** Depende de `calculoDescuentos`/`calculoRecargos`
   (`base` vs `compuesto`) y del acumulado en ese paso; `venta_detalles` guarda `subtotal`,
   no los intermedios.
5. **El redondeo pierde información** (`redondear()` por paso) — la división no vuelve al
   valor original.

El motor **sí** lleva el `nombre` en `TrazaRegla` (`:70-74`), pero la persistencia lo descarta.

## Encuadre: esto es ADR-010 generalizado

[ADR-010](../../adr/) fija "congelar el hecho fiscal en la transacción, diferir lo que solo
transmite o formatea". Los impuestos lo cumplen. Descuentos y recargos quedaron atrás por
omisión, no por decisión. Esta spec extiende el mismo principio a las tres familias.

⚠️ **No es un requisito del SII.** El DTE pide `DescuentoMonto` / `RecargoMonto` — el monto
aplicado, no lo que la regla quería. Esto es **auditabilidad interna**: poder responder por
qué una venta dio el total que dio. Vale tenerlo claro porque define la prioridad.

---

## Por qué columnas y no JSON

**Decidido 2026-08-02**, revirtiendo la decisión de JSON del mismo día. Lo que la cambió fue
un hecho medido, no una preferencia: **el enfoque de columnas ya está implementado a medias
en este repo, y ya tiene consumidor.**

- `porcentaje_aplicado` existe en las tres tablas y los impuestos la pueblan.
- El detalle de la venta **ya lee las tres tablas con esa columna y las expone**
  (`ventas.service.ts:1463-1476` → `:1625-1639`). La vista de auditoría futura lee de ahí.
- **Congelar campos mutables como columnas ya es el idioma del repo:** `venta_detalles`
  guarda `descripcion = item.nombre` y `clasificacion_tributaria` como snapshots
  (`ventas.service.ts:407,410`). Congelar la regla es ese mismo patrón, no uno nuevo.

Elegir JSON habría puesto un **segundo mecanismo** al lado del que ya funciona: impuestos
auditados por columna, descuentos por JSON — salvo mover también los impuestos, que rompe el
contrato del endpoint de detalle.

El trade completo, para que no se rediscuta sin los datos:

| | Columnas | JSON |
|---|---|---|
| Consistencia con lo que hay | Termina un patrón existente | Segundo mecanismo |
| Consultable con SQL | Sí — "ventas con descuento topeado" es un `WHERE` | Requiere operadores `jsonb` |
| Tipado/validado por la BD | Sí, admite constraints | Nada valida la forma |
| Evolución del esquema | Migración en 3 tablas por campo nuevo | Sin migrar |
| Vínculo línea↔regla | Necesita `detalle_id` | Nativo en el árbol |
| Consumidor listo | El detalle ya devuelve los tres arrays | Plomería nueva |
| Deriva en el tiempo | El esquema es la verdad | Filas viejas con forma vieja → snapshot versionado |

**Lo que decidió:** la ventaja principal del JSON es evitar migraciones, y acá las migraciones
son gratis — no hay datos productivos (decisión registrada del owner: se cambia el esquema, se
actualiza el seeder y se resetea). El JSON pagaba un costo permanente por un beneficio que hoy
vale casi cero. Y el objetivo —"esta regla valía 10%"— es un hecho **por regla**, que es la
forma de una fila.

**Dónde el JSON sí ganaría, y queda anotado:** si algún día se quiere *reproducir* el cálculo
—no leerlo, re-ejecutarlo— un blob inmutable con el árbol entero es mejor. No es lo pedido, y
se puede agregar después sin deshacer las columnas.

---

## Diseño propuesto

### Backend — motor

`TrazaRegla` (`calculo-precios.engine.ts:70-74`) gana lo que hoy se descarta:

- `modo` — `'porcentaje' | 'monto_fijo'`, viene de `ReglaResuelta.modo`.
- `valorEfectivo` — el valor con el que se evaluó. Para reglas planas es
  `ReglaResuelta.valor`; **para reglas por tramos es el valor del tramo elegido**, que hoy
  `seleccionarTramo()` usa y tira. Es el cambio menos obvio: hay que hacer que la selección
  del tramo salga de la función, no solo su resultado.
- `valorSolicitado` — solo descuentos: el `monto` **antes** de que el piso lo pise
  (`calculo-precios.engine.ts:303`). Igual a `monto` cuando no hubo tope.

`nombre` ya está en la traza; hoy simplemente no se persiste.

⛔ Toca el motor de cálculo de precios. **Ningún cambio de aritmética**: solo se propaga
información que ya existe en el punto de evaluación.

### Backend — esquema

| Tabla | Columnas nuevas | Columna a empezar a poblar |
|---|---|---|
| `ventas_descuentos` | `detalle_id`, `modo`, `nombre_regla`, `valor_solicitado` | `porcentaje_aplicado` |
| `ventas_recargos` | `detalle_id`, `modo`, `nombre_regla` | `porcentaje_aplicado` |
| `ventas_impuestos` | `detalle_id`, `nombre_regla` | — (ya poblada) |

- `detalle_id` es `uuid` **nullable**: las filas `aplicado_en = 'venta'` no pertenecen a
  ninguna línea. Con `type: 'uuid'` explícito (ADR-004).
- `valor_solicitado` solo en descuentos: son las únicas reglas que el piso topea.
- `modo` no aplica a impuestos: siempre son porcentaje.
- `porcentaje_aplicado` se puebla solo en reglas `porcentaje`; en `monto_fijo` queda `null`
  explícito, que ahí sí significa "no aplica" en vez de "no se guardó".

### Backend — config del cálculo

Una columna `config_calculo jsonb` en `ventas` con `formula`, `calculoDescuentos`,
`calculoRecargos`, `escalaCalculo` y `modoRedondeo`. **Sin esto el congelado no es
interpretable**: el mismo descuento del 10% da distinto según el orden de la fórmula y el
modo base/cascada, y las dos cosas se editan desde Preferencias.

Va como `jsonb` y no como cinco columnas por una razón concreta, no por gusto: `formula` es
un **array** (`string[]`), que no entra limpio en una columna escalar. Es un objeto de
configuración que se lee entero o no se lee — nunca se consulta por partes.

### Frontend

**Nada en esta tanda.** La vista de auditoría es un tema propio y posterior; esta spec deja
el dato guardado, no la pantalla. El endpoint de detalle ya devuelve los tres arrays, así que
los campos nuevos viajan solos en cuanto se agreguen al `SELECT` de `:1463-1476`.

---

## Alcance

**Dentro:**
- Motor: propagar `modo`, `valorEfectivo` y `valorSolicitado` por la traza, incluyendo el
  tramo elegido.
- Esquema: las columnas de arriba + `config_calculo` en `ventas`.
- Persistencia: poblarlas en `crearEnTransaccion`.
- **Batchear las escrituras de `venta_detalles` y de las tres tablas de reglas** (ver
  "Consultas").
- `startup-pos.sql` y el seeder.
- Tests que ejerzan el congelado **cambiando la regla después de la venta**.

**Fuera:**
- La vista de auditoría de ventas.
- Reportes que consuman los campos nuevos.
- Notas de crédito y devoluciones.
- Los movimientos de inventario por línea (ver la sección de consultas abajo).

---

## Consultas: qué se batchea y qué no

**Regla del owner (2026-08-02): un N+1 no se difiere, se saca en el momento.** No entra al
backlog "para después".

Medido el camino completo de `crearEnTransaccion`: **no hay ningún N+1 de lectura** — ninguna
query por fila para derivar un dato. (`garzonesService.obtenerActivoPorId` en `:618` parece
uno pero no lo es: cuelga de un `if` de una sola propina, no de un bucle.) Lo que hay son
escrituras de N filas, que es otra cosa y hay que tratarlas distinto — la auditoría de
jul-2026 ya refutó dos hallazgos de "N+1" exactamente por esto.

| Sitio | Qué es | Decisión |
|---|---|---|
| `:426-486` — 3 tablas de reglas | `await manager.save()` **secuencial** por traza: N round-trips en serie | **Se batchea en esta tanda.** Es el código que la spec edita; dejar un bucle secuencial recién tocado es peor que el original |
| `:387-423` — `venta_detalles` | `Promise.all` + `save` por línea: N round-trips concurrentes | **Se batchea.** Lo tocamos igual, porque `detalle_id` necesita los ids generados de las líneas |
| Movimientos de inventario (`for (const i of ordenLocks)`) | Escrituras por línea **en orden de lock determinista**, para evitar deadlocks | **No se toca.** El orden es la defensa; batchear cambiaría la semántica de bloqueo. La auditoría ya registró que el deadlock se decide un nivel más arriba |

Forma del batch: acumular las filas en memoria y hacer **un `save` por entidad con el array
completo** (TypeORM lo emite como un `INSERT` multi-fila), en vez de un `save` por iteración.
No cambia el orden de escritura entre tablas ni la transacción.

⚠️ **Dependencia de orden:** `detalle_id` exige que las líneas estén insertadas y con id
antes de escribir las reglas. El batch de `venta_detalles` tiene que devolver las entidades
con sus ids —`manager.save(Entity, array)` lo hace— y el mapeo línea↔`detalle_id` se arma por
índice contra `resultado.lineas`, **nunca por `itemId`**: el mismo ítem puede aparecer en dos
líneas con personalizaciones distintas. Es el mismo criterio que ya usa el frontend para
cruzar advertencias.

## Preguntas abiertas

**1. ¿Aplica a las reglas a nivel venta?** — *sin respuesta del owner.*
Las filas `aplicado_en = 'venta'` tienen el mismo problema de valor, modo y nombre, aunque no
el de `detalle_id` (por eso es nullable). **Asunción de trabajo: sí, entran**; excluirlas
dejaría la auditoría a medias. Confirmar antes de ejecutar.

**2. ¿`nombre_regla` se congela también para impuestos?**
Es el único campo que le falta a los impuestos, que ya congelan la tasa. **Recomendación: sí**
— cuesta una columna y deja las tres familias parejas; sin él, un impuesto renombrado o
borrado deja la venta apuntando a algo que ya dice otra cosa.

---

## Verificación

Además del gate de `verify-feature`:

- **El test que importa**: crear una venta con una regla de 10%, **editar la regla a 20%**, y
  verificar que la venta sigue diciendo 10%. Y su gemelo con la regla **borrada**.
- Una regla **por tramos**: verificar que se guarda el valor del tramo que aplicó, no `null`
  ni el primer tramo.
- Un descuento topeado por el piso: `valor_solicitado` ≠ `valor_aplicado`, con el caso ya
  reproducido a mano el 2026-08-02 (regla fija $5.000 sobre línea de $1.500 → aplicado
  $1.500, solicitado $5.000).
- `detalle_id`: una venta con la **misma regla en dos líneas** distintas, verificando que las
  filas quedan atribuidas a líneas distintas. Es el caso que hoy produce filas
  indistinguibles.
- `modo = 'monto_fijo'` deja `porcentaje_aplicado` en `null` — que no se cuele un 0 que se
  lea como "0%".
- **Mutante**: revertir la propagación de `valorEfectivo` y confirmar que los tests caen. Si
  pasan igual, el test no está tocando la línea nueva. Ídem quitando `detalle_id` del
  `INSERT`.
- **El batch no puede cambiar el resultado**: una venta con varias líneas y varias reglas por
  línea tiene que producir exactamente las mismas filas que antes —misma cantidad, mismos
  montos, misma atribución— después de batchear. Es un cambio de rendimiento; si mueve un
  número, está mal.
