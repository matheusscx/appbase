# Plan: la venta emite la boleta electrónica

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft · **Date:** 2026-10-14 · **Owner:** owner del repo (fiscal: frente propio)

**Goal:** Con el interruptor prendido, cada boleta del sistema de una venta sale con folio, timbrada,
firmada y en la cola del SII, dentro de la transacción de la venta. Si no se puede, queda "sin
emitir" y el admin la emite después con un botón.

**Architecture:** `EmisionBoletaService.emitir` (módulo `venta-documentos`) lee la venta de la base,
arma `DatosBoleta` con una función pura, pide folio y credenciales a `FoliosService`, firma con
`emitirBoleta` y encola con `ColaDteService`. La venta la llama al final de `crearEnTransaccion`,
detrás de un savepoint: un `DteError` vuelve al savepoint y deja `sin_emitir`. El botón la llama por
documento, cada uno en su transacción y con el bloqueo de su venta.

**Tech Stack:** NestJS + TypeORM + Postgres 18 (SQL crudo vía `Db`), Decimal.js, Jest + supertest,
Nuxt 4 + Nuxt UI, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-14-boleta-desde-la-venta-design.md`](../specs/2026-10-14-boleta-desde-la-venta-design.md)

## Context

Subproyecto 4 del emisor de DTE propio, frente 1 de 3. Ya existen y están desplegados el perfil
fiscal (`FoliosService.tomarFolio` / `credencialesParaFirmar`), el motor (`emitirBoleta`) y la cola
(`ColaDteService.encolar` y los jobs). Nadie llama todavía a `tomarFolio`, a `emitirBoleta` ni a
`encolar` desde una venta: este plan es el que los conecta. Detalle de lo existente en
`docs/features/emision-electronica.md`.

## Scope / Out of scope

Incluido y excluido: § 2 de la spec. Fuera, en resumen: la NC electrónica 61 (frente 2), la pantalla
de atrasadas y rechazadas (frente 3), la factura 33, la certificación y el PDF417.

## Global Constraints

- `tenant_id` sale siempre del token; ninguna ruta lo acepta del body, la query ni el path.
- Dinero con Decimal.js, nunca `number`. Montos en strings (`numeric` ↦ string).
- Soft delete: ningún `DELETE`. Toda lectura nueva filtra `eliminado_el IS NULL`; la excepción lleva
  el porqué escrito en la propia consulta.
- Sin N+1: ninguna consulta por línea, por pago ni por documento dentro de una lectura. El botón
  procesa documentos de a uno a propósito (una transacción por boleta): es escritura de N filas,
  no lectura N+1, y la lista sale de **una** consulta.
- Solo un `DteError` se atrapa; cualquier otro error se propaga (regla R9 de la cola).
- Los textos para el local, en español y en el tono de la spec (los mensajes exactos están en cada
  tarea y en la spec).
- `estado_envio`: `('armado','sin_emitir','emitido')`. `enviado` desaparece.
- Interruptor: `tenants.emite_boleta_electronica boolean NOT NULL DEFAULT false`.
- Variables nuevas: `DTE_PROVEEDOR_RUT`, `DTE_PROVEEDOR_RAZON_SOCIAL`. En e2e, `setup-env.ts`:
  `76222333-3` y `Proveedor de prueba SpA`.
- `DTE_COLA_AUTOMATICA=false` en e2e (ya está en `setup-env.ts`): los jobs no corren solos.
- Cambiar una entity = generar y leer su migración en el mismo commit
  (`env -u DATABASE_URL npm run migration:generate -- <Nombre>` desde el host), más
  `startup-pos.sql`. `migration:generate` no ve los CHECK: van a mano.
- Una entity nueva o una columna nueva no necesita registro extra; un módulo que use un repo nuevo
  lo agrega a su `RepositoriosModule.forFeature`.
- Implementador: stagea **por ruta**, nunca `git add -A`, nunca `.claude/settings.local.json`; **no
  commitea** (lo hace el controlador con el recibo). Nunca `--no-verify`.
- El repo es público: ningún secreto, y nunca el literal de una cabecera de llave privada PEM en un
  archivo (los fixtures ya existen en `src/modules/dte/__fixtures__/`).
- e2e en primer plano (`npx jest --config ./test/jest-e2e.json <spec>`), nunca en background. No correr
  `./scripts/reset-db.sh` en el checkout principal sin que el controlador lo pida.
- No tocar un `.ts` del backend con un e2e corriendo.
- Ejecutar antes de reportar: `npm run lint:check && npm run typecheck && npm test` (backend) y, si
  la tarea toca el front, `npm run build && npm test && npm run typecheck:ratchet && npm run
  design:check` (frontend).

## Review Focus

1. **Una venta que un descuento deja en $0** (dos descuentos que suman más del 100 %): la boleta sale
   por $0 con la línea a precio de lista y su `DescuentoMonto`, no queda `sin_emitir` con
   `TOTAL_NO_POSITIVO`. → Tareas 2 y 5.
2. **Una línea con descuento de línea más un descuento de nivel venta** (`ajuste_venta` ≠ 0) y una a
   granel (0,375 kg): la igualdad de la regla 2 del motor cierra y la boleta sale. → Tareas 4 y 5.
3. **La emisión falla dentro del cierre de una mesa**: la cuenta queda cerrada, la venta
   confirmada y la boleta `sin_emitir`; nada queda a medias. → Tarea 5.
4. **Una venta pendiente** (la mesa que debe): la boleta del sistema por lo no pagado se emite igual
   al cerrar. → Tarea 5.
5. **El botón sobre una venta que se anuló entre la lista y el bloqueo**: la salta, no la emite. →
   Tarea 6.

---

## Task 1: el nombre del ítem cabe en la boleta

**Files:**
- Modify: `backend/src/modules/dte/texto.ts` (exportar el patrón), `backend/src/modules/dte/texto.spec.ts`
- Modify: `backend/src/modules/items/dto/create-item.dto.ts:202-205`, `backend/src/modules/items/dto/update-item.dto.ts:68-71`
- Create: `backend/test/items-nombre-sii.e2e-spec.ts`
- Create: `frontend/app/composables/useTextoSii.ts`, `frontend/app/composables/useTextoSii.spec.ts`
- Modify: `frontend/app/pages/configuracion/items.vue:2046-2052`
- Modify: `docs/features/catalogo-paginado.md` (una sección corta "El nombre cabe en la boleta")

**Interfaces:**
- Produces: `TEXTO_SII: RegExp` (`/^[ -~ -ÿ]*$/u`) exportado de `dte/texto.ts`;
  `FUERA_DE_LATIN1` pasa a derivarse de la misma clase de caracteres (una sola fuente).
  `MAX_NOMBRE_ITEM` (80) ya existe en `dte/dte.types.ts`.
- Produces (front): `textoSiiInvalido(valor: string, max: number): string | null`.

- [ ] **Step 1: test unitario del patrón.** En `texto.spec.ts`: `TEXTO_SII` acepta `"Pisco sour ñandú
  ¿5?"` y rechaza `"Café €"`, `"Tab\tx"`, `"🍺"`; y para los 4 casos `TEXTO_SII.test(v) ===
  !FUERA_DE_LATIN1.test(v)` (el catálogo y el motor no pueden discrepar).
- [ ] **Step 2: exportarlo.** En `texto.ts`:

```ts
const CARACTERES_SII = '\\u0020-\\u007E\\u00A0-\\u00FF';
const FUERA_DE_LATIN1 = new RegExp(`[^${CARACTERES_SII}]`, 'u');
/** Un texto que cabe entero en un campo del SII: lo usa el catálogo para validar al capturar. */
export const TEXTO_SII = new RegExp(`^[${CARACTERES_SII}]*$`, 'u');
```

- [ ] **Step 3: los DTO.** En `CreateItemDto.nombre` y `UpdateItemDto.nombre`, además de lo que ya
  tienen:

```ts
@MaxLength(MAX_NOMBRE_ITEM, { message: MENSAJE_NOMBRE_SII })
@Matches(TEXTO_SII, { message: MENSAJE_NOMBRE_SII })
```

  con `MENSAJE_NOMBRE_SII = 'El nombre no puede pasar de 80 caracteres ni llevar símbolos fuera del
  alfabeto latino (lo exige el SII en la boleta)'`, definido una vez en `create-item.dto.ts` y
  exportado.
- [ ] **Step 4: e2e** (`items-nombre-sii.e2e-spec.ts`, con el login del seed como los demás specs
  de ítems): `POST /items` con 81 caracteres → 400 con el mensaje; con `"Cerveza €"` → 400; con 80
  caracteres que incluyen `ñ` → 201. `PATCH /items/:id` con 81 → 400 y con `"🍺"` → 400. Borrar
  (soft) lo creado al final. Correrlo.
- [ ] **Step 5: el formulario.** `useTextoSii.ts` (mismo patrón, comentado como gemelo de
  `TEXTO_SII`) con su spec (los mismos 4 casos). En `items.vue`, el `UFormField` del nombre lleva
  `:error="textoSiiInvalido(form.nombre, 80)"` y el `UInput` `:maxlength="80"`; el guardado se
  deshabilita con error.
- [ ] **Step 6:** doc, gate del backend y del frontend, stagear por ruta.

---

## Task 2: el motor acepta la boleta de $0 por descuento

**Files:**
- Modify: `backend/src/modules/dte/montos.ts:121-126`, `backend/src/modules/dte/montos.spec.ts`
- Modify: `backend/src/modules/dte/envio-boleta.spec.ts` (o el spec que ya valida contra el XSD con `__fixtures__/xsd.ts`)
- Modify: `docs/features/emision-electronica.md` (regla 3 de "Los montos" y la fila de `TOTAL_NO_POSITIVO`)

**Interfaces:**
- Consumes: `DatosBoleta`, `LineaBoleta.descuentoMonto`, `AjusteGlobal { tipo: 'D' | 'R', monto }`.
- Produces: `verificarMontos` (o como se llame la función de `montos.ts`) acepta `MntTotal = 0`
  si y solo si `Σ lineas.descuentoMonto + Σ ajustesGlobales[tipo='D'].monto > 0`.

- [ ] **Step 1: tests que fallan** en `montos.spec.ts`:
  - una línea `{ cantidad: '1', precioUnitario: '12000', descuentoMonto: '12000', monto: '0' }`,
    montos todo `'0'` → **no** tira;
  - la misma con un descuento global `D` de 12000 en vez del de línea → no tira;
  - total 0 sin ningún descuento (una línea gratis sola) → `TOTAL_NO_POSITIVO`;
  - total negativo → sigue `MONTO_NEGATIVO` o `TOTAL_NO_POSITIVO` como hoy (no cambiar cuál).
- [ ] **Step 2: correrlos y ver que el primero falla** con `TOTAL_NO_POSITIVO`.
- [ ] **Step 3: implementar.** El chequeo de `total.gt(0)` pasa a:

```ts
const descuentos = datos.lineas
  .reduce((s, l) => s.plus(l.descuentoMonto ?? 0), new Decimal(0))
  .plus(
    datos.ajustesGlobales
      .filter((a) => a.tipo === 'D')
      .reduce((s, a) => s.plus(a.monto), new Decimal(0)),
  );
// Res. Ex. SII 60/2023: la boleta de $0 se emite si un descuento la dejó en cero.
if (total.lt(0) || (total.isZero() && !descuentos.gt(0)))
  throw new DteError('TOTAL_NO_POSITIVO', /* mismo mensaje, que diga "sin un descuento que lo explique" */);
```

  Si los descuentos se validan como enteros más abajo, usar los ya validados. Leer la función entera
  antes de editar: el orden de las validaciones no cambia.
- [ ] **Step 4: XSD.** Un test que arma con `emitirBoleta` la boleta de $0 (línea de $12.000 con
  descuento de $12.000) y la valida contra el XSD de formato 4.2, como los tests existentes. Si el
  XSD la rechaza, **parar y reportar** (la decisión del owner se apoya en que el esquema la admite).
- [ ] **Step 5:** el doc, el gate del backend, stagear.

---

## Task 3: los datos, el interruptor y el proveedor de software

**Files:**
- Modify: `backend/src/modules/tenants/entities/tenant.entity.ts` (columna `emiteBoletaElectronica`)
- Modify: `backend/src/modules/venta-documentos/entities/venta-documento.entity.ts` (estado, 3 columnas, CHECKs, índice)
- Modify: `backend/src/modules/metodos-pago/entities/metodo-pago.entity.ts` (`medioPagoSii`)
- Create: `backend/src/database/migrations/<ts>-BoletaDesdeLaVenta.ts` (generada + CHECKs a mano)
- Modify: `startup-pos.sql`
- Modify: `backend/src/modules/seeder/seeder.service.ts:3206-3240` (`medioPagoSii` en los 4 métodos, y que el seed lo actualice si la fila ya existe)
- Modify: `backend/src/modules/dte/perfil-fiscal.ts` (5º parámetro `proveedor`, faltante `SIN_PROVEEDOR_SOFTWARE`), `perfil-fiscal.spec.ts`
- Modify: `backend/src/modules/dte/perfil-fiscal.service.ts` (proveedor, `emisionActiva`, `cambiarEmision`), su spec
- Create: `backend/src/modules/dte/dto/cambiar-emision.dto.ts`
- Modify: `backend/src/modules/dte/dte.controller.ts` (`PATCH /dte/emision`)
- Modify: `backend/src/modules/venta-documentos/venta-documentos.service.ts:231-232,670` (anular con `emitido`)
- Modify: `frontend/app/composables/useDocumentosVenta.ts:39,111`
- Modify: `backend/test/setup-env.ts`, `.env.example`, `docker-compose.yml` (backend: `DTE_PROVEEDOR_RUT: ${DTE_PROVEEDOR_RUT:-}` y la razón social)
- Modify: `backend/test/dte-perfil.e2e-spec.ts`
- Modify: `docs/adr/028-emision-registrada-por-venta.md` (nota: `enviado` → `emitido`, y `sin_emitir`), `docs/features/ventas.md` (tabla de anular)

**Interfaces:**
- Produces (entity `VentaDocumento`): `EstadoEnvio = 'armado' | 'sin_emitir' | 'emitido'`;
  `dteDocumentoId: string | null` (`dte_documento_id uuid`), `emisionErrorCodigo: string | null`
  (`emision_error_codigo text`), `emisionError: string | null` (`emision_error text`).
- Produces: CHECK `chk_venta_documentos_estado_envio` = `"estado_envio" IN ('armado','sin_emitir','emitido')`;
  CHECK `chk_venta_documentos_emitido` = `("estado_envio" = 'emitido') = ("dte_documento_id" IS NOT NULL)`
  — ojo con el `NULL`: escribirlo como `(estado_envio IS NOT DISTINCT FROM 'emitido') = (dte_documento_id IS NOT NULL)`;
  índice `idx_venta_documentos_sin_emitir` en `(tenant_id, creado_el) WHERE estado_envio = 'sin_emitir' AND descarte IS NULL AND eliminado_el IS NULL`.
- Produces: `tenants.emite_boleta_electronica boolean NOT NULL DEFAULT false` (entity `emiteBoletaElectronica`).
- Produces: `metodos_pago.medio_pago_sii smallint NULL` (entity `medioPagoSii: number | null`):
  Efectivo `1`, Tarjeta de débito `2`, Tarjeta de crédito `2`, Transferencia bancaria `3`.
- Produces: `evaluarPerfil(emisor, certificado, cafs, ahora, proveedor: ProveedorSoftware | null)`;
  con `proveedor === null` o RUT inválido → faltante `{ codigo: 'SIN_PROVEEDOR_SOFTWARE', mensaje:
  'Falta el proveedor de software en la configuración del sistema' }`.
- Produces: `PerfilFiscalService.proveedorSoftware(): ProveedorSoftware | null` (lee
  `DTE_PROVEEDOR_RUT` y `DTE_PROVEEDOR_RAZON_SOCIAL` de `ConfigService`; null si falta alguna o el
  RUT no es válido; el RUT normalizado). `obtener` suma `emisionActiva: boolean` a `PerfilFiscal`.
- Produces: `PerfilFiscalService.cambiarEmision(tenantId, activa: boolean, ahora: Date): Promise<{ emisionActiva: boolean }>`;
  `PATCH /dte/emision { activa: boolean }` (`TenantAdminGuard`, ya a nivel de clase).

- [ ] **Step 1: tests de `evaluarPerfil`** con el proveedor: null → faltante; RUT inválido →
  faltante; válido → no. Ajustar las llamadas existentes de la spec al 5º parámetro.
- [ ] **Step 2: entities y migración.** Editar las tres entities, generar, **leer la migración**, y
  agregar a mano: el DROP/ADD del CHECK de estado, el CHECK nuevo y el índice parcial si no salió.
  `migration:run` y `migration:check` limpios. `startup-pos.sql` con lo mismo.
- [ ] **Step 3: seed** de `medio_pago_sii` (con update si la fila ya existe, para las bases que ya
  tienen los 4 métodos).
- [ ] **Step 4: proveedor y `emisionActiva`** en el service; `obtener` lee
  `t.emite_boleta_electronica` (una consulta, o sumado a una que ya pase por el tenant).
- [ ] **Step 5: `cambiarEmision`.** Con `activa: true` llama a `obtener` y, con faltantes, `400`
  con `{ message: 'Para emitir falta: ' + faltantes.map(f => f.mensaje).join('; '), faltantes }`.
  Apagar no valida. `UPDATE tenants SET emite_boleta_electronica = $2, actualizado_el = now() WHERE
  tenant_id = $1 AND eliminado_el IS NULL`. DTO `CambiarEmisionDto { @IsBoolean() activa: boolean }`.
- [ ] **Step 6: anular.** `MOTIVO_ANULAR_CON_ENVIADO` pasa a `'La boleta ya se emitió: se revierte
  con una nota de crédito, no se anula.'` y la condición mira `estado_envio === 'emitido'`.
  `sin_emitir` cae en el descarte `armado_sin_enviar` como `armado` (ya lo hace el `for`: verificar).
  En el front, el tipo suma los dos estados y la etiqueta: `emitido` → `'Boleta electrónica
  emitida'`, `sin_emitir` → `'Boleta electrónica sin emitir'`, `armado` → la de hoy.
- [ ] **Step 7: e2e** en `dte-perfil.e2e-spec.ts`:
  - `PATCH /dte/emision {activa:true}` con faltantes → 400 y la lista; sin faltantes (perfil completo
    del e2e) → 200 y `GET /dte/perfil` da `emisionActiva: true`; `{activa:false}` → 200;
  - un cajero → 403;
  - `{activa: "si"}` → 400 del pipe;
  - sin `DTE_PROVEEDOR_RUT` (borrarlo del `process.env` en ese test y restaurarlo): el perfil trae
    `SIN_PROVEEDOR_SOFTWARE`. Si el `ConfigService` cachea la variable al arrancar, el test usa
    `jest.spyOn(service, 'proveedorSoftware').mockReturnValue(null)` y lo dice en un comentario.
- [ ] **Step 8:** grep de `'enviado'` en `backend/src` y `frontend/app` ligado a `estado_envio` /
  `estadoEnvio`: no queda ninguno. Docs, gate, stagear.

---

## Task 4: de la venta a los datos de la boleta (funciones puras)

**Files:**
- Create: `backend/src/modules/venta-documentos/boleta-de-venta.ts`
- Create: `backend/src/modules/venta-documentos/boleta-de-venta.spec.ts`

**Interfaces:**
- Consumes: `DatosBoleta`, `LineaBoleta`, `EmisorBoleta`, `ProveedorSoftware`, `MedioPagoSii`,
  `TipoBoleta`, `CodigoDteError` de `dte/dte.types.ts`.
- Produces:

```ts
export interface LineaParaBoleta {
  descripcion: string | null;
  cantidad: string;       // venta_detalles.cantidad
  subtotal: string;       // venta_detalles.subtotal (neto, antes de descuentos)
  totalLinea: string;     // venta_detalles.total_linea (con impuestos)
  exenta: boolean;        // clasificacion_tributaria = 'exento'
  tasaIva: string;        // Σ porcentaje_aplicado de sus ventas_impuestos con impuesto tipo 'iva' ('0' en exenta)
}
export interface DocumentoParaBoleta {
  monto: string; montoAfecto: string; montoExento: string; montoImpuestos: string;
  cubreTodo: boolean;     // monto = ventas.total_final
}
export interface VentaParaBoleta {
  fechaVenta: string;     // AAAA-MM-DD en hora de Chile (fechaChile(ventas.creado_el))
  lineas: LineaParaBoleta[];
  documento: DocumentoParaBoleta;
  adicionales: string;    // Σ ventas_impuestos de impuestos no 'iva'
  receptor: { rut: string; nombre: string | null; correo: string | null; telefono: string | null } | null;
  superaUmbral: boolean;
  pagos: { monto: string; medioPagoSii: MedioPagoSii | null }[]; // ya en orden de registro
}
export const NOMBRE_LINEA_SALDO = 'Saldo de la venta';
export const NOMBRE_LINEA_SALDO_EXENTO = 'Saldo de la venta (exento)';
export function tipoBoletaDe(v: VentaParaBoleta): TipoBoleta;
export function datosBoletaDeVenta(
  v: VentaParaBoleta, folio: number, emisor: EmisorBoleta, proveedor: ProveedorSoftware,
): DatosBoleta;
export type GrupoErrorEmision = 'perfil' | 'boleta';
export function grupoDelError(codigo: CodigoDteError): GrupoErrorEmision;
```

**Reglas** (spec § 4.2–4.3, con Decimal.js en todo):
- `tipoBoletaDe`: con `cubreTodo`, `41` si todas las líneas son exentas (y hay al menos una); sin
  `cubreTodo`, `41` si `montoAfecto` y `montoImpuestos` son 0. Si no, `39`.
- Con `cubreTodo`, una `LineaBoleta` por línea:
  - `nombre = descripcion ?? ''` (vacío lo rechaza el motor; no inventar un nombre);
  - `monto = totalLinea`, `exenta`;
  - si `subtotal` es 0: sin `cantidad` ni `precioUnitario` (línea gratis), con `cantidad`
    igual a la de la venta solo si el motor la pide (leer `boleta-documento.ts`: hoy la línea gratis
    sale con `QtyItem`);
  - si no: `cantidad`, `precioUnitario = subtotal / cantidad × (1 + tasaIva)` a 6 decimales
    (`toDecimalPlaces(6, ROUND_HALF_UP)`), y `dif = precioUnitario × cantidad − totalLinea` redondeada a
    0 decimales `ROUND_HALF_UP`: `dif > 0` → `descuentoMonto = dif`; `dif < 0` → `recargoMonto = −dif`.
- Sin `cubreTodo`: `{ nombre: NOMBRE_LINEA_SALDO, monto: montoAfecto + montoImpuestos, exenta: false }`
  si esa suma es > 0, y `{ nombre: NOMBRE_LINEA_SALDO_EXENTO, monto: montoExento, exenta: true }` si
  `montoExento > 0`. Sin cantidad ni precio. Si las dos son 0, una sola línea afecta de 0.
- `ajustesGlobales: []` siempre (los de nivel venta ya están en `ajuste_venta`).
- `montos`: `neto = montoAfecto`, `exento = montoExento`, `iva = montoImpuestos`, `total = monto`,
  `adicionales`. Todos a 0 decimales tal cual (el motor los verifica enteros; no redondear acá).
- `receptor` solo si viene con RUT.
- `superaUmbralIdentificacion = superaUmbral`; `medioPago` solo con `superaUmbral`: el `medioPagoSii`
  del pago de mayor `monto` (empate: el primero), `5` si es null; sin pagos, sin `medioPago`.
- `fechaEmision = fechaVenta`.
- `grupoDelError`: `'perfil'` para `SIN_FOLIOS`, `SIN_CERTIFICADO`, `CERTIFICADO_VENCIDO`,
  `PERFIL_INCOMPLETO`, `AMBIENTE_DISTINTO`; `'boleta'` para todo otro código.

- [ ] **Step 1: tests que fallan**, cada uno pasando el resultado por `emitirBoleta` con
  `cafDePrueba` / `certificadoDePrueba` de `dte/__fixtures__/credenciales-prueba.ts` (así el motor
  verifica las igualdades de verdad, no el test):
  - venta completa de 2 líneas afectas, una con `ajuste_venta` (`totalLinea` con un descuento de
    venta repartido) → sale, y la línea lleva `DescuentoMonto`;
  - línea a granel `cantidad '0.375'`, `subtotal` y `totalLinea` de 1.121 → sale;
  - afecta + exenta → tipo 39 con una línea exenta; todo exento → 41 sin neto ni IVA;
  - **$0 por descuento**: `subtotal` 10.084, `totalLinea` 0, montos 0 → sale con `MntTotal` 0 y
    `DescuentoMonto` (depende de la tarea 2);
  - pago mixto (`cubreTodo: false`, afecto 50.420 + IVA 9.580) → una línea "Saldo de la venta" de
    60.000; con exento, dos líneas;
  - sobre el umbral con dos pagos (efectivo 1.000 y débito 5.000.000) → `MedioPago` 2; con el pago
    mayor sin código → 5;
  - `fechaEmision` es `fechaVenta` aunque el `ahora` de la firma sea otro día;
  - `adicionales > 0` → `IMPUESTO_ADICIONAL_NO_SOPORTADO`;
  - `grupoDelError`: un caso por cada código del grupo perfil y tres del grupo boleta.

  Los valores de los fixtures evitan el 1 y los redondeos que coinciden por casualidad
  (`el valor del fixture decide si el mutante vive`).
- [ ] **Step 2:** verlos fallar; implementar; verlos pasar.
- [ ] **Step 3: mutantes** (revertir con `cp` y comprobar con `cmp`): `dif` con el signo cambiado;
  `precioUnitario` sin `(1 + tasaIva)`; `medioPago` del primer pago en vez del mayor;
  `fechaEmision` con la fecha del `ahora`. Anotar en el reporte cuál cae y con qué test.
- [ ] **Step 4:** gate del backend, stagear.

---

## Task 5: la venta emite, detrás de un savepoint

**Files:**
- Modify: `backend/src/common/db/db.service.ts` (`conSavepoint`), `backend/src/common/db/db.spec.ts`
- Create: `backend/src/modules/venta-documentos/emision-boleta.service.ts`, `emision-boleta.service.spec.ts`
- Modify: `backend/src/modules/venta-documentos/venta-documentos.module.ts` (importa `DteModule`; provider y export)
- Modify: `backend/src/modules/ventas/ventas.service.ts` (la consulta de `t.facturador` ~:913 suma `t.emite_boleta_electronica`; después de `documentarVenta` ~:1687 llama a la emisión; `BoletaVenta` y `armarBoleta` ~:455 y ~:5386 suman `boletaElectronica` y `boletaSinEmitir`)
- Create: `backend/test/boleta-desde-la-venta.e2e-spec.ts`
- Modify: `docs/features/emision-electronica.md` (sección nueva "La venta emite la boleta"), `docs/features/ventas.md` (flujo transaccional, respuesta), `docs/patterns/backend.md` (el savepoint, en el § de `Db`)

**Interfaces:**
- Consumes: `FoliosService.tomarFolio(tenantId, tipo): Promise<{cafId, folio}>`,
  `FoliosService.credencialesParaFirmar(tenantId, cafId, ahora): Promise<{caf, certificado, emisor, caratula}>`,
  `emitirBoleta(datos, {caf, certificado}, ahoraChile): BoletaEmitida`,
  `ColaDteService.encolar(tenantId, boleta, cafId): Promise<{documentoId}>`,
  `PerfilFiscalService.proveedorSoftware()`, `fechaChile`, `ahoraChile` (`dte/perfil-fiscal.ts`),
  `datosBoletaDeVenta`, `tipoBoletaDe`, `VentaParaBoleta` (tarea 4).
- Produces: `Db.conSavepoint<T>(nombre: string, fn: () => Promise<T>): Promise<T>` — exige
  transacción activa (si no, `throw new Error`); `nombre` validado con `/^[a-z_]+$/`; corre
  `SAVEPOINT <nombre>`, luego `fn`; en el éxito `RELEASE SAVEPOINT`, en el error
  `ROLLBACK TO SAVEPOINT` y vuelve a lanzar el mismo error.
- Produces: `EmisionBoletaService.emitir(tenantId: string, ventaDocumentoId: string, ahora: Date):
  Promise<{ estado: 'emitido'; folio: number; tipo: TipoBoleta } | { estado: 'sin_emitir'; codigo:
  CodigoDteError; mensaje: string }>`. Se llama siempre dentro de `db.transaccion`. Atrapa **solo**
  `DteError`.
- Produces: `EmisionBoletaService.documentoAEmitir(documentos: VentaDocumento[], tipoEsBoleta: boolean):
  VentaDocumento | null` (pura): el `emisor = 'sistema'`, con `tipoDocumentoId` de boleta, sin
  `descarte`, no duplicado. A lo sumo uno (si hay dos, `throw new Error`: contradice ADR-028).
- Produces (`BoletaVenta`): `boletaElectronica: { tipo: 39 | 41; folio: number; monto: string;
  cubreTodo: boolean; ambiente: 'certificacion' | 'produccion'; resolucion: { numero: number; fecha:
  string }; emisor: { rut: string; razonSocial: string; giro: string; direccion: string; comuna:
  string } } | null` y `boletaSinEmitir: { mensaje: string } | null`.

**`emitir`, paso a paso:**
1. `conSavepoint('emision_boleta', async () => { … })` envuelve 2 a 6.
2. Lee, con consultas fijas: el documento (`FOR UPDATE`, por id y tenant, vigente); la venta
   (`creado_el`, `total_final`, el umbral del **año de la venta** — variante de
   `UMBRAL_IDENTIDAD_SQL` con `EXTRACT(YEAR FROM v.creado_el AT TIME ZONE prov.zona_horaria)`); sus
   líneas con la tasa de IVA en **una** consulta (`venta_detalles` `LEFT JOIN` agregado de
   `ventas_impuestos` ⋈ `impuestos` por `detalle_id`; el `JOIN` a `impuestos` **no** filtra
   `eliminado_el`, con el comentario: un impuesto borrado después no cambia lo que la venta cobró); los
   adicionales (misma consulta o una más); el `venta_customer`; los pagos aplicados a ese documento
   con `metodos_pago.medio_pago_sii` (si el documento es la boleta del sistema, son los pagos con
   emisor `sistema`, por `pago_aplicaciones`). Si el documento ya no está en `armado`/`sin_emitir` o
   tiene descarte, devuelve sin hacer nada (lo usa el botón).
3. `tipo = tipoBoletaDe(v)`; `{cafId, folio} = tomarFolio(tenantId, tipo)`.
4. `cred = credencialesParaFirmar(tenantId, cafId, ahora)`; `proveedor = proveedorSoftware()` (null →
   `throw new DteError('PERFIL_INCOMPLETO', 'Falta el proveedor de software en la configuración del
   sistema')`).
5. `boleta = emitirBoleta(datosBoletaDeVenta(v, folio, cred.emisor, proveedor), cred, ahoraChile(ahora))`;
   `{documentoId} = encolar(tenantId, boleta, cafId)`.
6. `UPDATE venta_documentos SET estado_envio='emitido', dte_documento_id=$3, emision_error_codigo=NULL,
   emision_error=NULL, actualizado_el=now() WHERE documento_id=$1 AND tenant_id=$2`.
7. Fuera del savepoint, en el `catch (e) { if (!(e instanceof DteError)) throw e; … }`:
   `UPDATE … SET estado_envio='sin_emitir', emision_error_codigo=$3, emision_error=$4`.

**En la venta:** después de `documentarVenta(...)` (que devuelve los `VentaDocumento[]`), si
`monedaOficial.emiteBoletaElectronica` y `documentoAEmitir(docs, tipoDocumento.esBoleta)` no es null,
`await this.emisionBoleta.emitir(tenantId, doc.id, new Date())`. Nada más cambia en el orden de
`crearEnTransaccion`. `armarBoleta` lee `boletaElectronica` con un `LEFT JOIN` de
`venta_documentos` (el sistema, vigente) → `dte_documentos` → `razones_sociales` (sin filtrar
`eliminado_el` de la razón social, con el porqué: la boleta ya emitida conserva su emisor), dentro de
la consulta de cabecera o como una sola consulta más; nunca por línea.

- [ ] **Step 1: `conSavepoint`** con su test en `db.spec.ts` (contra la base real si el spec ya lo
  hace, o con el manager mockeado verificando las tres sentencias y el re-lanzado): éxito libera; error
  vuelve y re-lanza; nombre inválido tira; sin transacción tira.
- [ ] **Step 2: `documentoAEmitir`** con tests unitarios (sistema de boleta → ese; factura → null;
  `maquina`/`nadie` → null; descartado → null; duplicado → null; dos → tira).
- [ ] **Step 3: `emitir`** e integración en la venta, y `armarBoleta`.
- [ ] **Step 4: e2e** `boleta-desde-la-venta.e2e-spec.ts`. Setup como `dte-cola.e2e-spec.ts`
  (`cafDePrueba`, `certificadoDePrueba`, `emisora`, `subirCertificado`, limpieza en `afterAll` que
  acumula fallos y cierra la app primero); prende el interruptor con `PATCH /dte/emision`. Casos:
  - POS (`POST /ventas` con `Idempotency-Key`): la respuesta trae `boleta.boletaElectronica.folio`;
    `venta_documentos` `emitido` con `dte_documento_id`; `dte_documentos` `pendiente` con ese folio;
  - mismo cobro con la misma clave → el mismo folio, y `siguiente_folio` avanzó una sola vez;
  - interruptor apagado → `armado`, `dte_documentos` sin fila nueva, `boletaElectronica: null`;
  - **sin folios** (CAF agotado: subir uno de rango corto y consumirlo, o marcar `siguiente_folio =
    hasta + 1` por SQL con comentario) → 201, `sin_emitir` con `SIN_FOLIOS`, `boletaSinEmitir.mensaje`,
    y `siguiente_folio` igual que antes;
  - **una venta que se cae después de emitir**: `jest.spyOn(ventasService, 'armarBoleta')
    .mockRejectedValueOnce(new Error('falla de prueba'))` (corre después de la emisión, en la misma
    transacción) → la respuesta es 500, no hay venta nueva, no hay fila nueva en `dte_documentos` y
    `siguiente_folio` quedó igual (el folio volvió);
  - 10 ventas en paralelo → 10 folios distintos y consecutivos;
  - **$0 por descuento** (Review Focus 1): dos descuentos que suman más del 100 % → `emitido`, y el
    XML encolado trae `<MntTotal>0</MntTotal>` y un `DescuentoMonto`;
  - **descuento de línea + de venta y una línea a granel** (Review Focus 2) → `emitido`;
  - **cierre de mesa** con el CAF agotado (Review Focus 3) → la cuenta cerrada, la venta creada,
    `sin_emitir`; con folios → `emitido`;
  - **venta pendiente** del cierre de mesa (paga una parte) (Review Focus 4) → la boleta del sistema
    por lo no pagado `emitido`;
  - pago mixto con un medio `maquina` → la boleta del sistema por el saldo, `emitido`, con la línea
    "Saldo de la venta" en el XML;
  - callback de la tienda online y alta de suscripción → `emitido` (usar los helpers de sus e2e
    existentes; si montar el callback es demasiado, `crear` con `canal: 'online'` y `ventaCongelada`
    como hace su spec, diciéndolo en el reporte);
  - `GET /ventas/:id/boleta` de una emitida → el mismo `boletaElectronica`.
- [ ] **Step 5: mutantes** (revertir con `cp` y `cmp`; correr el e2e y los unitarios):
  sin `conSavepoint` (el `sin_emitir` deja la transacción abortada o el folio consumido); emitir
  **antes** de `documentarVenta`; atrapar cualquier error en vez de solo `DteError`; el umbral con
  `now()` en vez del año de la venta. Anotar cuál cae.
- [ ] **Step 6:** e2e dos veces seguidas, docs, gate del backend, stagear.

---

## Task 6: emitir después, el estado para el cajero y la marca de la NC

**Files:**
- Create: `backend/src/modules/venta-documentos/emision-boleta.controller.ts`
- Modify: `backend/src/modules/venta-documentos/emision-boleta.service.ts` (`emitirPendientes`, `sinEmitir`, `estadoEmision`)
- Modify: `backend/src/modules/venta-documentos/venta-documentos.module.ts` (controller)
- Modify: `backend/src/modules/venta-documentos/venta-documentos.service.ts:785-860` (el detalle: `folio`, `estadoSii`, `emisionError`, `ncElectronicaPendiente`)
- Modify: el camino de emisión de la NC en `ventas.service.ts`: la respuesta suma `avisoNcElectronica: string | null`, con *"La boleta de esta venta ya se emitió: la nota de crédito ante el SII hazla en su portal por ahora."* cuando corrige un documento `emitido`, y `null` si no
- Modify: `backend/test/boleta-desde-la-venta.e2e-spec.ts`
- Modify: `docs/features/emision-electronica.md`, `docs/features/reembolsos-nota-credito.md`

**Interfaces:**
- Consumes: `EmisionBoletaService.emitir` y `grupoDelError` (tareas 4 y 5),
  `PerfilFiscalService.obtener` (avisos, `emisionActiva`).
- Produces, en `@Controller('dte')` del módulo `venta-documentos` (no el `DteController`, que lleva
  `TenantAdminGuard` a nivel de clase y es del módulo `dte`, que no puede importar a este):
  - `POST /dte/emitir-pendientes` — `JwtAuthGuard, TenantGuard, TenantAdminGuard`. Responde
    `{ emitidas: number; pendientes: number; errores: { ventaId: string; codigo: string; mensaje: string }[] }`.
  - `GET /dte/boletas-sin-emitir` — mismos guards. Responde `{ ventaId, fecha, monto, codigo, mensaje,
    grupo: 'perfil' | 'boleta' }[]`, del más viejo al más nuevo, hasta 200, en **una** consulta.
  - `GET /dte/estado-emision` — `JwtAuthGuard, TenantGuard, PermisosGuard` y
    `@RequiresPermiso('Ventas', 'Crear')`. Responde `{ activa: boolean; avisos: { codigo:
    'POCOS_FOLIOS' | 'CERTIFICADO_POR_VENCER'; mensaje: string }[]; sinEmitir: number }`; con
    `activa: false`, `avisos: []` y `sinEmitir: 0`.
- Produces (detalle de la venta, `documentos[]`): `folio: number | null`, `estadoSii: string | null`
  (`dte_documentos.estado`), `emisionError: string | null`, `ncElectronicaPendiente: boolean` (un
  documento de corrección `sistema` cuyo `documento_corregido_id` apunta a uno `emitido`), todo en la
  consulta que ya existe (`LEFT JOIN`s), sin una consulta por documento.

**`emitirPendientes(tenantId, ahora)`:**
1. Una consulta: los `sin_emitir` del tenant, vigentes, `ORDER BY creado_el, documento_id LIMIT 200`.
2. Por cada uno, `db.transaccion`: `SELECT … FROM ventas WHERE venta_id=$1 AND tenant_id=$2 AND
   eliminado_el IS NULL FOR UPDATE` (el mismo bloqueo que `lockVentaOriginal`; es un duplicado
   deliberado porque este módulo no puede importar `VentasService`: decirlo en el comentario), y
   después `emitir(...)`, que vuelve a mirar el estado y el descarte del documento con `FOR UPDATE`.
3. `emitido` → suma; `sin_emitir` con grupo `perfil` → agrega el error y **corta**; con grupo
   `boleta` → agrega el error y sigue.
4. `pendientes` = cuántos `sin_emitir` quedan (un `count`).

- [ ] **Step 1: e2e** (en el mismo spec de la tarea 5):
  - con el CAF agotado, 3 ventas quedan `sin_emitir`; `GET /dte/boletas-sin-emitir` las lista con
    `grupo: 'perfil'`; `POST /dte/emitir-pendientes` → `emitidas: 0`, un error y corta;
  - se sube un CAF → `POST` → `emitidas: 3`, `pendientes: 0`, y el XML de cada una lleva `FchEmis` con
    la fecha de su venta (correr `creado_el` de una venta un día atrás por SQL, con comentario, para
    que la fecha no coincida con hoy);
  - un `sin_emitir` del grupo boleta (un producto con un impuesto `otro`) no corta: las demás salen;
  - **anulación en paralelo** (Review Focus 5): una venta `sin_emitir` pendiente sin pagos; retener la
    fila de la venta con un query runner propio (`FOR UPDATE`), lanzar el botón, confirmar con
    `pg_blocking_pids` que espera, anularla por SQL en ese runner (como lo haría `cancelarUnaVez`:
    estado y descarte) y soltar → el botón no la emite, y no hay venta `cancelada` con documento
    `emitido`;
  - anular una `sin_emitir` por la ruta → 201 y descartada; una `emitido` → 400 con el motivo nuevo;
  - la NC sobre una venta emitida → 201 con el aviso, y el detalle trae `ncElectronicaPendiente: true`;
  - `GET /dte/estado-emision`: el cajero del seed → 200; con menos de 100 folios trae `POCOS_FOLIOS`;
    con el interruptor apagado → `activa: false`, sin avisos;
  - el cajero → 403 en `POST /dte/emitir-pendientes`, en `GET /dte/boletas-sin-emitir` y en
    `PATCH /dte/emision`;
  - las respuestas no traen ningún blob (XML, PEM, credencial): buscar `xml`, `BEGIN` y `cifrad` en el
    JSON.
- [ ] **Step 2:** implementar hasta que pase.
- [ ] **Step 3: mutantes:** el botón sin el `FOR UPDATE` de la venta; el corte también con grupo
  `boleta`; **sin el corte con `SIN_FOLIOS`** (sigue con todas); `estado-emision` con
  `TenantAdminGuard`. Anotar cuál cae.
- [ ] **Step 4:** e2e dos veces, docs, gate, stagear. El controlador corre además
  `api-security-reviewer` sobre esta tarea.

---

## Task 7: el ticket y el aviso al cajero

**Files:**
- Modify: `frontend/app/types/boleta.ts` (espejo de `boletaElectronica` y `boletaSinEmitir`)
- Modify: `frontend/app/utils/ticket-builder.ts:496-620` y su spec
- Create: `frontend/app/composables/useBoletaElectronica.ts`, `useBoletaElectronica.spec.ts`
- Modify: `frontend/app/pages/ventas/pos.vue:339-341`, `frontend/app/pages/salones/index.vue:2936-2938`, `frontend/app/components/ventas/VentaDetalleDrawer.vue:953-955` (los tres `facturacionElectronica: false`)
- Create: `frontend/app/components/ventas/FranjaEmision.vue`
- Modify: `pos.vue` y `salones/index.vue` (montan la franja; avisan `boletaSinEmitir` al cobrar)
- Modify: `frontend/app/composables/useDocumentosVenta.ts` y el drawer (la marca de la NC)
- Modify: `docs/features/impresion-termica.md`

**Interfaces:**
- Consumes: `BoletaVenta.boletaElectronica`, `BoletaVenta.boletaSinEmitir` (tarea 5),
  `GET /dte/estado-emision` y `documentos[].ncElectronicaPendiente` (tarea 6).
- Produces: `buildBoletaTicket` cambia `facturacionElectronica: boolean` + `folio` por
  `electronica?: { tipo: 39 | 41; folio: number; monto: string; cubreTodo: boolean; certificacion:
  boolean; resolucion: { numero: number; fecha: string } }` y `pendienteDeEmision?: boolean`. El
  `emisor` del ticket, cuando hay `electronica`, sale de `boletaElectronica.emisor`.
- Produces: `useBoletaElectronica()` → `{ paraTicket(boleta: BoletaVenta): { electronica?, pendienteDeEmision?, emisor? }, avisoSinEmitir(boleta): string | null }`.

**El papel** (spec § 7):
- Emitida: `BOLETA ELECTRÓNICA` (o `BOLETA EXENTA ELECTRÓNICA` con 41) y `N° <folio>`; con
  `cubreTodo: false`, debajo `por <monto> (saldo de la venta)`. Al pie: `Timbre Electrónico SII`,
  `Res. N° <numero> de <AAAA>` (año de `resolucion.fecha`), `Verifique documento en www.sii.cl`.
  Se va el `TODO(SII futuro)` y la leyenda `Verifique en www.sii.cl`.
- Certificación: además `CERTIFICACIÓN – SIN VALIDEZ` debajo del tipo.
- Sin emitir: el de hoy (`DOCUMENTO INTERNO`, `SIN VALIDEZ FISCAL`) más `Boleta electrónica pendiente
  de emisión` al pie.
- Ni uno ni otro: exactamente el de hoy (test de regresión con el snapshot de líneas actual).

- [ ] **Step 1: tests de `buildBoletaTicket`**: 39 con folio; 41; pago mixto con la línea de saldo;
  certificación; sin emitir; ninguno = igual a hoy. Y de `useBoletaElectronica`.
- [ ] **Step 2:** implementar el builder, el composable y los tres llamadores.
- [ ] **Step 3: la franja.** `FranjaEmision.vue` lee `GET /dte/estado-emision` al montarse y expone
  `recargar()`; muestra un `UAlert` (color `warning`, tokens de Nuxt UI) por aviso, más `Hay N
  boletas sin emitir: avisa al encargado` si `sinEmitir > 0`; nada si `activa: false`. POS y salón la
  montan arriba y llaman `recargar()` después de cada cobro. Al cobrar, si
  `avisoSinEmitir(boleta)` no es null: `toast.add({ title: 'La boleta no se emitió: <mensaje>. Avisa
  al encargado.', color: 'warning' })`.
- [ ] **Step 4: la NC.** En el drawer, un documento con `ncElectronicaPendiente` muestra el badge
  `NC electrónica pendiente` y el texto *"Hazla en el portal del SII por ahora; el sistema la emitirá
  cuando esté disponible."*. La etiqueta de `useDocumentosVenta` para `emitido` suma el folio
  (`Boleta electrónica N° 1234`).
- [ ] **Step 5: Playwright** (`frontend/e2e/ventas/boleta-electronica-pos.spec.ts`, nuevo, con login
  vía Playwright y el rol real del cajero): con la emisión prendida por API en el setup, un cobro en
  el POS no muestra error y la franja aparece con pocos folios (el CAF de prueba tiene menos de 100).
  El ticket se verifica en los unitarios, no acá (QZ Tray no corre en CI).
- [ ] **Step 6:** gate del frontend, doc, stagear.

---

## Task 8: la pantalla para todos los admin

**Files:**
- Modify: `frontend/app/pages/configuracion.vue:40-41` (sale `auth.isSuperadmin`)
- Modify: `frontend/app/pages/configuracion/boleta-electronica.vue` (interruptor, lista, botón)
- Modify: `frontend/e2e/configuracion/boleta-electronica.spec.ts`, `frontend/e2e/configuracion/menu-configuracion.spec.ts:27`
- Modify: el spec de la página si existe (`*.nuxt.spec.ts`)
- Modify: `docs/features/emision-electronica.md` (§ Permisos y pantalla)

**Interfaces:**
- Consumes: `GET /dte/perfil` (`emisionActiva`, `faltantes`), `PATCH /dte/emision`,
  `GET /dte/boletas-sin-emitir`, `POST /dte/emitir-pendientes`.

- [ ] **Step 1: el menú.** La entrada `Boleta electrónica` pasa a `admin && { … }`. El comentario
  de la línea 40 se actualiza. El spec del menú cuenta la entrada para el admin no superadmin.
- [ ] **Step 2: el interruptor.** Arriba de las tarjetas, `USwitch` "Emitir boletas electrónicas":
  deshabilitado si hay `faltantes`, con el texto `Para emitir falta: …`; al prenderlo, un modal de
  confirmación con *"Desde ahora cada venta emite una boleta ante el SII."*; apagar no confirma. El
  400 del servidor se muestra tal cual.
- [ ] **Step 3: la lista y el botón.** Una `UCard` "Boletas sin emitir" con `UTable` (fecha, monto,
  motivo, link a la venta) y `UButton` "Emitir pendientes" que muestra el resultado (`N emitidas`,
  y los errores). Con la lista vacía, el `#empty` dice *"No hay boletas sin emitir."*. Tras el botón,
  se recarga la lista.
- [ ] **Step 4: Playwright** de la pantalla con un admin **no superadmin** (crear uno en el setup o
  usar el del seed si existe; probar con el rol real): ve el menú; el interruptor deshabilitado con
  faltantes y habilitado con el perfil completo; prenderlo pide confirmación; la lista vacía.
- [ ] **Step 5:** gate del frontend, doc, stagear.

---

## Task 9: el cierre

**Files:**
- Modify: `docs/ESTADO.md`, `docs/ARCHITECTURE.md`, `docs/agent/desarrollo-nuevo.md` (frente 1 hecho;
  frentes 2 y 3 abiertos; lo que queda de la spec § 12), `docs/README.md` si cambia una fila,
  `docs/features/emision-electronica.md` ("Lo que queda abierto" de la nueva sección)
- Delete: este plan y su spec (`docs/superpowers/README.md`: las de features implementadas se eliminan)

- [ ] **Step 1:** docs.
- [ ] **Step 2:** el gate entero local (backend: lint, typecheck, `npm test`; frontend: build,
  test, ratchet, design) y el e2e de los specs tocados: `boleta-desde-la-venta`, `dte-perfil`,
  `dte-folios`, `dte-cola`, `items-nombre-sii`, `idempotencia-venta`, y los de ventas, salones,
  online y suscripciones que el diff toque.
- [ ] **Step 3:** la revisión final de la rama (la hace el controlador).

## Verification

Después del push (con turno de la orquestadora): CI por SHA (`gh run list --commit <sha>`, `gh run
watch --exit-status`), el deploy del backend en SUCCESS y `./scripts/smoke-produccion.sh`. **Antes
del push**, el owner carga `DTE_PROVEEDOR_RUT` y `DTE_PROVEEDOR_RAZON_SOCIAL` en Railway, o el
interruptor no prende en producción (el backend arranca igual).

## Decisions / Open questions

- **Desvío de la spec (ruling del plan):** la spec ubica `EmisionBoletaService` "en el módulo
  `dte`". Va en `venta-documentos`: es el dueño de `venta_documentos`, que el service escribe, y ya es
  el módulo hoja que importan ventas y pagos. Si viviera en `dte`, `dte` tendría que escribir una
  tabla de ventas y el botón no podría bloquear la venta sin importar `VentasService`. `dte` no
  importa a nadie de ventas, así que `venta-documentos → dte` no arma un ciclo.
- Las rutas nuevas llevan el prefijo `/dte` aunque su controller viva en `venta-documentos`.
- La resolución del ticket se lee de la razón social al imprimir, no se congela en la boleta: si la
  empresa pasa de certificación a producción, la reimpresión de una boleta de certificación mostraría
  la resolución nueva. Se acepta: esas boletas no tienen validez; anotado en "Lo que queda abierto".
