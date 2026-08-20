# Redondeo de plata — segunda ronda de decisiones del owner

**Fecha:** 2026-08-20
**Estado:** ✅ Ronda cerrada — **insumo directo de la spec.** No toca código.
**De dónde salen:** [análisis de coherencia](2026-08-20-redondeo-de-plata-analisis-coherencia.md)
§5, sobre las [once decisiones](2026-08-20-redondeo-de-plata-decisiones.md).

> Ocho preguntas que **ninguna de las once cubría** y que la spec no podía contestar sola
> por ser de negocio o de arquitectura. Mismo formato que la ronda anterior: **qué se
> decidió · por qué · qué obliga**. La tercera parte es la que la spec tiene que honrar.

---

## Resumen

| # | Pregunta | Decisión |
|---|---|---|
| P1 | ¿Qué significa `nivel = documento`? | **Solo el total se cuantiza** — y la matriz frena la combinación con CLP |
| P2 | ¿En qué capa vive el rechazo de (d)? | **Solo el borde de API**, con los clamps internos documentados |
| P3 | El 400 contra el webhook de reembolso | **Cuantizar y registrar** — no rechazar un hecho consumado |
| P4 | ¿La NC congela su propio criterio? | **Sí, congela lo que heredó** |
| P5 | Fallback si la venta original no tiene config | **Fallar ruidosamente** |
| P6 | Frontend de (d) | **Máscara: no deja tipear de más** |
| P7 | `montoTolerancia` | **Escala de la moneda** |
| P8 | Asimetría de propinas | **Ratificar y nombrarla** |

---

## P1 — `nivel = documento` cuantiza solo el total

**Decidido:** en la posición `documento`, las líneas quedan a `escala_calculo` y el único
redondeo a la escala de la moneda es el del **total**. La matriz de (c.4) declara
`documento` + moneda de 0 decimales como combinación **frenada**.

**Por qué:** es lo que "documento" significa fuera de acá —Stripe *invoice level*, Odoo
*Round Globally*, Avalara `Document`— y es literalmente la regla mexicana (SAT: sumar a
hasta 6 decimales y redondear una sola vez al total). La posición no está para Chile:
está para el día que entre un tenant en una jurisdicción que la mande. Inventarle una
semántica propia —repartir el descuadre a las líneas por mayores restos— sería resolver un
problema que ningún tenant tiene, contra el patrón del repo de no construir sin evidencia.

**Qué obliga:**
- La matriz de (c.4) **deja de ser documentación y pasa a ser validación**: alguna
  combinación tiene que ser rechazable, con su 400 y su test. Es la primera obligación de
  código que sale de esta ronda.
- Elegir `documento` en CLP reproduce a propósito el `.5000` en
  `venta_detalles.total_linea` — el bug medido que motivó el frente. Que esté frenado es
  lo que hace honesta la perilla; sin el freno, la configuración ofrece el bug como opción.
- El default (`linea`) es el que gobierna el 100% de los tenants de hoy. Toda la mecánica
  de cierre —qué son `dv`/`rv` en el documento, la obligación (c.1)— se diseña para esa
  posición.

## P2 — El rechazo de (d) vive solo en el borde de API

**Decidido:** la validación de escala va en el DTO/pipe. Los services siguen como están.

**Por qué:** el controller es la única puerta pública; el service no es un borde de
confianza distinto, y darle a `CajaService` acceso a `moneda.decimales` sería plumbing
nuevo en un módulo que hoy no lo tiene, para cubrir un camino que ningún cliente alcanza.

**Qué obliga:**
- Los dos tests que la decisión (d) **no contaba** entre sus ocho rotos
  —`caja.service.spec.ts:493` (`montoContado`) y `:2198` (`saldoInicial`), que invocan el
  service directo— **sobreviven sin tocarse**. Su conteo de ocho queda confirmado como
  exacto.
- Los clamps internos que quedan **se documentan como escala de captura**, no quedan
  mudos: `caja.service.ts:731` (contado del cierre), los cuatro de propinas manuales
  (`liquidacion-propinas.service.ts:980, :1033, :1070, :1507`), los de costo
  (`inventario.service.ts:227, :353, :403`) y los del precio al aplicar desfase
  (`items.service.ts:4292, :4344`). Misma obligación que (b) impuso a los sitios de costo:
  el silencio es lo que obligó a reconstruir todo midiendo.
- `caja.service.ts:247` es la excepción a mirar: no clampa nada, pasa `saldoInicial` crudo
  y el recorte lo hace Postgres. Con el borde validando, deja de importar — pero el
  comentario tiene que decir que la escala ya vino validada, no que ahí no pasa nada.

## P3 — El webhook de reembolso cuantiza y registra, no rechaza

**Decidido:** un monto que llega por `reembolso-callback.handler.ts:36-40` se cuantiza a
la escala de la moneda y queda traza de que venía con más decimales. El 400 de (d) aplica
al camino manual, no al callback.

**Por qué:** validar una **intención** (un cajero tipeando un monto) y registrar un
**hecho consumado** (una pasarela informando lo que ya cobró) no son la misma operación.
Rechazar el callback no deshace el cobro: pierde el evento o lo manda a un retry que va a
fallar igual. El porqué de (d) —*"el sistema nunca cambia calladamente un número que una
persona escribió"*— se sigue cumpliendo: acá no lo escribió una persona, y no va a ser
callado.

**Qué obliga:**
- El criterio de (d) deja de ser *"toda la plata que entra por API"* y pasa a ser *"toda
  la plata que una persona ingresa"*. La spec tiene que decirlo así, o el próximo lector
  va a ver el webhook como un agujero en la regla.
- La traza tiene que existir de verdad: si el monto se cuantizó, se registra el valor
  original. Un log sin el número no sirve para reconstruir nada.

## P4 — La nota de crédito congela su propio `config_calculo`

**Decidido:** la NC persiste el `config_calculo` que heredó de la venta original.

**Por qué:** es el mismo argumento que creó el congelado el 2026-08-02 —sin él el
documento no es interpretable— y una NC es un documento tributario, no un apéndice de la
venta. Con (g) la NC iba a *usar* el modo heredado sin dejar rastro de cuál usó.

**Qué obliga:**
- `crearNotaCredito` (`ventas.service.ts:988-1004`) suma el campo al `manager.create`.
- `config_calculo = NULL` **deja de ser un estado permanente del modelo**: hoy toda NC
  nace en `NULL` por construcción (comentarios en `ventas.service.ts:1738-1740` y
  `VentaDetalleDrawer.vue:112-116` lo confirman). Los dos comentarios quedan obsoletos y
  se actualizan en el mismo commit.
- El drawer pasa a mostrar el bloque "Cómo se redondeó" también en las NC
  (`VentaDetalleDrawer.vue:845`, hoy `v-if` que las deja fuera).

## P5 — Si la venta original no tiene config, se falla ruidosamente

**Decidido:** heredar de una venta sin `config_calculo` es un error, no un caso a
resolver con un default.

> ❓ **La pregunta del owner —"¿por qué no tendría config?"— destapó el caso real.**
> Verificado en esta pasada, hay **tres** fuentes de `NULL`, y una está viva hoy:
>
> 1. **Ventas anteriores al congelado** (2026-08-02). Histórico puro: desaparece con el
>    reset, y el proyecto no tiene datos productivos.
> 2. **Toda NC nace con `NULL` por construcción** — `crearNotaCredito` no asigna el campo
>    y la columna no tiene default. **P4 seca esta fuente.**
> 3. 🔴 **Una NC sobre otra NC, por el camino del webhook.** El guard que lo impide
>    (`ventas.service.ts:956-959`, *"No se puede emitir una nota de crédito sobre otra
>    nota de crédito"*) está **adentro de `if (params.validarVentaElegible)`**, y ese flag
>    solo lo pasa el camino manual (`:1146`). El webhook llama a `crearNotaCredito`
>    directo, **sin el flag**: por ahí la "venta original" puede ser una NC, que hoy no
>    tiene config. Este caso es **alcanzable ahora**, no histórico.
>
> Con P4 aplicada las tres se secan: post-reset toda venta tiene config y toda NC nueva
> también. Por eso fallar ruidosamente es correcto —queda como **canario**, no como
> camino esperado.

**Por qué:** después del reset no hay ventas sin config; un `NULL` ahí significa que algo
se rompió aguas arriba, y tragárselo con un `HALF_UP` esconde el problema real. El default
del tenant vigente quedó **descartado** por contradecir el congelado: reinterpretaría un
documento viejo con la config de hoy, que es justo lo que el snapshot existe para impedir.

**Qué obliga:**
- El error tiene que nombrar la venta y el caso, no ser un `TypeError` de acceso a `null`.
- **Entrada de backlog propia** (no de arrastre acá): el guard de NC-sobre-NC no corre en
  el camino del webhook. Que hoy no dispare depende de que ninguna pasarela reembolse una
  NC —una NC no se cobra por pasarela— y eso es un hecho de configuración, no una
  propiedad del código. Es el mismo tipo de razonamiento que sostiene la decisión de las
  suscripciones sin previsualización, y se anota igual.

## P6 — El frontend usa máscara, no recorte

**Decidido:** el input no deja tipear más decimales de los que la moneda admite.

**Por qué:** resuelve la contradicción interna de (d), que obligaba a *"cuantizar antes de
mandar"* mientras su porqué prohíbe cambiar calladamente lo que una persona escribió. Con
máscara, el usuario nunca produce un número inválido y nada se cambia a sus espaldas.

**Qué obliga:**
- `MoneyInput.vue` ya conoce `moneda.decimales` (la usa para formatear): el dato está, lo
  que falta es que restrinja la entrada.
- Los inputs de plata que **no** pasan por `MoneyInput` tienen que enumerarse — si alguno
  queda con `type="number"` pelado, el backend lo va a rechazar y la pantalla no va a
  saber por qué.
- Los tests de frontend de la lista de 34 (`MoneyInput.spec.ts:125`,
  `currency-format.spec.ts:73/:78/:93/:98`) **siguen verdes**: son monedas con decimales
  (USD, UF), donde la máscara permite lo que ya afirman.

## P7 — `montoTolerancia` va a la escala de la moneda

**Decidido:** `tenants.monto_tolerancia` se valida y se guarda a la escala de la moneda
del tenant, como cualquier monto.

**Por qué:** se compara contra diferencias de arqueo, que son montos en la moneda. Una
tolerancia de medio peso en CLP no significa nada.

**Qué obliga:**
- El DTO (`update-preferencias-financieras.dto.ts:33`) hoy solo tiene `@IsNumberString` —
  ni siquiera pasa por `decimal-signo.decorator.ts`. Suma la validación de escala y,
  de paso, la de signo: una tolerancia negativa tampoco significa nada.
- `tenants.service.spec.ts:613` afirma el round-trip de `'1.5'`: con CLP-0 ese valor deja
  de ser válido. **Es un test más que rompe, y no estaba en los ocho de (d)** — el conteo
  pasa a nueve.
- La columna es `NUMERIC(18,6)`; con la escala de la moneda mandando, los 6 decimales
  quedan como capacidad, no como contrato. Se documenta igual que (j) documenta
  `escala_calculo`.

## P8 — La asimetría de propinas se ratifica y se nombra

**Decidido:** el monto de propina que **entra** se valida como cobro (d); el **reparto**
no mira `modo_redondeo` a propósito (b), porque en un apportionment la garantía
Σ partes = total no depende de ningún modo.

**Por qué:** las dos cosas son correctas y se ven contradictorias juntas. Abrir el reparto
sería tocar el único lugar del repo que ya cumple el criterio decidido
(`mayores-restos.ts:44`, sitios 8 y 9 de los once).

**Qué obliga:** entra a la matriz de (c.4) y al comentario del sitio, para que nadie lo
lea como un descuido y lo "complete".

---

## Lo que esta ronda le agrega a la spec

**Obligaciones nuevas de código** (no estaban en las once):
1. La matriz de interacción pasa a ser **validación con 400 y test**, no solo doc (P1).
2. La NC persiste `config_calculo`, y los dos comentarios que dicen lo contrario se
   actualizan (P4).
3. `montoTolerancia` suma validación de escala y signo (P7) — **noveno test roto**.
4. La máscara del frontend, con el inventario de inputs de plata que no pasan por
   `MoneyInput` (P6).
5. El error ruidoso de herencia sin config (P5).

**Lo que se aclara y no cuesta código:** el criterio de (d) es *"la plata que una persona
ingresa"*, no *"toda la plata que entra por API"* (P3); el rechazo vive en el borde y los
clamps internos se documentan (P2); la asimetría de propinas es deliberada (P8).

**Entrada de backlog que sale de acá:** el guard de NC-sobre-NC no corre en el camino del
webhook de reembolso (P5) — con su evidencia, para que la entrada no subcuente el hueco.
