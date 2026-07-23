# Gestión de caja — análisis de mercado vs. implementación

**Fecha:** 2026-07-23 (tres pasadas: §1–§6 internacional + Chile; §7 Fudo/LatAm + cruce del esperado; §8 mecánica y ciclo de vida del arqueo)
**Estado:** 🔎 En investigación — insumo, todavía no hay diseño ni decisión tomada. No se tocó código.
El hilo bloqueante (§3, esperado del cierre) quedó **reencuadrado en §7** con 3 salidas (A solo-efectivo / B multi-medio / C status quo) — decisión de negocio del owner, aún abierta.
Del brainstorming salió además un **refactor general de caja** dividido en sub-proyectos: ver **roadmap en §9** (arranca por la definición de cajones).
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
  electrónica al SII en tiempo real. Para nosotros es contexto ya cubierto por el diseño
  fiscal diferido (**ADR-010**), no una brecha de caja.
  > ⚠️ **Corregido en §8.7 (2026-07-23):** una afirmación previa de este punto ("el cierre
  > Z suele acompañarse del reporte de ventas para el SII" / "el cierre de turno tiene una
  > dimensión tributaria") quedó **desactualizada**. Desde ago-2022 el SII eliminó el
  > Resumen de Ventas Diarias (RVD); la boleta viaja **transaccional en tiempo real** y el
  > arqueo/cierre **no** es un hecho fiscal ni lleva envío consolidado al SII. Ver §8.7.

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

## 7. Cruce con Fudo y el mercado LatAm (2026-07-23, 2ª pasada)

Motivación: antes de elegir un hilo abierto (§3, §5, §6) se corrió una segunda pasada con
foco en el **mercado local**, tomando **Fudo** como caso central (POS de restaurantes muy
usado en Chile) más Bsale, Toteat, Defontana, Maxirest. **Insumo, no verdad** — abajo se
marca qué sobrevive al cruce contra nuestro código y qué queda como decisión del owner.

### 7.1 El hallazgo que reencuadra §3 — no es "efectivo vs. total", son tres modelos

La primera pasada (§3) planteó el problema como binario: esperado = **efectivo puro** o
**total del turno**. El mercado local usa una tercera forma que no estaba sobre la mesa:

- **Arqueo *multi-medio* (Fudo, Bsale, Toteat) — norma LatAm.** El cierre tiene **una fila
  esperado-vs-contado por cada método de pago**. El efectivo se cuenta físico; la tarjeta
  se concilia contra el total del terminal Transbank (que tiene su **propio cierre de
  lote**, aparte). Toteat pide explícitamente **restar la propina** del monto de tarjeta al
  cuadrar cuando el local no recauda propina en la venta. Fudo, con Terminal Fudo propio,
  autocompleta la fila de tarjeta; con terminal Transbank externo (lo común en Chile) la
  concilia contra el cierre del terminal.
- **Cash drawer *solo-efectivo* (Toast, Square) — escuela internacional.** El cajón es una
  entidad efectivo-only por diseño; `Cash expected = inicial + ventas efectivo − vueltos −
  paid-outs`. La tarjeta vive **entera fuera** del arqueo, la liquida el procesador.
- **Coinciden en lo único que importa para nuestro bug:** ninguno mete la tarjeta dentro
  de **un solo esperado de efectivo**. Es exactamente lo que hacemos hoy.

⚠️ Diferencia de **modelo de datos**, no de UI: LatAm modela el arqueo como objeto
multi-fila (una por método); Toast/Square como cajón efectivo-only separado del cierre de
tarjeta.

### 7.2 Cruce contra nuestro código — la sorpresa buena

| Verificado | Hallazgo |
|---|---|
| `movimiento-caja.entity.ts` (`MovimientoCaja`) | **Ya tiene `metodo_pago_id` por fila** (nullable) |
| `pagos.service.ts:252` | **Ya lo puebla** en cada movimiento derivado de venta |
| `caja.service.ts:154-169` (`calcularSaldoEsperado`) | Colapsa **todo** en un número: `SUM(m.monto) FILTER (WHERE m.tipo='entrada')`, **sin mirar el método** ← raíz del faltante fantasma |
| `metodo-pago.entity.ts` (`MetodoPago`) | **NO** tiene marca de efectivo (solo `nombre`/`abreviatura`/`activo`) |

Traducción: el **modelo multi-medio (B) ya está soportado a nivel de datos** — el
`metodo_pago_id` está en cada movimiento; lo que colapsa la información es una sola query
de agregación y un `montoContado` de campo único (`caja.service.ts:199,202`). Lo pesado de
B **no es la BD**, es el DTO de cierre (un contado por método) y la UI. La opción
efectivo-puro (A) es más simple en el cierre pero **sí** exige agregar `es_efectivo` (o un
`tipo`) a `metodos_pago` → toca el modelo de pagos.

### 7.3 §3 reencuadrado — tres salidas (decisión de negocio, abierta)

- **A) Esperado solo-efectivo** (Toast/Square + opción 1 de §3). La tarjeta queda
  informativa, no cuadra contra conteo físico. Necesita `es_efectivo` en `metodos_pago`.
  Cierre simple (un solo contado). Al implementar, el efectivo de una venta es el **monto
  redondeado** (Ley 20.956, §4), no el `total_final` nominal.
- **B) Arqueo multi-medio** (Fudo/Bsale/Toteat, norma local). Un esperado/contado por
  método. **Nuestra data ya lo soporta** (`metodo_pago_id`); el peso está en cierre+UI y en
  separar propina del monto de tarjeta (§4). Es lo más fiel al mercado chileno real.
- **C) Status quo** (un total, tarjeta incluida). Rompe bajo las dos escuelas. Descartable.

### 7.4 Cruce de los otros hilos

- **§6 cierre forzado — precedente local casi nulo, pero confirma `cerrada_por`.** Ningún
  POS LatAm investigado documenta "el supervisor cierra por el cajero ausente" (solo Toast,
  con *Cash Drawer Lockdown Override*). **Pero** la feature "Conciliación de Caja" (Plan Pro)
  de Fudo registra **"usuario que realizó el cierre"** como campo y usa flujo *Operador
  cierra → Supervisor revisa/ajusta/valida* — o sea la distinción **`cerrada_por` ≠
  dueño-del-turno** que §6 predijo **existe en el mercado**. El escenario "ausencia" en sí
  sigue sin precedente local claro.
- **§6 umbral de aprobación — reencuadre: Fudo NO usa umbral.** Exige justificar **toda**
  diferencia (sin importar monto) con **motivo categorizado** + comentario. El umbral
  configurable de dos niveles (warning / aprobación obligatoria) solo aparece en **Toast**.
  La norma local es "justificar siempre", no "aprobar si supera X" → si se quiere umbral,
  se adapta de Toast, no se copia de un competidor regional.
- **§5 blind count — el mejor confirmado.** Fudo ("Arqueo de caja ciego"), Toteat ("Cierre
  Ciego") y Toast, todos, como **permiso de rol que oculta el "según sistema"/esperado** al
  cajero. Barato, mapea limpio a nuestro RBAC (un permiso que oculta `saldoEsperado` en el
  drawer). En Fudo es el Administrador quien lo activa por rol, no un supervisor en runtime.
- **Nuevo (no estaba en §1–§6): motivos categorizados de diferencia.** Fudo obliga a un
  motivo tipificado en cualquier descuadre (falta / sobra / divergencia de tarjeta / error
  de lanzamiento manual / registro de pago ausente / error operacional / otro). Cruza y
  extiende el gap ya anotado en §2 (paid-in/out con concepto de texto libre, sin motivos).

### 7.5 Qué sobrevive al cruce

- **Sobrevive (mercado + código convergen):** que la tarjeta **no** vaya en un único
  esperado de efectivo (§3, refuerza §4); que `cerrada_por` es una distinción real (§6);
  que blind count es un permiso de rol barato (§5); que los descuadres piden motivo
  tipificado (nuevo).
- **Decisión de negocio del owner (no auto-resolver):** elegir modelo A vs B para el
  esperado (§7.3) — B toca cierre+UI, A toca `metodos_pago`; si se quiere umbral (§6),
  adaptarlo de Toast asumiendo que la norma local es justificar-siempre.
- **Huecos honestos del mercado (no inventar sobre esto):** si Fudo autocompleta o concilia
  manual la tarjeta con terminal Transbank **externo**; si el permiso "listar/actualizar
  todos" de Fudo habilita operar sobre el arqueo *abierto* de otro usuario o solo verlo;
  y el detalle de auditoría fino del cierre forzado (ningún POS lo documenta público).

---

## 8. Mecánica y ciclo de vida del arqueo (2026-07-23, 3ª pasada)

Motivación: profundizar el **arqueo como objeto y proceso** (no el modelo del esperado, ya
resuelto en §7): qué es, sus tipos, conteo, movimientos, diferencia, estados y el cruce
chileno. Fudo como caso central + Bsale, Toteat, Defontana, Maxirest. **Insumo, no verdad.**

### 8.1 El arqueo como sesión — y el cruce que revela nuestro modelo

En el mercado, "arqueo" es la **sesión temporal** que abre/cierra sobre una **Caja
persistente**:
- **Fudo:** la "Caja" es el objeto persistente (Administración › Cajas: caja de mesas, de
  mostrador, de delivery); el usuario se asigna a una o más; el **arqueo** es la sesión que
  corre sobre **una** caja. No se abren dos arqueos con la misma caja; sí varios en paralelo
  si hay varias cajas.
- **Defontana:** modelo de **dos niveles explícito** — Caja (contenedor) contiene varios
  **Turnos** anidados; se cierran todos los turnos y recién ahí se cierra la Caja.
- **Square:** "cash drawer" físico + "session" pausable/reanudable — mismo patrón
  contenedor + sesión.

**Cruce contra nuestro código — el hallazgo:** nuestro `cajas` **conflaciona contenedor y
sesión en una sola fila** (`caja.entity.ts:27-68`): cada `abrir` inserta una fila con su
propio `fecha_apertura`/`fecha_cierre`/`saldo_inicial`/`monto_contado`/`diferencia`/`estado`.
En vocabulario de mercado, **nuestro `cajas` = el "arqueo/sesión", NO el contenedor "Caja"
persistente**. No existe una caja física nombrada que persista entre sesiones; el "cajón" es
implícitamente `(tenant, usuario)` (doc: "una física abierta por tenant+usuario"). → Confirma
desde el modelo que el **multi-cajón nombrado por local** (caja de mesas/mostrador/delivery)
es la **dimensión futura** que §2 declaró fuera de alcance, no un gap del diseño actual.

### 8.2 Tipos de arqueo — LatAm no usa X/Z, y nosotros ya tenemos el equivalente

Fudo/Bsale/Toteat/Maxirest documentan solo **apertura** y **cierre** (cada cierre es
terminal). La nomenclatura **X report (lectura viva) / Z report (cierre)** es de cajas
registradoras fiscales EE.UU.; **ningún POS LatAm investigado la usa**. Defontana es lo más
cercano (cerrar turno vs. cerrar turno+sesión).
**Cruce:** ya tenemos el equivalente al X — `GET /:id/movimientos/resumen` (KPIs vivos sin
cerrar). No falta un objeto "arqueo parcial": el cierre es el único evento terminal, igual
que el mercado local. Alineado.

### 8.3 Conteo por denominación — nadie local lo hace

No hay fuente pública de que Fudo, Bsale, Toteat o Defontana ofrezcan conteo por
denominación (billete a billete); todos piden **un monto único por medio de pago** (Maxirest
es ambiguo). Solo **Lightspeed** lo confirma como opción configurable internacional.
**Cruce:** nuestro `montoContado` único (`caja.service.ts:199,202`) está **alineado con la
norma local**. La denominación es nice-to-have (ya anotado en §5), sin presión de mercado.

### 8.4 Movimientos del turno — alineado, con un matiz sobre "motivos"

Fudo "Movimientos de Caja" (ingreso/egreso no ligado a venta): **monto obligatorio, tipo,
comentario opcional**; impactan directo el esperado del arqueo en curso. Aparte, los "Gastos"
solo impactan si tienen flag "Usar en Arqueo" y caen en la franja horaria del arqueo.
**Cruce:** nuestro `movimientos_caja.concepto` (texto libre) + `tipo` entrada/salida está
alineado. **Matiz que corrige §7.4:** el **motivo categorizado** de Fudo es sobre la
**diferencia del cierre** (conciliación), no sobre cada movimiento — para el movimiento el
comentario es *opcional*. No distinguimos "gasto usado en arqueo" vs. movimiento (Fudo sí);
menor.

### 8.5 Diferencia — sin tolerancia ni bloqueo (igual que nosotros)

Ningún POS LatAm documenta **tolerancia configurable** ni que el descuadre **bloquee** el
cierre. Maxirest es el único con bifurcación explícita: **recontar** o **cerrar aplicando un
ajuste** por la diferencia. El **over/short histórico agregado por cajero** solo aparece en
Toast/Square, en ninguno de los 5 locales.
**Cruce:** nuestro `diferencia = montoContado − saldoEsperado` (`caja.service.ts:199`) sin
tolerancia y sin bloqueo está **alineado con la norma local**. El reporte histórico por
cajero es un nice-to-have (el dato existe por caja; falta la agregación) — ya en §2/§5.

### 8.6 Estados y reapertura — hueco transversal del mercado

Fudo: **Abierto → Cerrado**, y "una vez cerrado no puede reabrirse" (solo se puede editar un
movimiento mientras el arqueo sigue abierto). Ningún POS documenta públicamente **quién puede
reabrir/editar un arqueo cerrado ni bajo qué permiso**.
**Cruce:** nuestro `estado` `'abierta'|'cerrada'` (`caja.entity.ts:67`) coincide. El tercer
estado "pendiente de conciliación/validado" pertenece al flujo de conciliación de Fudo Pro
(§7.4) — sería relevante solo si implementamos cierre forzado/conciliación (diferido en §6).

### 8.7 Realidad chilena — corrige un dato y refuerza otros

- **🛑 Corrección a §4: el arqueo/cierre NO es un hecho fiscal.** Desde **ago-2022 el SII
  eliminó la obligación del Resumen de Ventas Diarias (RVD)**: el Registro de Ventas se
  alimenta de las boletas electrónicas ya recibidas por transacción. No existe "cierre Z
  enviado al SII". El arqueo es **control interno de caja**; la boleta viaja sola, en tiempo
  real. La "dimensión tributaria del cierre" que insinuaba §4 **no aplica** hoy.
- **Redondeo (Ley 20.956):** confirmado efectivo-only, el documento refleja el precio sin
  redondear. **Hueco real:** ningún POS (ni Fudo ni los otros) documenta si el *esperado en
  efectivo del arqueo* incorpora el redondeo. Queda como decisión al resolver §3-opción A/B.
- **Propina en efectivo:** en Fudo **impacta el arqueo por defecto** salvo que se registre un
  retiro/egreso manual — no hay separación automática. Refuerza §4 (el arqueo debe poder
  separar efectivo de venta vs. de propina).
- **Cierre del terminal Transbank:** paso **separado** si el datáfono es standalone (cierre
  diario del terminal, imprime total por marca); **integrado** si es nativo (Terminal Fudo /
  Toteat+Transbank eliminan el paso). Refuerza §4/§7.

### 8.8 Qué sobrevive al cruce

- **Sobrevive (mercado + nuestro modelo convergen):** apertura/cierre como único evento
  terminal, con el `resumen` como lectura viva (§8.2); monto único de conteo (§8.3);
  movimientos con concepto y sin bloqueo por diferencia (§8.4–8.5); estados abierta/cerrada
  sin reapertura (§8.6). **Nuestro modelo actual está alineado con la norma local** en la
  mecánica del arqueo — el trabajo pendiente real es §3 (el esperado), no la mecánica.
- **Corrección registrada:** el cierre **no** es evento fiscal (§8.7) — ajustar cualquier
  diseño que asumiera lo contrario.
- **Dimensión futura, no gap:** caja física nombrada persistente (multi-cajón) — §8.1, ya
  fuera de alcance en §2.
- **Huecos honestos del mercado (no inventar):** conteo por denominación, tolerancia
  configurable, over/short histórico por cajero, y reapertura/edición de arqueo cerrado con
  permiso — ninguno documentado por los POS locales (varios sí en Toast/Square/Lightspeed).

---

## 9. Roadmap del refactor general de caja (decisión 2026-07-23)

Del brainstorming del owner salió un **refactor general** del módulo de caja que introduce el
**cajón físico como entidad** (hoy `cajas` conflaciona contenedor + sesión, §8.1). Es
demasiado para un solo spec → se **divide en sub-proyectos**, cada uno con su propia spec,
plan y ciclo de implementación. Este roadmap es el índice; se enlaza cada spec al crearla.

**Alcance elegido = A (solo estructura).** El refactor entrega la estructura (cajones +
autorización + sesión sobre cajón). Las features de negocio (§3 esperado, §6 cierre forzado,
§5 blind count/motivos) quedan **fuera** y se montan *después* sobre esta estructura — no la
bloquean. El owner además fijó el **orden**: primero la definición de cajones.

Modelo acordado (§8.1 + brainstorming):
- El **admin define** los cajones físicos del tenant (Mostrador, Delivery, Barra…).
- El **admin autoriza** qué usuarios pueden abrir qué cajones (**allow-list** N‑a‑N, "puede
  abrir" — no amarre 1‑a‑1).
- **Un cajón físico:** máximo una sesión abierta a la vez. **Un cajero:** máximo una sesión
  abierta a la vez (regla actual, se conserva).

### Sub-proyectos (opción A)

- [ ] **1. Definición de cajones (admin)** — ✅ *spec aprobada, lista para plan*. CRUD de
  cajones físicos por tenant (entidad `cajones`, config admin-only). Entregable y testeable
  por sí solo. Spec: [`2026-07-23-cajones-definicion-admin-design.md`](../../superpowers/specs/2026-07-23-cajones-definicion-admin-design.md).
- [ ] **2. Autorización: qué usuarios abren qué cajones** — allow-list N‑a‑N gestionada por
  el admin. Convive con el permiso RBAC (`MiCaja:Crear`). Depende de 1. Spec: _(pendiente)_.
- [ ] **3. Sesión sobre cajón + terminología** — la sesión (hoy `cajas`) gana `cajon_id`; la
  apertura elige un cajón autorizado y libre; unicidad por cajón; resolución del rename
  terminológico y ajuste de las superficies `MiCaja`/`Cajas`. Depende de 1+2. Spec: _(pendiente)_.

### Features de negocio diferidas (fuera de A, se montan sobre la estructura)

- [ ] **§3 — Modelo del esperado** (efectivo puro vs. arqueo multi-medio). Bloqueante del
  propósito de la feature; decisión de negocio abierta (§7.3).
- [ ] **§6 — Cierre forzado + `cerrada_por`** y conciliación operador→supervisor (§7.4).
- [ ] **§5 — Blind count, motivos categorizados de diferencia, denominación** (§8.4–8.5).

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

**Fudo y mercado LatAm (§7, 2ª pasada):**
- Fudo — [Arqueos de caja](https://soporte.fu.do/es/articles/11730865-3-arqueos-de-caja) ·
  [Arqueo de caja ciego](https://soporte.fu.do/es/articles/11730856-como-configurar-un-arqueo-de-caja-ciego) ·
  [Conciliación de Caja (operador vs. supervisor, "usuario que realizó el cierre")](https://soporte.fu.do/es/articles/14658427-conciliacion-de-caja) ·
  [Motivos de diferencia de arqueo](https://soporte.fu.do/es/articles/11730868-principales-motivos-de-diferencia-de-arqueo-de-caja) ·
  [Roles de usuario](https://soporte.fu.do/es/articles/11730991-roles-de-usuario) ·
  [Función de permisos de usuario](https://soporte.fu.do/es/articles/11730992-funcion-de-permisos-de-usuario) ·
  [Terminal Fudo CL: sincronización con arqueos](https://soporte.fu.do/es/articles/11732104-terminal-de-fudo-cl-sincronizacion-con-arqueos-de-caja) ·
  [Cierre de caja en restaurantes (blog)](https://blog.fu.do/cierre-de-caja-en-restaurantes-como-pasar-de-horas-a-minutos-con-la-terminal-fudo)
- Toteat — [Cerrar caja cuando NO recaudan propina (restar propina de tarjeta)](http://ayuda.toteat.com/es/articles/2164086-pasos-para-cerrar-la-caja-de-forma-correcta-cuando-no-recaudan-propina) ·
  [Perfiles de usuarios (permisos, cierre ciego)](https://toteat.com/ayuda/operacion-en-restaurante/articulo-ayuda/perfiles-de-usuarios-permisos)
- Bsale — [¿Cómo hacer un cierre de caja? (multi-medio)](https://ayuda.bsale.com.mx/support/solutions/articles/151000212827--c%C3%B3mo-hacer-un-cierre-de-caja-)
- Maxirest — [Fin de turno](https://ayuda.maxirest.com/fin-de-turno) · [Arqueo de caja](https://ayuda.maxirest.com/arqueo-de-caja)
- Defontana — [Cierre de turno - Pos](https://defontana.atlassian.net/wiki/spaces/CDAV2/pages/23069819/Cierre+de+turno+-+Pos)
- Toast — [Cash drawer operations (Closeout Over/Short Max, umbral)](https://doc.toasttab.com/doc/platformguide/adminCashDrawerOperations.html) ·
  [Job roles (Cash Drawers Blind)](https://support.toasttab.com/en/article/Creating-and-Editing-Job-Roles)
- Square — [Start and end a cash drawer session (cash-only expected)](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)
- Transbank — [Cierre de turno y tienda con Transbank (cierre de terminal separado)](https://www.pos-xpress.cl/tutoriales/caja/CIERRE%20DE%20TURNO%20Y%20TIENDA%20CON%20TRANSBANK.pdf)

**Mecánica y ciclo de vida del arqueo (§8, 3ª pasada):**
- Fudo — [Arqueos de caja](https://soporte.fu.do/es/articles/11730865-3-arqueos-de-caja) ·
  [Arqueo de caja — preguntas frecuentes](https://soporte.fu.do/es/articles/11730869-arqueo-de-caja-preguntas-frecuentes) ·
  [Movimientos de caja (monto oblig., comentario opcional)](https://soporte.fu.do/es/articles/11730862-2-movimientos-de-caja) ·
  [Abrir más de un arqueo (uno por caja)](https://soporte.fu.do/es/articles/12044091-como-abrir-mas-de-un-arqueo-de-caja) ·
  [Emitir boletas/facturas SII en Chile](https://soporte.fu.do/es/articles/12429735-como-emitir-e-imprimir-boletas-y-facturas-electronicas-en-chile-desde-fudo-sii)
- Defontana — [Cierre de turno y caja (Caja contiene varios turnos)](https://intercom.help/defontanaerp/es/articles/5318588-cierre-de-turno-y-caja)
- Bsale — [Generar un cierre de caja (Chile)](https://ayuda.bsale.io/support/solutions/articles/151000224795--c%C3%B3mo-generar-un-cierre-de-caja-) ·
  [Resumen de cierre: aperturas, retiros, vueltos (Perú)](https://ayuda.bsale.com.pe/support/solutions/articles/151000212324--c%C3%B3mo-generar-un-cierre-de-caja-)
- Maxirest — [Fin de turno (recontar vs. cerrar con ajuste; "cantidad de billetes")](https://ayuda.maxirest.com/fin-turno/fin-de-turno)
- Lightspeed — [Finalise your takings (denominación opcional)](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329369881755-Finalise-your-takings)
- Toast — [Close Out Day / Z Report (X vs Z)](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture) ·
  [Cash Drawer Reports (over/short histórico por cajero)](https://support.toasttab.com/en/article/Cash-Drawer-Reports-Overview)
- SII / RVD — [SII elimina obligatoriedad del Resumen de Ventas Diarias (ago-2022)](https://www.sii.cl/noticias/2022/160622noti01rp.htm) ·
  [LibreDTE — análisis de la eliminación del RVD](https://www.libredte.cl/blog/2022-06-20-sii-elimina-la-obligatoriedad-de-envio-del-rvd)
- Transbank — [Cierre de ventas diario del terminal (paso separado)](https://ayuda.transbank.cl/cierre-ventas-diario-transbank)
