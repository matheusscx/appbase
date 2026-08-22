# Auditoría: recurso por usuario cruzando tenants, y deadlock del pool — Plan de pasada

> **Para agentes:** esta NO es una pasada de implementación. Es una pasada de auditoría y se
> rige por [`docs/agent/auditoria-codigo.md`](../../agent/auditoria-codigo.md): buscadores
> baratos y ciegos entre sí, un refutador independiente por hallazgo, y triaje al final.

**Estado:** ✅ **lista para lanzar** — presupuesto acordado el 2026-08-22. No lanzada
todavía: falta elegir el momento, por lo que pide la lente B (ver §Cómo se dispara).

**Origen:** las dos lentes salieron de la tanda del 2026-08-15 (`resueltos.md`, *"El correo
coincide deja de ser prueba de identidad"*), donde las dos aparecieron como bugs reales y
ninguna la habría encontrado un buscador leyendo "¿está bien esta función?".

**Decisiones del owner, ya tomadas:**

- (2026-08-15) Lente B (pool): **delta y revalidación, no redescubrimiento.** Se le pasa la
  tabla existente como contexto conocido.
- (2026-08-15) Destino de los hallazgos: **solo al backlog. NO se arregla nada en esta pasada.**
- (2026-08-22) **Alcance y presupuesto: las dos lentes, tope 500k tokens.** El owner eligió
  las dos aun sabiendo que la premisa de la lente B cambió (ver §Presupuesto).

---

## Por qué estas dos y no otras

Las dos comparten la propiedad que las hace caras de encontrar y baratas de tener escritas:
**se buscan por la AUSENCIA de algo**, así que ningún grep del término las encuentra, y **se
confirman midiendo contra Postgres**, no razonando sobre el código.

Detalle, ejemplos ❌/✅ y método de detección: `docs/agent/anti-patterns.md` — entradas
*"Recurso indexado por usuario que una acción de un tenant borra en otro"* y *"Llamada
repo-bound adentro de una transacción — deadlock del pool"*.

---

## Lente A — Recurso por usuario que cruza tenants

**Cobertura previa: NINGUNA.** Es la única de las dos que es descubrimiento genuino.

**Qué caza.** El `tenant_id` sale del token, los guards están, todas las lecturas filtran
bien — y aun así una acción de un tenant destruye o expone estado observable de **otro**,
porque el recurso del medio está indexado por `usuario_id` **sin** `tenant_id` al lado. Una
persona existe en varios tenants; sus tokens, preferencias, sesiones y vínculos, no
necesariamente.

**No confundir con lo ya cubierto.** El repo ya tiene documentados dos parientes que NO son
esto: `tenant_id` tomado del request, e id ajeno aceptado del body (`assignUser` con un rol
de otro tenant, tercero de otro tenant en una venta). En ambos el atacante manda un id. Acá
**no hay id del request** y todo el filtrado es correcto.

**Cómo buscar** (el orden importa: el paso 1 acota, el 2 es el juicio):

1. Enumerar toda tabla y toda query cuyo criterio de búsqueda o PK sea `usuario_id` **sin**
   `tenant_id`. Candidatos conocidos de arranque, a confirmar y ampliar: `tokens_acceso`
   (ya corregida el 2026-08-15 — sirve de control positivo), `refresh_tokens`,
   `usuarios.preferencias`, `garzon_pin_evento`, `sesiones_garzon`, `usuarios.es_superadmin`.
2. Por cada una: **¿puede una acción disparada desde un tenant escribir o borrar acá?** Si
   sí, ¿qué ve el otro tenant cuando pasa?
3. Barrido aparte de los **borrados totales por usuario** — `invalidarTodos`, `deleteAll`,
   `revokeAll`, `delete({ userId })` y equivalentes. Casi siempre son más anchos que su
   intención; ese fue exactamente el bug de `invalidarTodos` que se corrigió.

**Cómo se confirma un hallazgo.** Montar al mismo usuario en dos tenants y ejercer la acción
desde uno. Sin ese experimento el hallazgo no entra al triaje — es la regla de "todo hallazgo
trae escenario reproducible".

**Señal de gravedad, para priorizar:** si el efecto **no deja rastro** para el tenant
afectado, sube. El caso de agosto era grave no por el borrado sino porque la persona
desaparecía del roster del otro tenant sin ningún evento que lo explicara.

---

## Lente B — Deadlock del pool (delta, no descubrimiento)

⛔ **El barrido ya se hizo el 2026-08-11** sobre todo `backend/src`, con causa confirmada por
experimento, umbral medido y **tabla de sitios en 7 módulos**. **Redescubrirlo es pagar dos
veces.**

🔴 **CORREGIDO EL 2026-08-22, y cambia el trabajo de esta lente.** Este plan se escribió
cuando los ~20 sitios estaban vivos y decía que arreglarlos "es el frente 🔴". Dos cosas
pasaron desde entonces:

1. **La entrada se movió.** Ya no está en `pendientes.md`: vive en
   [`resueltos.md`](../../agent/resueltos.md) § *"Diez ventas simultáneas cuelgan la API para
   siempre: el pool de conexiones deja de agotarse (2026-08-18)"*. **Ese es el contexto que
   hay que pasarle al buscador** — el puntero viejo lo mandaba a un lugar donde ya no está
   nada, y un buscador que no lo encuentra redescubre los siete módulos, que es justo lo que
   esta lente existe para no pagar.
2. **Los sitios se arreglaron, y por construcción.** La pata del pool cerró el **2026-08-18**
   con **[ADR-020](../../adr/020-contexto-transaccional-als.md)** (contexto transaccional en
   `AsyncLocalStorage`); el frente 🔴 entero, el 2026-08-20. Verificado el 2026-08-22: queda
   **un solo** `dataSource.transaction` en todo `backend/src` —`common/db/db.service.ts:28`,
   el chokepoint— y `TxContext` resuelve el manager activo para el resto.

**Entonces la pregunta 1 de abajo ya NO es "¿la tabla de sitios pendientes sigue exacta?"** —
esos sitios no están pendientes: están cerrados. **Lo que queda para esta lente es residuo y
delta**, y así hay que briefearla. Reportar como hallazgo un sitio que ADR-020 ya resolvió es
el fracaso más caro que puede tener esta pasada.

⛔ **Y arreglar lo que aparezca NO es parte de esta pasada.** Esta pasada solo actualiza el
mapa.

**Contexto obligatorio para el buscador:** la entrada de `resueltos.md` con su tabla de
sitios **y** ADR-020. Sin las dos, el resultado no se distingue del barrido viejo.

**Las tres preguntas, y sólo estas tres:**

1. **¿La migración de ADR-020 dejó residuo?** Sitio por sitio de la tabla vieja contra el
   código de hoy: ¿queda alguno que todavía tome conexión propia adentro de una transacción?
   La entrada avisa que la tabla **quedó stale dos veces en el mismo día**, así que esto no es
   trámite — pero el veredicto esperado por defecto es **cerrado**, y un "sigue vivo" hay que
   sostenerlo con el experimento, no con lectura.
2. **¿Hay sitios nuevos desde el 2026-08-11?** Delta acotado a lo que cambió desde esa fecha.
   Con ADR-020 en pie esto tiene una firma barata: **cualquier `dataSource.transaction` fuera
   de `common/db/db.service.ts` es sospechoso por sí solo** (hoy hay exactamente uno, el del
   chokepoint). Lo mismo para cualquier camino que se saltee `TxContext`.
3. **La vía que el barrido original NO buscaba** — y es la razón principal de esta lente.
   Aquel buscó *llamadas repo-bound agregadas adentro de una transacción existente*. El
   2026-08-15 el patrón reincidió **al revés**: la llamada ya estaba y se le agregó una
   **transacción alrededor** (`auth.service.ts` → `refresh`). Ningún grep de "llamada nueva"
   ve eso. Buscar todo `dataSource.transaction` **introducido después del 2026-08-11** y
   revisar qué código quedó envuelto.

**Cómo se confirma.** Ráfaga de ~15 requests **independientes** contra el endpoint —no una
carrera: un test de 2 concurrentes nunca llega al tamaño del pool—. Con el bug se cuelga
hasta el timeout; sin él, milisegundos. Firma en `pg_stat_activity`: `idle in transaction /
ClientRead` acumulándose hasta agotar el pool. Ya hay un detector reutilizable en
`test/rbac-y-contrasena.e2e-spec.ts`.

⚠️ **Al medir: cada cuelgue deja el backend envenenado** y hay que `docker restart` antes del
siguiente experimento. Un segundo experimento sobre un proceso ya trabado da un falso
positivo.

---

## Línea base medida (2026-08-16, conteo mecánico previo a la pasada)

No es la auditoría: es **contar el pajar**, para que la pasada tenga contra qué comparar y
para responder "¿quedan más casos?" sin gastar la pasada entera. Hecho con grep + script,
con falsos positivos y negativos **confirmados** (ver abajo).

| Lente | Candidatos | Archivos | Qué se sabe con certeza |
|---|---|---|---|
| A — cross-tenant | ~23 | 8 | La **mayoría son legítimos**: sesiones y perfil propio son por-usuario a propósito. El conteo NO responde la pregunta; cada sitio necesita el juicio *"¿puede una acción de un tenant escribir acá?"* |
| B — pool | ~20 | 7 | Consistente con la tabla del 2026-08-11. **Verificados a mano y todavía sin arreglar:** `ventas.service.ts` 156, 157, 186, 649, 714 |

**Conclusión para la lente B, tal como se escribió el 2026-08-16:** la tabla está
esencialmente vigente y **los sitios siguen ahí**. Confirma que el trabajo pendiente es
arreglar, no encontrar.
⚠️ **SUPERADA el 2026-08-18:** ese conteo es de **dos días antes** de que ADR-020 cerrara la
pata del pool. Se conserva porque es el registro de lo que se midió entonces —y sirve de
control: los cinco sitios de `ventas.service.ts` (156, 157, 186, 649, 714) son el mejor caso
de prueba para la pregunta 1 de la lente B—, pero **ya no describe el estado de hoy**.

**Conclusión para la lente A:** el pajar es chico y acotado, pero el conteo no distingue el
caso legítimo del bug. Es exactamente el tipo de pregunta que necesita buscador + refutador.

### ⚠️ Tres bugs de detección, para que el script de la pasada no los repita

Los tres se cometieron haciendo este conteo, y los tres daban números que parecían buenos:

1. **Contar llaves desde la firma de un método da bloques vacíos.** Al detectar
   transacciones por `manager: EntityManager` en la firma, la profundidad arranca en 0 y el
   bucle corta antes de que el cuerpo abra. Resultado: **11 candidatos en vez de 20**, y
   `ventas.service.ts` reportaba 1 sitio de 8. Hay que esperar la primera `{` antes de
   contar.
2. **"¿Aparece `manager` cerca?" no sirve como heurística.** Con una ventana de líneas, los
   sitios 649 y 714 de `ventas.service.ts` se perdían porque la llamada *siguiente* sí pasa
   `manager`. Hay que mirar **la lista de argumentos de esa llamada**, no un entorno.
3. **La lente A no se puede buscar sólo en SQL crudo.** Un primer conteo sobre plantillas
   con backticks dio 6 sitios y **no habría encontrado el bug real de ayer**: QueryBuilder
   usa comillas simples y `refreshRepo.delete({ userId })` es repositorio. Hay que cubrir
   las tres formas: SQL crudo, QueryBuilder y repositorio.

**Y la lección de método que esto deja:** en un rato de grep aparecieron falsos positivos
*y* falsos negativos en las dos lentes, con dos correcciones al script sobre la marcha. Un
barrido mecánico solo **no alcanza** — el paso del refutador no es ceremonia, es lo que
separa 11 de 20.

---

## Reglas de esta pasada

- **Buscadores ciegos entre sí**, uno por lente, con tope de hallazgos y schema estructurado.
- **Un refutador independiente por hallazgo.** Vías válidas de refutación: guard aguas arriba
  que el buscador no vio, escenario imposible por construcción, preexistente de otro alcance,
  decisión de diseño documentada.
- **Todo hallazgo trae escenario reproducible y `archivo:línea` verificado abriendo el
  archivo.** Sin eso no entra al triaje.
- **No se arregla nada.** Decisión del owner. Todo sobreviviente va a `pendientes.md`,
  incluidos los refutados por *"preexistente"* — no eran falsos, eran de otro alcance.
- **No abrir el frente 🔴.** Ni siquiera "de paso".
- Registrar la fila en el mapa de cobertura de `auditoria-codigo.md`, con fecha y números
  reales.

---

## Presupuesto — ✅ acordado el 2026-08-22: **500k tokens, tope duro**

El método exige fijarlo antes: *"si el número no se fija antes, la pasada crece hasta donde
alcance"*. Referencia medida: una pasada de 5 lentes sobre un módulo mediano costó **~1.4M
tokens** de subagentes; la estimación para estas dos, con una en delta, era **300-500k**.

**Decisión del owner: 500k, las dos lentes.** El tope es duro, no orientativo: si la pasada
lo alcanza, se corta y se reporta lo que haya, con lo que quedó sin cubrir **escrito**
—"no hay caps silenciosos" es regla del método—.

⚠️ **Una premisa de este plan cambió entre que se escribió y que se fijó el número**, y la
corrección está adentro de la §Lente B: sus ~20 sitios **ya se arreglaron** —pata del pool
cerrada el 2026-08-18 por ADR-020, frente 🔴 entero el 2026-08-20—, así que la lente B pasó de
*"revalidar una tabla de pendientes"* a *"buscar residuo y delta"*. El owner eligió igual las
dos lentes sabiendo esto: la pregunta de si aparecieron sitios nuevos **después** del
2026-08-11 sigue sin contestarse, y ahora tiene una firma barata para buscarlos.
⚠️ **Consecuencia para el presupuesto:** la lente B debería costar **menos** que la estimación
original, porque su pajar se achicó. Si la pasada se acerca al tope, lo que hay que recortar
es la lente B, no la A — la A es la que nadie relevó nunca.

---

## Cómo se dispara

Pasarle **la ruta de este archivo** al agente. Lo que falta no es una decisión, es el momento:

1. **Stack arriba y máquina quieta.** `docker-compose up` corriendo, y nada más peleando por
   la base — la lente B mide con ráfagas de ~15 requests independientes.
2. **Base fresca antes de empezar:** `./scripts/reset-db.sh`. Un experimento sobre estado
   sucio hace perder tiempo en forenses inútiles.
3. **Un `docker restart` entre experimentos de la lente B.** Cada cuelgue deja el backend
   envenenado; el segundo experimento sobre un proceso ya trabado da un **falso positivo**.
4. **Nadie tocando `.ts` del backend mientras corre.** El compose usa `start:dev` con el
   fuente bind-mounteado: un cambio recompila, reinicia y **vuelve a sembrar**, y eso arruina
   cualquier medición en curso.
5. Al terminar: registrar la fila en el mapa de cobertura de
   [`auditoria-codigo.md`](../../agent/auditoria-codigo.md) con fecha y números reales, y
   volcar los sobrevivientes a [`pendientes.md`](../../agent/pendientes.md) — **sin arreglar
   nada**.

---

## ⚠️ Lo que esta pasada NO va a resolver, y conviene tener presente al leer el resultado

`pendientes.md` está en **67 entradas abiertas, 29 de ellas ya decididas esperando
construcción**. La regla del propio método dice que auditar más código mientras ese montón
crece **produce inventario, no confianza**.

El owner decidió lanzarla igual y sin arreglar en el momento, que es una decisión legítima
—el mapa de estas dos lentes tiene valor propio—, pero el número va a subir, no bajar. Si al
terminar la pasada la sección 3 creció, eso es el resultado esperado y no una sorpresa.
