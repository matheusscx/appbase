# Gestión de caja — análisis de mercado vs. implementación

**Fecha:** 2026-07-23
**Estado:** 🔎 En investigación — insumo, todavía no hay diseño ni decisión tomada. No se tocó código.
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)

> ⚠️ Método (`docs/agent/investigacion-mercado.md`): lo que trae el mercado es **insumo
> para cruzar, no verdad a copiar**. Abajo se marca qué sobrevive al cruce contra el
> código y qué queda como **decisión de negocio del owner**.

---

## 1. Cómo lo modela la industria (Toast / Square / Lightspeed / Clover)

Vocabulario estándar y conceptos que se repiten en todos:

- **Cash drawer session / shift** — sesión de caja: se abre con un **starting cash /
  float** ($100–120 típico) y se cierra contando el efectivo.
- **Expected cash** — fórmula universal:
  `Starting + Cash tenders − Cash refunds − Paid-outs/Drops + Paid-ins`.
  **Clave: solo *cash* tenders.** Tarjeta y transferencia **no** entran al cajón, se
  concilian por separado.
- **Paid-in / Paid-out** — movimientos manuales de efectivo fuera de ventas, normalmente
  con **motivo categorizado** (no texto libre).
- **Cash drop / Safe drop** — retiro de efectivo a la caja fuerte a mitad de turno por
  seguridad (recomendado mantener < $200–300 en el cajón). Es un paid-out con destino
  "bóveda".
- **Blind count / blind close** — al cerrar, el sistema **oculta el expected**; el
  cajero cuenta a ciegas y recién después ve la diferencia. Es un permiso aparte
  (Lightspeed "3.17 Cash drawers (Blind)"). Anti-fraude.
- **Over/Short (variance)** = `Actual − Expected`. Negativo = faltante, positivo =
  sobrante. Se **trackea por empleado** en el tiempo.
- **X report vs Z report** — X = lectura de mitad de turno sin cerrar; Z = cierre que
  resetea el período.
- **Accountability model** — dos escuelas: **un usuario por cajón** (máxima
  responsabilidad, quien cierra responde por la diferencia) o **cajón compartido con
  suspend** (el cajero suspende y retira su till en el cambio de turno).
- **Denomination count** — contar por denominación (billetes/monedas) en vez de un solo
  total. Opcional en varios.

---

## 2. Cruce contra nuestra implementación

| Concepto de la industria | Nuestra caja | Veredicto |
|---|---|---|
| Sesión abrir/cerrar con float inicial | `abrir` (saldo_inicial) / `cerrar` (cuadre) | ✅ Cubierto |
| Over/Short = contado − esperado (Decimal) | `diferencia = montoContado − saldoEsperado` | ✅ Cubierto |
| Un usuario por cajón, dueño responde | 1 caja física por `(tenant, usuario)`, movimientos owner-only | ✅ Alineado (máxima responsabilidad) |
| No permitir saldo negativo en salidas | 422 si `salida > saldo_esperado` | ✅ Cubierto (más estricto que el mercado; ver nota §4) |
| X report (lectura mitad de turno) | `GET /:id/movimientos/resumen` (KPIs vivos) | ✅ Equivalente funcional |
| Paid-in / Paid-out | `movimiento` entrada/salida, **concepto texto libre** | △ Parcial — sin motivos categorizados |
| **Expected = solo efectivo** | **`saldo_esperado` suma TODO pago** (tarjeta incl.) | ❌ **Diverge — decisión de negocio (§3)** |
| Blind count al cerrar | `CajaCierreDrawer` muestra el esperado antes de contar | ✗ Falta (anti-fraude) |
| Cash drop / safe drop a bóveda | Se puede emular con `salida`, sin concepto de bóveda | ✗ Falta (no crítico sin caja fuerte) |
| Over/short por empleado (histórico) | `diferencia` por caja; sin reporte agregado por cajero | △ Dato existe, falta reporte |
| Conteo por denominación | Un solo `montoContado` | ✗ Falta (nice-to-have) |
| Multi-cajón por local / sucursal | 1 física por usuario | n/a — **fuera de alcance declarado** |
| Conciliación con pagos electrónicos | — | n/a — **fuera de alcance declarado** |

---

## 3. 🛑 Lo que requiere decisión de negocio (no auto-resolver)

**`saldo_esperado` incluye pagos con tarjeta/transferencia, no solo efectivo.**

Verificado en `backend/src/modules/pagos/pagos.service.ts:241-254`: por cada pago de una
venta se inserta un `movimiento_caja` tipo `'entrada'` con el neto, **sin mirar el
método**. El cierre (`caja.service.ts → calcularSaldoEsperado`) suma todas las entradas.
Nuestra doc, en cambio, describe la caja como conteo de **efectivo físico** ("el cajero
declara el efectivo físico… diferencia entre lo que debería haber y lo que cuenta").

Contra el mercado esto choca de frente: el cajón solo contiene efectivo, y ninguna caja
madura mete la tarjeta en el `expected`. **Consecuencia hoy:** si se vende $500 con
tarjeta, el sistema espera $500 de efectivo físico que no están → el cuadre marca un
faltante enorme en cada cierre.

Salidas posibles (gana la que decida el owner, es regla de negocio, no del mercado):

1. **Efectivo puro** (lo que hace la industria): solo métodos marcados efectivo afectan
   `saldo_esperado`; el resto se lista aparte pero no cuadra contra conteo físico.
   Requiere una marca `es_efectivo` en el método de pago → **toca el modelo de pagos**.
2. **Caja = ingreso total del turno** (arqueo total, no "cuadre de efectivo"): habría
   que renombrar el concepto y el conteo declararía efectivo + comprobantes de tarjeta
   por separado.
3. **Dejar como está** solo si se asume que el 100% de las ventas físicas son efectivo
   (irreal para el mercado objetivo).

**Bloqueante:** antes de proponer diseño hay que elegir. Si va por (1), confirmar que se
agrega `es_efectivo` al método de pago (por eso me detengo — toca modelo de pagos).

---

## 4. Realidad chilena (cruce local)

Cómo lo resuelven los POS locales (Bsale, Toteat, Defontana, Nubox) y qué imponen las
reglas del país. **Todo esto refuerza el hallazgo de §3: en Chile la caja física es
efectivo, y punto.**

- **Transbank / Redcompra separa físicamente el efectivo del resto.** Las ventas con
  tarjeta (crédito, débito/Redcompra, prepago) se **depositan en la cuenta bancaria del
  comercio** (débito/prepago ~24 h; crédito diferido), **no entran al cajón**. El
  terminal Transbank tiene su **propio "cierre de caja"** independiente del arqueo de
  efectivo → en la práctica chilena conviven **dos cierres distintos**: el del efectivo
  (nuestra caja) y el del terminal de tarjetas. Confirma desde la realidad local que
  meter la tarjeta en `saldo_esperado` (§3) es incorrecto.

- **Ley de redondeo (Ley 20.956 + Decreto 1266, vigente desde 2017).** En **pagos en
  efectivo** el total se redondea a la **decena más cercana** ($1–5 abajo, $6–9 arriba);
  no existen monedas de $1 ni $5. Es **obligatorio y solo aplica a efectivo** — cobrar el
  redondeo en tarjeta es ilegal (caso La Polar). Cruce con caja: el efectivo recibido por
  una venta **difiere en pesos del total nominal**; si el `movimiento_caja` de un pago en
  efectivo registra el total y no el efectivo redondeado, el cuadre acumula diferencias
  sistemáticas. → Al resolver §3 (opción 1), el monto que entra al cajón por una venta en
  efectivo es el **efectivo redondeado**, no el `total_final` nominal.

- **Propina (Ley 20.729): sugerida 10%, no obligatoria; íntegra al trabajador.** Puede ir
  en **efectivo** (entra al cajón) o en **tarjeta** (se deposita vía Transbank, agregada
  en la maquinita). Cruce con caja: la **propina en efectivo infla el cajón pero no es
  ingreso del comercio** — al arquear hay que poder separar cuánto del efectivo contado
  es propina que se retira para el garzón. Ya existe módulo de propinas
  (`liquidacion-propinas`); el punto es que el arqueo debe **distinguir efectivo de venta
  vs. efectivo de propina**, no mezclarlos en un único `saldo_esperado`.

- **Boleta electrónica SII integrada al cierre.** Todos los POS locales emiten boleta
  electrónica al SII en tiempo real, y el **cierre Z suele acompañarse del reporte de
  ventas para el SII**. Para nosotros es contexto ya cubierto por el diseño fiscal
  diferido (**ADR-010**), no una brecha de caja — pero anota que el "cierre de turno"
  chileno tiene una dimensión tributaria además de la de arqueo.

**Conclusión del cruce local:** Chile no cambia el diagnóstico, lo **endurece**. La
opción 1 de §3 (efectivo puro) no es solo "lo que hace el mercado internacional": es lo
que exige la operación chilena real (Transbank aparte, redondeo solo-efectivo, propina
separable). Las opciones 2 y 3 de §3 chocan con la realidad local.

---

## 5. Recomendación de prioridad (si se cierra la brecha)

1. **Efectivo vs total en el esperado** (§3) — rompe el propósito declarado de la
   feature. Todo lo demás es secundario. Al resolverlo, contemplar de una vez lo que
   exige Chile (§4): el efectivo de una venta es el **monto redondeado** (Ley 20.956), y
   el arqueo debe **separar efectivo de venta vs. efectivo de propina**.
2. **Blind count** — barato, alto valor anti-fraude: ocultar un número en el drawer + un
   permiso.
3. **Motivos categorizados** en paid-in/out y un tipo "retiro a bóveda" — cosmético
   hasta que exista caja fuerte.
4. Conteo por denominación y reporte over/short por cajero — nice-to-have.

**Nota menor:** bloqueamos la salida si excede el saldo (422). El mercado suele permitir
over-payout reflejado en la diferencia; con caja fuerte real un retiro puede vaciar el
cajón legítimamente. No cambiar hasta que aparezca la bóveda, pero queda anotado.

---

## 6. Poderes del encargado sobre la caja del cajero (investigación 2026-07-23)

Segunda pasada, motivada por el refactor **"Mi caja" (operar) / "Cajas" (supervisar)** y
el escenario concreto: **un cajero se va de urgencia y deja el turno abierto** — ¿puede el
encargado cerrarlo?

Lo que hace el mercado (**insumo, no verdad**):

- **Override del manager y accountability del cajero conviven, no se excluyen.** La caja se
  "amarra" a un usuario (drawer lock) para que la diferencia tenga un responsable, pero el
  manager tiene un permiso de *override* para operar sobre esa caja cuando hace falta.
- **El control dominante no es "cerrar por él" — es aprobación por umbral.** El cajero
  cierra normal; **si la diferencia supera un umbral configurado, un manager debe aprobar
  el cierre** (Toast). Regla de auditoría: *quien manejó el cajón no debería ser el único
  que verifica una diferencia material* → la separación de funciones **favorece** que el
  encargado intervenga en el cuadre.
- **Handoff / custodia interrumpida ⇒ reconciliación + audit trail de "quién contó".**
  Cualquier traspaso de cajón o interrupción inesperada exige reconciliar, y el sistema
  registra **quién usó/cerró el cajón y cuándo**. El escenario del cajero que se va es el
  caso "unexpected interruption that affects custody".
- **Realidad chilena 🇨🇱:** **Defontana** distingue explícito **cajero vs. supervisor** (el
  cajero no abre el primer turno; el supervisor habilita acciones). **Bsale y Toteat**
  tienen **cierre ciego** estándar (el cajero cuenta sin ver el esperado; el supervisor sí
  lo ve). Y por Transbank (§4), el cierre forzado del encargado es sobre el **efectivo
  físico**, no la tarjeta.

**Cruce contra nuestro modelo — el hallazgo:** hoy `cerrar` es **owner-only** y
`cajas.usuario_id` conflaciona *de quién es el turno* con *quién lo cerró*. Habilitar el
cierre forzado exige **separar ambos**: un campo `cerrada_por` (quién contó/cerró) distinto
de `usuario_id` (dueño del turno). Sin él, un cierre forzado mentiría sobre quién respondió
por el efectivo. Es un cambio de **modelo** (tabla `cajas` + romper el invariante owner-only
del cierre), no solo de permisos → "detenerse y preguntar".

**Decisión de negocio (2026-07-23):** el refactor arranca con **"Cajas" = solo
lectura/supervisión**. El cierre forzado (con `cerrada_por`) y la aprobación por umbral se
**difieren a propósito** para no acoplar el refactor de IA/permisos a un cambio de modelo
con implicancias de auditoría. Items diferidos registrados en
[`docs/agent/pendientes.md`](../pendientes.md).

---

## Fuentes

- Toast — [Shift Review Overview](https://support.toasttab.com/en/article/Shift-Review-Overview) ·
  [Close Out Day / Z Report](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)
- Lightspeed — [K-Series: Managing cash drawer operations](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050436394-Managing-cash-drawer-operations) ·
  [S-Series: X and Z Reports](https://shopkeep-support.lightspeedhq.com/hc/en-us/articles/47480030210971-X-and-Z-Reports)
- Square — [Start and end a cash drawer session](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session) ·
  [Set up cash management](https://squareup.com/help/us/en/article/5152-cash-drawer-management)
- Microsoft — [Dynamics 365: Shift and cash drawer management](https://learn.microsoft.com/en-us/dynamics365/commerce/shift-drawer-management)
- [KORONA — How to count the till](https://koronapos.com/blog/count-the-till-cash-handling/)
- [Insightful Accountant — POS cash management best practices](https://insightfulaccountant.com/accounting-tech/payroll-merchant-services/point-of-sale-best-practices:-cash-management/)

**Chile:**
- POS locales — [Bsale](https://www.bsale.cl/) · [Toteat — boletas electrónicas SII](https://toteat.com/productos/boletas-electronicas) ·
  [Defontana POS](https://digital.defontana.com/pos) · [Webiados — comparativa POS Chile 2026](https://webiados.com/blog/sistema-pos-chile-2026-comparativa)
- Redondeo — [Banco Central: Regla de redondeo](https://www.billetesymonedas.cl/Monedas/ReglaRedondeo) ·
  [BCN — Decreto 1266 (reglamento Ley 20.956)](https://www.bcn.cl/leychile/Navegar?idNorma=1111243) ·
  [Conadecus — redondeo no aplica a tarjeta (caso La Polar)](https://www.conadecus.cl/denuncian-a-la-polar-por-usar-la-ley-de-redondeo-en-pago-con-tarjeta/)
- Transbank — [Cierre de caja POS](https://publico.transbank.cl/guias-de-uso/pos/cierre-de-caja) ·
  [Cuándo deposita Transbank las ventas](https://ayuda.transbank.cl/cuando-deposita-transbank) ·
  [Propina en la maquinita](https://ayuda.transbank.cl/%C2%BFc%C3%B3mo-reviso-el-detalle-de-las-propinas-asociadas-a-mis-ventas-)
- Propina — [Nubox — Ley de propinas en Chile (Ley 20.729)](https://blog.nubox.com/contadores/ley-de-propinas-en-chile)

**Poderes del encargado (§6):**
- Toast — [Cash Drawer Lockdown](https://support.toasttab.com/en/article/Cash-Drawer-Lockdown) ·
  [POS cash drawer operations](https://doc.toasttab.com/doc/platformguide/adminCashDrawerPOSOperations.html)
- [POS Highway — Cash drawer management (accountability por usuario)](https://www.poshighway.com/blog/cash-drawer-management-cycle-counts-reconcilation-activation-and-closing/)
- [MangoApps — Cash Drawer Close & Reconcile SOP (separación de funciones en variance)](https://www.mangoapps.com/templates/sop/cash-drawer-close-reconcile)
- Defontana — [Apertura de Caja / Turno (cajero vs. supervisor)](https://defontana.atlassian.net/wiki/spaces/CDAV2/pages/23069789)
- Bsale — [Cierre de caja ciego](https://ayuda.bsale.com.mx/support/solutions/articles/151000212864-cierre-de-caja-ciego-o-sin-detalle)
