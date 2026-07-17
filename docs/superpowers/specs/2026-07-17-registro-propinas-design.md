# Diseño: Registro de Propinas al Cerrar Cuenta

**Status**: Draft
**Owner**: Cesar Matheus
**Date**: 2026-07-17

---

## Contexto

Con A/B/C operativos (garzones, turnos/sesiones, responsable vigente +
transferencias), el cierre de cuenta de mesa genera una venta y registra pagos
contra `total_final`, pero **no captura propina**. En Chile la propina no forma
parte de la venta ni de la base imponible del IVA: es un monto voluntario que el
establecimiento recauda para distribuir al personal.

Sin un registro separado, no hay hecho auditable para liquidaciones (E) ni
reportes (F), y el cobro operativo (cuenta + tip juntos) no queda modelado.

Este diseño cubre el subproyecto **D** del requerimiento de gestión de garzones,
turnos y propinas.

## Alcance

Incluido en esta fase:

- Tabla `venta_propina` (siempre 1 fila por cierre de mesa, incluso tip $0).
- Tabla `pago_aplicaciones` (hijo de `pagos`: split tipado venta/propina, extensible).
- Extensión de `POST /cuentas/:id/cerrar` para recibir propina y cobrar
  `total_final + propina`.
- Estrategia de asignación tipada (`EstrategiaAsignacionPropina`); en D solo se
  implementa `NO_VUELTO`.
- Split determinista vía esa estrategia (prioridad a medios `permite_vuelto =
  false`, orden estable por `metodo_pago_id`).
- UI de cobro en salones: desglose venta / propina / total a pagar; propina
  sugerida 10% editable (incluye $0); se persiste también el % sugerido.
- Inclusión de propina y aplicaciones en detalle de venta cuando existan.
- Tip entra a caja con el monto total del pago (arqueo refleja dinero recibido).

Fuera de alcance de esta fase:

- Configuración de % de propina por tenant (v1 fijo 10% / `0.10` en front; el %
  usado se congela en `venta_propina.porcentaje_sugerido`).
- Otras estrategias de asignación (`ULTIMO_PAGO`, `PRIMER_PAGO`, `PROPORCIONAL`,
  `MANUAL`) — solo el enum y el dispatch existen; lanzan error si se piden.
- Config UI de estrategia por tenant (hardcode `NO_VUELTO` en el cierre de mesa).
- Liquidación / fondo común / grupos / reglas de reparto (E).
- Reportes agregados (F).
- Propina en POS genérico (`ventas/pos`) o ventas online.
- Impresión DTE / boleta (solo dejar datos listos; no plantilla nueva).
- Nota de crédito / anulación de propina (se aborda cuando exista NC sobre mesa
  con tip, o en E).
- Conceptos futuros en aplicaciones (`cargo_servicio`, `donacion`, etc.): el
  modelo los admite por `tipo`, pero D solo escribe `venta` y `propina`.

## Decisiones

| Tema | Decisión |
|---|---|
| Relación con la venta / SII | Propina **fuera** de `total_final` y del motor de precios |
| Cobro | Modal trabaja sobre **total a pagar** = venta + propina |
| Pagos | Un solo flujo; no se divide el pago físicamente ante el cajero |
| Split interno | Tabla hija `pago_aplicaciones` (no columnas en `pagos`) |
| Estrategia | Enum `EstrategiaAsignacionPropina`; D implementa solo `NO_VUELTO` |
| Regla `NO_VUELTO` | Tip primero a métodos `permite_vuelto = false`, luego efectivo; orden estable por `metodo_pago_id` (no por orden de ingreso) |
| Sugerencia | 10% fijo (`0.10`) en front; editable; $0 permitido; se guarda `porcentaje_sugerido` + `monto_sugerido` |
| Alcance operativo | Solo cierre de cuenta de mesa |
| Caja | Movimiento = monto total recibido (incluye tip) |
| Atribución garzón | `venta_propina.garzon_id` = `cuenta.garzon_responsable_id` al cerrar |
| Fila propina | Siempre existe en cierre de mesa (`sin_propina` si monto 0) |
| Estado de la venta | Se calcula solo con `Σ aplicaciones tipo=venta` vs `total_final` |
| Errores operativos | `400 Bad Request` |
| RBAC | Sin rutas nuevas; mismo `Salones:Operar` del cierre |

### Relación conceptual

```
Venta (SII)
├── Productos / descuentos / impuestos
└── total_final                    ← base imponible / documento

Propina (administrada, no fiscal)
├── porcentaje_sugerido / monto_sugerido / monto_pagado
└── garzon_id (responsable vigente)

Pago (dinero recibido)
├── monto / vuelto
└── pago_aplicaciones[]
    ├── tipo=venta    → monto
    └── tipo=propina  → monto

Caja
└── movimiento por monto del pago (bruto recibido)
```

Ejemplo:

| Concepto | Monto |
|---|---|
| Total venta | $50.000 |
| Propina sugerida (10%) | $5.000 |
| Total a pagar | $55.000 |

Para el SII: venta $50.000. Propina $5.000 informativa, no afecta IVA.

Pago tarjeta $55.000 → aplicaciones:

| tipo | monto |
|---|---|
| venta | 50.000 |
| propina | 5.000 |

## Modelo de Datos

### `venta_propina` (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `venta_propina_id` | UUID PK | |
| `tenant_id` | UUID | del JWT |
| `venta_id` | UUID UNIQUE | FK → `ventas`; una fila por venta |
| `garzon_id` | UUID | FK → `garzones`; responsable vigente al cerrar |
| `porcentaje_sugerido` | numeric(10,6) | decimal (p. ej. `0.10` = 10%); congela el % usado al sugerir |
| `monto_sugerido` | numeric(18,4) | ≥ 0; monto sugerido mostrado/calculado |
| `monto_pagado` | numeric(18,4) | ≥ 0; tip efectivo |
| `tipo` | text | `'sugerida'` \| `'manual'` |
| `estado` | text | `'pagada'` \| `'sin_propina'` |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | soft delete |

**Derivación:**

- `tipo = 'sugerida'` si `monto_pagado` equals `monto_sugerido` (Decimal); si no → `'manual'` (incluye tip $0 o distinto del sugerido).
- `estado = 'pagada'` si `monto_pagado > 0`; si no → `'sin_propina'`.

**Cuándo se crea:** siempre al cerrar cuenta de mesa (incluso con tip $0), para
trazabilidad y reportes sin `LEFT JOIN` obligatorio. Ventas POS/online **no**
crean fila.

Índices: UNIQUE(`venta_id`) WHERE `eliminado_el IS NULL`; índice
(`tenant_id`, `garzon_id`, `creado_el`) para consultas futuras de E/F.

### `pago_aplicaciones` (nueva)

Extensible a futuros conceptos (cargo servicio, donación, etc.) sin ALTER de
`pagos`.

| Columna | Tipo | Notas |
|---|---|---|
| `pago_aplicacion_id` | UUID PK | |
| `tenant_id` | UUID | |
| `pago_id` | UUID | FK → `pagos` |
| `tipo` | text | en D: `'venta'` \| `'propina'` |
| `referencia_id` | UUID nullable | opcional; para `propina` → `venta_propina_id`; para `venta` → `venta_id` (o null si redundante con `pagos.venta_id`) |
| `monto` | numeric(18,4) | ≥ 0 |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | soft delete |

CHECK: `tipo IN ('venta', 'propina')` en D (ampliable después). Índice
(`pago_id`) WHERE `eliminado_el IS NULL`; índice (`tenant_id`, `tipo`,
`referencia_id`) para liquidaciones.

**Invariantes:**

Por pago (neto):

```
Σ pago_aplicaciones.monto (del pago) = pago.monto - pago.vuelto
```

Por venta cerrada de mesa:

```
Σ(pago.monto - pago.vuelto)              = total_final + venta_propina.monto_pagado
Σ aplicaciones tipo=venta (de la venta)  = total_final
Σ aplicaciones tipo=propina (de la venta)= venta_propina.monto_pagado
```

**Ventas sin tip (POS / online / tip $0):** cada pago tiene **una** aplicación
`tipo=venta` por el neto (`monto − vuelto`). Si tip $0 en mesa, además existe
`venta_propina` con `estado=sin_propina` y **no** se crean filas `tipo=propina`
(monto 0 no se materializa como aplicación).

**Backfill:** para cada `pago` existente sin aplicaciones, insertar una fila
`tipo='venta'`, `monto = monto - vuelto`, `referencia_id = venta_id`
(idempotente).

`pagos` **no** gana columnas `monto_aplicado_*`.

### Estrategia de asignación

```ts
enum EstrategiaAsignacionPropina {
  NO_VUELTO = 'no_vuelto',       // D: implementada
  ULTIMO_PAGO = 'ultimo_pago',   // reserved
  PRIMER_PAGO = 'primer_pago',   // reserved
  PROPORCIONAL = 'proporcional', // reserved
  MANUAL = 'manual',             // reserved
}
```

- El splitter recibe `(pagosNetos, propinaMonto, estrategia, metaMétodos)`.
- En D, el cierre de mesa siempre pasa `NO_VUELTO`.
- Cualquier otra estrategia → `400` / `NotImplemented` interno claro (no silencio).
- Persistencia de la estrategia usada: **no** en v1 (queda implícita `NO_VUELTO`);
  si E necesita auditarla, se puede añadir columna en `venta_propina` entonces.
  YAGNI ahora.

### Algoritmo `NO_VUELTO` (determinista)

Entrada: lista de pagos ya con `vuelto` calculado, `total_final`, `propinaMonto`,
mapa `metodoPagoId → permiteVuelto`.

1. Neto_i = monto_i − vuelto_i.
2. `restantePropina = propinaMonto`.
3. Ordenar pagos: primero `permite_vuelto = false` por `metodo_pago_id` ASC;
   después `permite_vuelto = true` por `metodo_pago_id` ASC. **No** usar el
   orden de ingreso del array.
4. Para cada pago en ese orden: `aplicado_propina = min(neto, restantePropina)`;
   `aplicado_venta = neto − aplicado_propina`; restar de `restantePropina`.
5. Persistir 1–2 filas en `pago_aplicaciones` por pago (omitir fila si monto 0).
6. Al final `restantePropina` = 0 (garantizado si Σ netos = target).

Ejemplo (mismos montos, distinto orden de captura → mismo resultado):

- Venta 50.000, propina 5.000; Efectivo 30.000 + Tarjeta 25.000.
- Tarjeta (`permite_vuelto=false`): aplicaciones venta 20.000 + propina 5.000.
- Efectivo: aplicación venta 30.000.

## API

### `POST /cuentas/:id/cerrar` (extensión)

Body:

```ts
{
  pin: string                      // 6 dígitos (igual que hoy)
  propinaMonto?: string            // Decimal ≥ 0; omitido = '0'
  propinaSugerida?: string         // Decimal ≥ 0; opcional (monto sugerido)
  propinaPorcentajeSugerido?: string // Decimal; default '0.10' si se omite
  pagos?: PagoVentaDto[]
  tipoDocumentoId?: string
  customer?: CustomerVentaDto
}
```

Permiso: `Salones:Operar`. Sin ruta nueva.

### Flujo transaccional

Dentro de la TX existente de `cerrarCuenta`:

1. Resolver garzón por PIN + `assertSesionAbierta`.
2. `FOR UPDATE` de la cuenta; validar abierta y con líneas.
3. Calcular venta vía `VentasService.crearEnTransaccion` con target de pagos =
   `total_final + propinaMonto`. Extender `PagosService.registrar` para:
   - aceptar `propinaTarget` + `estrategia` (default / forzado `NO_VUELTO`);
   - persistir `pago_aplicaciones` tras calcular vuelto.
4. Insertar `venta_propina` con:
   - `garzon_id = cuenta.garzonResponsableId`
   - `porcentaje_sugerido = propinaPorcentajeSugerido ?? '0.10'`
   - `monto_sugerido = propinaSugerida ?? propinaMonto`
   - `monto_pagado = propinaMonto`
   - tipo/estado derivados
   - enlazar `referencia_id` de aplicaciones `propina` → este id (si se inserta
     propina después de pagos, actualizar `referencia_id` o insertar
     aplicaciones de propina en un segundo paso dentro de la misma TX; orden
     preferido: crear `venta_propina` justo después de la venta y **antes** o
     **junto** al registrar pagos, pasando `ventaPropinaId` al registrar).
5. Cerrar cuenta, setear `garzon_cierre_id`, cerrar tramo de asignación (C).
6. Movimientos de caja: sin cambio de semántica — monto del pago completo.

Orden preferido dentro de `crearEnTransaccion` / cierre:

1. Crear cabecera venta + detalles (como hoy).
2. Crear `venta_propina` (si viene de cierre mesa; flag/param opcional).
3. `PagosService.registrar` con `propinaTarget` + `ventaPropinaId` + estrategia.
4. Estado venta según Σ aplicaciones `venta`.

### Lectura

- `GET /ventas/:id`: incluir
  `propina: null | { id, porcentajeSugerido, montoSugerido, montoPagado, tipo, estado, garzonId, garzonNombre? }`.
- Cada pago en detalle: `aplicaciones: { tipo, monto, referenciaId }[]`
  (y, si conviene al front, helpers derivados `montoAplicadoVenta` /
  `montoAplicadoPropina` calculados al serializar — no columnas en BD).

No hay CRUD independiente de propinas en D.

### Validaciones → 400

| Caso | Mensaje orientativo |
|---|---|
| `propinaMonto` &lt; 0 | Propina inválida |
| Σ(neto) ≠ total_final + propinaMonto | Los pagos no cubren venta + propina |
| Excedente sin método con vuelto | (regla actual de pagos) |
| Estrategia ≠ `NO_VUELTO` | Estrategia de asignación no soportada |
| PIN / sin sesión / cuenta no abierta | (igual B/C) |

### Estado de venta

`calcularEstadoVenta(total_final, Σ aplicaciones tipo=venta)`. La propina **no**
interviene en `pagada` / `pagada_parcial` / `pendiente`.

## Frontend

### Salones (`pages/salones/index.vue` + `VentasCobroModal`)

Al iniciar cobro de cuenta:

1. `porcentaje = 0.10`. Calcular `sugerida = (totalCuenta × porcentaje)` con
   Decimal.js, **half-up a 0 decimales** (pesos enteros). Persistido como string
   numérico compatible con `numeric(18,4)`.
2. Mostrar desglose:
   - Total venta
   - Propina (input editable, default sugerida, permite 0)
   - Total a pagar = venta + propina
3. `CobroModal` / `VentasCobroModal` recibe `total = totalAPagar` (no solo venta).
4. Confirmar → `cerrarCuenta(id, { pin, propinaMonto, propinaSugerida: sugerida, propinaPorcentajeSugerido: '0.10', pagos })`.
5. Actualizar estado local de mesa/cuenta (patrón anti-refetch).

POS y `AbonoModal` **no** se modifican en D. Sus pagos generan solo aplicación
`venta` por el neto.

### Tipos / composables

- Extender `useSalones` (`cerrarCuenta` body + tipos de respuesta).
- Helper `sugerirPropina(total: string, porcentaje = '0.10'): string` (tests).
- Detalle de venta: mostrar tip si `propina` presente; opcional desglose de
  aplicaciones por pago.

## Errores y UX

- Toasts operativos en 400 (mismo patrón de salones: no logout).
- Si tip > 0, toast de cierre puede mencionar propina registrada.
- El cajero **no** ve ni edita el split venta/propina por medio; es interno.

## Testing

### Backend (unit / service)

- Split `NO_VUELTO`: solo tarjeta → tip entero en tarjeta (2 aplicaciones).
- Mixto efectivo+tarjeta: mismo resultado independiente del orden del array.
- Solo efectivo → tip en efectivo.
- `propinaMonto = 0` → fila `sin_propina`, solo aplicaciones `venta`.
- Estrategia distinta de `NO_VUELTO` → error.
- Estado venta ignora tip (Σ tipo=venta).
- Caja: monto de movimiento = `pago.monto` (incluye tip).
- Cierre sin `propinaMonto` ≡ tip 0.
- Backfill: pagos legacy tienen una aplicación `venta` = neto.

### Frontend

- `sugerirPropina` (casos borde, redondeo, %).
- Cambiar propina recalcula total a pagar del modal.

### Manual

1. Cerrar mesa con tip 10% sugerido.
2. Editar tip (mayor/menor) y confirmar.
3. Tip $0.
4. Cobro mixto efectivo+tarjeta; verificar aplicaciones en detalle de venta.
5. Verificar arqueo de caja = dinero recibido.

## Compatibilidad y migración

- `startup-pos.sql`: CREATE `venta_propina` + CREATE `pago_aplicaciones` +
  backfill de aplicaciones `venta` para pagos existentes + CHECKs de
  no-negatividad / tipos.
- Entity TypeORM con `type: 'uuid'` en PKs/FKs (ADR-004).
- Soft delete en ambas tablas nuevas.
- Seed: no obligatorio en D.

## Relación con E / F

D congela el **hecho**: cuánto tip se pagó, con qué % se sugirió, quién era el
responsable, y cómo se aplicó el dinero por medio (`pago_aplicaciones`). E leerá
`venta_propina` + sesiones (B) + config de reparto; podrá añadir estrategias o
tipos de aplicación sin migrar columnas en `pagos`. F agregará consultas. No
distribuir tip en D.
