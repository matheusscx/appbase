# Diferenciadores — dónde nos separamos del mercado

Cosas que este producto hace (o va a hacer) y que el mercado **no** hace, con la evidencia
que lo respalda. Nace el 2026-08-11, al descubrir diseñando el testigo del cierre de caja
que varias decisiones tomadas acá no tienen equivalente en ningún POS relevado.

**Para qué sirve este archivo:** que no se pierda. Los hallazgos salen de investigaciones
puntuales, quedan enterrados en un `.md` de 600 líneas y seis meses después nadie recuerda
que eran diferenciadores. Cuando llegue el momento de comunicar el producto, la materia
prima está acá.

---

## ⛔ Regla de honestidad — leer antes de usar esto para promocionar

Este archivo alimenta comunicación externa, así que el estándar de verdad es más alto que
en el resto de `docs/`, no más bajo.

1. **El estado es obligatorio y literal.** ✅ construido / 📐 diseñado / 💡 hallazgo.
   Prometer algo diseñado como si estuviera construido es publicidad engañosa, no
   entusiasmo.
2. **"Ningún POS lo hace" se cita, no se afirma.** Cada entrada dice **dónde** se midió y
   **qué se relevó**. Un relevamiento de 8 productos no autoriza a decir "nadie en el
   mundo": autoriza a decir "ninguno de los 8 que miramos, y acá está la lista".
3. **Ausencia de documentación pública ≠ ausencia de la función.** Varios hallazgos son
   "no lo documenta públicamente". Eso es un dato real, pero **no** prueba que el
   competidor no lo tenga.
4. **Antes de publicar, revalidar.** El mercado se mueve. Un hallazgo de hace un año puede
   estar viejo.

---

## ✅ Construido

### Testigo del cierre de caja — el que originó este archivo

**Nosotros:** cuando un encargado cierra la caja de un cajero ausente, un garzón en turno
puede **dar fe del conteo** desde su propia pantalla. Ve lo que se contó —nunca lo esperado,
así no se rompe el cierre ciego—, y puede **rechazar**. Firma **desde su cuenta** si la
tiene (la prueba fuerte: la identidad la da su sesión) o con su PIN si no. El registro
guarda quién contó, quién dio fe, **por cuál de las dos vías**, a qué hora, **cuánta gente
había disponible**, y si no hubo testigo, por qué.
**El mercado:** **ninguno de los POS relevados documenta un campo de testigo ni una segunda
firma en el cierre** — ni siquiera Oracle Xstore, que es enterprise. La doble firma existe
hace décadas —en formularios de papel y en políticas de manejo de efectivo— pero **no está
en el software**.
⚠️ A diferencia de las otras entradas de este archivo, la investigación que lo respalda
(§10.9.2) **no enumera el universo relevado** para esta afirmación puntual. Hasta que se
enumere, comunicar "de los que relevamos", nunca "ninguno en el mundo" (regla 2).
**Por qué le importa:** convierte "confiar o no en el encargado" en un dato auditable. Y en
Chile, donde un faltante **no se le puede descontar al trabajador** sin asignación pactada,
lo que vale es exactamente eso: la prueba.
**Y hay precedente legal**, que es lo que lo hace defendible y no un capricho: el estándar
condiciona la responsabilidad del cajero a **dos** requisitos —acceso exclusivo y
oportunidad de estar presente en el conteo—, así que contar sin él **cae la imputación**.
**Evidencia:** [investigación §10](agent/investigaciones/2026-07-23-gestion-caja.md) ·
Law Insider (cláusulas de convenios colectivos) · DT Chile ORD. N°4229 · U.S. Bank
(hold-for-processing) · Oracle Xstore (Till Accountability) ·
[feature](features/gestion-cajas.md#ciclo-de-vida-de-una-solicitud-de-testigo).
**Estado:** ✅ Implementado 2026-08-13 ([ESTADO](ESTADO.md)), verificado end-to-end en
navegador.
⚠️ La parte legal chilena **está sin validar por un abogado** — no comunicar el ángulo legal
hasta que lo esté.
⚠️ **Y una precisión que hay que respetar al comunicarlo:** la
firma **por PIN identifica al garzón, no prueba quién lo tecleó** —el PIN lo emite el
encargado y lo ve en claro—. Lo que sí es prueba fuerte es la firma **desde la cuenta** del
garzón. Se puede decir "queda registrado quién dio fe y por qué vía"; **no** se puede decir
"nadie puede firmar por otro" sin la aclaración, porque en la vía PIN sí podría.
⚠️ **El PIN propio (2026-08-14) no levanta esta advertencia**, y no es un olvido: quien
tiene cuenta ya firma por la vía fuerte (`via_firma='cuenta'`); la vía PIN la usan **por
construcción** los garzones **sin** cuenta, a quienes el encargado les sigue emitiendo el
PIN y viéndolo en claro. La vía débil queda exactamente igual de débil. Detalle en
[la spec](superpowers/specs/2026-08-14-pin-propio-garzon-design.md#lo-que-esta-feature-gana--y-lo-que-no).

### El cierre ciego es política del negocio, no un permiso de rol — y también tapa al supervisor

**Nosotros:** `arqueo_ciego` es **config del tenant**, no un permiso que se le da o se le
quita a un rol. Mientras la caja está abierta, el esperado no lo ve **ni el cajero dueño del
turno ni el supervisor con `Cajas:Leer`** — solo el admin del tenant y el superadmin quedan
exentos. Es una decisión explícita del owner, más estricta que el estándar de mercado.
**El mercado:** en **los cinco productos que documentan el ciego con un permiso nombrado**,
es siempre **permiso de rol o perfil**, así que por construcción hay roles que **sí** ven el
esperado mientras el cajero cuenta: Toast (`3.17 Cash Drawers (Blind)` contra `3.18 (Full)`),
Oracle MICROS Simphony (`25 - View Blind Totals`), Fudo (*"Ver 'Según Sistema'"*, que se le
quita al rol Cajero), Bsale (*"Ver detalle de la caja teórica"*, por perfil) y Toteat (por
perfil de usuario). Relevados además sin la función: Square, Lightspeed, Clover, Defontana.
**Por qué le importa a quien compra:** un ciego que es permiso de rol **se cae con una
conversación**. Si el supervisor ve el esperado y el cajero se lo pregunta, el control
desapareció y no queda rastro. Que sea política del local —y no un atributo de quién está
mirando— es lo que lo hace sobrevivir a la colusión, que es el escenario para el que se
inventó el conteo a ciegas.
⚠️ **Costo, y hay que decirlo al comunicarlo:** el supervisor tampoco puede despejar una duda
en el momento. Si el cajero pregunta *"¿voy bien?"*, nadie en el local puede contestarle salvo
el admin del tenant.
⚠️ **Alcance exacto de la afirmación** (regla 2): son **doce** productos relevados en total,
de los cuales **siete** documentan cierre ciego. De esos siete, **cinco** nombran el permiso y
los cinco lo hacen por rol/perfil; Relbase documenta la función sin nombrar el permiso, y de
Revel no se pudo leer nada (su help site bloqueó el acceso). Se comunica *"ninguno de los que
relevamos"*, nunca *"ninguno en el mundo"*.
⚠️ **Y esto es sobre el turno EN CURSO.** Una vez enviado el conteo, la diferencia se le
revela al propio cajero — igual que Toast, Simphony, Square, Defontana y mySYSTEM. Eso **no**
es un diferenciador, es el estándar, y se decidió mantenerlo así el 2026-08-22.
**Evidencia:** [investigación §11](agent/investigaciones/2026-07-23-gestion-caja.md#11-cuándo-se-revela-el-descuadre-y-a-quién-2026-08-22-5ª-pasada) ·
[feature](features/gestion-cajas.md#cierre-ciego-modo-anti-fraude).
**Estado:** ✅ Implementado 2026-07-24 ([ESTADO](ESTADO.md)). El relevamiento que lo respalda
como diferenciador es del 2026-08-22.

### Costeo por promedio ponderado móvil, y no "último costo"

**Nosotros:** el costo de un producto es el promedio ponderado móvil, recalculado en cada
entrada, con ajuste de costo auditado.
**El mercado:** el *last cost* es lo que se usa por defecto en varios POS, y **no es un
método de valorización** — infla o desinfla el margen según cuándo se compró la última vez.
**Por qué le importa a quien compra:** el margen que ve en el reporte es el margen real, no
un artefacto de la última factura.
**Evidencia:** [ADR-016](adr/016-costeo-promedio-ponderado-movil.md) ·
[spec](superpowers/specs/2026-07-26-costeo-cpp-design.md) · relevamiento: Lightspeed, Odoo
y otros.
**Estado:** ✅ Implementado 2026-07-26 ([ESTADO](ESTADO.md)).

### En un descuento por tramos, los porcentajes se aplican antes que los montos fijos

**Nosotros:** dentro de un mismo paso, primero los porcentajes y después los montos fijos —
un orden fijo y explícito, no el que resulte del orden en que se cargaron las reglas.
**El mercado:** **ningún POS del relevamiento lo hace**; el resultado depende del orden de
carga, que es invisible para el que configura.
**Por qué le importa:** dos locales con las mismas promociones cobran lo mismo. Y el mismo
carrito da el mismo total hoy y mañana.
**Evidencia:** [investigación 2026-08-11](agent/investigaciones/2026-08-11-orden-de-descuentos.md) ·
[motor de precios](features/motor-calculo-precios.md).
**Estado:** ✅ Implementado 2026-08-11.

### El reembolso se acota contra el efectivo cobrado, no contra el ticket

**Nosotros:** lo que se puede devolver está limitado por lo que efectivamente entró.
**El mercado:** Toast y Lightspeed acotan el refund contra **el pago**; ninguno de los ocho
relevados (Toast, Square, Clover, Lightspeed, Bsale, Toteat, Defontana, Fudo) documenta la
regla que usamos. **La decisión es nuestra, no copiada.**
**Por qué le importa:** no se puede devolver plata que nunca entró.
**Evidencia:** [investigación 2026-07-27](agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md).
**Estado:** ✅ Implementado 2026-07-10.

---

## 📐 Diseñado, todavía no construido

> No usar en comunicación como si existiera.

### Conteo por denominación, configurable por tenant

**Nosotros:** el cajero carga cuántos billetes de cada uno y el sistema suma; cada tenant
elige si lo usa o carga un total.
**El mercado:** **nadie local lo hace** (relevamiento LatAm/Chile 2026-07-23).
**Por qué le importa:** menos errores de suma, y con el cierre ciego es más difícil
apuntarle a un número cuando no sumás vos.
**Evidencia:** [investigación §8.3](agent/investigaciones/2026-07-23-gestion-caja.md).
**Estado:** 📐 Decidido 2026-08-11, sin construir.

### El happy hour que cruza la medianoche está definido, no indefinido

**Nosotros:** la franja horaria de una promoción admite `hora_inicio > hora_fin` con
semántica explícita de cruce de medianoche (18:00–02:00), fijada en el esquema y con test.
**El mercado:** los cuatro POS internacionales relevados por documentación oficial (Toast,
Square, Lightspeed, Clover) programan promociones por día y hora, y **ninguno de los
cuatro documenta qué pasa cuando la ventana cruza medianoche**.
**Por qué le importa a quien compra:** el happy hour de un bar termina a las 2 AM, no a
las 23:59 — el caso que nadie especifica es el caso normal del rubro nocturno.
⚠️ Regla 3 de este archivo: lo relevado es documentación pública; que no lo documenten no
prueba que no lo manejen.
**Evidencia:** [spec del motor de promociones §investigación](superpowers/specs/2026-08-27-motor-promociones-design.md#investigación-de-mercado-2026-08-27-y-su-cruce-contra-este-diseño).
**Estado:** 📐 Diseñado 2026-08-27, sin construir.

### El reparto del combo a precio fijo es determinista y auditable

**Nosotros:** el descuento de un combo a precio fijo se reparte entre sus líneas a
prorrata del neto, con el residuo asignado por mayores restos — el mismo mecanismo
determinista que el motor ya usa para las reglas de documento — y queda congelado por
línea en `ventas_promociones`.
**El mercado:** de los cuatro relevados, **solo Toast documenta una fórmula de prorrateo**
(proporcional al precio original, impuesto recalculado post-prorrateo); Square declara que
"apportions" sin publicar la fórmula, y Lightspeed y Clover no documentan nada. Ninguno
documenta qué pasa con el residuo del reparto.
**Por qué le importa a quien compra:** el impuesto de cada componente sale de un reparto
que se puede explicar peso por peso, y dos cierres del mismo combo dan el mismo ticket.
⚠️ Regla 3: ausencia de documentación pública ≠ ausencia de la función.
**Evidencia:** [spec del motor de promociones §investigación](superpowers/specs/2026-08-27-motor-promociones-design.md#investigación-de-mercado-2026-08-27-y-su-cruce-contra-este-diseño) ·
[Toast — effect of discounts on prices](https://doc.toasttab.com/doc/platformguide/adminDiscountPricing.html).
**Estado:** 📐 Diseñado 2026-08-27, sin construir.

---

## 💡 Hallazgos sin diseñar

> Oportunidades detectadas. No hay ni diseño.

### Descomponer el IVA de una nota de crédito emitida por monto

**El hueco:** **ninguno de los 7 productos relevados** —Square, Toast, Clover, Lightspeed,
Bsale, Defontana, Nubox— documenta un algoritmo que tome un monto de nota de crédito o
reembolso **libre, no ligado a líneas** de la venta original y lo descomponga en
neto/exento/IVA prorrateando sobre la mezcla de tasas y exenciones de esa venta. Los tres que
documentan algo **evitan el problema** por tres caminos distintos: Square y Toast **excluyen**
el monto libre del desglose fiscal (*"partial refunds will not include tax and tips in
reporting"*; *"custom amount refunds are not tied to specific items… they do not break down by
sales category"*); Clover lo **prohíbe** por API cuando hay impuesto y obliga a itemizar; y
Bsale se lo **delega a un humano** por transacción —el texto que su propia guía sugiere para
la glosa es *"Verificar si lleva o no lleva IVA esta devolución"*—.
**Por qué nos toca justo a nosotros:** la NC por monto es **nuestro camino principal**
(`crearNotaCredito(params.monto)`, con las líneas devueltas como parámetro opcional), o sea
que el caso que el mercado evita es el que nuestro modelo pone al frente.
**Estado: 💡 hallazgo, sin diseño y sin decisión.** Hoy la NC declara `total_impuestos = 0`.
Si el sistema termina resolviéndolo con un mecanismo propio, **ahí** se convierte en
diferenciador; mientras tanto es un hueco que compartimos con el mercado, y así hay que
decirlo.
⚠️ Regla 3 de este archivo: lo relevado es **documentación pública**. Que Square o Toast no
publiquen el desglose no prueba que internamente no lo calculen.
**Evidencia:** [investigación 2026-08-22 §3, §4 y §7](agent/investigaciones/2026-08-22-descomposicion-nota-credito.md).

### Sellar y contar después

**El hueco:** ningún POS de restaurante/retail chico modela *"cerré sin contar porque el
efectivo quedó sellado"*. Toast, Square y Lightspeed dejan cerrar sin contar o cerrar el
cajón de otro con override, pero ninguno representa el sellado. El único con esa semántica
es Oracle Xstore (`Remove Till`), que es software de cadenas.
**La práctica existe hace décadas** en banca y retail grande (bolsas *hold-for-processing*
de U.S. Bank: monto declarado antes de sellar, plazo máximo, apertura entre dos si el dueño
no aparece).
**Y nuestro modelo casi lo soporta:** el cajón físico ya es una entidad distinta de la
sesión de caja, que es la separación que el patrón exige. Lo que lo impide es una regla —la
caja en conciliación ocupa cajón y cajero—, no la arquitectura.
**Evidencia:** [investigación §10.5 y §10.7](agent/investigaciones/2026-07-23-gestion-caja.md).

### Guía de despacho electrónica en traslados entre bodegas

**El hueco:** en Chile, mover mercadería por vía pública exige **guía de despacho
electrónica (DTE 52)** aunque no haya venta — el traslado interno usa código 5 y el motivo
debe declararse. **Ningún POS internacional lo contempla**; es una obligación local que
convierte un movimiento interno en un documento tributario.
**Estado del producto:** hoy **no hay multi-bodega ni traslados**, así que esto es una
oportunidad futura, no una ventaja actual.
**Evidencia:** [investigación 2026-07-26](agent/investigaciones/2026-07-26-inventario.md) ·
Resolución 154 del SII · Bsale lo implementa así.

### Acumulación exacta de notas de crédito parciales

**El hueco:** **ningún POS chileno documenta públicamente** cómo acumula NCs parciales
—por monto, por línea, o ambas—. Tampoco hay documentación sobre anular una venta cuyo
stock ya se revendió, ni sobre anulación concurrente.
**Evidencia:** [investigación 2026-07-27](agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md).

### El descuadre de 1 peso al despejar la base desde un precio con impuesto incluido

**El hueco:** cuando el precio de góndola **incluye** el impuesto y hay que despejar la base
imponible, "base + impuesto" redondeados pueden no dar exactamente el precio mostrado. La
diferencia es de una unidad mínima de la moneda y aparece siempre, en cualquier sistema.
**Ninguna de las cinco autoridades tributarias relevadas lo legisla** — ni el SII de Chile,
ni HMRC del Reino Unido, ni la DIAN de Colombia, ni el SAT de México, ni la NTA de Japón. Se
relevó buscando la regla explícita en cada una; las cinco norman **otras** cosas del redondeo
(por línea vs total, precisión de campos, criterio del algoritmo) y ninguna aborda ésta.
**Y no es que el problema sea desconocido**: UBL / EN 16931 tiene un campo estándar para la
diferencia (`cbc:PayableRoundingAmount`, BT‑114) que Colombia reutiliza. O sea, el formato lo
reconoce; la autoridad no dice qué hacer con él en este caso puntual. ⚠️ El DTE chileno
**no** parece tener ese campo, y la normativa de 2017 prohíbe expresamente aplicar el ajuste
como un descuento que afecte la base del IVA — así que en Chile la diferencia **no tiene
dónde ir dentro del documento**.
**Por qué le importa:** es plata que aparece o desaparece en cada boleta con precio final
redondo, que es el caso normal de un restaurante o un minimarket. Quien lo resuelva de forma
explícita y auditable puede explicar sus totales; quien no, tiene un descuadre que nadie sabe
de dónde sale.
**Estado del producto:** 💡 hallazgo. **Todavía no hay decisión ni diseño** — el tema entero
(decimales y redondeo) está en investigación cerrada y pendiente de spec con el owner.
**Evidencia:** [investigación 2026-08-15 §6 y §8](agent/investigaciones/2026-08-15-decimales-y-redondeo.md) ·
TJUE C‑484/06 (*Ahold*) · HMRC VATREC12020 · SAT Anexo 20 · DIAN Anexo Técnico v1.9 ·
NTA (facturas calificadas) · Peppol BIS `PayableRoundingAmount`.

### El nivel de redondeo lo decide el país, no el usuario

**El hueco:** *"¿el impuesto se redondea por línea o al total del documento?"* tiene respuesta
legal distinta según el país —el Reino Unido obliga por línea y declara redondear el total
*"inapropiado para minoristas"*; México obliga exactamente al revés— y **ninguno de los once
productos relevados lo deriva de la jurisdicción**: Odoo, Avalara, Stripe (tasas manuales),
NetSuite, Zuora y Toast lo exponen como **setting**, y el usuario tiene que saber la norma de
su país para elegir bien. Square, Lightspeed, Clover y SAP directamente fijan uno. La única
excepción es Stripe Tax automático, que fija *suma-y-redondea-una-vez* — pero para **evitar**
la pregunta, no para resolverla por país.
**Por qué nos importa:** el producto es multi-tenant y multi-país, y ya deriva del país la
moneda oficial en vez de dejarla elegir. Aplicar el mismo criterio al nivel de redondeo es
coherente con el modelo que ya existe — y le saca de encima al dueño de un restaurante una
decisión tributaria que no tiene por qué saber contestar.
**Qué se relevó:** once productos (Toast, Square, Lightspeed, Clover, Odoo, SAP, NetSuite,
Zuora, Stripe, Avalara, Vertex) y cinco autoridades tributarias.
⚠️ **Ausencia de documentación pública no es ausencia de la función**: lo medido es que ninguno
lo **documenta** como derivación automática del país.
**Estado del producto:** 💡 hallazgo. No hay decisión ni diseño: es una de las preguntas
abiertas de la investigación.
**Evidencia:** [investigación 2026-08-20 §1](agent/investigaciones/2026-08-20-redondeo-por-linea-o-por-total.md) ·
[docs.stripe.com — tax rate rounding](https://docs.stripe.com/billing/taxes/tax-rates) ·
Avalara `RoundingLevelId` · NetSuite Tax Rounding Levels · TJUE C‑484/06.

---

## Cómo se agrega una entrada

Cuando una investigación diga *"ningún POS…"*, *"nadie lo documenta"* o *"la decisión es
nuestra"*, **eso es una entrada acá** — en el mismo commit que la investigación, mientras
está fresco. Formato: qué hacemos nosotros, qué hace el mercado (con qué se relevó), por qué
le importa a quien compra, evidencia linkeada, y **estado literal**.

Si algo cambia de estado —se construye, o se descubre que un competidor sí lo tiene—, se
actualiza acá también.
