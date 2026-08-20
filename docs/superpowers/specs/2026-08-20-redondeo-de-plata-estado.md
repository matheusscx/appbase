# Redondeo de plata — estado del código antes de diseñar

**Fecha:** 2026-08-20
**Estado:** 📋 Relevamiento cerrado — **no es diseño y no toca código.** Alimenta la spec.
**Entrada del backlog:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) → §🔴 →
*"Cuatro redondeos de plata más que siguen en HALF_UP fijo"*, único frente abierto de la
tanda 🔴 desde que rendimiento se cerró.
**Investigación financiera que lo precede:**
[`2026-08-15-decimales-y-redondeo.md`](../../agent/investigaciones/2026-08-15-decimales-y-redondeo.md)
— norma, práctica de mercado y las preguntas abiertas. **Este documento no la repite**: mira
el código y mide.

> ⚠️ **Para qué existe.** La entrada del backlog es un punto de partida, no un enunciado
> verificado — y ésta en particular subcuenta. Todo lo de acá está medido el 2026-08-20
> contra el código en `ccd08aef` y contra la base de dev. Cada afirmación trae cómo
> reproducirla (§7): si envejece, que se note.

> ⛔ **AUDITADO Y CORREGIDO el 2026-08-20 por
> [`…-lectura-independiente.md`](2026-08-20-redondeo-de-plata-lectura-independiente.md).**
> Este documento se sostuvo en casi todo —el cast de Postgres, los dos totales en CLP-0,
> `ESCALA_PERSISTIDA`, los defaults, los espejos del frontend y las once líneas de la tabla
> reprodujeron exactas— y **perdió en tres puntos**, marcados abajo donde aparecen:
> 1. **"113 apariciones en 17 archivos"** no reproduce: son **106 líneas / 108 ocurrencias**,
>    los mismos 17 archivos.
> 2. **"se activa con un `PATCH`"**: es un **`PUT`**.
> 3. **"19 sitios matchean; 11 son plata"**: con el grep ampliado son **128 hits en 20
>    archivos**, y por la conducta que este mismo documento declara los sitios de plata son
>    **≥13** — faltaban los gemelos de escritura `items.service.ts:3508` y `:3580`. El patrón
>    "cuatro→once" del backlog se repitió en chico, ahora conmigo.
>
> **Dónde manda cuál:** para el estado del código manda la lectura independiente; para qué se
> decidió manda [`…-decisiones.md`](2026-08-20-redondeo-de-plata-decisiones.md). Este queda
> como el relevamiento original, con sus correcciones a la vista.

---

## 1. Las tres capas, y cuál obedece al tenant

| Capa | Quién redondea | ¿Respeta `modo_redondeo`? |
|---|---|---|
| El motor de precios | `redondear()` — `calculo-precios.engine.ts:221`, con 3 usos (`:453` regla, `:520` subtotal de línea, `:581` impuesto) | **Sí**, y con `escala_calculo` |
| La conversión a moneda oficial | `calculo-precios.service.ts:403` | **Sí** — se arregló el 2026-08-11 |
| La persistencia de la venta | **Postgres, en el `INSERT`** | **No** |
| Los cálculos de costo, merma y propina | `toFixed(4)` / `ROUND_HALF_UP` escritos a mano | **No** |

La tercera fila es el hallazgo incómodo: el motor formatea con `escala_calculo` —6 por
default— y esos strings entran a columnas `NUMERIC(18,4)`. **El último redondeo del importe
que se guarda lo decide Postgres.** Medido:

```
SELECT '10.00005'::numeric(18,4), '-10.00005'::numeric(18,4), '10.00004'::numeric(18,4);
   10.0001   |   -10.0001   |   10.0000
```

Media hacia afuera del cero, siempre, sin mirar la configuración del tenant. Alcanza a
`venta_detalles.subtotal`, `.descuento_aplicado`, `.total_linea`; a los cinco totales de
`ventas`; y a `valor_aplicado` de `ventas_descuentos`, `ventas_recargos` y `ventas_impuestos`
(todas `NUMERIC(18,4)`, verificadas en `startup-pos.sql`).

**Eso ya está decidido en contra**, y no por omisión:
[`motor-calculo-precios.md:228-240`](../../features/motor-calculo-precios.md) fija el criterio
al explicar por qué la conversión usa 4 decimales fijos y no `escala_calculo` — *"subirlo no
evitaría el recorte, lo movería al `INSERT` —Postgres, su propia regla, fuera de la config y
sin test—"*. Los importes de línea y cabecera hacen exactamente eso. No hay que decidir el
criterio: hay que aplicarlo donde no está.

---

## 2. El inventario de sitios: son once, no cuatro ni cinco

Barrido **por conducta** —toda multiplicación o división de plata seguida de un redondeo—,
no por la lista de la entrada. 19 sitios matchean; 11 son plata.
⛔ **Corregido:** son **≥13** — faltan los gemelos de escritura `items.service.ts:3508` y
`:3580`, y el grep ampliado (`Math.*`, `.round(`, `.floor(`, `.ceil(`, `.trunc(`) da 128 hits
en 20 archivos. Ver §2.2 de la lectura independiente.

| # | Sitio | Qué redondea | Destino | En la entrada |
|---|---|---|---|---|
| 1 | `inventario.service.ts:410` | CPP: `(valorPrevio + valorEntrante) ÷ stock` | **persiste** en `item_producto.costo_actual` | sí |
| 2 | `inventario.service.ts:914` | `cantidad × costo_unitario` del kardex | proyección de lectura | sí (citada como `:818-821`, la línea se corrió) |
| 3 | `items.service.ts:3879` | costo propuesto de una **receta** | propuesta; persiste si se aplica | sí |
| 4 | `items.service.ts:4017` | costo propuesto de un **combo** | ídem | **no** — gemelo exacto del anterior |
| 5 | `items.service.ts:3697` | precio sugerido que preserva margen | propuesta al usuario | **no** |
| 6 | `mermas.service.ts:200` | costo perdido al registrar la merma | proyección de la respuesta | sí |
| 7 | `mermas.service.ts:343` | el mismo cálculo, en el listado | proyección de lectura | sí |
| 8 | `mayores-restos.ts:44` | monto → unidades mínimas enteras | reparto de propina | sí (como un sitio) |
| 9 | `mayores-restos.ts:75` | unidades → vuelta a decimales | ídem | **no** — son dos |
| 10 | `costo-conversion-unidad.util.ts:28` | `cantidad × costoUnitario ÷ cantidadBase` | **persiste**: alimenta `costo_unitario` de ajustes, compras y mermas | **no** |
| 11 | `ventas.service.ts:1010` | `precioUnitario × cantidad` de una línea de **nota de crédito** | **persiste** en `venta_detalles.total_linea` | **no** |

Los once usan HALF_UP: explícito (`ROUND_HALF_UP`) o implícito (`toFixed`, cuyo default es
HALF_UP). Ninguno mira `modo_redondeo`.

⚠️ **Esta tabla localiza, no juzga.** Decisión del owner (2026-08-20): **ninguno de los once
se da por bueno ni por malo de entrada**. Cada uno pide su propio análisis de contexto —qué
representa el número, quién lo consume, si es tasa o monto, si se persiste o se proyecta— y
termina en un **veredicto explícito**, incluido *"queda como está"*.

**Y el veredicto se escribe en el código, no solo acá.** Cada sitio queda con un comentario
que diga por qué redondea como redondea. Hoy los once están mudos, y ese silencio es
exactamente lo que hizo falta reconstruir midiendo: sin la nota, dentro de seis meses cada
`toFixed(4)` vuelve a ser sospechoso y alguien lo analiza otra vez desde cero.

📌 **Contexto del owner que reencuadra la tabla entera:** los once no son once decisiones
tomadas. Quedaron en HALF_UP porque **el motor de cálculo no llegaba hasta ahí** — están
fuera de su alcance, no en desacuerdo con él. No hay que buscar la razón por la que se eligió
HALF_UP en cada uno: probablemente no hubo elección.

**Quedan fuera a propósito, aunque el grep los trae** — no son plata, y meterlos en el
barrido sería el error contrario: conversión de cantidades (`cantidad-presentacion.util.ts`
`:165` y `:247`, `catalog.service.ts:177`), horas (`horas-interseccion.ts:16`), el margen en
porcentaje (`items.service.ts:3680`) y un `toFixed(2)` que solo arma un mensaje de error
(`propina-distribucion.service.ts:269`).

**Y la escala 4 escrita a mano:** ~~113 apariciones~~ **106 líneas / 108 ocurrencias** en 17 archivos (`toFixed(4)`,
`toDecimalPlaces(4`). `ESCALA_PERSISTIDA` existe, tiene 3 usos y los tres viven en
`calculo-precios.service.ts`. La investigación del 2026-08-15 midió 97 en 17 archivos: el
número creció, la forma no.

---

## 3. Lo que nadie decidió: la escala de la moneda no entra al cálculo

`moneda.decimales` existe y CLP está sembrada con **0**. Se usa en **un solo módulo**:
propinas (`liquidacion-propinas.service.ts`, que además **congela** `decimales_moneda` en la
liquidación). El motor, ventas, pagos y caja **nunca lo consultan** — medido con un grep del
backend entero.

La consecuencia está en la base de dev ahora mismo, después de una suite e2e completa:

```
 total_final | codigo_iso | decimales
 16957.5000  | CLP        |     0
  5057.5000  | CLP        |     0
```

Medio peso chileno persistido y cobrable en una moneda que el propio sistema declara sin
decimales. No es un caso de laboratorio: sale del camino normal de la venta.

👉 El patrón completo —unidades mínimas enteras, reparto por mayores restos, decimales
congelados en el documento— **ya existe en este repo, en propinas**. La decisión no es
inventarlo.

---

## 4. Activo hoy vs. latente

**Latente:** `modo_redondeo` es `HALF_UP` por default en la entidad
(`tenant.entity.ts:39`), en el seeder (`:1116`) y al crear un tenant
(`tenants.service.ts:203`). Mientras ningún tenant lo cambie, los once sitios y el recorte de
Postgres **coinciden** con lo que el tenant eligió: hoy ninguno produce un número distinto
del esperado. Pero el DTO ya acepta `HALF_UP | HALF_EVEN | FLOOR | CEIL`
(`update-preferencias-financieras.dto.ts:30`), así que se activa con un `PUT` (~~`PATCH`~~,
corregido: `tenants.controller.ts:296`).

**Activo:** la escala de la moneda (§3). Esa produce importes mal formados hoy, con todos los
tenants en el default.

**Y una divergencia latente que vale nombrar aparte:**
[`useMonedaConversion.ts:23`](../../../frontend/app/composables/useMonedaConversion.ts) dice
*"Misma lógica que el backend"* y quedó en `toFixed(4)` cuando el backend pasó a
`modo_redondeo` el 2026-08-11. Es exactamente la divergencia mostrado-vs-guardado que aquel
arreglo cerró, reabierta del otro lado del espejo. Con un tenant en `FLOOR`, el POS muestra un
precio y la venta guarda otro.

Su gemelo `useUnidadConversion.ts:32` espeja `costo-conversion-unidad.util.ts` (sitio 10),
así que cualquier criterio nuevo se aplica **en los dos lados**: no hay workspace compartido
entre backend y frontend en este repo.

---

## 5. Lo que el owner ya contestó → se mudó

⛔ **Las decisiones NO viven acá.** Están, las once, en
[`2026-08-20-redondeo-de-plata-decisiones.md`](2026-08-20-redondeo-de-plata-decisiones.md),
cada una con su *qué se decidió · por qué · qué obliga*. Este documento tenía dos de ellas
anotadas al vuelo y mantenerlas en dos lugares es cómo se desincronizan.

## 6. Lo que falta contestar antes de escribir la spec

En orden de cuánto bloquea:

1. **¿Por línea o por total?** El motor arma `totalFinal` como la **suma de los `totalLinea`**
   y después aplica las reglas de nivel venta (`calculo-precios.engine.ts:652`). Redondear a
   la escala de la moneda obliga a elegir dónde cae el error: si redondea cada línea, la
   boleta cuadra línea por línea pero el total se aleja del cálculo exacto; si redondea solo
   el total, Σ líneas ≠ total y el desglose de IVA no cuadra con lo cobrado; si redondea las
   líneas y reparte la diferencia por mayores restos, cuadran las dos cosas y una línea puede
   mostrar una unidad más que su propia cuenta. **No hay respuesta universal**: el TJUE lo
   declaró discreción nacional y UK y México legislaron al revés uno del otro (§6 de la
   investigación). ⛔ **Corregido el mismo día:** Chile **no** exige enteros en cada campo — el
   precio unitario y la cantidad admiten 6 decimales explícitos; que los totales vayan enteros
   es inferencia desde el silencio del formato. Ver
   [`2026-08-20-redondeo-por-linea-o-por-total.md`](../../agent/investigaciones/2026-08-20-redondeo-por-linea-o-por-total.md).
2. **¿Los costos siguen el mismo criterio que los precios?** Un CPP o un costo por unidad base
   llevado a la escala de CLP sería 0 o 1 peso por gramo. La investigación trae respaldo para
   tratarlos distinto (Zuora no redondea el precio unitario; el combustible se cotiza en
   milésimas): *el precio unitario es una tasa, no un monto*. Si eso vale, los sitios 1, 3, 4,
   5 y 10 **no** se tocan y la entrada del backlog se achica sola.
3. **Propinas, ¿excepción explícita?** Mayores restos garantiza que la suma de las partes dé
   el total. Aplicarle `modo_redondeo` puede romper esa propiedad, que es justamente lo que el
   método compra.
4. **El redondeo de efectivo es otra cosa** y la investigación lo marca como norma en tres
   jurisdicciones: no toca el impuesto ni el documento, es una diferencia de caja aparte. Hay
   que decidir si entra en este alcance o va después.

**Lo que NO hay que preguntar:** qué hacer con lo ya persistido. El proyecto no tiene datos
productivos — se cambia el esquema, se actualiza el seeder y se resetea.

---

## 7. Cómo reproducir cada medición

```bash
# Los sitios que redondean plata (multiplicación o división antes del redondeo)
grep -rn "toFixed(\|toDecimalPlaces(\|ROUND_" --include="*.ts" backend/src | grep -v "\.spec\."

# Quién mira la escala de la moneda
grep -rn "decimales" --include="*.ts" backend/src | grep -v "\.spec\.\|escalaCalculo"

# Cómo redondea Postgres al persistir
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT '10.00005'::numeric(18,4), '-10.00005'::numeric(18,4);"

# Totales con decimales que su moneda no tiene
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT v.total_final, mo.codigo_iso, mo.decimales FROM ventas v
     JOIN moneda mo ON mo.moneda_id = v.moneda_id
    WHERE v.total_final <> round(v.total_final) AND v.eliminado_el IS NULL;"
```

La última necesita tráfico en la base: con la base recién sembrada da vacío. Los números de
§3 salieron de correr `npm run test:e2e` completo antes de consultar.
