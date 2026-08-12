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

### Testigo del cierre de caja — el que originó este archivo

**Nosotros:** cuando un encargado cierra la caja de un cajero ausente, un garzón en turno
puede **dar fe del conteo** desde su propia pantalla y con su propio PIN. Ve lo que se
contó —nunca lo esperado, así no se rompe el cierre ciego—, y puede **rechazar**. El
registro guarda quién contó, quién dio fe y a qué hora, **cuánta gente había disponible**, y
si no hubo testigo, por qué.
**El mercado:** **ningún POS tiene campo de testigo ni segunda firma en el cierre.** La
doble firma existe hace décadas —en formularios de papel y en políticas de manejo de
efectivo— pero **no está en el software**. Ni siquiera Oracle Xstore, que es enterprise.
**Por qué le importa:** convierte "confiar o no en el encargado" en un dato auditable. Y en
Chile, donde un faltante **no se le puede descontar al trabajador** sin asignación pactada,
lo que vale es exactamente eso: la prueba.
**Y hay precedente legal**, que es lo que lo hace defendible y no un capricho: el estándar
condiciona la responsabilidad del cajero a **dos** requisitos —acceso exclusivo y
oportunidad de estar presente en el conteo—, así que contar sin él **cae la imputación**.
**Evidencia:** [investigación §10](agent/investigaciones/2026-07-23-gestion-caja.md) ·
Law Insider (cláusulas de convenios colectivos) · DT Chile ORD. N°4229 · U.S. Bank
(hold-for-processing) · Oracle Xstore (Till Accountability).
**Estado:** 📐 Diseñado 2026-08-11. ⚠️ La parte legal chilena **está sin validar por un
abogado** — no comunicar el ángulo legal hasta que lo esté.

### Conteo por denominación, configurable por tenant

**Nosotros:** el cajero carga cuántos billetes de cada uno y el sistema suma; cada tenant
elige si lo usa o carga un total.
**El mercado:** **nadie local lo hace** (relevamiento LatAm/Chile 2026-07-23).
**Por qué le importa:** menos errores de suma, y con el cierre ciego es más difícil
apuntarle a un número cuando no sumás vos.
**Evidencia:** [investigación §8.3](agent/investigaciones/2026-07-23-gestion-caja.md).
**Estado:** 📐 Decidido 2026-08-11, sin construir.

---

## 💡 Hallazgos sin diseñar

> Oportunidades detectadas. No hay ni diseño.

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

---

## Cómo se agrega una entrada

Cuando una investigación diga *"ningún POS…"*, *"nadie lo documenta"* o *"la decisión es
nuestra"*, **eso es una entrada acá** — en el mismo commit que la investigación, mientras
está fresco. Formato: qué hacemos nosotros, qué hace el mercado (con qué se relevó), por qué
le importa a quien compra, evidencia linkeada, y **estado literal**.

Si algo cambia de estado —se construye, o se descubre que un competidor sí lo tiene—, se
actualiza acá también.
