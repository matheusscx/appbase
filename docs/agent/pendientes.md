# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

Regla de este archivo: una entrada sale cuando se corrige (marcar `[x]` y, en el commit
que la cierra, borrarla o moverla a un changelog). No es un TODO genérico: solo va lo que
ya identificamos con ubicación concreta.

---

## Deuda de código (surgió durante el harness)

- [x] **Burndown de typecheck del frontend — COMPLETO (0 errores)** (frontend) — jul-2026
  Los 84 errores de vue-tsc estricto se quemaron por tandas. `typecheck-baseline.json`
  quedó vacío: el `typecheck:ratchet` ahora es un gate totalmente estricto (cualquier
  error nuevo bloquea CI). Todos los patrones y sus fixes solo-de-tipo quedaron en
  `anti-patterns.md` (`@click`→arrow inline; spread/índice guardado→`!`; `string|null`→prop
  con `?? undefined`/tipar form; mismatches Nuxt UI·reka; tipado de unit tests vitest).

---

## Harness / tooling (CodeGraph)

- [x] **Sync de CodeGraph en un git hook + niveles de búsqueda — HECHO** (harness) — jul-2026
  `.githooks/pre-push` corre `codegraph sync --quiet` (red de seguridad no-bloqueante:
  nunca frena el push, no-op si CodeGraph ausente; nunca `index`). Validado empíricamente:
  el daemon estaba caído y el índice tenía 44 archivos viejos; el sync los reconcilió en
  <1s. Niveles de búsqueda (`--max-files`: rápido=default / normal=3-5 / profundo=10+)
  documentados en el "Orden de búsqueda" de `CLAUDE.md`.

---

## Suite E2E de navegador (fundación lista, flujos por escribir)

Scaffold Playwright ya funciona (`frontend/e2e/`, auth vía storageState, 1 smoke verde).
Escribir los flujos críticos, cada uno con aserciones derivadas de `docs/features/`
(NUNCA del output del código), `@smoke` en el subconjunto barato, cero esperas fijas:

- [ ] Venta completa hasta documento (afecto + exento; total contra `docs/features/ventas.md`).
- [ ] Pago mixto (múltiples métodos; vuelto solo si `permite_vuelto`).
- [ ] Nota de crédito (referencia a la venta original).
- [ ] Apertura/cierre de caja (reloj congelado; `diferencia` calculada por el sistema).
- [ ] Descuento de stock en una venta (movimiento + saldo materializado).
- [ ] **Cambio de tenant sin fuga de datos** (el más valioso — ninguna prueba unitaria
  lo cubre; login como usuario multi-tenant, verificar aislamiento de catálogo/ventas).
- [ ] Integrar `@smoke` al CI cuando haya masa crítica (hoy el CI no levanta el stack
  de navegador).

## Propinas en POS (notas de la revisión final, severidad baja — no bloqueantes)

- [ ] **Unique index para el garzón placeholder "Mostrador"** (backend) — `asegurarMostrador`
  (`garzones.service.ts`) es find-or-create sin restricción única sobre `(tenant_id,
  es_placeholder)`. En la práctica el placeholder ya existe (se siembra al crear el tenant
  y en el seed), así que el camino on-demand es solo fallback para tenants preexistentes;
  bajo concurrencia, dos "primeras" propinas de POS de un tenant sin placeholder podrían
  insertar dos "Mostrador" (duplicado benigno: ambos neutros y ocultos). Cerrar con un
  índice único parcial `WHERE es_placeholder = true AND eliminado_el IS NULL`.
- [ ] **Validación de `propinaDirecta`** (backend) — `montoPagado` es `@IsNumberString()`
  sin garantía de `> 0`, y no se restringe al canal `fisico`. Es el mismo patrón que
  `propinaCierreMesa` preexistente (no regresión); si se endurece, hacerlo en ambos.

## Refactor Caja → "Mi caja" / "Cajas" (diferido del brainstorm 2026-07-23)

El refactor separa la operación del cajero (**"Mi caja"**) de la supervisión del encargado
(**"Cajas"**). Se decidió que **"Cajas" arranca solo-lectura**; los poderes de escritura del
encargado se difieren a propósito para no acoplar el refactor de IA/permisos a un cambio de
modelo con implicancias de auditoría. Investigación y cruce de mercado:
[`investigaciones/2026-07-23-gestion-caja.md §6`](investigaciones/2026-07-23-gestion-caja.md).

- [x] **Refactor de IA/permisos — HECHO** (2026-07-23) — módulo `Caja` renombrado a
  `MiCaja` (mismo id, `Leer`/`Crear`/`Actualizar`/`Eliminar`); módulo nuevo `Cajas`
  (solo `Leer`); `Ver todas` dejó de asociarse a caja; guards remapeados por endpoint en
  `caja.controller.ts` (mismo controller/service, rutas `/caja/*` sin cambio); dos
  superficies frontend `/mi-caja*` y `/cajas*` (`/caja` redirige a `/mi-caja`);
  escrituras siguen owner-only aun con `Cajas:Leer`. Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#modelo-de-acceso-por-permiso).
- [x] **Sub-proyecto A — Arqueo de caja multi-medio — HECHO** (2026-07-24) — resuelve el
  §3 de la investigación (faltante fantasma / esperado mezclado): el cierre pasa de un
  número a una línea esperado-vs-contado por método (`es_efectivo` global +
  `requiere_conteo` por tenant, tabla `caja_arqueo_medio` congelada, `GET
  /caja/:id/arqueo`, `POST /caja/:id/cerrar` multi-línea). Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#arqueo-de-caja-multi-medio-sub-proyecto-de-negocio-a-post-estructura).
- [x] **Sub-proyecto B — Cierre ciego — HECHO** (2026-07-24) — resuelve la mitad barata de
  §5/§6 de la investigación (blind count): config por tenant `tenants.arqueo_ciego`
  (default `false`, `GET`/`PUT /caja/arqueo-ciego` con `Cajas:Leer`/`Actualizar`); en modo
  ciego + caja abierta `GET /caja/:id/arqueo` retiene `esperado:null` y filtra a solo
  líneas obligatorias (nadie ve el esperado de una caja abierta, ni dueño ni supervisor);
  respuesta cambia de `LineaArqueo[]` a `{ ciego, lineas }`; caja cerrada siempre revela;
  `cerrar` sin cambios (su respuesta es la revelación); drawer ciego revela por
  redirección al detalle. Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#cierre-ciego-modo-anti-fraude).
  Los ítems siguientes quedaron pendientes hasta el sub-proyecto C (abajo); "ocultar el
  resultado post-cierre" **sigue** diferido incluso después de C (ver [investigación
  §6](investigaciones/2026-07-23-gestion-caja.md#6-poderes-del-encargado-sobre-la-caja-del-cajero-investigación-2026-07-23)):
- [x] **Sub-proyecto C — Cierre en dos fases + motivos de diferencia — HECHO** (2026-07-24)
  — resuelve la conciliación operador→supervisor de §6 y los motivos categorizados de §5:
  fase 1 `POST /caja/:id/conteo` congela el arqueo server-side (inmutable desde ahí) y
  bifurca a auto-cierre (todo cuadró) o `estado='en_conciliacion'` (algún descuadre); fase
  2 `POST /caja/:id/cerrar` (owner-**o**-admin, única escritura no estrictamente
  owner-only del controller) exige un motivo categorizado — o comentario si el tenant no
  tiene motivos activos (red de seguridad) — por línea descuadrada y finaliza sin
  recalcular nada; `en_conciliacion` ocupa igual que `abierta` (bloquea abrir otra caja, el
  cajón, ventas y movimientos); catálogo `motivo_diferencia_caja` admin-only (mismo patrón
  que `causas_merma`); override admin `PATCH /caja/:id/arqueo/motivos` corrige motivos de
  una caja ya cerrada. **No** es el cierre forzado de §6 (el admin solo *finaliza* una
  conciliación que el dueño ya congeló, nunca inicia el conteo de una caja ajena) — ese
  ítem sigue diferido más abajo. Detalle:
  [`docs/features/gestion-cajas.md` § Cierre en dos fases](../features/gestion-cajas.md#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).
- [ ] **Cierre forzado de caja ajena por el encargado** (backend + modelo) — habilitar que
  un usuario con permiso `Cajas` cierre la caja de un cajero que dejó el turno abierto
  (escenario: cajero que se fue de urgencia). Requiere agregar **`cerrada_por`** a la tabla
  `cajas` (quién contó/cerró), distinto de `usuario_id` (de quién es el turno): sin ese
  campo el cierre mentiría sobre quién respondió por el efectivo. Rompe el owner-only del
  cierre bajo permiso `Cajas:Actualizar`. Mercado: la separación de funciones favorece que
  un segundo intervenga en el cuadre.
- [ ] **Aprobación de cierre por umbral de diferencia** (backend + config) — patrón Toast:
  si el over/short del cierre supera un umbral configurable, el cierre del cajero requiere
  aprobación del encargado. Agrega config de umbral por tenant + flujo de aprobación. Más
  fiel al mercado; mayor alcance. Ya no depende de resolver el modelo del esperado (§3,
  **resuelto** por el sub-proyecto A de arriba) — el umbral se evaluaría sobre la
  diferencia de cada línea del arqueo multi-medio, ya no sobre un total mezclado que
  inflaba cualquier diferencia.
- [ ] **Ocultar el resultado post-cierre al cajero** (backend + frontend) — en el cierre
  ciego (sub-proyecto B) el cajero **sí** ve su propia diferencia al enviar el conteo (la
  revelación es inmediata, vía el detalle), aunque la caja quede `en_conciliacion`. El
  sub-proyecto C (arriba) resolvió la conciliación operador→supervisor de §6, pero no
  condicionó la revelación a que solo el supervisor la vea de inmediato — sigue diferido.
- [ ] **Conteo por denominación** (§5/§8.3 de la investigación) — los motivos categorizados
  de diferencia de §5 quedaron **resueltos** por el sub-proyecto C (arriba); lo que sigue
  pendiente de §5 es exclusivamente el conteo por denominación de billetes/monedas, sin
  tracking más detallado que [`investigaciones/2026-07-23-gestion-caja.md
  §9`](investigaciones/2026-07-23-gestion-caja.md).

## Endurecimiento para producción (pre-lanzamiento — hoy no hay prod)

El proyecto está en desarrollo y `main` no se despliega, así que nada de esto corre hoy.
Pero el flujo actual (push directo a `main`; CI que corre **después** del push como
detector, no como portón; sin ramas/PRs por decisión de la etapa de dev) **no es seguro
para producción**: un CI rojo hoy es inofensivo porque `main` no despliega, pero el día
que `main` auto-despliegue significaría subir código roto a prod y enterarse tarde. Esta
sección se abre al encarar el paso a producción. Orden = prioridad.

- [ ] **`synchronize: true` → migraciones (CRÍTICO, bloqueante de prod)** (backend) —
  hoy el esquema lo crea `synchronize` al bootstrap (dev + CI, porque `NODE_ENV != production`).
  En prod `synchronize` **puede dropear columnas y perder datos** al arrancar tras un cambio
  de entidad. Antes de cualquier deploy real: apagar `synchronize` en prod, adoptar
  migraciones TypeORM (generar desde el estado actual, versionar), y que el deploy corra
  `migration:run`. `startup-pos.sql` deja de ser solo referencia y pasa a ser el baseline
  de la primera migración. Es dinero y multi-tenant: sin esto un deploy puede corromper datos.
- [ ] **CI como portón de deploy + branch protection** (harness/infra) — hoy
  `.github/workflows/ci.yml` dispara `on: push: [main]` → corre DESPUÉS del push (detector),
  y `main` **no está protegida**. Para prod: (1) el job de deploy declara `needs: [gate]`
  (`if: success()`) → CI rojo = **no hay deploy**, prod queda en la última versión buena;
  (2) reactivar PRs + `required status checks` sobre `main` (revierte la regla de dev
  "trabajar directo sobre `main`") → el código roto ni toca la rama que despliega. Cierra el
  agujero del post-mortem del 2026-07-23 (push a `main` con e2e rojo).
- [ ] **Rate limiting** (backend) — hoy no hay throttling; los endpoints de auth
  (`POST /auth/login`, `/auth/refresh`) son brute-forceables. Agregar `@nestjs/throttler`:
  límite global por IP + límite estricto en auth. Cuidado multi-tenant: la key de rate limit
  no debe filtrar entre tenants ni permitir que un tenant agote la cuota de otro. Considerar
  store compartido (Redis) si corre en varias instancias — el límite en memoria no sirve tras
  un load balancer.
- [ ] **Deploy seguro: rollback + feature flags + canary** (infra) — el portón de CI evita
  el error *conocido* (que los tests detectan), no el desconocido (bug que ningún test cubre y
  pasa en verde). Para acotar ese: rollback rápido a la versión anterior (deploy inmutable),
  canary/gradual (soltar al % del tráfico y mirar métricas antes del 100%), y feature flags
  para apagar una feature sin re-desplegar.
- [ ] **Secrets fuera del repo + rotación** (infra) — `JWT_SECRET`, `JWT_REFRESH_SECRET`,
  `PASARELA_ENCRYPTION_KEY` hoy salen de `.env`. En prod deben venir de un secret manager
  (no del repo, no de variables de entorno en texto plano en el CI), con rotación. Auditar que
  ningún secreto real quedó commiteado. La `PASARELA_ENCRYPTION_KEY` es especialmente sensible:
  cifra credenciales de pasarela de pago.
- [ ] **Cabeceras de seguridad + CORS whitelist + HTTPS** (backend) — `main.ts`: `helmet`,
  forzar HTTPS, y **CORS por whitelist env-driven**. Hoy `enableCors` permite un solo origen
  (`FRONTEND_URL ?? http://localhost:5173`, `credentials: true`); generalizar a lista blanca:
  `CORS_ORIGINS` (coma-separado) → `.split(',').map(trim).filter(Boolean)` → array a `origin`
  (el paquete `cors` lo refleja si está, rechaza si no). Con `credentials: true` **no** se puede
  usar `'*'`; la lista debe ser explícita. Documentar la var en `.env.example`. Prod define
  `CORS_ORIGINS=https://app.tudominio.com[,...]`; dev queda con el default localhost.
  **Nota de alcance:** CORS solo guarda al **navegador** (evita que la web de otro origen use la
  sesión/cookie del usuario contra la API); no frena curl/Postman/servidor-a-servidor. El control
  de acceso real es el JWT ya implementado — la whitelist es defensa en profundidad, no el candado.
- [ ] **Observabilidad: logs estructurados + error tracking + alertas** (backend/infra) —
  logging estructurado que **no filtre PII ni `tenant_id` cruzado**, captura de errores
  (Sentry/equivalente), y alertas de error-rate/latencia para enterarse en minutos, no cuando
  se queja un cliente. Es la contraparte del "bug que pasó el CI verde".
- [ ] **Backups automáticos + restore probado (Postgres)** (infra) — datos financieros
  multi-tenant: backups automáticos + point-in-time recovery, y **restore probado** (un backup
  que nunca se restauró no es un backup). Tópico aparte del deploy de la app.
- [ ] **Health/readiness + graceful shutdown** (backend) — endpoint `/health` para el
  orquestador (readiness real: chequea la BD), y cierre ordenado de conexiones al recibir
  SIGTERM para no cortar requests en vuelo durante un deploy.
- [ ] **Escaneo de dependencias en CI** (harness) — `npm audit` / Dependabot como paso del
  gate, para no arrastrar CVEs conocidos a prod.
- [ ] **Pre-push que corre el gate completo local (todas las suites)** (harness) — hoy
  `.githooks/pre-push` solo hace `codegraph sync` (no-bloqueante); el gate real corre en CI
  DESPUÉS del push (fue lo que dejó `main` en rojo el 2026-07-23). Mover ese gate a un pre-push
  BLOQUEANTE para atajarlo antes de subir. Diseño acordado:
  (1) **Gate determinista primero** (rápido, sin infra, cero falsos rojos): backend `lint:check`
  + `typecheck` + `test` (unit); frontend `test` (vitest) + `typecheck:ratchet` + `design:check`
  + `build`. Si algo falla, corta acá sin tocar Docker.
  (2) **e2e con DB fresca**: `docker-compose down -v && docker-compose up -d` → esperar Postgres
  healthy → `npm run test:e2e`. La DB limpia es imprescindible: contra la DB de dev acumulada da
  **falsos rojos** por polución de seed ([[e2e-cumulative-stock-pollution]]) → entrena `--no-verify`
  y mata el hook. NO usar `--build`: el e2e levanta su Nest en el host y solo necesita Postgres
  fresco; rebuildear imágenes solo suma minutos. `down -v` es destructivo con la data local —
  aceptado (el owner no la necesita).
  (3) **Solo el bloque pesado (Docker + e2e) si el rango a pushear tocó `backend/`**; el gate
  determinista corre siempre. Evita 4 min de stack+e2e en un push de solo-docs.
  (4) Bloqueante; escape `git push --no-verify`. Es el enforcement de [[rigor-sobre-velocidad]].
  Complementa (no reemplaza) el CI, que sigue siendo la verdad con DB fresca de verdad.

## Limpiezas menores (opcionales, no bloqueantes)

- [ ] **Falta usuario semilla "supervisor `Cajas:Leer` no-admin" para e2e del ciego** (test) —
  al hacer que el modo ciego NO aplique al admin/superadmin (2026-07-25), el criterio es
  `esAdmin = esSuperadmin || userIsTenantAdmin`; un supervisor con `Cajas:Leer` que **no** sea
  admin debe seguir ciego. Hoy eso lo cubren el unit del controller (`Cajas:Leer=true` +
  `userIsTenantAdmin=false` → `esAdmin=false`) y la lógica del service, pero **no** un e2e real:
  el seed solo tiene admin (admin.paris, que hace de "supervisor") y cajero (vendedor), ninguno
  es supervisor-no-admin. Sembrar un rol `Cajas`-solo-lectura no-fijo + su usuario y agregar un
  e2e que verifique que ve la caja abierta ciega. Cierra el gap que marcó la revisión de seguridad.
- [ ] **`crear-movimiento.dto.ts:16` — `monto` admite negativos** (backend) — al hacer real
  el modo ciego (2026-07-25) el validador pasó de `@IsNumberString({ no_symbols: true })` a
  `@IsNumberString()` (obligado: `no_symbols` rechaza el punto decimal y rompe montos de
  dinero — mismo bug ya documentado en `linea-cierre.dto.ts`). Efecto colateral: ese endpoint
  ahora acepta `monto` negativo, que `no_symbols` bloqueaba de rebote; como `tipo`
  (entrada/salida) codifica el signo, una `salida` con monto negativo *sumaría* al esperado.
  Es el **mismo patrón** que `propinaDirecta`/`propinaCierreMesa` (money `@IsNumberString()`
  sin `> 0`) — cerrar con un **barrido de positividad** sobre los DTOs de dinero de caja y
  propinas a la vez (no un fix aislado). Auditable en `movimientos_caja`; no bloqueante.
- [ ] **`causas-merma.service.ts` — mismo latente `UPDATE ... RETURNING` sin unwrap que
  se corrigió en `motivos-diferencia.service.ts`** (backend) — `create()` (línea ~58) y
  `update()` (línea ~101) tipan directo el resultado de `dataSource.query('INSERT/UPDATE
  ... RETURNING ...')` como `CausaMermaRow[]` y leen `rows[0]` sin pasar por ningún
  unwrap. `motivos-diferencia.service.ts` documenta el motivo real: "TypeORM + pg:
  INSERT/UPDATE ... RETURNING llega como `[rows, rowCount]`, no como `rows`" y agrega un
  helper `unwrap()` para los mismos dos métodos. `causas-merma.service.ts` no tiene ese
  helper — hoy funciona porque nadie lo notó romperse (posible que la config actual del
  driver no dispare el caso, o que quede enmascarado por otro camino), pero es el mismo
  patrón de riesgo. Cerrar aplicando el mismo `unwrap()` (o extrayéndolo a un helper
  compartido si se toca un tercer service con el mismo patrón — regla de "duplicar dos
  veces es aceptable, se extrae a la tercera" de `CLAUDE.md`).
- [ ] `items.vue:81` — campo `esPendiente` en `GrupoOpcionOverrideRow` se setea pero
  nunca se lee (el badge re-deriva la condición inline). O wirear el badge a este campo,
  o quitarlo del tipo.
- [ ] DTOs de override — normalizar `@IsUUID('4')` vs `@IsUUID()` (inconsistencia de
  estrictez, inofensiva con seed v4).
- [ ] `backend/src/modules/users/user.entity.ts` (clase `User`) parece **código muerto**:
  duplicado legacy de `Usuario` (`usuario.entity.ts`), sin referencias ni `forFeature`.
  Confirmar y eliminar. (Detectado al automatizar la invariante uuid — ambos tenían el
  mismo `googleId`.)
