# Plan: cada venta registra quién emitió, y la regla la declara cada método de pago

> **Para agentes:** se ejecuta con `superpowers:subagent-driven-development`, tarea por tarea, con
> implementadores **Sonnet**. Los pasos usan checkboxes (`- [ ]`). El implementador **no commitea**:
> stagea por ruta explícita. La revisión (`domain-reviewer` con las dudas que el controlador no
> verificó, más `api-security-reviewer` si la tarea toca controllers o DTOs), el recibo del
> pre-commit y el commit los hace el controlador.

- **Status:** Approved (owner, 2026-10-01) — In Progress
- **Date:** 2026-10-01
- **Owner:** César (owner) · redacta la sesión del frente de emisión (worktree `sad-dubinsky-6b3af5`)

**Goal:** Que cada medio de pago declare quién emite con él, que cada venta registre sola qué
documentos tiene y quién los emitió, y que toda devolución deje su registro según quién emitió lo que
corrige.

**Spec:** [`docs/superpowers/specs/2026-10-01-emision-por-venta-design.md`](../specs/2026-10-01-emision-por-venta-design.md).
Las decisiones (E1–E7) y su procedencia están ahí y en `PRODUCTO.md` § 10. No se repiten acá. El
plan argumenta desde la spec: quien ejecuta lee las dos.

**Architecture:** una tabla nueva, `venta_documentos`, que se llena **dentro de la transacción que
registra los pagos**, a partir de una columna nueva `tenant_metodo_pago.emisor`. Las devoluciones
siguen siendo filas de `ventas` con `venta_referencia_id`, compuestas como la NC de hoy. Lo nuevo es
el documento que llevan, resuelto del documento que corrigen. Los lectores reconocen una corrección
por `venta_referencia_id IS NOT NULL`.

**Tech Stack:** NestJS + TypeORM (`synchronize`, el esquema sale de las entities), PostgreSQL 18,
Decimal.js, Nuxt 4 + Nuxt UI v4, Jest + supertest (e2e), Vitest, Playwright.

## Decisiones que llegaron después de la primera versión

- **E1 corregida** (`67c3789e`, con
  [`2026-10-01-documento-de-lo-no-pagado.md`](../../agent/investigaciones/2026-10-01-documento-de-lo-no-pagado.md)):
  lo entregado se documenta al entregarlo, se haya pagado o no. El pago posterior de una deuda no
  genera documento, salvo el voucher duplicado de **E1b**, que se registra marcado.
- **E2 reemplazada, E8 y E9** (`ab13bcd0`): quién hace las facturas y lo que queda debiendo lo
  declara el comercio (`tenants.facturador`: el sistema u otro facturador, que se anota como
  `externo` con su número). Una boleta del sistema solo `armado` no impide anular: queda
  descartada.
- **E10** (`8d4071f1`): un documento `externo` se pregunta al anular. Si ya está hecho, va por NC;
  si no, se anula y queda registrado quién lo afirmó.
- **La tarea 8 migra todo lector de "es corrección"** (orquestadora, 2026-10-01, a partir de la
  medición de la tarea 1): la devolución interna nace con tipo nulo, así que los lectores que hoy
  distinguen una NC por el tipo —incluidos `VentasService.resumen` y las tres consultas de
  `resumen-negocio`— pasan a `venta_referencia_id IS NOT NULL` **en la misma tarea que la crea**. La
  tarea 11 queda como verificación.

No queda ninguna pregunta abierta.

## Global Constraints

- `tenant_id` siempre del token. Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`, salvo
  excepción con el porqué escrito en la consulta. Nunca `DELETE`.
- Plata con Decimal.js, nunca `number`. Montos en moneda oficial, cuantizados a su escala.
- **Nunca una query por iteración.** El emisor de los medios de un cobro sale en una sola lectura;
  los documentos se insertan con un solo `save` del array; el listado y el detalle traen los
  documentos con `WHERE venta_id = ANY($1)` o un `EXISTS`.
- **El cliente nunca manda quién emitió ni qué documento corrige.** Manda qué pasó: con qué medio
  pagó, por dónde vuelve la plata, el número que tipeó.
- **No se toca:** el motor de precios, `movimientos_inventario` (salvo lo que la NC ya hace hoy, sin
  cambiar su conducta), el envío al SII, el ticket impreso. Si una tarea parece exigirlo: **parar y
  preguntar**.
- **`resumen-negocio.service.ts` y `VentasService.resumen`:** la tarea 8 cambia **solo el predicado
  de "es corrección"** (uno por consulta: `ventas.service.ts:2845` y `resumen-negocio.service.ts`
  :184, :261, :324), para que el frente del vendido neto vea un conflicto textual y no uno de
  conducta. Todo lo demás de esas consultas sigue siendo del frente del vendido neto y de la tarea 11.
- Entidad nueva → registrarla en el array `entities` de `app.module.ts` además de `forFeature`.
- Un tipo TS estrecho en un `@Column` lleva el `type` explícito (si no, `design:type` queda en
  `Object`).
- **e2e:** `./scripts/entorno.sh db` en el worktree, `./scripts/reset-db.sh` antes de cada corrida
  y `--verificar` después. No tocar un `.ts` del backend mientras corre. **Playwright:**
  `./scripts/entorno.sh stack`.
- Cada test nuevo lleva un mutante que **revierte** a la conducta de hoy, y lo tiene que matar.
  Montos que discriminen: ni 1, ni factores iguales.
- **No hacer push.** Main despliega en Railway; lo decide el owner.

---

## Tarea 1 — Medir antes de fijar la forma (spike, sin código de producción)

Lo que sale de acá **fija** los nombres y la forma de las tareas siguientes. Si un dato contradice
la spec, se para y se avisa: la tarea no se resuelve sola.

- [x] **Lectores de "es NC".** Grep de `es_nota_credito`, `esNotaCredito`, `tipoNotaCreditoDelTenant`,
  `exigirTipoNotaCredito` y de toda consulta que cruce `tipo_documento_id` con el tipo NC, en
  `backend/src` y `frontend/app`. Una tabla con archivo:línea, qué hace cada uno y en qué tarea
  cambia (8, 11 o ninguna). Medido en el diseño: `ventas.service.ts` l.1537, 1567, 1632, 2143,
  2845, 2925, 3013, 3313 y 3339; y `resumen-negocio.service.ts` en cinco lugares. Confirmar o
  corregir esa lista abriendo cada línea.
- [x] **Lo aplicado por pago.** En `PagosService.registrar` (`pagos.service.ts:112`): qué devuelve
  hoy y si de ahí sale, por pago, `pagoId`, `metodoPagoId` y lo aplicado a la venta
  (`pago_aplicaciones.tipo = 'venta'`), separado de la propina y del vuelto. Hay que cubrir los
  tres llamadores: `crearEnTransaccion` (POS, salones, online, suscripción) y `registrarAbono`. Si
  no lo devuelve, proponer el cambio mínimo de su retorno.
- [x] **El reparto a prorrata.** Si `descomponer`, `repartirAjuste` o `escalarDevoluciones`
  (`nota-credito-composicion.ts`) sirven para partir un monto en afecto, exento e impuestos contra
  las porciones de la venta **sin cambiar la conducta de la NC**. Escribir la firma que usaría la
  tarea 4. Si hace falta tocar una función compartida, se para.
- [x] **Dónde vive el resolvedor.** `VentasModule` importa `PagosModule`, y `PagosModule` no importa
  ventas. `registrarAbono` vive en pagos y necesita resolver documentos. Proponer dónde va el
  servicio de documentos sin `forwardRef` nuevo. Por ejemplo, un módulo propio
  `venta-documentos` que importen los dos, o dentro de `PagosModule`. El criterio está en
  `docs/patterns/backend.md`.
- [x] **Forma de las enumeraciones.** Cómo declaran las entities existentes una columna de texto con
  valores cerrados: `@Check`, `enum` de Postgres o texto libre con comentario. Con eso se decide la
  forma de `emisor`, `clase_maquina` y `estado_envio`.
- [x] **Un solo pago online.** Confirmar que la venta online y la de suscripción tienen un único
  pago (la tarea 9 corrige ese).
- [x] **Suscripción y online.** Confirmar que las dos crean la venta con `canal = 'online'`
  (`suscripciones.service.ts:120`, `online-callback.handler.ts`), para que les toque E5.
- [x] **El reporte va a la sección "Medido en la tarea 1"** de este plan, al final, con los nombres
  definitivos de los tipos y servicios que usan las tareas 2–12. Las interfaces de abajo son la
  propuesta. Si la medición las cambia, se corrigen acá en el mismo commit.

**Entrega:** este plan con la sección "Medido en la tarea 1" completa. Sin código.

---

## Tarea 2 — La regla por medio de pago (backend + pantalla)

**Archivos:**
- Modificar: `backend/src/modules/metodos-pago/entities/tenant-metodo-pago.entity.ts`,
  `dto/update-tenant-metodo-pago.dto.ts`, `metodos-pago.service.ts`.
- Modificar: `backend/src/modules/tenants/tenants.service.ts:450-458` (alta de tenant) y
  `backend/src/modules/seeder/seeder.service.ts` (`seedTenantMetodosPago`).
- Modificar: `backend/src/modules/tenants/entities/tenant.entity.ts` (`facturador`),
  `dto/update-my-tenant.dto.ts` y `tenants.service.ts` (`updateMine`): el endpoint es
  `PATCH /tenants/me`, no `preferencias-financieras` (tarea 1, § 8a).
- Modificar: `frontend/app/pages/configuracion/metodos-pago.vue` y el tipo del front que espeja la
  respuesta.
- Tests: `metodos-pago.service.spec.ts`; e2e en `backend/test/` junto al de métodos de pago (o uno
  nuevo, si no existe); vitest de la página si ya hay uno.

**Interfaces:**
- Produce: `type EmisorMedio = 'sistema' | 'maquina' | 'nadie'` (lo que se declara por medio),
  exportado desde `tenant-metodo-pago.entity.ts`, y `type Facturador = 'sistema' | 'externo'` (lo
  que se declara por comercio), exportado desde `tenant.entity.ts`. `GET /metodos-pago` suma
  `emisor` y `esEfectivo` por fila (`MetodoPagoTenant`, y el `SELECT` con
  `COALESCE(tmp.emisor, 'sistema')` y `mp.es_efectivo`). `PATCH /metodos-pago/:id` acepta `emisor`.
  `tenants.facturador` se lee por `GET /tenants/me` y se escribe por `PATCH /tenants/me`.

- [ ] Columna `emisor` no nula, default `'sistema'` (E3): `type: 'text'` explícito y
  `@Check('chk_tenant_metodo_pago_emisor', ...)` (forma de la tarea 1, § 5).
- [ ] `UpdateTenantMetodoPagoDto.emisor?` con `@ValidateIf(v !== undefined)` y
  `@IsIn(['sistema','maquina','nadie'])`, no `@IsOptional`: con `null` saltaría la validación y
  llegaría a la columna `NOT NULL` como un 500. El `TenantAdminGuard` de hoy no cambia.
- [ ] `findMetodosPago` devuelve `emisor` y `esEfectivo`; la tarea 7 necesita los dos para la
  pantalla de cobro.
- [ ] El alta de tenant y el seed dejan `'sistema'` explícito.
- [ ] `tenants.facturador`: `'sistema' | 'externo'`, no nulo, default `'sistema'` (E9), con
  `@Check('chk_tenants_facturador', ...)` junto a `chk_tenants_nivel_redondeo`. Lo escribe solo el
  admin por `PATCH /tenants/me` (`UpdateMyTenantDto.facturador?`, `@ValidateIf(v !== undefined)` +
  `@IsIn`): omitirlo conserva el valor, y `null` da 400.
- [ ] Pantalla, arriba de la tabla: **"Facturas y lo que queda debiendo: las hace el sistema / otro
  facturador"**. Con "otro facturador", una línea: *"El sistema las registra como hechas por fuera,
  y su número se anota después."*
- [ ] Pantalla: un `USelect` por fila ("El sistema" / "La máquina" / "Nadie"), con el mismo patrón
  optimista que los switches de esa página. Con "Nadie", una línea debajo: *"Las ventas con este medio
  quedan sin documento. Emitirlo es responsabilidad del comercio."* Solo tokens semánticos de Nuxt
  UI.
- [ ] e2e: el admin cambia `facturador` a `externo` por `PATCH /tenants/me` y se lee en
  `GET /tenants/me`; un `PATCH` sin `facturador` lo deja como estaba; `null` da 400; un no-admin
  recibe 403. El admin cambia a `maquina` y el `GET` lo devuelve; un no-admin recibe 403; un valor
  fuera de la lista da 400; el tenant de otro no cambia.
- [ ] Docs: `docs/features/pagos.md` (o el feature de métodos de pago, si existe): qué es el emisor y
  su default.

---

## Tarea 3 — El catálogo marca la boleta y el servidor valida el tipo

**Archivos:**
- Modificar: `backend/src/modules/ventas/entities/tipo-documento-tributario.entity.ts`, el seeder
  (`seedTiposDocumentoTributario`, l.5096-5181) y `ventas.service.ts` (`crearEnTransaccion`, l.717).
- Tests: `ventas.service.spec.ts`; e2e de ventas.

**Interfaces:**
- Produce: `tipos_documento_tributario.es_boleta` (bool, default `false`, `true` en el código 39 de
  Chile). Un método privado de `VentasService` que resuelve el tipo de la venta:
  `resolverTipoDocumento(manager, tenantId, tipoDocumentoId | undefined, canal): Promise<{ id: string | null; esBoleta: boolean }>`.

- [ ] `es_boleta` en la entity y en el seed.
- [ ] Validación en el servidor: el `tipoDocumentoId` que llega es del país del tenant, `activo` y no
  `es_nota_credito`. Si no, 400. Hoy no se valida nada.
- [ ] Sin `tipoDocumentoId`: la boleta del país (`es_boleta = true`). Sin boleta sembrada en el país
  (AR/CO/MX): `null`, como hoy (§ 3.3 de la spec).
- [ ] `canal = 'online'` (el `canal` guardado en la venta decide, no un dato aparte): siempre la boleta
  del país, aunque el body traiga otro `tipoDocumentoId` (E5; ruling del controlador, tarea 1).
- [ ] Una sola lectura por venta, sin N+1.
- [ ] e2e: tipo de otro país → 400; el tipo NC → 400; sin tipo → la boleta; online → la boleta;
  salones sin tipo → la boleta.
- [ ] Docs: `docs/features/ventas.md` § `POST /api/ventas` (el tipo se valida y tiene default).

---

## Tarea 4 — `venta_documentos` y su resolución al crear la venta

**Archivos:**
- Crear: `backend/src/modules/venta-documentos/` con `venta-documentos.module.ts`,
  `entities/venta-documento.entity.ts` y `venta-documentos.service.ts` (módulo propio, tarea 1 § 4).
- Modificar: `ventas.service.ts` (`crearEnTransaccion`: el `SELECT` de la moneda en l.488 suma
  `t.facturador`, y `documentarVenta` entra después de l.1151), `ventas.module.ts` (importa el
  módulo nuevo), `pagos.service.ts` (`registrar` suma `porPago`, tarea 1 § 2),
  `create-venta.dto.ts` (`PagoVentaDto`), `app.module.ts` (array `entities` y `imports`),
  `backend/src/modules/online/online-callback.handler.ts` (código de Webpay a `referencia`).
- Tests: unit del servicio de documentos; e2e de ventas; `pagos.service.spec.ts:179` y los mocks de
  `registrar` de `ventas.service.spec.ts` (suman `porPago`). `VentaDocumentosService` se registra en
  los providers de los specs de `PagosService` y `VentasService` que ya existen.

**Interfaces:**
- Consume: `EmisorMedio` y `Facturador` (tarea 2), `resolverTipoDocumento` (tarea 3), y
  `porPago: PagoRegistrado[]` que devuelve `PagosService.registrar` (`pagoId`, `metodoPagoId`,
  `emisor`, `esEfectivo`, `aplicadoVenta`; la suma la hace esta tarea, tarea 1 § 2).
- Produce:
  ```ts
  // venta-documento.entity.ts
  export type ClaseDocumentoMaquina = 'voucher' | 'boleta';
  export type EstadoEnvio = 'armado' | 'enviado';
  export type Descarte = 'armado_sin_enviar' | 'afirmado_no_hecho';
  @Entity('venta_documentos') export class VentaDocumento {
    id; tenantId; ventaId; emisor: EmisorDocumento; tipoDocumentoId: string | null;
    // EmisorDocumento = EmisorMedio | 'externo'
    claseMaquina: ClaseDocumentoMaquina | null; numero: string | null;
    estadoEnvio: EstadoEnvio | null; monto: string;
    montoAfecto: string | null; montoExento: string | null; montoImpuestos: string | null;
    pagoId: string | null; documentoCorregidoId: string | null; esDuplicado: boolean;
    descarte: Descarte | null; descartadoEl: Date | null; descartadoPorUsuarioId: string | null;
    creadoEl; actualizadoEl; eliminadoEl;
  }
  // el servicio
  documentarVenta(manager, params: {
    tenantId: string;
    venta: { id: string; tipoDocumentoId: string | null; esBoleta: boolean; canal: string;
             totalFinal: string; configCalculo: ConfigCalculo | null };
    facturador: Facturador;       // de t.facturador, en la consulta de la moneda (l.488)
    porciones: PorcionOriginal[]; // Σ por clasificación de `detalles` (ya en memoria)
    pagos: { pagoId: string; metodoPagoId: string; emisor: EmisorMedio; aplicadoVenta: string;
             numeroDocumento?: string; claseDocumento?: ClaseDocumentoMaquina }[];
  }): Promise<VentaDocumento[]>
  ```
  `monto_impuestos` es **una** columna: la suma de todos los impuestos del documento (tarea 1 § 8b).
  Los baldes salen de `componerBaldes(monto, porciones, cfg)`, función pura exportada del mismo
  archivo (tarea 1 § 3). La tarea 5 suma `registrarDuplicadoDeAbono`.

- [ ] Entity con índice por `venta_id` y por `documento_corregido_id`. Documentar la tabla en
  `startup-pos.sql`.
- [ ] `documentarVenta` corre **una vez, al crear la venta** (en POS y salones crear la venta es la
  entrega, E1), con las reglas de la spec § 3.3 en este orden:
  1. total $0 → nada (E6);
  2. `canal = 'online'` → un `sistema`/`armado` por el total (E5);
  3. factura (`!esBoleta` y hay tipo) → un documento por el total, se pague o no (E2): con
     `facturador = 'sistema'`, `sistema`/`armado`; con `'externo'`, `externo` con el tipo factura y
     sin número;
  4. boleta → un documento por pago `maquina` (con `pagoId`, número y clase si vinieron); uno
     `nadie` por la suma de los pagos `nadie`; y lo no pagado (`totalFinal − Σ aplicadoVenta`) según
     `facturador` (E2): con `'sistema'`, **una** boleta `sistema`/`armado` por los pagos `sistema`
     más lo no pagado; con `'externo'`, la boleta del sistema cubre solo los pagos `sistema`, y lo
     no pagado va en un `externo` con el tipo boleta y sin número. Un documento de monto 0 no se
     crea.
- [ ] `facturador` se lee en la consulta de la moneda que ya hace `crearEnTransaccion` (l.482-500,
  arranca en `FROM tenants t`): se suma `t.facturador` al `SELECT` y no cuesta una lectura más.
- [ ] Invariante, afirmado en un unit: la suma de los documentos no duplicados es el `totalFinal`
  de la venta (salvo $0).
- [ ] Baldes congelados de los `sistema` y los `externo`: siempre por `componerBaldes` (con el total
  de la venta reproduce sus baldes exactos; con una parte, a prorrata). Un solo camino, sin rama para
  "cubre todo".
- [ ] El emisor de cada medio sale en la lectura de `tenant_metodo_pago` que ya hace `registrar`
  (`pagos.service.ts:144-157`): se suma `tmp.emisor` y `mp.es_efectivo` al `SELECT` y el retorno trae
  `porPago`. Cero consultas nuevas. Un pago con `aplicadoVenta = 0` (todo fue propina) no da
  documento.
- [ ] `PagoVentaDto` suma `numeroDocumento?` (texto, máx. 40, trim) y `claseDocumento?`
  (`@IsIn(['voucher','boleta'])`). Si vienen en un pago cuyo medio no es `maquina`, se ignoran sin
  error: la pantalla de la tarea 7 no los muestra ahí, y el pago sigue siendo válido.
- [ ] Online: `pagos.referencia` = `orden.metadata.resultadoPago.codigoAutorizacion`
  (`pagos-redirect.service.ts:205-212`). `PagoVentaDto.referencia` ya existe y `registrar` ya la
  persiste: solo se amplía el cast de `resultadoPago` del handler y se pasa.
- [ ] e2e (los escenarios de la spec § 5 que caen acá):
  - boleta de $100.000: efectivo $60.000 + débito $40.000 en `maquina` con número;
  - mesa de $100.000: $40.000 con tarjeta en `maquina` y $60.000 sin pagar → voucher por 40.000 y
    boleta del sistema por 60.000 al cerrar (E1);
  - boleta pendiente sin pagos (por API) → boleta del sistema por el total;
  - factura de $119.000 con tarjeta en `maquina` → un solo documento `sistema`; con
    `facturador = 'externo'`, un solo documento `externo` con el tipo factura;
  - la mesa que debe $60.000 con `facturador = 'externo'` → voucher + `externo` con el tipo boleta
    por 60.000;
  - online con el crédito en `maquina` → `sistema` por el total, y el código en `referencia`;
  - medio en `nadie` → fila `nadie`;
  - venta de $0 → nada;
  - salones con pago mixto y propina → los montos de los documentos sin la propina.
- [ ] ADR nuevo en `docs/adr/` (el siguiente número libre): la emisión registrada por venta, su
  tabla, por qué el documento nace con la entrega (E1, con la Res. 58/2003 y el art. 55), el
  duplicado de E1b, la declaración del comercio y el emisor `externo` (E2, E9), el descarte de E8 y
  E10, y por qué una corrección se reconoce por `venta_referencia_id` (E7). Más el
  índice, y una nota en ADR-010 que lo enlace.
- [ ] Docs: `docs/features/ventas.md` (qué documentos deja cada venta).

---

## Tarea 5 — El abono no documenta (salvo el duplicado), y anular mira lo emitido

**Archivos:**
- Modificar: `backend/src/modules/pagos/pagos.service.ts` (`registrarAbono`, l.325-458),
  `pagos.module.ts` (importa `VentaDocumentosModule`) y `create-pago.dto.ts` (`PagoItemDto` con los
  mismos dos campos de la tarea 4).
- Modificar: `ventas.service.ts` (`cancelarUnaVez`, l.1325-1342), `dto/cancelar-venta.dto.ts`
  (`externoHecho?`), `ventas.controller.ts` (`anular`, que lo pasa).
- Tests: e2e de pagos y de anular.

**Interfaces:**
- Consume: `VentaDocumento` (tarea 4).
- Produce: en el servicio de documentos,
  `registrarDuplicadoDeAbono(manager, { tenantId, ventaId, pagos: { pagoId, metodoPagoId, emisor, aplicadoVenta, numeroDocumento?, claseDocumento? }[] }): Promise<VentaDocumento[]>`
  (el `emisor` sale de `porPago` de `registrar`), y `evaluarAnulacion(manager, ventaId)` /
  `descartarAlAnular(manager, { tenantId, ventaId, usuarioId, externoHecho })`: una sola regla para
  `cancelarUnaVez` y para el `anulable` de la tarea 6.

- [ ] `registrarAbono` **no** crea documentos por los pagos `sistema` ni `nadie`: la deuda ya estaba
  documentada (E1). Por cada pago cuyo medio es `maquina`, y solo si la venta tiene algún documento
  no duplicado (siempre, salvo $0), registra un documento `maquina` con `es_duplicado = true`, su
  `pagoId`, y número y clase si vinieron (E1b). El cobro **nunca** se rechaza por esto.
- [ ] `cancelarUnaVez`: sale el `if (venta.tipo_documento_id)`. Los otros dos rechazos no cambian.
  Entra (E8, E10; los mensajes exactos están en la spec § 3.5). Solo cuentan los documentos
  vigentes (`descarte IS NULL`):
  - 400 si hay algún documento `maquina` o `sistema` en `enviado`;
  - con un `externo` vigente: con número → 400 (va por NC, sin preguntar); sin número y
    `externoHecho` ausente → 400 que pide la respuesta; `true` → 400 (va por NC); `false` → sigue;
  - si sigue, anula y en la misma transacción descarta: los `sistema` en `armado` con
    `'armado_sin_enviar'`, y los `externo` con `'afirmado_no_hecho'`; los dos con
    `descartado_el = NOW()` y `descartado_por_usuario_id` = el usuario del token. Sin borrar filas.
- [ ] `CancelarVentaDto.externoHecho?`: `@IsOptional() @IsBoolean()`. El controller lo pasa tal cual:
  `undefined` y `false` son dos conductas distintas, y no se colapsan con un default.
- [ ] e2e:
  - la mesa que debe $60.000 paga al día siguiente en efectivo → ningún documento nuevo;
  - la misma deuda pagada con tarjeta en `maquina` → un documento `maquina` con `es_duplicado`, y
    el cobro pasa;
  - factura con abono en efectivo → ningún documento nuevo;
  - boleta pendiente sin pagos (por API) → se anula, y su boleta queda `descartado` (E8);
  - factura del sistema sin pagos → se anula, y queda descartada;
  - factura `externo` sin pagos: sin `externoHecho` → 400; `true` → 400; `false` → se anula, y el
    `externo` queda con `'afirmado_no_hecho'`, el usuario y la hora; con número anotado → 400 aunque
    venga `false`;
  - los mutantes que dejan de descartar al anular, y que tratan `externoHecho` ausente como `false`,
    tienen que morir;
  - el mutante que vuelve a documentar el abono por su medio (la E1 vieja) tiene que morir.
- [ ] Docs: `docs/features/ventas.md` § anular y `docs/features/pagos.md` § abono (el abono no
  documenta; el duplicado). `PRODUCTO.md` § 10: la regla de `cancelada` pasa a leerse contra lo
  emitido, y se va el párrafo que dice que hoy se mira la etiqueta.

---

## Tarea 6 — El detalle trae los documentos, y el número se completa después

**Archivos:**
- Modificar: `ventas.controller.ts`, `ventas.service.ts` (`findOne`, l.3017), el servicio de
  documentos. Crear el DTO `completar-documento.dto.ts`.
- Tests: e2e de ventas.

**Interfaces:**
- Produce:
  - `GET /ventas/:id` suma `documentos: { id, emisor, tipoDocumento: {id, codigo, nombre} | null, claseMaquina, numero, estadoEnvio, monto, pagoId, documentoCorregidoId, esDuplicado }[]`, `anulable: boolean`, `anularPreguntaExterno: boolean` y `abonoConMaquinaDuplica: boolean`;
    `documentos[]` suma `descarte`, `descartadoEl` y quién descartó (nombre del usuario, en la misma
    consulta);
  - `PATCH /ventas/:id/documentos/:documentoId` con body `{ numero: string; clase?: ClaseDocumentoMaquina }`, que responde el documento actualizado.

- [ ] `findOne` trae los documentos de la venta **y los de sus correcciones** en una sola consulta.
- [ ] `anulable`, calculado en el backend con la misma regla que `cancelarUnaVez`: ambos llaman a
  `VentaDocumentosService.evaluarAnulacion` (tarea 5), el predicado compartido. Es la única fuente de
  verdad: el drawer deja de replicarla (tarea 7).
- [ ] `anularPreguntaExterno`: `true` si es anulable y tiene un `externo` vigente sin número (E10).
- [ ] `abonoConMaquinaDuplica`: `true` si la venta tiene saldo y algún documento no duplicado (E1b).
  Es lo que la pantalla de abono usa para avisar, sin replicar la regla.
- [ ] `PATCH`: `@RequiresPermiso('Ventas','Crear')`, con el alcance de caja de `findOne`
  (`resolverAlcanceDerivadoDeCaja`). Solo documentos `maquina` o `externo` de esa venta y de ese
  tenant: si no, 404. `clase` solo se acepta con `maquina`. El `tenant_id` sale del token.
- [ ] El `PATCH` también sirve para el voucher duplicado de E1b: el contador necesita su número.
- [ ] El `PATCH` delega en un método del servicio de documentos,
  `completarNumero(manager, { tenantId, documentoId, numero, clase? })`, sin `usuarioId` ni nada del
  request. Una integración futura con el facturador externo llama ese mismo método (spec § 3.4,
  owner `795f9bb5`).
- [ ] e2e: completar el número de un voucher → 200 y queda; el de una factura `externo` → 200; un documento `sistema` → 404; uno de
  otro tenant → 404; un cajero de otra caja sin `Cajas:Leer` → 404; un número vacío → 400.
- [ ] `api-security-reviewer` sobre el controller y el DTO.
- [ ] Docs: `docs/features/ventas.md` § `GET /api/ventas/:id` y el endpoint nuevo.

---

## Tarea 7 — Pantallas: el número al cobrar, el aviso del abono y la sección Documentos

**Archivos:**
- Modificar: `frontend/app/components/ventas/CobroModal.vue`, `frontend/app/composables/useVenta.ts`
  (`PagoInput`), `frontend/app/pages/ventas/pos.vue`, `frontend/app/pages/salones/index.vue`,
  `frontend/app/composables/useSalones.ts`, `frontend/app/components/pagos/AbonoModal.vue`,
  `frontend/app/components/ventas/VentaDetalleDrawer.vue` y los tipos de `frontend/app/types/`.
- Tests: vitest de `CobroModal`, `AbonoModal` y del drawer.

**Interfaces:**
- Consume: `emisor` de `GET /metodos-pago` (tarea 2), los campos de `PagoVentaDto` (tarea 4), los
  `documentos`, `anulable`, `abonoConMaquinaDuplica` y el `PATCH` (tarea 6).

- [ ] `CobroModal`: en un pago cuyo medio emite con la máquina, dos campos opcionales debajo: "N° del
  comprobante" y "Es voucher / Es boleta de la máquina". Viajan en el body. El cajero no elige
  quién emite: la pantalla no ofrece eso.
- [ ] `AbonoModal`: si `abonoConMaquinaDuplica` y el cajero elige un medio que emite con la máquina,
  un aviso antes de confirmar: *"Esta venta ya tiene su boleta. El voucher de este pago también vale
  como boleta y la duplica. El cobro sigue, y queda marcado para que el contador lo corrija."* No
  bloquea. Los dos campos del número también aparecen ahí.
- [ ] Drawer: una sección "Documentos" que lista cada uno: quién lo emitió, el tipo o la clase, el
  número o "sin número", el monto, si es una corrección qué corrige, y si es duplicado, la marca
  "Duplicado — para el contador". Un documento `sistema` dice "Armado, sin enviar al SII". Una venta
  sin documentos dice "Sin documento".
- [ ] "Completar número" en los documentos de la máquina y los hechos por fuera sin número, con el
  `PATCH`. Un documento `externo` dice "Hecho por fuera". Uno descartado dice "Descartado al anular"
  y, si fue `'afirmado_no_hecho'`, "<usuario> dijo que no estaba hecho, <fecha>".
- [ ] `puedeAnular` usa `venta.anulable` del backend y deja de leer `tipoDocumento`.
- [ ] `AnularVentaModal`: con `anularPreguntaExterno`, pregunta *"¿Ya hiciste esta factura en tu
  facturador?"* (o "este documento", si el tipo es boleta). Con "Sí", no anula: explica que va por
  nota de crédito, hecha por fuera y anotada con su número. Con "No", anula mandando
  `externoHecho: false`. El botón de anular no se habilita hasta que conteste.
- [ ] Utilidades de presentación (etiquetas de emisor y clase) en un composable de
  `app/composables/`, no locales al `.vue`.
- [ ] vitest: los campos aparecen solo con medio `maquina`; el body los lleva; el aviso del abono
  aparece solo con `abonoConMaquinaDuplica` y medio `maquina`, y no deshabilita confirmar; el drawer
  usa `anulable` (con un mutante que vuelve a `!tipoDocumento`).; `AnularVentaModal` no habilita anular sin
  respuesta, manda `externoHecho: false` con "No" y no llama al endpoint con "Sí".
- [ ] Smoke en navegador del cobro mixto, del abono con tarjeta y de completar el número, como un
  rol con los permisos del módulo, no admin (los bugs de runtime del drawer no los ve el build).

---

## Tarea 8 — Las correcciones llevan su documento según por dónde vuelve la plata

**Archivos:**
- Modificar: `ventas.service.ts` (`crearNotaCredito*`, l.1495-2230, y los lectores de la tabla de
  la tarea 1 que caen en esta tarea), `create-nota-credito.dto.ts`, `ventas.controller.ts` y el
  servicio de documentos.
- Tests: unit y e2e de notas de crédito.

**Interfaces:**
- Produce:
  ```ts
  // CreateNotaCreditoDto: sale `devolverDinero`, entra
  devolucion: { pagoId: string } | { sinPlata: true }
  // CrearNotaCreditoParams (interno), en lugar de devolverDinero:
  via: { tipo: 'pago'; pagoId: string } | { tipo: 'sin_plata' }
     | { tipo: 'pasarela'; pagoId: string }   // solo la usa la tarea 9; no mueve caja
  // servicio de documentos:
  documentoQueCorrige(manager, ventaId, via): Promise<VentaDocumento>  // nunca un duplicado
  documentarCorreccion(manager, { tenantId, correccionVentaId, corregido: VentaDocumento | null,
                                  monto, tipoNotaCreditoId }): Promise<VentaDocumento>
  ```

- [ ] `exigirTipoNotaCredito` (`ventas.service.ts:1529`) se llama hoy al abrir la transacción: pasa
  a exigirse solo si la corrección lleva el tipo NC; con `nadie` (devolución interna, tipo nulo) no
  hace falta y un país sin NC sembrada no la frena. `devolucion` en el DTO es una clase con
  `pagoId?` y `sinPlata?` y un 400 si no viene exactamente una (el pipe global rechaza lo que el DTO
  no declara, `validacion-global.pipe.ts:19-24`). Los baldes de una NC `sistema` salen de las líneas
  de la propia corrección, no de `componerBaldes`.
- [ ] Qué documento corrige, en el servidor (spec § 3.6). El contrato es por **pago** y no por
  "efectivo", porque un comercio puede tener el efectivo en `maquina` (hay máquinas que emiten
  también por efectivo) y una venta puede tener dos pagos en efectivo:
  - `pago`: el documento que cubre ese `pagoId`, que tiene que ser de esa venta. Si el medio de ese
    pago `es_efectivo`, la plata sale de la caja (la salida de hoy, con sus dos topes). Si no, no se
    mueve caja: la reversa se hace en la máquina o en el banco;
  - `sin_plata`: solo si la venta tiene saldo, y corrige el documento que cubre lo no pagado: la
    boleta del sistema, el `externo` o la factura (E1, E2);
  - el `pagoId` de un abono: el documento que documentó la deuda (la boleta del sistema o la
    factura), nunca el voucher duplicado;
  - en una factura, la factura siempre.
- [ ] El documento de la corrección: `sistema` → NC `sistema`/`armado` con el tipo NC; `maquina` → NC
  `maquina` sin número, con el tipo NC; `externo` → NC `externo` sin número, con el tipo NC;
  `nadie` → **devolución interna**: fila `nadie`, y la fila de
  `ventas` de la corrección con `tipo_documento_id` **nulo**.
- [ ] **Tope por documento**: lo corregido de un documento no pasa su `monto`, bajo el mismo lock y
  junto a los dos topes de hoy. El mensaje no revela el efectivo de la caja (la fuga 5 del modo
  ciego sigue cerrada).
- [ ] **Todo** lector que pregunta "¿esto es una corrección?" pasa a `venta_referencia_id IS NOT NULL`,
  en esta tarea (E7). La devolución interna **cuenta** en los topes. Los de la tarea 1 § 1:
  - `ventas.service.ts:1537` (NC sobre NC; `lockVentaOriginal`, `:2375`, suma `venta_referencia_id`
    a su `SELECT`);
  - los topes `:1567`/`:1569`, `:1632`/`:1638` y `:2143`/`:2146` (sale el `AND tipo_documento_id = $2`
    y el parámetro);
  - los flags `esNotaCredito` del listado (`:3012`, que hoy no trae `venta_referencia_id` en su
    `SELECT`, `:2925`) y del detalle (`:3338`), y el gemelo `elegibleParaNotaCredito` (`:3312-3313`);
  - **`VentasService.resumen` (`:2845`)** y **`resumen-negocio.service.ts:184`, `:261`, `:324`**: solo
    el predicado (`v.venta_referencia_id IS NULL` donde hoy dice "no es NC"); el resto de esas
    consultas no se toca (restricción global).
  El backend produce el flag `esCorreccion: boolean` (listado y detalle); `esNotaCredito` queda
  como `esCorreccion` con tipo NC (falso en la devolución interna).
- [ ] **Antes de despachar esta tarea**, el controlador hace grep de todo el repo (`backend` y
  `frontend`) de lectores que distingan una corrección por el tipo de documento (`es_nota_credito`,
  `tipoNotaCreditoDelTenant`, `tipo_documento_id`, `esNotaCredito`, `td.es_nota_credito`): la lista
  completa va en el brief. La de la tarea 1 es del 2026-10-01 y puede haber crecido.
- [ ] e2e:
  - NC por el pago en efectivo del pago mixto → corrige la boleta, no el voucher, y deja la salida
    de caja;
  - NC por el pago con tarjeta → NC `maquina`, sin salida de caja;
  - NC sobre una venta en `nadie` → devolución interna con tipo nulo, y la venta original baja su
    disponible;
  - una devolución interna **no suma** al vendido del dashboard (`resumen-negocio`: vendido, por
    cobrar y más vendidos) ni al `totalFacturado`/`saldoPendiente` de `GET /ventas/resumen`, y
    cuenta en el tope de la venta original (con un mutante que vuelve al filtro por tipo);
  - el tope por documento rechaza el excedente;
  - `sin_plata` en una venta pagada → 400;
  - `sin_plata` en la mesa que debe $60.000 → corrige la boleta del sistema, no es devolución
    interna;
  - NC por el pago de un abono con tarjeta (E1b) → corrige la boleta de la deuda, no el duplicado;
  - corregir una corrección → 400;
  - los tests de NC de hoy siguen en verde con el `pagoId` del pago en efectivo donde antes iba
    `devolverDinero: true`, y con `sinPlata` o el pago con tarjeta donde iba `false` (cuál, según
    lo que afirma cada test).
- [ ] `api-security-reviewer`: el `pagoId` del body es de esa venta y de ese tenant.
- [ ] Docs: `docs/features/reembolsos-nota-credito.md` (reescribir la sección, no anexar).

---

## Tarea 9 — El reembolso por pasarela siempre deja registro

**Archivos:**
- Modificar: `backend/src/modules/pasarela/dto/create-reembolso.dto.ts`,
  `services/cobros.service.ts` (`aplicarPostReembolso`, l.429-482),
  `services/reembolso-callback.registry.ts`, `entities/pasarela-transaccion.entity.ts`,
  `backend/src/modules/ventas/reembolso-callback.handler.ts`.
- Tests: `reembolso-callback.handler.spec.ts`; e2e de pasarela.

**Interfaces:**
- Consume: `crearNotaCredito` con `via: { tipo: 'pasarela', pagoId }` (tarea 8).
- Produce: `pasarela_transacciones.correccion_venta_id` (uuid, nulo).

- [ ] Sale `generarNotaCredito` del DTO, del evento y del handler. Todo `REFUND` aprobado de una
  orden con `venta_id` crea la corrección, contra el documento del pago online (E5: la boleta del
  sistema). Las `devoluciones` de stock viajan dentro de la corrección. Sale
  `registrarDevolucionesPorReembolso` y su `registrarDevolucionesPorReembolsoUnaVez`
  (`ventas.service.ts:2261`), que quedan sin llamador (la tarea 1 confirmó que el único llamador de
  producción es `reembolso-callback.handler.ts:56`): se borran con su rama del handler, sus
  dos menciones en comentarios (`ventas.service.ts:2405`, `:2514`) y sus tests de
  `ventas.service.spec.ts` y del spec del handler.
- [ ] El pago a corregir se resuelve en el servidor: el único pago de la venta online. La tarea 1
  confirmó que es uno solo en los dos llamadores internos (`online-callback.handler.ts:75-83` y
  `suscripciones.service.ts:197`), pero `POST /ventas` acepta `canal: 'online'` con varios pagos: la
  resolución **lanza** si la venta no tiene exactamente un pago.
- [ ] Cuando la corrección se crea, `correccion_venta_id` se escribe en el `REFUND`. Si el hook
  falla, sigue el `warning` de hoy: la plata ya volvió y no se revierte.
- [ ] Orden sin `venta_id` → sin corrección, como hoy (es legítimo).
- [ ] e2e: `REFUND` aprobado → corrección con su documento y `correccion_venta_id`; un body con
  `generarNotaCredito` → 400 por `forbidNonWhitelisted` (el pipe global lo tiene,
  `validacion-global.pipe.ts:19-24`, y ningún controller de pasarela lo reemplaza); la API externa
  igual.
- [ ] `api-security-reviewer` sobre los dos controllers de pasarela.
- [ ] Docs: `docs/features/pasarela-pagos.md`, `docs/features/reembolsos-nota-credito.md`.

---

## Tarea 10 — Pantallas de la devolución

**Archivos:**
- Modificar: `frontend/app/components/ventas/NotaCreditoModal.vue`,
  `frontend/app/components/ordenes/ReembolsoModal.vue` y sus tipos, y —para que una devolución
  interna no se pinte como venta— `frontend/app/components/ventas/VentaDetalleDrawer.vue` (l.135,
  245, 258, 596, 864, 926) y `frontend/app/pages/ventas/index.vue` (l.18, 273). Corre después de la
  7, que también edita el drawer.
- Tests: vitest de los dos modales, `VentaDetalleDrawer.nuxt.spec.ts`, y el Playwright
  `frontend/e2e/ventas/nota-credito.spec.ts` (l.131-135 afirma `esNotaCredito`).

- [ ] `NotaCreditoModal`: la casilla "devolver dinero" se reemplaza por **"¿Por dónde vuelve la
  plata?"**: una opción por cada pago de la venta (*"Efectivo de la caja · $60.000"*, *"Tarjeta de
  débito · $40.000"*) y "No vuelve plata", esta última solo si la venta tiene saldo. Debajo, en una
  línea, qué registro va a quedar: nota de crédito, nota de la máquina para anotar después o
  devolución interna. "No vuelve plata" siempre deja una nota de crédito (E1). Sale del documento corregido, que ya trae el detalle (tarea 6), con la misma
  regla que el servidor (gemelo exacto o nada).
- [ ] `ReembolsoModal`: se va la casilla "Generar nota de crédito" (`ReembolsoModal.vue:36` y
  l.151-158). Las devoluciones de stock siguen. Se va `normalizarSoloStock`, que existía solo para
  el camino sin NC.
- [ ] Drawer y listado leen `esCorreccion` del backend (tarea 8) donde hoy leen `esNotaCredito`:
  badge, título de las líneas, `clasificacion` y `puedeCrearNC`. Una devolución interna (tipo nulo)
  se rotula como corrección ("Devolución interna"), no como "Líneas de venta". El badge del listado
  sigue el mismo flag.
- [ ] vitest: `VentaDetalleDrawer` con `esCorreccion: true` y `esNotaCredito: false` rotula
  "Líneas de la nota"/"Devolución interna" y no ofrece nota de crédito; el body de la NC lleva `devolucion`; "No vuelve plata" no aparece en una venta pagada;
  el reembolso ya no manda la casilla.
- [ ] Playwright (`nota-credito.spec.ts`): el documento devuelto afirma también `esCorreccion`.
- [ ] Smoke en navegador de una NC por tarjeta sobre un pago mixto, como el rol con `Ventas:Nota de
  crédito`.

---

## Tarea 11 — Reportes (⏸ solo verificación, después del frente del vendido neto)

**No arranca hasta que la orquestadora avise que el frente "El vendido, el cobrado y el Total
facturado restan las notas de crédito" está en main.** El predicado de "es corrección" de esas
consultas ya lo cambió la tarea 8, y ese frente reconoce las correcciones por
`venta_referencia_id IS NOT NULL` (orquestadora, `fcec4332`): **esta tarea no escribe código de
producción**, verifica sobre lo mergeado que la devolución interna entra y que ninguna consulta quedó
con `es_nota_credito`.

**Archivos:** `backend/src/modules/resumen-negocio/resumen-negocio.service.ts`,
`ventas.service.ts` (`resumen`), y sus e2e.

- [ ] Medir sobre lo mergeado: cada lector de la tabla de la tarea 1 que cae en esta tarea reconoce
  la corrección por `venta_referencia_id`. Si alguno quedó con `es_nota_credito`, se cambia acá.
- [ ] e2e: una devolución interna de hoy resta del vendido y de "Total facturado", y su línea de
  mercadería resta de lo más vendido. Una NC de la máquina, igual.
- [ ] Docs: `docs/features/dashboard-inicio.md` y `docs/features/ventas.md` § resumen: la devolución
  interna resta como una NC.

---

## Tarea 12 — `/ventas` filtra por quién emitió

**Archivos:** `ventas.service.ts` (`buildListarFilters`, l.2957-2985; `listar`),
`dto/query-ventas.dto.ts`, `frontend/app/pages/ventas/index.vue`. Tests: e2e de listar y vitest de
la página.

- [ ] `QueryVentasDto.documento?`: `'sistema' | 'maquina' | 'externo' | 'sin_numero' | 'sin_documento' | 'duplicado'`.
  "Sin número" = algún documento `maquina` o `externo` sin `numero`. Los descartados no cuentan.
  Va como un `EXISTS` sobre `venta_documentos`, sin N+1. "Sin documento" = la venta tiene algún
  tramo en `nadie` (con E1 lo no pagado nunca queda sin documento). "Duplicado" = algún documento
  con `es_duplicado` (E1b, para el contador). Las correcciones quedan fuera de los filtros.
- [ ] El listado devuelve por fila un resumen chico (`emisores: EmisorDocumento[]`, `tieneDuplicado`)
  en la misma consulta, con una agregación.
- [ ] Página: un filtro "Documento" junto a los de estado y canal, y un badge por fila.
- [ ] e2e: cada filtro trae exactamente sus ventas, con una de cada tipo sembrada en el test.
- [ ] Docs: `docs/features/ventas.md` § `GET /api/ventas`.

---

## Cierre

- [ ] Playwright: el cobro mixto con número, completar el número después, la NC por tarjeta y el
  filtro "sin documento". Corre como el rol del módulo, en el stack propio del worktree.
- [ ] Gate completo de `CLAUDE.md` (backend y frontend), con el exit code de cada comando y no la
  última línea.
- [ ] `docs/ESTADO.md`. Las dos entradas de la § 6 de `pendientes.md` se mudan a `resueltos.md`, con
  lo que las fija. La tarea 11 cierra la suya cuando entre.
- [ ] Aviso a la orquestadora al mergear cada tarea.

## Orden y paralelismo

`1 → 2 → 3 → 4 → 5 → 6 → 8 → 9`, con `7` después de `6`, `10` después de `7`, `8` y `9` (la 7 y la 10 editan el drawer), y `12` después
de `4`. La `11` es solo verificación, espera al vendido neto y no frena a ninguna. Las tareas de backend que comparten
`ventas.service.ts` van de a una: es un archivo de 4.000 líneas y dos implementadores encima se
pisan.

## Medido en la tarea 1

Medido el 2026-10-01 sobre `b9892a7e` (= `main`), solo lectura, sin tocar `backend/src`. Cada cita
se abrió antes de escribirla. Los conteos de un grep se clasificaron a mano: un grep cuenta el
patrón, no la conducta.

### 1. Lectores de "es NC"

Las nueve líneas de `ventas.service.ts` que midió el diseño están **confirmadas**. Faltaban ocho
más, y `resumen-negocio.service.ts` no tiene "cinco lugares": tiene **tres consultas** (las cinco
líneas del grep son tres predicados y dos comentarios).

| Archivo:línea | Qué hace | Tarea |
|---|---|---|
| `ventas.service.ts:1462-1478` | `tipoNotaCreditoDelTenant`: el id del tipo NC del país (una consulta, `es_nota_credito = true`) | 8: deja de *reconocer*; sigue para *escribir* el tipo de una NC con documento |
| `:1485-1493` | `exigirTipoNotaCredito`: 400 si el país no tiene el tipo | 8: solo se exige si la corrección lleva tipo (con `nadie` es nulo) |
| `:1529` | la llama `crearNotaCreditoEnTransaccion` al abrir la transacción, antes del lock | 8 |
| `:1537` | rechazo "NC sobre NC": `original.tipo_documento_id === tipoNotaCredito` | 8 → `venta_referencia_id IS NOT NULL` (E7) |
| `:1567` | Σ de NC previas (tope total): `venta_referencia_id = $1 AND tipo_documento_id = $2` | 8 → solo `venta_referencia_id` |
| `:1632` | composición original vs NC previas: `AND tipo_documento_id = $2` | 8 |
| `:2143` | efectivo ya devuelto: `nc.tipo_documento_id = $2` | 8 |
| `:1569`, `:1638`, `:2146` | pasan `tipoNotaCredito` como `$2` de las tres anteriores | 8 (salen con el filtro) |
| `:1989` | **escritor**: `tipoDocumentoId: tipoNotaCredito` en la fila de la NC | 8 (nulo en la devolución interna) |
| `:2375` | `lockVentaOriginal` trae `tipo_documento_id`; lo leen 1329 y 1537 | 5 y 8 (sumar `venta_referencia_id` al `SELECT`) |
| `:1329` | `cancelarUnaVez` rechaza si `venta.tipo_documento_id`: anular mira la etiqueta | 5 |
| `:2835-2846` | `resumen`: `v.tipo_documento_id IS DISTINCT FROM <NC>` | 8 (solo el predicado, `:2845`) |
| `:2925`, `:2949`, `:3013` | listado: el `SELECT` trae `tipo_documento_id`, `esNotaCredito` se deriva del id; el tipo en `:93` | 8: derivar de `venta_referencia_id`, que el `SELECT` **no trae hoy** |
| `:3286`, `:3313` | detalle: el gemelo `elegibleParaNotaCredito` (`v.tipo_documento_id !== tipoNotaCredito`) | 8 |
| `:3339` | detalle: `esNotaCredito` | 8 |
| `:2409-2422`, `:3122`, `:3152` | **ya** leen `venta_referencia_id` sin mirar el tipo (unidades comprometidas, NC hijas, disponible por porción) | ninguna |
| `resumen-negocio.service.ts:168-184` (vendido), `:242-261` (por cobrar), `:309-324` (más vendidos) | `LEFT JOIN tipos_documento_tributario` + `COALESCE(td.es_nota_credito, false) = false` (predicados en 184, 261 y 324). La consulta de **cobrado** (`:203-224`) no mira NC, y lo dice | 8 (solo el predicado de 184, 261 y 324); 11 verifica |
| `VentaDetalleDrawer.vue:135`, `:245`, `:258`, `:596`, `:864`, `:926` | `esNotaCredito` del backend: tipo, computed, `puedeCrearNC` (`!esNotaCredito`), `clasificacion`, badge "Nota de Crédito", título "Líneas de la nota" | 10 (con el `esCorreccion` que produce la 8) |
| `VentaDetalleDrawer.vue:268-274` | `puedeAnular` lee `!venta.value.tipoDocumento` (l.272) | 7 |
| `pages/ventas/index.vue:18`, `:273` | tipo y badge "NC" del listado | 10 |

No son lectores de NC y no cambian: `useVenta.ts:446` y `salones/index.vue:2780` (el selector de
`tipoDocumentoId`), `ventas.service.ts:3053-3071` (el `LEFT JOIN` del detalle trae `codigo` y
`nombre` solo para mostrar). Tests que fijan hoy la conducta: `ventas.service.spec.ts`,
`resumen-negocio.service.spec.ts`, `test/nota-credito-por-pais.e2e-spec.ts`,
`test/nota-credito-composicion.e2e-spec.ts`. `devolverDinero` aparece en
`test/caja.e2e-spec.ts:1323` (el único e2e) y en `ventas.service.spec.ts` (8 sitios).

⚠️ Una **devolución interna** (tipo nulo, tarea 8) quedaría fuera del reconocimiento de `resumen`
(`:2845`) y de las tres consultas de `resumen-negocio`: las dos cuentan "todo lo que no tiene el tipo
NC" como venta y la sumarían con signo positivo. **Decidido** (orquestadora, 2026-10-01): la tarea 8
migra esos predicados junto con los demás lectores (ver "Contradicciones", 1).

### 2. Lo aplicado por pago

`PagosService.registrar` (`pagos.service.ts:112`) devuelve hoy `{ pagos: Pago[]; montoAplicadoVenta: string }`
(`:125`, `:316-319`). **No devuelve lo aplicado por pago.** Lo calcula y lo tira: el loop de
`:276-298` recorre `aplicaciones` (que viene de `dispatchAsignacionPropina`, `:269`), suma `venta`
en un acumulador (`:283`) y guarda cada fila en `pago_aplicaciones`, pero solo sale la suma.

Lo que sí hay en el sitio, sin una consulta más:

- `pagosGuardados[i]` está **en el mismo orden que `params.pagos[i]`** (`:235-256`), con `id`,
  `metodoPagoId`, `monto`, `vuelto`. El documento puede cruzar el número y la clase que tipeó el
  cajero (`PagoVentaDto`, por índice) con el pago guardado.
- `calcularAplicacionesNoVuelto` (`asignacion-propina.ts:23-70`) emite **como mucho una fila
  `venta` por pago** y ninguna si todo el neto fue propina (`if (venta.gt(0))`). Por eso un pago
  puede tener `aplicadoVenta = 0`, y entonces no da documento.
- La lectura de `tenant_metodo_pago` que ya hace `registrar` (`:144-157`) hace `JOIN metodos_pago mp`:
  sumar `tmp.emisor` y `mp.es_efectivo` a ese `SELECT` cuesta **cero consultas**.

**Cambio mínimo** (no cambia `pagos` ni `montoAplicadoVenta`, que leen todos los llamadores): sumar
a la respuesta `porPago`, en el orden de la entrada.

```ts
// pagos.service.ts
export interface PagoRegistrado {
  pagoId: string;
  metodoPagoId: string;
  emisor: EmisorMedio;       // de tenant_metodo_pago, en la misma lectura de :144-157
  esEfectivo: boolean;       // metodos_pago.es_efectivo, mismo JOIN
  aplicadoVenta: string;     // pago_aplicaciones.tipo = 'venta' de ESE pago, '0.0000' si todo fue propina
}
// registrar(...): Promise<{ pagos: Pago[]; montoAplicadoVenta: string; porPago: PagoRegistrado[] }>
```

Se llena en el loop de `:276-298` (un `Map<pagoIdx, Decimal>` en lugar de solo el acumulador). La
invariante: `Σ porPago.aplicadoVenta === montoAplicadoVenta`. En el retorno anticipado de `:139-141`
(sin pagos) sale `porPago: []`.

Llamadores de `registrar`: **dos sitios**, no tres: `ventas.service.ts:1120` y `pagos.service.ts:415`.
Los cuatro caminos que crean ventas (POS por `POST /ventas`, `salones.service.ts:2304`,
`suscripciones.service.ts:190`, `online-callback.handler.ts:87` vía `crear`) pasan **todos** por
`crearEnTransaccion`, así que `documentarVenta` entra en **un solo lugar**: después de `:1151`
(`venta.estado = estadoFinal`). `registrarAbono` es el otro. Rompe, y hay que actualizar:
`pagos.service.spec.ts:179` (`toEqual({ pagos: [], montoAplicadoVenta: '0.0000' })`) y los mocks de
`registrar` de `ventas.service.spec.ts` (l.263, 476, 783, 1432, 1459, 1656, 1792, 1806, 2620).

### 3. El reparto a prorrata

**Sirven, sin tocar ninguna función compartida.** `repartirAjuste` (`nota-credito-composicion.ts:91`)
reparte un monto entre porciones a prorrata de un peso; `tasaEfectiva` (`:52`) y `descomponer` (`:73`)
parten cada parte en neto + impuesto, con el impuesto **por resta**, así que `neto + impuesto = bruto`
exacto. Son las que ya usa la NC por monto (`ventas.service.ts:1814-1821`, `:1928`). `repartirProporcional`
vive en el motor (`calculo-precios.engine.ts:1577`) y la composición solo la importa: no se modifica.

Las porciones de una venta recién creada **ya están en memoria**: `detalles` (`ventas.service.ts:737`,
`manager.save` devuelve las mismas instancias) trae `clasificacionTributaria`, `totalLinea` e
`impuestoAplicado` por línea. Σ por clasificación da el `PorcionOriginal[]` sin una consulta.

Firma que usa la tarea 4 (función pura, exportada para test, en `venta-documentos.service.ts`):

```ts
import { descomponer, repartirAjuste, tasaEfectiva, CFG_SIN_CONGELAR,
         type PorcionOriginal } from '../ventas/nota-credito-composicion';

export function componerBaldes(
  monto: Decimal,                     // lo que cubre el documento, en moneda oficial
  porciones: PorcionOriginal[],       // Σ por clasificación de las líneas de la venta
  cfg: ConfigCalculo | null,          // venta.configCalculo; null → CFG_SIN_CONGELAR
): { montoAfecto: Decimal; montoExento: Decimal; montoImpuestos: Decimal }
// q = (d) => cuantizar(d, cfg), como ventas.service.ts:1595-1598 (ignora nivelRedondeo, a propósito).
// pesos = porciones.map(p => ({ clasificacion, peso: new Decimal(p.total) })) ORDENADOS por
//         clasificacion (localeCompare): el desempate del reparto es por posición (ventas.service.ts:1809-1812).
// partes = repartirAjuste(monto, pesos, cfg, q); por parte: descomponer(parte.bruto, tasaEfectiva(porciones, clasificacion), q)
// montoAfecto / montoExento = el NETO de cada porción; montoImpuestos = Σ impuesto de las dos.
// Una clasificación distinta de 'afecto'/'exento' lanza: no se descarta en silencio.
```

Definición de los baldes: `montoAfecto + montoExento + montoImpuestos = monto`, exacto.

Medido con un script en el scratchpad (no versionado): 20.000 ventas en CLP (0 decimales, IVA 19 %,
porción afecta y exenta aleatorias), partidas en 2 o 3 documentos:

| Medición | Resultado |
|---|---|
| identidad `afecto + exento + impuestos = monto` | rota en **0 de 49.606** documentos |
| documento que cubre la venta entera | reproduce el neto y el IVA de la venta en **20.000 de 20.000** |
| Σ de los documentos de una venta contra los baldes de la venta | difiere en 4.039 de 20.000 ventas (20,2 %); máximo **2** en el neto y **1** en el impuesto, en unidades de CLP |

Ese residuo es el mismo que ADR-010 anota para una serie de NC ("hasta 2 minor units"), y es lo que
la spec dice: "el residuo de cuantización va igual que en la NC". Límites: generador propio, solo CLP
y `nivelRedondeo = 'linea'`. **No medido:** con `'documento'` (México, que no tiene boleta sembrada),
donde Σ `total_linea` puede no igualar `total_final`; el reparto igual fuerza `Σ partes = monto`.

Para una NC `sistema` (tarea 8), los baldes **no** salen de esta prorrata: la corrección ya trae sus
líneas compuestas por `crearNotaCreditoEnTransaccion`, y de ahí se leen.

### 4. Dónde vive el resolvedor

`PagosModule` importa `CajaModule`, `MonedasModule` e `IdempotenciaModule` (`pagos.module.ts:12-19`) y
`VentasModule` importa `PagosModule` (`ventas.module.ts:46`): el servicio de documentos no puede vivir
en `VentasModule` (pagos lo necesita y no importa ventas), y ponerlo **dentro de `PagosModule`** haría
que pagos fuera dueño de una tabla de ventas. `docs/patterns/backend.md` § 1 pide un módulo por feature
con sus entities, § 5 que el módulo exporte su service, y § 13 que el borde se cruce en una sola
dirección.

**Decisión: un módulo propio, `VentaDocumentosModule`**, que importan `VentasModule` y `PagosModule` y
que **no importa a ninguno de los dos**. Sin `forwardRef`. Lo que necesita no exige imports:

- `Db` es global (lo inyectan `PagosService` y `VentasService` sin importar nada que lo provea);
- su entity va por `RepositoriosModule.forFeature([VentaDocumento])` y en el array `entities` de
  `app.module.ts:200` (junto a `VentaImpuesto`, l.266);
- lee `tenant_metodo_pago`, `pagos` y `pago_aplicaciones` por SQL con `Db`/`manager` (como ya hacen
  `ventas.service.ts:2125-2147` y `pagos.service.ts`), sin importar `PagosService`;
- las funciones de reparto son un archivo hoja (`nota-credito-composicion.ts` solo importa el motor):
  importarlo desde el módulo nuevo no cierra un ciclo de archivos.

Grafo: `VentasModule → PagosModule → VentaDocumentosModule` y `VentasModule → VentaDocumentosModule`. El
`PATCH /ventas/:id/documentos/:documentoId` (tarea 6) vive en `VentasController`, porque el alcance de
caja (`filtroDeMisCajas`, `ventas.service.ts:2817`) es de `VentasService`: verifica el alcance y delega
en `VentaDocumentosService.completarNumero`. `VentasService.spec` y `PagosService.spec` suman el servicio
nuevo a sus providers.

### 5. Forma de las enumeraciones

Medido en las entities. Tres formas conviven; la que siguen **las columnas de texto cerradas recientes**
es `@Check` + `type: 'text'` + una unión de TS exportada.

| Forma | Dónde | Cuándo |
|---|---|---|
| `@Check('chk_<tabla>_<col>', "col IN (...)")`, `@Column({ type: 'text', default })` y `export type X = 'a' \| 'b'` | `stock-minimo.entity.ts:11,34,55` (2026-09-21), `caja-testigo.entity.ts:56-60,81` (2026-08-11), `garzon-pin-evento.entity.ts:50-53`, `tipo-documento-compra.entity.ts:20-22`, `promocion.entity.ts:42-44`, `tenant.entity.ts:16-19` y `:68` (`nivel_redondeo`), `pais.entity.ts` | la norma de lo nuevo |
| `enum` nativo de Postgres | `venta.entity.ts:54-58` (`estado`), `descuento`/`recargo` (`modo_regla`), `motivo-baja` | lo viejo |
| texto libre con el comentario (`'afecto' \| 'exento'`) | `venta.entity.ts:48` (`canal`), `venta-detalle.entity.ts:74-78`, `venta-impuesto.entity.ts:68`, `pago-aplicacion.entity.ts:31-32` | lo que nunca se cerró |

Hay un caso gemelo en la misma tabla que se va a tocar: `tenant.entity.ts:16-19` ya declara
`chk_tenants_nivel_redondeo` y el comentario de `:49-58` explica por qué el `type` es explícito (con
una unión de TS importada por `import type`, `design:type` queda en `Object` y TypeORM no arranca).

**Decisión para las tres:** `@Check` con nombre `chk_<tabla>_<columna>`, `type: 'text'` explícito, la
unión exportada desde la entity que la declara. Un valor nulo pasa el `CHECK` por la semántica de SQL,
así que `clase_maquina`, `estado_envio` y `descarte` (nulables) no necesitan `OR ... IS NULL`. No se usa
`enum` nativo: cambiar los valores obliga a `ALTER TYPE`, y la regla es la de lo nuevo. Dos
invariantes de `src/common/invariants/` caen sobre la tabla nueva: `uuid-columns` (todo `*_id` con
`type: 'uuid'` explícito, incluidos `pago_id`, `documento_corregido_id` y
`descartado_por_usuario_id`) y `timestamptz-columns`.

### 6. Un solo pago online

**Confirmado para los tres creadores de ventas `online` conocidos** (dos internos y la tienda), y
**falso para `POST /ventas` en general**.

- Online por Webpay: `online-callback.handler.ts:75-83` arma `pagos: [ { metodoPagoId, monto: checkout.totalFinal, ... } ]`:
  uno solo, sin `referencia`.
- Suscripción: `suscripciones.service.ts:197` arma `pagos: [{ metodoPagoId, monto: totalFinal }]`: uno solo.
- Tienda online: `frontend/app/pages/tienda/pasarela.vue:65-82` hace `POST /ventas` con `canal: 'online'`
  (l.69): un solo pago, y **ninguno** cuando el total es 0. Es el tercer creador; le toca E5 y E6.
- ⚠️ `CreateVentaDto.canal` acepta `'online'` del cliente (`create-venta.dto.ts:156`) y `crearEnTransaccion`
  solo exige que lo pagado cubra el total (`ventas.service.ts:691-701`), **no que sea un pago**. Una venta
  `online` por la API puede traer varios pagos. La tarea 9 resuelve "el pago de la venta online" de una
  orden de pasarela, que nace de los dos llamadores internos; igual, la resolución tiene que **lanzar si
  la venta no tiene exactamente un pago** y no asumirlo.

El código de autorización para `pagos.referencia` está en
`orden.metadata.resultadoPago.codigoAutorizacion` (`pagos-redirect.service.ts:205-212`). `PagoVentaDto`
ya tiene `referencia?` y `registrar` ya lo persiste (`pagos.service.ts:249`): no hace falta campo nuevo,
solo ampliar el cast de `resultadoPago` del handler (`online-callback.handler.ts:49-53`) y pasarlo.

### 7. Suscripción y online crean la venta con `canal = 'online'`

**Confirmado, con una cita corregida.** `suscripciones.service.ts:120` es el `canal: 'online' as const`
del *cálculo del precio* (el paso 5), no de la venta. La venta se crea en `:190-198` con `canal: 'online'`
en `:195`. El handler de Webpay manda `canal: 'online'` en `online-callback.handler.ts:64`, y la tienda lo manda
por `POST /ventas` desde `frontend/app/pages/tienda/pasarela.vue:69`. Ninguno manda `tipoDocumentoId`:
las tres nacen sin tipo, como dice la spec. Les toca E5.

### 8. Lo que difirieron las tareas 2 y 4

**(a) Dónde se guarda una preferencia del tenant.** Hay tres endpoints que escriben columnas de
`tenants`, los tres bajo `TenantAdminGuard`:

| Endpoint | Cómo escribe | Sirve para `facturador` |
|---|---|---|
| `PUT /tenants/preferencias-financieras` (`tenants.controller.ts:309-320`, service `:1729`) | **reemplazo entero** de la configuración de precios: el DTO exige todos los campos (`update-preferencias-financieras.dto.ts`) y lo omitido se vuelve default (`:1818`, `promosAcumulanDescuentos ?? false`) | **No.** Obligaría a reenviar fórmula y redondeo para guardar quién factura, y una omisión lo resetearía a `'sistema'`. Además `getPreferenciasFinancieras` (`:1664`) alimenta `cargarConfig` (`calculo-precios.service.ts:116`), la config que se congela en `ventas.config_calculo`: es el camino del motor |
| `PUT /caja/arqueo-ciego` (`caja.controller.ts:158-164`, `caja.service.ts:624`) | un `UPDATE tenants SET arqueo_ciego` angosto, un endpoint por perilla | Posible, pero abre un endpoint por cada preferencia nueva |
| **`PATCH /tenants/me`** (`tenants.controller.ts:127-128`, service `updateMine` `:1486`) | **parcial**: `Object.assign(tenant, dto)` con `@ValidateIf(v !== undefined)` por campo (`update-my-tenant.dto.ts:30,42,46,68`); ya guarda `horaCorte`, otra preferencia del tenant | **Sí** |

**Decisión: `PATCH /tenants/me`**, con `UpdateMyTenantDto.facturador?` (`@ValidateIf(v !== undefined)` +
`@IsIn(['sistema','externo'])`, no `@IsOptional`: con `null` saltaría la validación y llegaría a la
columna `NOT NULL` como un 500, que es lo que el comentario del DTO ya explica). La pantalla lo lee de
`GET /tenants/me` (`:121`, cualquier miembro del tenant, devuelve la entidad entera). La columna va en
`tenant.entity.ts` con `@Check('chk_tenants_facturador', ...)`, junto al `chk_tenants_nivel_redondeo`.

⚠️ `UpdateTenantMetodoPagoDto` usa `@IsOptional() @IsBoolean()` (`update-tenant-metodo-pago.dto.ts:4,8`) y el
service asigna con `!== undefined` (`metodos-pago.service.ts:105-107`): un `null` hoy llega a la columna.
`emisor` no hereda ese patrón: lleva `@ValidateIf(v !== undefined)` + `@IsIn`.

**¿`crearEnTransaccion` ya lee una fila de `tenants` donde `facturador` viaje sin una consulta más?**
Sí, dos. La más barata es la de la moneda oficial (`ventas.service.ts:482-500`): arranca en
`FROM tenants t` (`:490`) y devuelve una fila por moneda del país. Sumarle `t.facturador` al `SELECT`
(`:488`) cuesta cero consultas. La otra, `getPreferenciasFinancieras` (`tenants.service.ts:1682`), ya trae
la entidad `Tenant` entera con `findOne`, pero está en el camino del motor y `cargarConfig` la copia campo
por campo: tocarla es tocar el motor. **Se usa la de la moneda.** Todas las ventas, incluida la de
salones y la online, pasan por ahí.

**(b) Lo que la venta ya congela, y si `monto_impuestos` es una columna o se parte.**

| Dato congelado | Dónde | Granularidad |
|---|---|---|
| `clasificacion_tributaria` (`'afecto'` \| `'exento'`) | `venta_detalles` (`venta-detalle.entity.ts:74-78`) | por línea |
| `subtotal`, `impuesto_aplicado`, `total_linea`, `ajuste_venta` | `venta_detalles` (`:110-166`) | por línea, **suma de todos los impuestos de la línea** |
| `valor_aplicado`, `porcentaje_aplicado`, `nombre_regla`, `impuesto_id` | `ventas_impuestos` (`venta-impuesto.entity.ts:28`; la tabla se llama `ventas_impuestos`, no `venta_impuestos`) | **una fila por impuesto y por línea**, sin la clase del impuesto |
| `total_bruto`, `total_impuestos`, `total_final`, `base_ventas_*` | `ventas` (`venta.entity.ts:61-122`) | **un solo número** de impuestos |

**Decisión: `monto_impuestos` es una columna**, la suma de todos los impuestos del documento. Razones: (1)
es lo que congelan `ventas.total_impuestos` y `venta_detalles.impuesto_aplicado`; (2) la NC compone con
**una tasa efectiva por porción** (`tasaEfectiva`, `nota-credito-composicion.ts:52`), nunca por impuesto, y la
spec pide el mismo reparto; (3) partirlo por impuesto exigiría una derivación que no existe y que
`ventas_impuestos` no puede alimentar sin leer la clase en `impuestos` (el catálogo vivo); (4) el desglose
por impuesto sigue disponible en `ventas_impuestos` de la venta, que es lo que el emisor futuro lee.

📌 ADR-010 nombra los baldes `neto afecto / exento / IVA / adicionales`, cuatro. La venta no congela
IVA y adicionales por separado en ninguna columna, y la spec fijó tres. Si el emisor del SII necesita
IVA y adicionales por documento, se derivan de `ventas_impuestos` a prorrata: no está congelado en el
documento. Se anota para el ADR de la tarea 4.

### Contradicciones y riesgos que el owner o la orquestadora tienen que ver

Las tres están **decididas**: la 1 por la orquestadora y la 2 y la 3 por el controlador del frente (los tres,
2026-10-01). Ninguna queda abierta.

1. **Decidido (orquestadora, 2026-10-01): la tarea 8 migra todos los lectores, resúmenes incluidos,
   y la 11 queda como verificación.** Lo medido, que motivó la decisión: el orden 8 → 11 dejaba un estado peor que el de hoy. La tarea 8 crea correcciones con
   `tipo_documento_id` nulo (devolución interna, spec § 3.6), y las restricciones globales prohíben
   tocar `VentasService.resumen` y `resumen-negocio` antes de la 11. Esas tres consultas (más `resumen`,
   `ventas.service.ts:2845`) tratan "tipo distinto de NC" como venta: sumarían la devolución interna con
   signo positivo en "Total facturado", en el vendido de hoy y en lo más vendido, hasta que entre el frente
   del vendido neto. Hoy ese frente es solo una spec (`cb403db1`, `fcec4332`): `main` no lo tiene. Es la
   forma de "dos tareas, un mismo número". Se descartaron: que la 8 no habilite la devolución
   interna hasta la 11, y mergear 8 y 11 juntas.
2. **Decidido (controlador del frente, 2026-10-01): el `canal` guardado decide, y no cambia código en
   este frente.** Lo medido: `POST /ventas` con `Ventas:Crear` acepta `canal: 'online'` en el body
   (`create-venta.dto.ts:156`, `ventas.service.ts:366`), y con E5 la venta `online` la documenta el
   sistema sin mirar el medio. Resolución: **el cliente declara DÓNDE ocurrió la venta y el servidor
   deriva QUIÉN emite**, igual que hoy el `canal` elige la caja virtual; por eso no rompe "el cliente
   nunca manda quién emitió". `frontend/app/pages/tienda/pasarela.vue:69` lo manda de forma legítima.
   Costo si estuviera mal: un cajero que marca como online una venta física recibe la boleta del
   sistema (y hoy ya recibe la caja virtual). El arreglo, en ese caso, es validar el canal, y queda
   fuera de este frente.
3. **Decidido (controlador del frente, 2026-10-01): `facturador` va por `PATCH /tenants/me`**, con
   `TenantAdminGuard`, y no por `preferencias-financieras` como se leía en la spec § 3.1. La spec
   delegó el dónde en la tarea 1, así que es una decisión y no una contradicción (lo medido está en
   8(a)). Costo si estuviera mal: mover un campo de DTO.

### Nombres definitivos

Las tareas 2–12 usan **estos** nombres. Cambia respecto de la propuesta lo que dice "(cambia)".

| Qué | Nombre y lugar |
|---|---|
| Tipo del emisor de un medio | `EmisorMedio = 'sistema' \| 'maquina' \| 'nadie'`, exportado desde `backend/src/modules/metodos-pago/entities/tenant-metodo-pago.entity.ts`; columna `emisor` (`type: 'text'`, default `'sistema'`), `@Check('chk_tenant_metodo_pago_emisor', ...)` |
| Tipo de quién factura | `Facturador = 'sistema' \| 'externo'`, desde `backend/src/modules/tenants/entities/tenant.entity.ts`; columna `facturador`, `@Check('chk_tenants_facturador', ...)` |
| Endpoint de `facturador` (cambia) | `PATCH /tenants/me` (`UpdateMyTenantDto.facturador?`, `tenants.service.ts` `updateMine`) y `GET /tenants/me`; **no** `preferencias-financieras` |
| `emisor` por medio | `UpdateTenantMetodoPagoDto.emisor?` con `@ValidateIf(v !== undefined)` + `@IsIn`; `MetodoPagoTenant` (`metodos-pago.service.ts:12-18`) suma `emisor` y `esEfectivo`; el `SELECT` de `findMetodosPago` suma `COALESCE(tmp.emisor, 'sistema')` y `mp.es_efectivo` |
| Módulo (cambia) | `VentaDocumentosModule` en `backend/src/modules/venta-documentos/venta-documentos.module.ts`; lo importan `VentasModule` y `PagosModule`; no importa a ninguno |
| Entity | `VentaDocumento` (tabla `venta_documentos`) en `backend/src/modules/venta-documentos/entities/venta-documento.entity.ts`, con `EmisorDocumento = EmisorMedio \| 'externo'`, `ClaseDocumentoMaquina`, `EstadoEnvio`, `Descarte`; `@Check`: `chk_venta_documentos_emisor`, `_clase_maquina`, `_estado_envio`, `_descarte`; índices `idx_venta_documentos_venta` y `idx_venta_documentos_corregido`; registrada en el array `entities` de `app.module.ts` |
| Servicio | `VentaDocumentosService` en `.../venta-documentos/venta-documentos.service.ts`: `documentarVenta`, `registrarDuplicadoDeAbono`, `completarNumero`, `documentoQueCorrige`, `documentarCorreccion`, más `evaluarAnulacion` y `descartarAlAnular` (tareas 5 y 6: una sola regla para `anulable` y para `cancelarUnaVez`) |
| Flag de corrección (nuevo) | `esCorreccion: boolean` en `VentaListItem` (`ventas.service.ts:93`) y en el detalle de `findOne`, producido por la tarea 8 desde `venta_referencia_id IS NOT NULL`; `esNotaCredito` se conserva como `esCorreccion` con tipo NC. Lo leen el drawer y el listado en la tarea 10 |
| Prorrata | `componerBaldes(monto, porciones, cfg)`, función pura exportada de `venta-documentos.service.ts`, sobre `repartirAjuste` + `tasaEfectiva` + `descomponer` sin modificarlas |
| Retorno de `registrar` (cambia) | `porPago: PagoRegistrado[]` (`pagoId`, `metodoPagoId`, `emisor`, `esEfectivo`, `aplicadoVenta`), en `pagos.service.ts` |
| `documentarVenta` (cambia) | los `pagos` de entrada llevan `emisor` (viene de `porPago`) y suma `porciones: PorcionOriginal[]`, armadas de `detalles`; `facturador` sale de la consulta de la moneda (`ventas.service.ts:488`) |
| `registrarDuplicadoDeAbono` (cambia) | `pagos: { pagoId, metodoPagoId, emisor, aplicadoVenta, numeroDocumento?, claseDocumento? }[]` |
| `monto_impuestos` | **una** columna: Σ de todos los impuestos del documento |
| Sin cambio | `resolverTipoDocumento` (privado de `VentasService`), `es_boleta`, `PagoVentaDto.numeroDocumento?`/`claseDocumento?`, `CancelarVentaDto.externoHecho?`, `CrearNotaCreditoParams.via`, `PATCH /ventas/:id/documentos/:documentoId`, `pasarela_transacciones.correccion_venta_id` |
| ADR de la tarea 4 | el siguiente libre es **ADR-028** (`docs/adr/` llega a 027) |
