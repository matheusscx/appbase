# Plan: el descuento global baja la base del IVA

**Status:** Draft
**Date:** 2026-08-21
**Owner:** Cesar Matheus

## Context

Un descuento de nivel venta baja lo cobrado pero no `totalImpuestos`, así que la boleta
declara más IVA del que corresponde. Entrada 🔴 de [`pendientes.md`](../../agent/pendientes.md);
decisión **(f)** de [redondeo de plata](../specs/2026-08-20-redondeo-de-plata-decisiones.md)
documentó el defecto y dejó el criterio sin decidir.

Lo que decide este plan ya está congelado en dos documentos y **no se re-discute acá**:

- [Investigación del DTE (2026-08-21)](../../agent/investigaciones/2026-08-21-descuento-global-vs-base-del-iva.md)
  — la norma, el mercado y el cruce contra el código.
- [Decisiones del owner (2026-08-21)](../specs/2026-08-21-descuento-global-vs-iva-decisiones.md)
  — las seis decisiones (a)–(f). **La columna "qué obliga" de cada una es el contrato de este plan.**

⛔ Esto es **motor de precios e impuestos**: va solo, con el sistema quieto. Si algo no cierra
con lo que se ve en el código, **se para y se pregunta** — en el frente anterior, cada vez que
un implementador paró, el registro estaba mal y el código bien.

## Scope / Out of scope

**In scope:** `calculo-precios.engine.ts`, `calculo-precios.service.ts`, sus tests, la red de
regresión e2e y la documentación viva.

**Out of scope, explícito:**
- **Frontend.** Ninguna pantalla manda `descuentosVentaIds` (medido 2026-08-21: cero
  productores en `frontend/app`). **No construir la pantalla** — decisión (f).
- **El campo `nivel` de la regla** (línea vs venta), decidido el 2026-08-15, con entrada propia
  en el backlog. Este plan no lo introduce ni lo asume.
- **Emisión del DTE.** Se diseña compatible, no se integra (ADR-010).
- La nota de crédito, la denominación mínima de efectivo y los `@IsNumberString` sin trazar:
  entradas separadas del mismo backlog.

---

# Paso 0 — el motor recibe el estado fiscal de la línea

> Se entrega, se verifica y **se commitea antes de empezar el Paso 1**. Decisión (f): mezclarlos
> sería otra vez dos cambios del motor en una pasada, que es lo que obligó a revertir el
> arreglo anterior del redondeo.

Resultó **más chico de lo que la entrada del backlog sugería**: `resolverLinea`
(`calculo-precios.service.ts:350`) **ya lee** `item.clasificacionTributaria` para derivar el
IVA. El dato está; simplemente no viaja al motor. No hace falta columna nueva ni tocar el
esquema.

## Backend

- [ ] `LineaResuelta` recibe el estado fiscal de la línea, **requerido, no opcional**. Seguir
      el patrón que ya está escrito en los docblocks de `ReglaResuelta.activo` e
      `ImpuestoResuelto.tipo`: *"requerido a propósito: si fuera opcional, olvidarse de
      mapearlo en el service haría que … en silencio"*. Mismo razonamiento, mismo texto de
      justificación.
- [ ] Mapearlo en `resolverLinea` **desde la misma fuente que ya usa ADR-018**, con la
      condición **positiva** (`=== 'afecto'`). ⚠️ No reintroducir un `!==`: el ADR explica que
      con la columna nullable un `!==` deja pasar el `NULL` de un `tipo='ingrediente'` y le
      cobra IVA.
- [ ] Verificar que el nuevo campo **no cambia ningún resultado**: es contrato, no lógica.
      Ningún valor esperado de los tests existentes debe moverse. Si alguno se mueve, **parar**.
- [ ] Test que fija el contrato + **mutante que revierte**: quitar el mapeo en el service (no
      solo romper la línea nueva) tiene que hacer fallar ese test. Un mutante que solo rompe
      prueba que el test toca la línea; solo revertir prueba que habría cazado el bug.

## Verification (Paso 0)

- [ ] `cd backend && npm run lint:check && npm run typecheck && npm test` — leer el **exit
      code**, no la última línea.
- [ ] `./scripts/reset-db.sh` y después **`npm run test:e2e` COMPLETO**. No es opcional aunque
      no se toquen DTOs: cambia el contrato de entrada del motor, y el arreglo anterior enseñó
      que un cambio "solo de tipos" puede romper el arranque de TypeORM sin que lo vean
      typecheck, lint, los unit ni dos revisiones independientes.
- [ ] `./scripts/reset-db.sh --verificar`.
- [ ] Revisión independiente (`domain-reviewer`) sobre el diff staged; si LIMPIO, escribir el
      recibo. **Nunca `--no-verify`.**
- [ ] Commit. **El Paso 1 no arranca hasta que esto esté en verde.**

---

# Paso 1 — el prorrateo

> No fijar el código de estas tareas antes de la 1: el spike decide la forma. Lo que va acá es
> **intención y contrato**, y las evidencias se citan, no se parafrasean.

## Backend

- [ ] **1. Spike medido — dónde encaja el prorrateo.** Tres cruces que el diseño no puede
      suponer, y cada respuesta va con **el número medido**, no con prosa:
      - `nivelRedondeo` `'linea'` vs `'documento'`: ¿el prorrateo cuantiza al repartir, o
        reparte fino y cuantiza al cerrar? El motor ya tiene el invariante *"el total se
        DERIVA de sus componentes ya cuantizados, no se cuantiza aparte"*, medido con neto
        3.000 / recargo 0,1 / impuesto 0,4. El prorrateo tiene que respetarlo.
      - El tope `disponibleVenta`: hoy topea contra la suma de `totalLinea`. Con el descuento
        bajando a las líneas, ¿sigue siendo el tope correcto? (El comentario dice que
        confundir las dos plata *"dejaba ventas en negativo sin advertencia"*.)
      - `cierraAGondola`: confirmar con números que apagarlo por descuento global da el mismo
        resultado que derivar por resta desde la góndola descontada. **Ya verificado para `%`
        (894 / 751 / 143); falta el caso de monto fijo**, que es donde (a) muerde.
      - **Salida del spike:** las tres respuestas escritas, con sus números. Si alguna
        contradice una decisión de la spec → **parar y preguntar.**
- [ ] **2. El descuento global se prorratea por peso a las líneas** y el impuesto se recalcula
      por línea sobre la base nueva — decisión (b). No agregar un paso `impuestos` a nivel
      documento: no existe una tasa única para el neto agregado cuando las líneas llevan IVA
      y `'otro'`.
- [ ] **3. El residuo va al resto más grande, desempate por `id`** — decisión (d). Mismo
      criterio que `elegirAbsorbente`, y por la misma razón escrita ahí (que el resultado no
      dependa del orden en que la query devolvió las líneas). Test con el caso exacto:
      `$10.000` entre tres líneas iguales en CLP → `3.333 + 3.333 + 3.334`.
- [ ] **4. Prorrata entre base afecta y exenta** — decisión (c). Usa el estado fiscal del Paso
      0. Test con el caso medido de la spec (`$80.000` afecto + `$20.000` exento, `$10.000` de
      descuento → IVA 13.680) y con los dos degenerados (todo afecto / todo exento).
- [ ] **5. Un descuento de monto fijo se resta de lo cobrado** — decisión (a). ⚠️ Con `%` no
      cambia nada (verificado); el test que prueba esta decisión tiene que ser **de monto
      fijo**, o no prueba nada.
- [ ] **6. Corregir el comentario de `calculo-precios.engine.ts:918-919`**, que afirma que la
      ausencia del paso a nivel venta es deliberada. **En el mismo commit que el arreglo**, o
      el próximo agente lo lee y desarregla.

## Verification (Paso 1)

- [ ] **Red de regresión que hoy no existe:** un e2e que lea `ventas.total_impuestos` **de la
      base** después de una venta con descuento global. Ningún e2e lee hoy los totales
      persistidos — es una entrada propia del backlog y este frente es el que la necesita.
      ⚠️ Si el test necesita SQL directo para montar el escenario, sospechar que el caso real
      quedó sin cubrir.
- [ ] Cada arreglo de conducta con su **mutante que revierte al código anterior**.
- [ ] Gate completo backend + `reset-db.sh` + **e2e COMPLETO** + `--verificar`. Exit codes.
- [ ] Frontend: `npm run build && npm test && npm run typecheck:ratchet && npm run design:check`
      — no se toca frontend, pero el gate va entero.
- [ ] Revisión independiente sobre el diff, recibo, commit.

## Documentación (mismo commit que el código)

- [ ] `docs/features/impuestos.md` — decisión (e), y **separada visiblemente** de la
      consecuencia elegida del desbruteo, que vive en el mismo archivo y se le parece.
- [ ] `docs/features/motor-calculo-precios.md` — el prorrateo y el criterio del residuo.
- [ ] `docs/features/ventas.md` — qué significa ahora un descuento de nivel venta.
- [ ] `docs/agent/pendientes.md` → mover la entrada 🔴 a `resueltos.md` con el detalle.
- [ ] Revisar si corresponde entrada en `docs/agent/anti-patterns.md`. ⚠️ Ese archivo tiene 22
      entradas contra su propio tope de 20: si se agrega una, se poda.
- [ ] `docs/ESTADO.md` si cambia el estado de alguna funcionalidad.

## Decisions / Open questions

**Cerradas** — las seis de [la spec](../specs/2026-08-21-descuento-global-vs-iva-decisiones.md).
No se re-abren durante la ejecución; si alguna no cierra con el código, se para y se pregunta.

**Abiertas, y que este plan NO resuelve:**

- [ ] Si el SII **rechaza** u **observa** un DTE donde `IVA ≠ tasa × MntNeto`: las fuentes
      secundarias se contradicen y no se verificó contra fuente primaria. **No cambia el
      diseño** —la fórmula es la fórmula— pero no se debe afirmar en ninguna dirección.
- [ ] El cruce **tax-inclusive + descuento de orden** no se relevó lo bastante para una entrada
      en `DIFERENCIADORES.md` (regla 2 de ese archivo: se cita, no se afirma).
