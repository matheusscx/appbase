# Hora de corte del día del negocio — investigación de mercado

**Fecha:** 2026-09-18 (1ª pasada — internacional + Chile)
**Estado:** 🔎 En investigación — insumo, todavía no hay diseño ni decisión tomada. No se tocó código.
**Motivada por:** [`docs/agent/pendientes.md`](../pendientes.md) § *"El día del negocio termina en una
hora de corte (owner, 2026-09-18)"* — un bar que abre sábado 19:00 y cierra domingo 03:00 cobra una
cuenta a la 01:30; con corte a medianoche esa venta cae en domingo, partiendo el sábado en dos.

> ⚠️ Método (`docs/agent/investigacion-mercado.md`): lo que trae el mercado es **insumo para
> cruzar, no verdad a copiar**. Al final de cada sección se marca qué sobrevive al cruce contra
> `rango-fecha.util.ts`, `zonaHorariaTenant` y el módulo de cajas, y qué queda como **decisión del
> owner**.

---

## Resumen (lo que el mercado hace, en bullets)

- El concepto tiene nombre estándar — **"business day cutoff"** (Toast), **"close of day"**
  (Square), **"business date"** (NCR Aloha) — y es **un solo campo de configuración**, casi
  siempre a nivel de local/cuenta, casi nunca por cuenta individual del usuario.
- **Square es el único de los cuatro grandes que ofrece una hora distinta por día de la
  semana**; Toast, Clover y Aloha usan **una sola hora para toda la semana**.
- **Ninguna fuente documenta si cambiar la hora recalcula el pasado.** Es un hueco del mercado,
  no un dato que se pueda dar por sobreentendido en ningún sentido (ver §2).
- El corte es un **hecho operativo** que se **congela al cerrar** el turno/caja — no una vista
  que se recalcule después — en todos los productos que documentan el mecanismo (Oracle Xstore,
  Aloha).
- El corte **fuerza el cierre de turnos y cajas** en el momento configurado: Toast auto-cierra
  cajones y hace clock-out de empleados a esa hora; Aloha tiene un **cutoff duro** (8am) que
  bloquea editar turnos de un día ya cerrado y exige un "Force Close".
- Para operación 24 horas, Toast recomienda explícitamente **desactivar el auto clock-out** y
  cerrar turnos manualmente antes del corte — no hay una solución automática satisfactoria; el
  "nunca cierra" es una excepción operada a mano, no un modo soportado nativamente.
- **En Chile, el SII no tiene ningún concepto de "día de negocio".** Las boletas viajan
  transaccionales en tiempo real y **deben emitirse el mismo día calendario de la venta**: el
  corte del negocio es una vista de reporte interno, nunca una fecha tributaria. Esto es lo más
  importante del cruce con lo que ya existe (§6 y "Cruce con lo que ya existe").
- Ningún POS local (Toteat, Bsale, Fudo, Defontana) publica documentación pública sobre un campo
  de "hora de corte" configurable — la señal de Chile está en la norma (SII), no en la
  competencia, igual que ya advirtió `docs/agent/investigacion-mercado.md` para otras pasadas.

---

## 1. Nombre del concepto y dónde se configura

| POS | Nombre | Dónde se configura | Nivel |
|---|---|---|---|
| **Toast** | **Business day cutoff** ("Close Out Day") | Backend de Toast; **no autoservicio** — hay que pedirle el cambio a Toast Customer Care | Por restaurante |
| **Square** | **Close of day** | Square Dashboard → Account & Settings → Location → Business Hours | Por ubicación (location) |
| **Lightspeed Restaurant (K-Series)** | **Sales period** / "closing the sales period" — el "Consolidated Fiscal Report" cierra fijo a las 5:29 del día siguiente | App / backoffice | No documentado si es configurable por local |
| **Clover** | **"End of day"** (dentro de la app Setup) | Setup app del dashboard web de Clover | Por comercio; ejemplo público: bares/restaurantes lo mueven a la 1am en vez de medianoche |
| **NCR Voyix Aloha Cloud** | **Business date** | Config interna — "contactar a Customer Care" para cambiar la hora | Por sitio |
| **KORONA POS** | **Automatic End of Day** | Settings → POS Profiles → perfil → Automatic End of Day | Por perfil de POS |

**No encontrado:** el término genérico "day part" u "hora de cierre fiscal" que a veces se usa
como sinónimo en foros **no es el mismo concepto** — ver la aclaración en §5.

Fuentes:
- [Toast — Close Out Day, Z Report, and Auto-Capture Overview](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)
- [Toast — Best Practices for 24 Hour Operations](https://support.toasttab.com/en/article/Best-Practices-for-24-Hour-Operations)
- [Square — Customize your close of day](https://squareup.com/help/us/en/article/5439-customize-your-close-of-day)
- [Lightspeed K-Series — Consolidated Fiscal Report](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403156188443-Consolidated-Fiscal-Report)
- [NCR Voyix Aloha Cloud — Understanding business dates](https://docs.ncrvoyix.com/restaurant/aloha-cloud/using/understanding_business_dates)
- [KORONA POS — Finish Day / End of Day Statements](https://manual.koronapos.com/finish-day-end-of-day-statement/)
- Clover "end of day 1am" — confirmado solo por resultados de búsqueda agregados sobre el Setup
  app; **no se encontró el artículo oficial de soporte con el paso a paso** (queda como "no
  encontrado" el detalle exacto de la UI, aunque el hecho de que sea configurable sí aparece
  citado en varias fuentes de soporte de terceros).

---

## 2. ¿Recalcula el pasado o queda congelado?

**Esta es la pregunta que menos documenta el mercado.** Ningún fabricante grande (Toast, Square,
Clover, Lightspeed) publica qué pasa con las ventas **ya cerradas** cuando se cambia la hora de
corte. Lo más cercano:

- **Oracle Payment Cloud** (no es un POS de restaurante, es infraestructura de pagos) sí
  documenta que un ajuste de "business day" puede aplicarse **retroactivamente hasta 90 días** y
  afectar reportes históricos, con hasta 12 horas de demora en propagarse — pero es una pieza de
  conciliación de pagos, no un POS de mostrador, así que **no es comparable 1:1**.
- **NCR Aloha** describe el mecanismo de cierre (umbral de 3am intenta cerrar, 8am fuerza) pero
  **no dice qué pasa si se cambia la hora de corte con historial ya cerrado** — su documentación
  se enfoca en el flujo hacia adelante.
- **Los hilos de la comunidad de Square** (varios, ver fuentes) tratan el problema desde el otro
  lado: usuarios que cambiaron su "close of day" y **el reporte de ventas diarias siguió
  cortando a medianoche igual**, un bug/limitación conocida que Square no arregló — la evidencia
  indirecta es que **algunos reportes de Square leen el corte configurado y otros no**, lo cual
  sugiere que el dato de "a qué día pertenece" no está unificado en un solo lugar del sistema, ni
  siquiera dentro del mismo producto.

**No encontrado, explícito:** ninguna fuente dice "el día de negocio se graba en la venta al
cerrarla" ni "se deriva siempre del timestamp al consultar". Es una laguna real del mercado, no
una omisión de esta investigación.

**Interpretación (no verificada, mía):** que ni Square logre que todos sus reportes obedezcan el
mismo corte es indicio indirecto de que la implementación más simple —derivar el día de negocio
del timestamp en cada consulta, sin persistirlo— es también la más común, y es la que **peor
convive** con un cambio de hora de corte a mitad de camino, porque un mismo timestamp puede
"mudarse" de día de negocio la próxima vez que alguien mire el mismo reporte. Persistirlo (grabar
el día de negocio en la venta al momento de cerrarla, como hace nuestra caja con `estado`) evita
ese problema pero exige decidir explícitamente si un cambio de configuración afecta solo lo nuevo.

Fuentes:
- [Oracle Payment Cloud — Adjust a Business Day](https://docs.oracle.com/en/industries/oracle-payment-cloud/latest/opcsc/t_adjust_business_day.html)
- [Square Community — Daily sales reports email cuts off at 12am even though close of day changed](https://community.squareup.com/t5/Archived-Discussions-Read-Only/How-do-I-change-the-daily-sales-reports-if-my-close-of-day-is/m-p/135175)
- [Square Community — 24 hour sales report](https://community.squareup.com/t5/Archived-Discussions-Read-Only/How-do-I-change-the-daily-sales-reports-if-my-close-of-day-is/m-p/87289)
- [Square Community — Change the "operating day" times so reporting matches](https://community.squareup.com/t5/Archived-Discussions-Read-Only/How-do-I-change-the-daily-sales-reports-if-my-close-of-day-is/m-p/104717)

---

## 3. ¿Una hora para toda la semana, o una por día?

- **Square: una hora distinta por día de la semana**, configurable desde el dashboard — la única
  fuente que lo confirma explícitamente ("set a custom close of day time for each day of the
  week"). Encaja con el caso real de un bar que cierra distinto viernes/sábado que entre semana.
- **Toast, Clover, NCR Aloha, KORONA: una sola hora para todos los días.** Toast lo dice
  indirecto (recomienda fijar el corte "entre las 12:00am y las 7:00am… en tu horario más
  tranquilo", en singular, y cualquier cambio requiere contactar soporte — no hay UI de
  autoservicio, mucho menos por día).
- **Lightspeed K-Series:** el "Consolidated Fiscal Report" corta fijo a las 5:29 del día
  siguiente — no encontrado si es configurable en absoluto, y mucho menos por día de semana.

**Conclusión del mercado:** la mayoría resuelve con **una hora fija**; el caso "una por día de
semana" existe (Square) pero es la excepción, no la norma — y justo la fuente que lo confirma no
dice si esa granularidad interactúa bien con el problema de §2 (retroactividad).

---

## 4. Interacción con reportes, cierre de caja/turnos y "Z report"

- **Toast:** al llegar el corte, el sistema automáticamente **cierra todos los cajones
  abiertos**, hace **clock-out de todos los empleados fichados** y **auto-captura los pagos con
  tarjeta pendientes** del día anterior. Recomienda a los locales de 24 horas hacer el "shift
  review" y cerrar caja **manualmente, empezando 30 minutos antes del corte**, porque el proceso
  automático puede tardar hasta media hora — es decir, **el corte no espera a que las cajas estén
  listas**, hay que anticiparse.
- **Para operación 24 horas, Toast recomienda explícitamente desactivar el auto clock-out**: si
  el local nunca cierra, forzar el clock-out de todos a una hora fija rompe el reporte de horas
  trabajadas de quien sigue en turno; queda como disciplina manual (cada empleado se marca la
  salida cuando de verdad termina).
- **NCR Aloha** tiene el mecanismo más explícito de los investigados: **umbral de las 3am**
  intenta cerrar automáticamente el día de negocio; **umbral duro de las 8am** bloquea el acceso a
  días anteriores si quedan turnos u órdenes abiertas — nadie puede loguearse a crear/editar
  turnos u órdenes de un día ya cerrado. Si algo quedó abierto y se llega al corte duro, existe un
  botón de **"Force Close"** que cierra todo de una.
- **Ventas dentro de la ventana del corte:** ninguna fuente documenta qué pasa con una venta que
  se está registrando *exactamente* en el instante del corte (ni Toast ni Aloha lo especifican) —
  **no encontrado**.
- **Terminología Z report:** viene de cajas registradoras fiscales de EE.UU. y **ninguna fuente
  de esta pasada la usa para el concepto de "business day"** — es un reporte de cierre de turno
  aparte, no el mecanismo de corte del día. (Esto ya lo había confirmado la investigación de caja,
  §8.2 de `2026-07-23-gestion-caja.md`: LatAm tampoco usa X/Z.)

Fuentes:
- [Toast — Close Out Day, Z Report, and Auto-Capture Overview](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)
- [Toast — Best Practices for 24 Hour Operations](https://support.toasttab.com/en/article/Best-Practices-for-24-Hour-Operations)
- [NCR Voyix Aloha Cloud — Understanding business dates](https://docs.ncrvoyix.com/restaurant/aloha-cloud/using/understanding_business_dates)

---

## 5. Casos borde que se suelen olvidar

- **Locales 24 horas:** ninguno de los productos investigados tiene un modo nativo satisfactorio
  — todos requieren desactivar comportamiento automático (clock-out, cierre forzado) y operar a
  mano. Es la confirmación más sólida de esta pasada, con tres fuentes independientes
  convergiendo (Toast explícito; Aloha implícito vía "Force Close"; Clover solo referencia
  indirecta de mover el corte a la 1am en vez de resolver el 24h real).
- **Múltiples zonas horarias:** **no encontrado** en ninguna fuente — todos los productos
  documentan el corte como si el negocio tuviera una sola zona. No es sorpresa: ninguno de los
  investigados es multi-tenant con provincias en dos husos como el proyecto (`America/Santiago` /
  `Pacific/Easter`).
- **Cambio de horario de verano (DST):** no encontrado un caso documentado por un POS de
  restaurante específicamente, pero el fenómeno general está bien caracterizado — el día del
  cambio de primavera tiene **23 horas** (una hora "no existe") y el de otoño tiene **25** (una
  hora se repite) — y es exactamente el tipo de arista que un corte a la madrugada atraviesa de
  lleno.
  🇨🇱 **Y esto no es hipotético para el proyecto: Chile sigue cambiando la hora.** El
  Decreto N°98 (jul-2026) fija el paso a horario de verano la noche del **sábado 5 de septiembre
  de 2026**: de las 23:59:59 del sábado se salta directo a la 01:00:00 del domingo (23 horas, sin
  la hora entre 00:00 y 01:00). Un bar con corte a las 05:00 que opera esa noche tiene su "sábado"
  cruzando exactamente por el instante del salto — el ejemplo del bar de la pendiente
  (sábado 19:00 → domingo 03:00) se superpone letra por letra con esta fecha real. **Aysén y
  Magallanes tienen excepción** en el mismo decreto: otra confirmación de que Chile ya tiene
  múltiples reglas horarias por región, coherente con que `provincia.zona_horaria` no sea una
  columna decorativa.
- **Propinas / reportes de garzón que cruzan el corte:** no encontrado en ninguna fuente de esta
  pasada — no se investigó específicamente y ningún resultado lo mencionó de pasada.

Fuentes:
- [Toast — Best Practices for 24 Hour Operations](https://support.toasttab.com/en/article/Best-Practices-for-24-Hour-Operations)
- [timeanddate.com — How Does Daylight Saving Time Work?](https://www.timeanddate.com/time/dst/transition.html)
- [El Mostrador — Cambio de hora Chile 2026](https://www.elmostrador.cl/datos-utiles/2026/08/23/tardes-mas-largas-la-fecha-en-que-cambiara-la-hora-en-chile-y-la-advertencia-que-debes-saber/)
- [Reporte Minero — Cambio de hora Chile 2026, Decreto 98](https://www.reporteminero.cl/noticia/noticias/2026/08/cambio-de-hora-chile-2026-cuando-es-horario-de-verano-decreto-98)

**Aclaración de terminología (no un caso borde, pero se confunde seguido):** "day part"
(desayuno/almuerzo/cena/happy hour) **no es sinónimo de "business day"**. El day part subdivide
el día de negocio para reportes y precios por horario; el "business day cutoff" define **dónde
empieza y termina** ese día. Son ejes ortogonales — y es justo la distinción que ya hace la
pendiente al excluir el motor de precios (`calculo-precios.service.ts` usa hora de reloj para el
happy hour, no día de negocio).

---

## 6. Chile (obligatorio)

### 6.1 POS locales

**No se encontró documentación pública** de Toteat, Bsale, Fudo o Defontana sobre un campo de
"hora de corte" o "business day" configurable. Toteat solo publica que hay que "abrir turno y
caja dentro de los horarios configurados de la tienda" (horario de disponibilidad, no corte de
día contable) y remite a soporte para cualquier detalle fino. Es la misma situación que
`docs/agent/investigacion-mercado.md` ya advirtió: **los POS chilenos publican cómo cargar datos
en la UI, no la lógica de su motor** — acá directamente no publican ni la UI.

Fuentes:
- [Toteat — Recomendaciones de Uso Toteat-Mercat](https://ayuda.mercat.cl/es/articles/8295613-recomendaciones-de-uso-toteat-mercat)
- [Toteat — Centro de ayuda](https://toteat.com/ayuda)

### 6.2 El SII y la fecha del documento tributario — el hallazgo central de esta pasada

**Verificado, con fuente:**

1. **Las boletas electrónicas deben emitirse el mismo día calendario de la venta.** No es una
   sugerencia operativa, es la regla: "las boletas electrónicas deben emitirse el mismo día de la
   venta o prestación del servicio". El campo `FchEmis` del formato DTE es una fecha
   (`AAAA-MM-DD`, sin componente de hora) y **no tiene ningún concepto de "día de negocio"**: es
   la fecha calendario real en la que se emite el documento.
2. **El Resumen de Ventas Diarias (RVD) — lo más parecido a un "día de negocio" que tuvo el
   sistema chileno — se eliminó en agosto de 2022.** Desde entonces el **Registro de Ventas (RV)**
   del SII se alimenta directamente de cada boleta electrónica recibida, **transacción por
   transacción**, no de un resumen consolidado por día. (Esto ya estaba confirmado en la
   investigación de caja, §8.7 de `2026-07-23-gestion-caja.md` — se re-verifica acá porque es el
   corazón de la pregunta 6.)
3. **Consecuencia directa para el diseño:** el "día de negocio" configurable por el tenant
   **no puede tocar la fecha de emisión del documento tributario**. Una venta cobrada a la 01:30
   del domingo, aunque el reporte interno la muestre como "sábado" por el corte a las 05:00, tiene
   que emitir su boleta con `FchEmis` = fecha real (domingo), porque eso es lo que exige la norma
   y lo que ya recibe el SII en tiempo real. El día de negocio es, y solo puede ser, **una vista
   de reporte interno** — nunca el campo que alimenta el documento tributario.

**No encontrado, explícito:** ningún texto del SII usa la frase "día de negocio" ni contempla el
escenario de un negocio que corta después de medianoche — la norma simplemente no tiene ese
concepto, opera 100% por fecha/hora real de emisión. Es coherente con que el RVD (que sí agrupaba
por día) haya sido eliminado en 2022: el sistema actual no agrupa nada por día en el momento de
recibir el documento, agrupa por transacción.

Fuentes:
- [SII — Preguntas Frecuentes, plazo de emisión (vía tuu.cl, cita la regla)](https://blog.tuu.cl/plazo-de-la-boleta-electronica-obligatoria-del-sii)
- [SII — FORMATO BOLETAS ELECTRÓNICAS DE VENTAS Y SERVICIOS 2023-06-01 v4.00 (campo `FchEmis`)](https://www.sii.cl/factura_electronica/factura_mercado/formato_boletas_elec_202306.pdf)
- [SII — SII elimina obligación de enviar el resumen de ventas diarias (ago-2022)](https://www.sii.cl/noticias/2022/160622noti01rp.htm)
- [SII — SII recuerda que se eliminó la obligación de enviar resumen de ventas diarias](https://www.sii.cl/noticias/2022/040822noti01rp.htm)
- [SII — Registro de Compras y Ventas](https://www.sii.cl/servicios_online/1039-3256.html)

---

## Cruce con lo que ya existe

### Qué del mercado aplica

- **Nombre y forma del concepto:** "hora de corte del día de negocio" como **una configuración
  por tenant** (no por usuario, no por sucursal — el proyecto no tiene sucursales) es exactamente
  lo que hace la mayoría del mercado (Toast, Aloha, Clover). No hay nada exótico en el pedido del
  owner.
- **El corte fuerza decisiones sobre turnos/cajas abiertas cruzando la medianoche:** hoy
  `zonaHorariaTenant`/`fechaLocalTenant`/`instanteLocalTenant` (`rango-fecha.util.ts`) colapsan un
  instante a un día **calendario local** (medianoche a medianoche) usando `Intl` con la zona de
  la provincia del tenant. Introducir una hora de corte configurable significa que **estas
  funciones (o una nueva junto a ellas) tienen que aceptar el corte como parámetro** — no es un
  cambio de zona horaria, es un cambio de **dónde arranca el día dentro de esa zona**. El
  mecanismo DST-correcto (`Intl`, sin librería nueva) sigue sirviendo: correr el mismo cálculo
  contra `instante - horaDeCorte` en vez de contra `instante` a secas resuelve el corrimiento sin
  tocar la resolución de zona.
- **Cajas:** el ejemplo del bar (19:00 sábado → 03:00 domingo, corte 05:00) calza con una caja
  física real: la sesión de caja (`cajas`, ver `docs/features/gestion-cajas.md`) que se abre el
  sábado y cierra el domingo de madrugada. La mecánica de Toast (auto-cerrar cajones al corte) y
  Aloha (force-close si quedan turnos abiertos al corte duro) **no aplica tal cual**: nuestro
  modelo de caja es manual (apertura/cierre por el cajero, sin auto-cierre por horario) y así debe
  seguir — automatizar el cierre de una caja física por hora de corte sería una feature nueva, no
  parte de esta. Lo que sí aplica es la **pregunta**, no la respuesta: si una caja queda abierta
  cruzando el corte, ¿a qué "día de negocio" pertenece su cierre? El mercado no contesta esto con
  un ejemplo reusable (ninguna fuente lo especifica, §4) — es decisión del owner.

### Qué NO aplica

- **X/Z report:** no existe en nuestro modelo (ya se confirmó en la investigación de caja) y esta
  pasada no encontró que LatAm lo use tampoco — no hay nada que adaptar acá.
- **Auto clock-out de empleados al corte (Toast):** el proyecto no tiene reloj control de
  asistencia — no aplica.
- **Cierre automático de caja al llegar la hora de corte:** fuera de alcance según la pendiente
  misma ("va entera, no pantalla por pantalla" — es un cambio de cómo se **lee** el día, no de
  cuándo se **fuerza** un cierre). Ningún hallazgo de esta pasada cambia eso.
- **Una hora distinta por día de la semana (Square):** es la minoría del mercado, no la norma —
  ver decisión pendiente abajo.

### Huecos del mercado (anotados en [`DIFERENCIADORES.md`](../../DIFERENCIADORES.md), 💡 hallazgo)

- **Ningún POS documenta si cambiar la hora de corte recalcula el historial o lo deja congelado**
  (§2). Si el proyecto documenta explícitamente esa decisión (cualquiera sea), ya es más
  transparente que todo lo investigado.
- **Ningún POS documenta el comportamiento exacto de una venta ocurriendo en el instante del
  corte** (§4).
- ~~Cruce de la hora de corte con multi-zona dentro del mismo tenant~~ — **descartado al
  cruzar con el código:** `zonaHorariaTenant` resuelve **una sola** zona por tenant (la de
  `tenants.provincia_id`), y el proyecto no tiene sucursales. Que existan provincias en dos
  husos (`America/Santiago` / `Pacific/Easter`) es multi-zona **entre** tenants, no dentro de
  uno: el corte de cada tenant se aplica en su única zona y no enfrenta este problema.

### Decisiones que quedan para el owner

**1. ¿Cambiar la hora de corte recalcula los días pasados, o los deja congelados?**

El mercado no contesta esto (§2) — es 100% decisión del owner. En lenguaje de local:

- **Opción "recalcula" (el día se deriva del timestamp cada vez que se consulta, como hoy hace
  `fechaLocalTenant` con la medianoche):** si el dueño del bar cambia el corte de 05:00 a 03:00 el
  lunes, **todo el historial pasado se reacomoda solo** — el reporte del sábado anterior puede
  mostrar un total distinto al que el dueño vio el domingo a la mañana, sin que nadie haya tocado
  una venta. Costo: un reporte que un día dijo "$450.000" puede decir "$410.000" la próxima vez
  que se abra, y no hay forma de explicarle al dueño por qué cambió si no sabe que tocó la
  configuración.
- **Opción "congela" (el día de negocio se graba en la venta al momento de cerrarla, como hoy
  graba `cajas.estado` al cerrar):** cambiar el corte el lunes **no mueve una sola venta vieja**
  — todo lo de antes del cambio queda con el corte que tenía vigente en ese momento; solo las
  ventas nuevas usan el corte nuevo. Costo: dos ventas del mismo instante de reloj, una de antes y
  otra de después del cambio de config, pueden terminar en "días de negocio" calculados con
  reglas distintas — hay que estar dispuesto a explicar eso si el dueño pregunta por qué el
  reporte "no es consistente" entre dos fechas que rodean el cambio.

Precedente ya existente en el proyecto: `cajas` graba el resultado del cierre (no lo deriva
después), y `caja_arqueo_medio` se congela explícitamente "nunca se recalcula después" — la
convención del proyecto hasta ahora es **congelar los hechos de negocio**, no re-derivarlos. Es un
dato para la conversación, no un veredicto — el owner puede decidir que el día de negocio es
distinto (una vista de reporte, no un hecho transaccional) y elegir recalcular.

**2. ¿Una hora para toda la semana, o una por día de la semana?**

El mercado se divide 1 a 4 a favor de "una sola hora" (§3). En lenguaje de local:

- **Una sola hora:** simple de explicar y de configurar — un campo, un valor. Costo: un bar que
  cierra a las 02:00 entre semana y a las 04:00 los fines de semana tiene que elegir **un** corte
  que sirva para los dos casos (por ejemplo 05:00), lo que puede ser innecesariamente tarde para
  el lunes — una venta del lunes a las 02:30 (que claramente es "del lunes", el local ya cerró)
  quedaría igual clasificada como si el corte de 05:00 rigiera todos los días.
- **Una por día de la semana:** resuelve exactamente ese caso (viernes/sábado con corte más tarde
  que el resto de la semana), pero es más para configurar y para explicarle al dueño ("¿por qué
  el jueves corta distinto que el viernes?"), y **ningún POS documenta cómo conviven "una por
  día" con el problema de la decisión 1** (recalcular vs. congelar) — sería terreno sin mapa, no
  solo sin la respuesta de mercado sino sin la pregunta hecha por nadie más.

**Nota aparte, no una tercera opción sino una restricción dura:** cualquiera sea la hora (o las
horas) de corte, **la fecha de emisión de la boleta electrónica (`FchEmis`) sigue siendo la fecha
calendario real**, nunca el "día de negocio" (§6.2). Esto no es negociable ni depende de lo que
decida el owner sobre 1 y 2 — es lo que exige el SII.

---

## Fuentes consultadas (resumen)

- Toast: [Close Out Day Overview](https://doc.toasttab.com/doc/platformguide/platformCloseOutDayOverview.html) ·
  [Close Out Day, Z Report, Auto-Capture](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture) ·
  [Best Practices for 24 Hour Operations](https://support.toasttab.com/en/article/Best-Practices-for-24-Hour-Operations)
- Square: [Customize your close of day](https://squareup.com/help/us/en/article/5439-customize-your-close-of-day) ·
  hilos de comunidad citados en §2
- Lightspeed K-Series: [Consolidated Fiscal Report](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403156188443-Consolidated-Fiscal-Report)
- NCR Voyix Aloha Cloud: [Understanding business dates](https://docs.ncrvoyix.com/restaurant/aloha-cloud/using/understanding_business_dates)
- KORONA POS: [Finish Day / End of Day Statements](https://manual.koronapos.com/finish-day-end-of-day-statement/)
- Oracle Payment Cloud: [Adjust a Business Day](https://docs.oracle.com/en/industries/oracle-payment-cloud/latest/opcsc/t_adjust_business_day.html)
- SII: formato DTE boletas ([PDF](https://www.sii.cl/factura_electronica/factura_mercado/formato_boletas_elec_202306.pdf)) ·
  [eliminación RVD 2022](https://www.sii.cl/noticias/2022/160622noti01rp.htm) ·
  [Registro de Compras y Ventas](https://www.sii.cl/servicios_online/1039-3256.html) ·
  [plazo de emisión (vía tuu.cl)](https://blog.tuu.cl/plazo-de-la-boleta-electronica-obligatoria-del-sii)
- Toteat: [Recomendaciones de Uso Toteat-Mercat](https://ayuda.mercat.cl/es/articles/8295613-recomendaciones-de-uso-toteat-mercat)
- DST Chile 2026 (Decreto 98): [El Mostrador](https://www.elmostrador.cl/datos-utiles/2026/08/23/tardes-mas-largas-la-fecha-en-que-cambiara-la-hora-en-chile-y-la-advertencia-que-debes-saber/) ·
  [Reporte Minero](https://www.reporteminero.cl/noticia/noticias/2026/08/cambio-de-hora-chile-2026-cuando-es-horario-de-verano-decreto-98)
- Contexto interno (no mercado): [`backend/src/common/utils/rango-fecha.util.ts`](../../../backend/src/common/utils/rango-fecha.util.ts) ·
  [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md) ·
  [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](2026-07-23-gestion-caja.md) §8.2, §8.7
