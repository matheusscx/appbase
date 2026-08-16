# Auditoría: recurso por usuario cruzando tenants, y deadlock del pool — Plan de pasada

> **Para agentes:** esta NO es una pasada de implementación. Es una pasada de auditoría y se
> rige por [`docs/agent/auditoria-codigo.md`](../../agent/auditoria-codigo.md): buscadores
> baratos y ciegos entre sí, un refutador independiente por hallazgo, y triaje al final.

**Estado:** 📋 preparada, **NO lanzada**. Falta acordar el presupuesto (ver §Presupuesto).

**Origen:** las dos lentes salieron de la tanda del 2026-08-15 (`resueltos.md`, *"El correo
coincide deja de ser prueba de identidad"*), donde las dos aparecieron como bugs reales y
ninguna la habría encontrado un buscador leyendo "¿está bien esta función?".

**Decisiones del owner (2026-08-15), ya tomadas:**

- Lente B (pool): **delta y revalidación, no redescubrimiento.** Se le pasa la tabla
  existente como contexto conocido.
- Destino de los hallazgos: **solo al backlog. NO se arregla nada en esta pasada.**

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
experimento, umbral medido y **tabla de sitios en 7 módulos**. Vive en la entrada 🔴 *"Diez
ventas simultáneas cuelgan la API para siempre"* de `pendientes.md`. **Redescubrirlo es pagar
dos veces.**

⛔ **Y arreglar esos sitios NO es parte de esta pasada:** es el frente 🔴, que va con decisión
del owner y **junto con las otras dos** (rendimiento y redondeo). Esta pasada solo actualiza
el mapa.

**Contexto obligatorio para el buscador:** pasarle la tabla de sitios completa. Sin eso
redescubre siete módulos y el resultado no se distingue del barrido viejo.

**Las tres preguntas, y sólo estas tres:**

1. **¿La tabla sigue exacta?** Verificar sitio por sitio contra el código de hoy. La propia
   entrada avisa que **quedó stale dos veces en el mismo día**, así que esto no es trámite.
   Reportar altas, bajas y líneas corridas.
2. **¿Hay sitios nuevos desde el 2026-08-11?** Delta acotado a lo que cambió desde esa fecha.
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

## Presupuesto — FALTA ACORDARLO

El método exige fijarlo antes: *"si el número no se fija antes, la pasada crece hasta donde
alcance"*. Referencia medida: una pasada de 5 lentes sobre un módulo mediano costó **~1.4M
tokens** de subagentes.

Esta es más chica —2 lentes, una de ellas en modo delta— así que la estimación es del orden
de **300-500k**. Confirmar antes de lanzar.

---

## ⚠️ Lo que esta pasada NO va a resolver, y conviene tener presente al leer el resultado

`pendientes.md` está en **67 entradas abiertas, 29 de ellas ya decididas esperando
construcción**. La regla del propio método dice que auditar más código mientras ese montón
crece **produce inventario, no confianza**.

El owner decidió lanzarla igual y sin arreglar en el momento, que es una decisión legítima
—el mapa de estas dos lentes tiene valor propio—, pero el número va a subir, no bajar. Si al
terminar la pasada la sección 3 creció, eso es el resultado esperado y no una sorpresa.
