# Plan: cada venta registra quién emitió, y la regla la declara cada método de pago

> **Para agentes:** se ejecuta con `superpowers:subagent-driven-development`, tarea por tarea, con
> implementadores **Sonnet**. Los pasos usan checkboxes (`- [ ]`). El implementador **no commitea**:
> stagea por ruta explícita. La revisión (`domain-reviewer` con las dudas que el controlador no
> verificó, más `api-security-reviewer` si la tarea toca controllers o DTOs), el recibo del
> pre-commit y el commit los hace el controlador.

- **Status:** Draft — para aprobar por el owner; una pregunta abierta en la orquestadora (P3, ver abajo)
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
  `descartado`.

**Abierta en la orquestadora** (spec § 3.8). No se decide en el plan:

| # | Pregunta | Qué toca | Cómo queda escrito mientras tanto |
|---|---|---|---|
| P3 | ¿Un documento hecho por fuera (`externo`) impide anular? El sistema sabe que le toca al otro facturador, no si ya lo hizo | tarea 5 y el `anulable` de la 6 | conservadora: impide anular, igual que la máquina |

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
- **No se toca `resumen-negocio.service.ts` ni `VentasService.resumen`** fuera de la tarea 11, que
  espera al frente del vendido neto.
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

- [ ] **Lectores de "es NC".** Grep de `es_nota_credito`, `esNotaCredito`, `tipoNotaCreditoDelTenant`,
  `exigirTipoNotaCredito` y de toda consulta que cruce `tipo_documento_id` con el tipo NC, en
  `backend/src` y `frontend/app`. Una tabla con archivo:línea, qué hace cada uno y en qué tarea
  cambia (8, 11 o ninguna). Medido en el diseño: `ventas.service.ts` l.1537, 1567, 1632, 2143,
  2845, 2925, 3013, 3313 y 3339; y `resumen-negocio.service.ts` en cinco lugares. Confirmar o
  corregir esa lista abriendo cada línea.
- [ ] **Lo aplicado por pago.** En `PagosService.registrar` (`pagos.service.ts:112`): qué devuelve
  hoy y si de ahí sale, por pago, `pagoId`, `metodoPagoId` y lo aplicado a la venta
  (`pago_aplicaciones.tipo = 'venta'`), separado de la propina y del vuelto. Hay que cubrir los
  tres llamadores: `crearEnTransaccion` (POS, salones, online, suscripción) y `registrarAbono`. Si
  no lo devuelve, proponer el cambio mínimo de su retorno.
- [ ] **El reparto a prorrata.** Si `descomponer`, `repartirAjuste` o `escalarDevoluciones`
  (`nota-credito-composicion.ts`) sirven para partir un monto en afecto, exento e impuestos contra
  las porciones de la venta **sin cambiar la conducta de la NC**. Escribir la firma que usaría la
  tarea 4. Si hace falta tocar una función compartida, se para.
- [ ] **Dónde vive el resolvedor.** `VentasModule` importa `PagosModule`, y `PagosModule` no importa
  ventas. `registrarAbono` vive en pagos y necesita resolver documentos. Proponer dónde va el
  servicio de documentos sin `forwardRef` nuevo. Por ejemplo, un módulo propio
  `venta-documentos` que importen los dos, o dentro de `PagosModule`. El criterio está en
  `docs/patterns/backend.md`.
- [ ] **Forma de las enumeraciones.** Cómo declaran las entities existentes una columna de texto con
  valores cerrados: `@Check`, `enum` de Postgres o texto libre con comentario. Con eso se decide la
  forma de `emisor`, `clase_maquina` y `estado_envio`.
- [ ] **Un solo pago online.** Confirmar que la venta online y la de suscripción tienen un único
  pago (la tarea 9 corrige ese).
- [ ] **Suscripción y online.** Confirmar que las dos crean la venta con `canal = 'online'`
  (`suscripciones.service.ts:120`, `online-callback.handler.ts`), para que les toque E5.
- [ ] **El reporte va a la sección "Medido en la tarea 1"** de este plan, al final, con los nombres
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
- Modificar: `backend/src/modules/tenants/entities/tenant.entity.ts` (`facturador`) y el DTO y
  service del endpoint de preferencias del tenant (lo ubica la tarea 1).
- Modificar: `frontend/app/pages/configuracion/metodos-pago.vue` y el tipo del front que espeja la
  respuesta.
- Tests: `metodos-pago.service.spec.ts`; e2e en `backend/test/` junto al de métodos de pago (o uno
  nuevo, si no existe); vitest de la página si ya hay uno.

**Interfaces:**
- Produce: `type EmisorMedio = 'sistema' | 'maquina' | 'nadie'` (lo que se declara por medio) y
  `type Facturador = 'sistema' | 'externo'` (lo que se declara por comercio), exportados desde donde
  los ubique la tarea 1. `GET /metodos-pago` suma `emisor` y `esEfectivo` por fila.
  `PATCH /metodos-pago/:id` acepta `emisor`. `tenants.facturador` se lee y se escribe por el
  endpoint de preferencias del tenant que ubique la tarea 1.

- [ ] Columna `emisor` no nula, default `'sistema'` (E3), con la forma de la tarea 1.
- [ ] `UpdateTenantMetodoPagoDto.emisor?` con `@IsIn(['sistema','maquina','nadie'])`. El
  `TenantAdminGuard` de hoy no cambia.
- [ ] `findMetodosPago` devuelve `emisor` y `esEfectivo`; la tarea 7 necesita los dos para la
  pantalla de cobro.
- [ ] El alta de tenant y el seed dejan `'sistema'` explícito.
- [ ] `tenants.facturador`: `'sistema' | 'externo'`, no nulo, default `'sistema'` (E9), con la
  forma de la tarea 1. Lo escribe solo el admin, con el guard del endpoint de preferencias.
- [ ] Pantalla, arriba de la tabla: **"Facturas y lo que queda debiendo: las hace el sistema / otro
  facturador"**. Con "otro facturador", una línea: *"El sistema las registra como hechas por fuera,
  y su número se anota después."*
- [ ] Pantalla: un `USelect` por fila ("El sistema" / "La máquina" / "Nadie"), con el mismo patrón
  optimista que los switches de esa página. Con "Nadie", una línea debajo: *"Las ventas con este medio
  quedan sin documento. Emitirlo es responsabilidad del comercio."* Solo tokens semánticos de Nuxt
  UI.
- [ ] e2e: el admin cambia `facturador` a `externo` y se lee; un no-admin recibe 403. El admin cambia a `maquina` y el `GET` lo devuelve; un no-admin recibe 403; un valor
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
- [ ] `canal = 'online'`: siempre la boleta del país, aunque el body traiga otra cosa (E5).
- [ ] Una sola lectura por venta, sin N+1.
- [ ] e2e: tipo de otro país → 400; el tipo NC → 400; sin tipo → la boleta; online → la boleta;
  salones sin tipo → la boleta.
- [ ] Docs: `docs/features/ventas.md` § `POST /api/ventas` (el tipo se valida y tiene default).

---

## Tarea 4 — `venta_documentos` y su resolución al crear la venta

**Archivos:**
- Crear: la entity `venta-documento.entity.ts` y el servicio de documentos, donde los ubique la
  tarea 1.
- Modificar: `ventas.service.ts` (`crearEnTransaccion`, después de registrar los pagos, l.1120-1156),
  `create-venta.dto.ts` (`PagoVentaDto`), `app.module.ts` (array `entities`),
  `online-callback.handler.ts` (código de Webpay a `referencia`).
- Tests: unit del servicio de documentos; e2e de ventas.

**Interfaces:**
- Consume: `EmisorMedio` y `Facturador` (tarea 2), `resolverTipoDocumento` (tarea 3), lo que devuelve
  `PagosService.registrar` por pago (tarea 1).
- Produce:
  ```ts
  // venta-documento.entity.ts
  export type ClaseDocumentoMaquina = 'voucher' | 'boleta';
  export type EstadoEnvio = 'armado' | 'descartado' | 'enviado';
  @Entity('venta_documentos') export class VentaDocumento {
    id; tenantId; ventaId; emisor: EmisorDocumento; tipoDocumentoId: string | null;
    // EmisorDocumento = EmisorMedio | 'externo'
    claseMaquina: ClaseDocumentoMaquina | null; numero: string | null;
    estadoEnvio: EstadoEnvio | null; monto: string;
    montoAfecto: string | null; montoExento: string | null; montoImpuestos: string | null;
    pagoId: string | null; documentoCorregidoId: string | null; esDuplicado: boolean;
    creadoEl; actualizadoEl; eliminadoEl;
  }
  // el servicio
  documentarVenta(manager, params: {
    tenantId: string;
    venta: { id: string; tipoDocumentoId: string | null; esBoleta: boolean; canal: string;
             totalFinal: string; configCalculo: ConfigCalculo | null };
    facturador: Facturador;
    pagos: { pagoId: string; metodoPagoId: string; aplicado: string;
             numeroDocumento?: string; claseDocumento?: ClaseDocumentoMaquina }[];
  }): Promise<VentaDocumento[]>
  ```
  Las columnas exactas (y si `monto_impuestos` es una o se parte por impuesto) las fija la tarea 1
  contra lo que ya congela la venta. La tarea 5 suma `registrarDuplicadoDeAbono`.

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
     `nadie` por la suma de los pagos `nadie`; y lo no pagado (`totalFinal − Σ aplicado`) según
     `facturador` (E2): con `'sistema'`, **una** boleta `sistema`/`armado` por los pagos `sistema`
     más lo no pagado; con `'externo'`, la boleta del sistema cubre solo los pagos `sistema`, y lo
     no pagado va en un `externo` con el tipo boleta y sin número. Un documento de monto 0 no se
     crea.
- [ ] `facturador` se lee en la misma consulta que ya trae la configuración del tenant al crear la
  venta, sin una lectura más por venta si se puede (lo mide la tarea 1).
- [ ] Invariante, afirmado en un unit: la suma de los documentos no duplicados es el `totalFinal`
  de la venta (salvo $0).
- [ ] Baldes congelados de los `sistema`: los de la venta si el documento cubre el total, y a
  prorrata de sus porciones si no, con la función que fijó la tarea 1.
- [ ] El emisor de cada medio sale en la misma lectura de `tenant_metodo_pago` que ya hace
  `registrar`, o en **una** consulta por venta. Nunca por pago.
- [ ] `PagoVentaDto` suma `numeroDocumento?` (texto, máx. 40, trim) y `claseDocumento?`
  (`@IsIn(['voucher','boleta'])`). Si vienen en un pago cuyo medio no es `maquina`, se ignoran sin
  error: la pantalla de la tarea 7 no los muestra ahí, y el pago sigue siendo válido.
- [ ] Online: `pagos.referencia` = el código de autorización de `orden.metadata.resultadoPago`.
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
  duplicado de E1b, la declaración del comercio y el emisor `externo` (E2, E9), el `descartado` de
  E8, y por qué una corrección se reconoce por `venta_referencia_id` (E7). Más el
  índice, y una nota en ADR-010 que lo enlace.
- [ ] Docs: `docs/features/ventas.md` (qué documentos deja cada venta).

---

## Tarea 5 — El abono no documenta (salvo el duplicado), y anular mira lo emitido

**Archivos:**
- Modificar: `backend/src/modules/pagos/pagos.service.ts` (`registrarAbono`, l.325-481) y
  `create-pago.dto.ts` (`PagoItemDto` con los mismos dos campos de la tarea 4).
- Modificar: `ventas.service.ts` (`cancelarUnaVez`, l.1325-1342).
- Tests: e2e de pagos y de anular.

**Interfaces:**
- Consume: `VentaDocumento` (tarea 4).
- Produce: en el servicio de documentos,
  `registrarDuplicadoDeAbono(manager, { tenantId, ventaId, pagos: { pagoId, metodoPagoId, aplicado, numeroDocumento?, claseDocumento? }[] }): Promise<VentaDocumento[]>`.

- [ ] `registrarAbono` **no** crea documentos por los pagos `sistema` ni `nadie`: la deuda ya estaba
  documentada (E1). Por cada pago cuyo medio es `maquina`, y solo si la venta tiene algún documento
  no duplicado (siempre, salvo $0), registra un documento `maquina` con `es_duplicado = true`, su
  `pagoId`, y número y clase si vinieron (E1b). El cobro **nunca** se rechaza por esto.
- [ ] `cancelarUnaVez`: sale el `if (venta.tipo_documento_id)`. Los otros dos rechazos no cambian.
  Entra (E8):
  - 400 *"La venta ya tiene documento: se revierte con nota de crédito, no se anula."* si hay algún
    documento `maquina`, `externo` (⏸ P3, lectura conservadora) o `sistema` en `enviado`;
  - si lo único que hay son `sistema` en `armado` (y filas `nadie`), anula, y esos documentos pasan a
    `estado_envio = 'descartado'` en la misma transacción. Sin borrar filas.
- [ ] e2e:
  - la mesa que debe $60.000 paga al día siguiente en efectivo → ningún documento nuevo;
  - la misma deuda pagada con tarjeta en `maquina` → un documento `maquina` con `es_duplicado`, y
    el cobro pasa;
  - factura con abono en efectivo → ningún documento nuevo;
  - boleta pendiente sin pagos (por API) → se anula, y su boleta queda `descartado` (E8);
  - factura del sistema sin pagos → se anula, y queda `descartado`;
  - factura `externo` sin pagos → no se anula (P3);
  - el mutante que deja de descartar la boleta al anular tiene que morir;
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
  - `GET /ventas/:id` suma `documentos: { id, emisor, tipoDocumento: {id, codigo, nombre} | null, claseMaquina, numero, estadoEnvio, monto, pagoId, documentoCorregidoId, esDuplicado }[]`, `anulable: boolean` y `abonoConMaquinaDuplica: boolean`;
  - `PATCH /ventas/:id/documentos/:documentoId` con body `{ numero: string; clase?: ClaseDocumentoMaquina }`, que responde el documento actualizado.

- [ ] `findOne` trae los documentos de la venta **y los de sus correcciones** en una sola consulta.
- [ ] `anulable`, calculado en el backend con la misma regla que `cancelarUnaVez`. Es la única fuente
  de verdad: el drawer deja de replicarla (tarea 7).
- [ ] `abonoConMaquinaDuplica`: `true` si la venta tiene saldo y algún documento no duplicado (E1b).
  Es lo que la pantalla de abono usa para avisar, sin replicar la regla.
- [ ] `PATCH`: `@RequiresPermiso('Ventas','Crear')`, con el alcance de caja de `findOne`
  (`resolverAlcanceDerivadoDeCaja`). Solo documentos `maquina` o `externo` de esa venta y de ese
  tenant: si no, 404. `clase` solo se acepta con `maquina`. El `tenant_id` sale del token.
- [ ] El `PATCH` también sirve para el voucher duplicado de E1b: el contador necesita su número.
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
  `PATCH`. Un documento `externo` dice "Hecho por fuera"; uno `descartado`, "Descartado al anular".
- [ ] `puedeAnular` usa `venta.anulable` del backend y deja de leer `tipoDocumento`.
- [ ] Utilidades de presentación (etiquetas de emisor y clase) en un composable de
  `app/composables/`, no locales al `.vue`.
- [ ] vitest: los campos aparecen solo con medio `maquina`; el body los lleva; el aviso del abono
  aparece solo con `abonoConMaquinaDuplica` y medio `maquina`, y no deshabilita confirmar; el drawer
  usa `anulable` (con un mutante que vuelve a `!tipoDocumento`).
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
- [ ] Los lectores de `ventas.service.ts` que la tarea 1 marcó para esta tarea pasan a
  `venta_referencia_id IS NOT NULL`: NC sobre NC, Σ de correcciones previas, composición de la serie,
  efectivo devuelto, listado (`esNotaCredito` → `esCorreccion`, más `esNotaCredito` derivado del
  documento si el front lo sigue necesitando) y detalle. **No** `VentasService.resumen` (tarea 11).
- [ ] e2e:
  - NC por el pago en efectivo del pago mixto → corrige la boleta, no el voucher, y deja la salida
    de caja;
  - NC por el pago con tarjeta → NC `maquina`, sin salida de caja;
  - NC sobre una venta en `nadie` → devolución interna con tipo nulo, y la venta original baja su
    disponible;
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
  `registrarDevolucionesPorReembolso`, que queda sin llamador; borrarla si la tarea 1 confirma que
  no hay otro.
- [ ] El pago a corregir se resuelve en el servidor: el único pago de la venta online. La tarea 1
  confirma que es uno solo (`online-callback.handler.ts:75-83` arma un único pago).
- [ ] Cuando la corrección se crea, `correccion_venta_id` se escribe en el `REFUND`. Si el hook
  falla, sigue el `warning` de hoy: la plata ya volvió y no se revierte.
- [ ] Orden sin `venta_id` → sin corrección, como hoy (es legítimo).
- [ ] e2e: `REFUND` aprobado → corrección con su documento y `correccion_venta_id`; un body con
  `generarNotaCredito` → 400 por `forbidNonWhitelisted`, si el pipe global lo tiene (medirlo); la API
  externa igual.
- [ ] `api-security-reviewer` sobre los dos controllers de pasarela.
- [ ] Docs: `docs/features/pasarela-pagos.md`, `docs/features/reembolsos-nota-credito.md`.

---

## Tarea 10 — Pantallas de la devolución

**Archivos:**
- Modificar: `frontend/app/components/ventas/NotaCreditoModal.vue`,
  `frontend/app/components/ordenes/ReembolsoModal.vue` y sus tipos.
- Tests: vitest de los dos modales.

- [ ] `NotaCreditoModal`: la casilla "devolver dinero" se reemplaza por **"¿Por dónde vuelve la
  plata?"**: una opción por cada pago de la venta (*"Efectivo de la caja · $60.000"*, *"Tarjeta de
  débito · $40.000"*) y "No vuelve plata", esta última solo si la venta tiene saldo. Debajo, en una
  línea, qué registro va a quedar: nota de crédito, nota de la máquina para anotar después o
  devolución interna. "No vuelve plata" siempre deja una nota de crédito (E1). Sale del documento corregido, que ya trae el detalle (tarea 6), con la misma
  regla que el servidor (gemelo exacto o nada).
- [ ] `ReembolsoModal`: se va la casilla "Generar nota de crédito" (`ReembolsoModal.vue:36` y
  l.151-158). Las devoluciones de stock siguen. Se va `normalizarSoloStock`, que existía solo para
  el camino sin NC.
- [ ] vitest: el body de la NC lleva `devolucion`; "No vuelve plata" no aparece en una venta pagada;
  el reembolso ya no manda la casilla.
- [ ] Smoke en navegador de una NC por tarjeta sobre un pago mixto, como el rol con `Ventas:Nota de
  crédito`.

---

## Tarea 11 — Reportes (⏸ espera al frente del vendido neto)

**No arranca hasta que la orquestadora avise que el frente "El vendido, el cobrado y el Total
facturado restan las notas de crédito" está en main.** Ese frente ya reconoce las correcciones por
`venta_referencia_id IS NOT NULL` (orquestadora, `fcec4332`), así que acá no se reescriben esas
consultas: se verifica que la devolución interna entra.

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
  "Sin número" = algún documento `maquina` o `externo` sin `numero`. Los `descartado` no cuentan.
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

`1 → 2 → 3 → 4 → 5 → 6 → 8 → 9`, con `7` después de `6`, `10` después de `8` y `9`, y `12` después
de `4`. La `11` espera al vendido neto y no frena a ninguna. Las tareas de backend que comparten
`ventas.service.ts` van de a una: es un archivo de 4.000 líneas y dos implementadores encima se
pisan.

## Medido en la tarea 1

*(lo completa la tarea 1)*
