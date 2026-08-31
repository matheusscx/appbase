# Lo pedido se cobra como se pidió — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: `superpowers:subagent-driven-development` (recomendada)
> o `superpowers:executing-plans`. Los pasos usan checkbox (`- [ ]`).

**Goal:** una línea de cuenta abierta se cobra con **lo que se pidió y al precio que tenía
cuando se pidió**; re-tasarla deja de re-validarla contra el catálogo vivo.

**Architecture:** hoy `cerrarCuenta` **desarma** el snapshot congelado en un DTO de puros
ids (`salones.service.ts:1133-1167`) y `ventas.service` lo vuelve a resolver contra el
catálogo de hoy (`ventas.service.ts:381-401`), que es de dónde salen las dos conductas
malas: rompe la mesa cuando la carta cambió, y le mueve el precio cuando no rompió. El
arreglo tiene dos mitades: **congelar el precio unitario en la línea** al pedirla, y
**pasar la foto entera** —snapshot + precio— por el canal interno que el motor ya tiene
(`precioUnitarioResuelto`, que **no** es parte del DTO HTTP: `calcular.dto.ts:128-142`),
en vez de volver a resolver.

**Tech Stack:** NestJS + TypeORM (`synchronize`, sin migraciones), PostgreSQL 15,
Decimal.js, Nuxt 4. Docker-first.

**Spec:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3, entrada *"Re-tasar
una línea ya pedida tiene que re-preciar, no re-validar"*, más la regla en
[`docs/PRODUCTO.md`](../../PRODUCTO.md). Las tres decisiones del owner (2026-08-30):

1. **Al cobrar manda lo que la mesa ya pidió, no la carta de hoy.**
2. **El extra se cobra al precio que tenía cuando se pidió** ($700, no $1.200).
3. **El plato también** — *"¿cuál carta? si la hamburguesa se pidió en 5 mil se paga en
   5 mil"*. Una sola regla, sin excepciones entre plato y extras.

## Global Constraints

- **Motor de cálculo: este frente va solo y con el sistema quieto** (`CLAUDE.md`, primer
  punto de "Detenerse y preguntar"). Nada más se toma de arrastre en la misma sesión.
- **Lo fiscal queda afuera, explícitamente.** Impuestos, tasas y documentos tributarios se
  siguen leyendo del catálogo vivo al cobrar. La regla del owner, llevada hasta el final,
  también los congelaría — pero eso es **ADR-010** y abre su propio frente, con su propia
  sesión. No decidirlo acá. Lo mismo para descuentos y recargos de catálogo: ver
  "Preguntas abiertas".
- **Dinero con Decimal.js**, nunca `number`. Cada paso cierra cuantizado a la escala de la
  moneda oficial con el `modo_redondeo` del tenant.
- **El cliente nunca manda un precio** (`1970ccbd`). Esto no lo reabre: el precio lo sigue
  calculando el servidor, leyendo la foto que **él mismo** congeló. Todo canal nuevo que
  lleve plata resuelta tiene que ser **interno**, como `precioUnitarioResuelto` — nunca un
  campo del DTO HTTP.
- **No hay datos productivos** (`docs/agent/`): el esquema se cambia en las entidades, se
  actualiza el seeder y se resetea. Nada de backfills ni migraciones incrementales.
- `tenant_id` del token. Soft delete en todo. Toda lectura nueva filtra `eliminado_el IS NULL`.

---

## File Structure

| Archivo | Responsabilidad en este frente |
|---|---|
| `backend/src/modules/salones/entities/cuenta-linea.entity.ts` | gana `precio_unitario` — la plata congelada de la línea |
| `backend/src/modules/salones/salones.service.ts` | `agregarLinea` congela; `cerrarCuenta` deja de desarmar la foto |
| `backend/src/modules/ventas/ventas.service.ts` | acepta la personalización ya resuelta y saltea el resolver |
| `backend/src/modules/calculo-precios/calculo-precios.service.ts` | la precuenta de una cuenta se arma del lado del servidor |
| `backend/src/modules/items/items.service.ts` | **no cambia** — los cinco guards se quedan (ver T4) |
| `frontend/app/composables/useSalones.ts` + la pantalla de cuenta | deja de mandar líneas para la precuenta de una cuenta |

---

## Task 1: congelar el precio unitario al pedir la línea

**Es la tarea que decide el frente.** Las tres siguientes llevan intención y contrato, no
código exacto, porque dependen de lo que se resuelva acá.

**Files:**
- Modify: `backend/src/modules/salones/entities/cuenta-linea.entity.ts`
- Modify: `backend/src/modules/salones/salones.service.ts:640-720` (`agregarLinea`)
- Modify: `backend/src/modules/seeder/seeder.service.ts` (si el seed crea cuentas con líneas)
- Test: **no existe un `salones-cuentas.e2e-spec.ts`** — las líneas de cuenta se ejercitan
  repartidas (`salones-comanda.e2e-spec.ts` es el que más las toca, después
  `recetas.e2e-spec.ts`). Decidir en el paso 1 si este frente estrena un spec propio o se
  cuelga del de comanda, y **escribir por qué**. Unitarios en
  `backend/src/modules/salones/salones.service.spec.ts`.

**Interfaces:**
- Produce: `CuentaLinea.precioUnitario: string` — **ya convertido a moneda oficial**,
  `NUMERIC(18,4)`, no nulo. Es lo que T2 y T3 consumen.

- [ ] **Paso 1: decidir de dónde sale la cuenta, y escribirlo antes de codear**

  El número a congelar es exactamente el que hoy calcula
  `calculo-precios.service.ts:381-387`:

  ```
  convertirAMonedaOficial(
    Decimal(item.precioBase).plus(precioExtraTotal).toFixed(4),
    item.monedaId, tasaMap, config.modoRedondeo)
  ```

  `convertirAMonedaOficial` es público en `CalculoPreciosService`
  (`calculo-precios.service.ts:871`) y **`SalonesService` ya lo llama**
  (`salones.service.ts:1542`), o sea que la inyección ya está hecha y no hay dependencia
  nueva que resolver. **Reusarlo, no duplicar la cuenta**: dos lugares que redondean plata
  es el modo de falla que este repo ya pagó (`resueltos.md`, redondeo de plata). Lo que sí
  hay que resolver es de dónde sale el `tasaMap` y el `modoRedondeo` dentro de
  `agregarLinea` — `ventas.service.ts:455` y `:963` muestran el patrón de llamada desde
  afuera.

- [ ] **Paso 2: el test que falla — el precio no se mueve cuando cambia la carta**

  e2e, por el camino de la app (nunca SQL directo):
  1. receta a `$5.000`, se agrega a una cuenta abierta;
  2. `PATCH /items/:id` sube `precioBase` a `$6.000`;
  3. `GET /cuentas/:id` → la línea sigue diciendo `$5.000`.

  Hoy el paso 3 no tiene dónde mirar: **ese es el punto**, la línea no guarda precio.

- [ ] **Paso 3: la columna**

  ```ts
  @Column({ name: 'precio_unitario', type: 'numeric', precision: 18, scale: 4 })
  precioUnitario: string;
  ```

  Docblock obligatorio: **por qué** está congelada (la decisión del owner, con fecha) y que
  está en **moneda oficial**, no en la del ítem — el bug de la moneda del extra
  (`resueltos.md`, 2026-08-26) nació de esa confusión exacta.

- [ ] **Paso 4: `agregarLinea` la escribe**

  Ya resuelve la personalización ahí mismo (`salones.service.ts:653-674`) y tiene el
  `precioExtraTotal` a mano: hoy lo descarta. Guardar `precioBase + precioExtraTotal`
  convertido.

- [ ] **Paso 5: ⚠️ el merge por hash deja de ser correcto y hay que arreglarlo**

  `agregarLinea` fusiona la nueva línea con una existente cuando coincide el hash de la
  personalización (`salones.service.ts:688-690`). Con el precio congelado, dos pedidos del
  mismo plato **a precios distintos** son dos hechos distintos y fusionarlos mezcla plata:
  la mesa pide una hamburguesa a $5.000, sube la carta, pide otra, y las dos se cobrarían a
  uno solo de los dos precios.

  El merge pasa a exigir **hash + precio unitario iguales**. Test dedicado: pedir, cambiar
  el precio del ítem, volver a pedir lo mismo → **dos líneas**, cada una con su precio.

- [ ] **Paso 6: verificación**

  ```bash
  cd backend && npm run lint:check && npm run typecheck && npm test
  ```
  Reset + e2e del spec de cuentas. `synchronize` crea la columna sola; si el seed inserta
  líneas de cuenta, se cae por el `NOT NULL` — actualizarlo en el mismo commit.

- [ ] **Paso 7: mutantes** — al menos dos: (a) leer `precioBase` del catálogo en vez de la
  columna congelada; (b) volver el merge al hash solo. Los dos tienen que morir.

- [ ] **Paso 8: revisión independiente + commit** (paso 7 de `verify-feature`, recibo atado
  al diff staged).

---

## Task 2: cerrar la cuenta con la foto, sin volver a la carta

**Files:**
- Modify: `backend/src/modules/salones/salones.service.ts:1123-1167` (el desarmado)
- Modify: `backend/src/modules/ventas/ventas.service.ts:374-401` (el bucle de resolución)
- Test: el spec que haya decidido T1, más `backend/test/recetas.e2e-spec.ts` y
  `backend/test/grupos-modificadores.e2e-spec.ts` (ahí están los casos de los cinco guards,
  que este frente convierte de "400" en "se cobra")

**Interfaces:**
- Consume: `CuentaLinea.precioUnitario` (T1).
- Produce: un canal **interno** —no HTTP— por el que `cerrarCuenta` le pasa a
  `ventas.service`, por línea, el par `{ snapshot, precioUnitario }` ya resuelto. Modelarlo
  como `precioUnitarioResuelto`: parámetro del método de servicio, **fuera** del
  `CreateVentaDto`. Un campo del DTO acá dejaría a un cliente mandar `precioExtra`
  arbitrario, que es exactamente lo que `1970ccbd` cerró.

- [ ] **Paso 1: los tests que fallan** — los casos que hoy dejan la mesa incobrable pasan a
  **cobrarse**. Al menos tres, y los tres ya están medidos (`pendientes.md` § 3):
  agregarle al plato un grupo obligatorio (`min ≥ 1`); sacarle a un combo un componente que
  la línea personalizó; y el precio del extra movido, que tiene que cobrarse **al viejo**.

- [ ] **Paso 2: `cerrarCuenta` deja de desarmar.** Borrar el `.map` de
  `salones.service.ts:1133-1167` y pasar el snapshot tal cual, con su precio.

- [ ] **Paso 3: `ventas.service` saltea el resolver** cuando la línea trae su par resuelto.
  El snapshot se **copia** a `venta_detalle.personalizacion`, no se recalcula.

- [ ] **Paso 4: lo que NO cambia, y hay que probar que no cambió.** El POS y la Tienda
  siguen resolviendo y validando contra el catálogo vivo: ahí el cliente **está eligiendo
  ahora**, no recordando lo que pidió. El consumo de stock por ingrediente
  (`venderIngredientesReceta`) sigue leyendo el snapshot igual. Un test por cada uno.

- [ ] **Paso 5: verificación + mutantes + revisión + commit.** Mutante obligatorio: volver a
  resolver aunque venga el par → los tests de los tres agujeros tienen que revivir.

---

## Task 3: la precuenta muestra lo mismo que se cobra

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts`
- Modify: `frontend/app/composables/useSalones.ts` y la pantalla de la cuenta
- Test: e2e de API + spec de pantalla

**Interfaces:**
- Consume: T1 y T2.

- [ ] **Paso 1: el problema, antes de tocar nada.** Hoy la precuenta la arma el **cliente**:
  manda las líneas a `POST /calculo-precios/calcular` y el servidor las re-resuelve. Con el
  precio congelado eso ya no sirve —el cliente no puede mandar plata— así que **la precuenta
  de una cuenta se arma del lado del servidor**, desde `cuentaId`. El campo ya existe en el
  contrato (`useCalculoPrecios.ts`, `cuentaId`, hoy solo para la vigencia de las reglas con
  fecha): decidir si se amplía su significado o si va un endpoint propio, y **escribir por
  qué**.

- [ ] **Paso 2: el test que falla** — precuenta y cobro dan el mismo total después de
  cambiarle el precio al ítem con la mesa sentada. Hoy los dos dan el precio nuevo; con T1 y
  T2, el cobro da el viejo y la precuenta seguiría mintiendo.

- [ ] **Paso 3: implementar. Paso 4: el front deja de mandar líneas** para ese caso.

- [ ] **Paso 5: ⚠️ mirar de paso —sin arreglarlo acá— el `—` mudo.** `useCalculoPrecios` se
  traga el 400 y `lineaSubtotal` dibuja un guion en todas las líneas sin decir por qué.
  Después de este frente el 400 casi no va a pasar, así que la urgencia baja; sigue siendo
  entrada propia en el backlog. **No tomarla de arrastre.**

- [ ] **Paso 6: gate completo de las dos puntas + revisión + commit.**

---

## Task 4: la documentación, y por qué los cinco guards se quedan

**Files:**
- Modify: `docs/PRODUCTO.md`, `docs/features/salones-mesas.md`,
  `docs/features/recetas.md`, `docs/features/grupos-modificadores.md`,
  `docs/features/personalizacion-recetas.md`, `docs/features/motor-calculo-precios.md`,
  `docs/ESTADO.md`, `docs/agent/pendientes.md` → `docs/agent/resueltos.md`
- Posible ADR: la regla "lo pedido se cobra como se pidió" es decisión técnica **y** de
  producto, y contradice la lectura ingenua de `1970ccbd`. Evaluar un ADR corto.

- [ ] **Paso 1: los cinco guards de `ab802b32` y anteriores NO se tiran.** Cambia lo que
  significan, y eso hay que escribirlo: dejan de ser *"si sacás esto, la mesa queda
  incobrable"* —ya no lo queda— y pasan a ser *"hay alguien sentado esperando esto"*, que es
  un dato de operación. El mensaje que nombra la mesa es hoy lo único que se lo dice al
  admin. **Si alguien propone borrarlos porque "ya no hace falta", esta línea es la
  respuesta.**

- [ ] **Paso 2: la tabla de las cinco puertas** (`salones-mesas.md`) se reescribe con el
  motivo nuevo, y las dos ⚠️ que hoy explican la re-validación se van.

- [ ] **Paso 3: mover la entrada de `pendientes.md` § 3 a `resueltos.md`** con el texto de
  su cierre, y anotar qué quedó afuera a propósito (lo fiscal).

---

## Preguntas abiertas — contestar ANTES de empezar, no durante

1. **Descuentos y recargos de catálogo.** Hoy se leen vivos al cobrar. La regla del owner
   los congelaría también, pero no se preguntó por ellos y **no son lo mismo que un precio**
   (una promo que arranca a las 20:00 con la mesa sentada desde las 19:00, ¿aplica?). Hoy la
   vigencia por fecha ya se evalúa con `cuenta.abierta_el`, o sea que esa parte **ya** está
   del lado de "cuando se sentó". Preguntar antes de tocar.
2. **Impuestos: no preguntar acá.** Es fiscal, va solo (ADR-010).
3. **`PATCH /cuentas/:id/lineas/:lineaId`** cambia la cantidad, no el precio unitario —
   confirmar leyendo el método, no asumiendo.
4. **Una línea cuyo ítem se borró del catálogo** hoy hace fallar el cierre con un 400 que
   nombra el ítem. Con el precio congelado podría cobrarse igual. ¿Se quiere? El ítem sigue
   existiendo (soft delete), así que técnicamente se puede.

## Lo que este plan da por medido (no re-medir, sí re-verificar si algo no cierra)

- `cuenta_lineas` **no** guarda ningún precio hoy (entidad leída completa, 2026-08-30).
- `cerrarCuenta` desarma el snapshot a puros ids en `salones.service.ts:1133-1167`.
- `precioUnitarioResuelto` es canal interno y **no** viaja en el DTO HTTP
  (`calcular.dto.ts:128-142`).
- `SalonesService` ya inyecta `CalculoPreciosService` y ya convierte plata a moneda oficial
  (`salones.service.ts:1542`).
- Tres llamadores de los resolvers: `ventas.service.ts:381/392`,
  `calculo-precios.service.ts:361/368`, `salones.service.ts:662/668`.
- El agujero es real y medido en dos formas: `PATCH` 200 → `calcular` 400 (grupo con
  `min ≥ 1`; componente sacado del combo), y el extra repreciado que la mesa abierta paga al
  precio nuevo.
