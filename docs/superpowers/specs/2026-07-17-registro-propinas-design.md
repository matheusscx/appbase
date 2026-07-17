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

- Tabla `venta_propina` (0..1 por venta de cierre de mesa).
- Columnas `monto_aplicado_venta` y `monto_aplicado_propina` en `pagos`.
- Extensión de `POST /cuentas/:id/cerrar` para recibir propina y cobrar
  `total_final + propina`.
- Split determinista de cada pago entre venta y propina (prioridad a medios
  `permite_vuelto = false`).
- UI de cobro en salones: desglose venta / propina / total a pagar; propina
  sugerida 10% editable (incluye $0).
- Inclusión de propina en detalle de venta cuando exista.
- Tip entra a caja con el monto total del pago (arqueo refleja dinero recibido).

Fuera de alcance de esta fase:

- Configuración de % de propina por tenant (v1 fijo 10% en front).
- Liquidación / fondo común / grupos / reglas de reparto (E).
- Reportes agregados (F).
- Propina en POS genérico (`ventas/pos`) o ventas online.
- Impresión DTE / boleta (solo dejar datos listos; no plantilla nueva).
- Nota de crédito / anulación de propina (se aborda cuando exista NC sobre mesa
  con tip, o en E).
- Asignación manual por el cajero de tip a un medio de pago concreto.

## Decisiones

| Tema | Decisión |
|---|---|
| Relación con la venta / SII | Propina **fuera** de `total_final` y del motor de precios |
| Cobro | Modal trabaja sobre **total a pagar** = venta + propina |
| Pagos | Un solo flujo; no se divide el pago físicamente ante el cajero |
| Split interno | `monto_aplicado_venta` + `monto_aplicado_propina` por fila de `pagos` |
| Regla de atribución | Determinista: tip primero a métodos `permite_vuelto = false`, luego efectivo; orden estable por `metodo_pago_id` (no por orden de ingreso) |
| Sugerencia | 10% fijo de `total_final` en front; editable; $0 permitido |
| Alcance operativo | Solo cierre de cuenta de mesa |
| Caja | Movimiento = monto total recibido (incluye tip) |
| Atribución garzón | `venta_propina.garzon_id` = `cuenta.garzon_responsable_id` al cerrar |
| Estado de la venta | Se calcula solo con `Σ monto_aplicado_venta` vs `total_final` |
| Errores operativos | `400 Bad Request` |
| RBAC | Sin rutas nuevas; mismo `Salones:Operar` del cierre |

### Relación conceptual

```
Venta (SII)
├── Productos / descuentos / impuestos
└── total_final                    ← base imponible / documento

Propina (administrada, no fiscal)
├── monto_sugerido / monto_pagado
└── garzon_id (responsable vigente)

Pagos (dinero recibido)
├── monto / vuelto
├── monto_aplicado_venta
└── monto_aplicado_propina

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

## Modelo de Datos

### `venta_propina` (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `venta_propina_id` | UUID PK | |
| `tenant_id` | UUID | del JWT |
| `venta_id` | UUID UNIQUE | FK → `ventas`; una fila por venta |
| `garzon_id` | UUID | FK → `garzones`; responsable vigente al cerrar |
| `monto_sugerido` | numeric(18,4) | ≥ 0; lo enviado como sugerencia (p. ej. 10%) |
| `monto_pagado` | numeric(18,4) | ≥ 0; tip efectivo |
| `tipo` | text | `'sugerida'` \| `'manual'` |
| `estado` | text | `'pagada'` \| `'sin_propina'` |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | soft delete |

**Derivación:**

- `tipo = 'sugerida'` si `monto_pagado` equals `monto_sugerido` (Decimal); si no → `'manual'` (incluye tip $0 o distinto del 10%).
- `estado = 'pagada'` si `monto_pagado > 0`; si no → `'sin_propina'`.

**Cuándo se crea:** siempre al cerrar cuenta de mesa (incluso con tip $0), para trazabilidad. Ventas POS/online **no** crean fila.

Índices: UNIQUE(`venta_id`) WHERE `eliminado_el IS NULL`; índice (`tenant_id`, `garzon_id`, `creado_el`) para consultas futuras de E/F.

### Cambio en `pagos`

Columnas nuevas (NOT NULL, default `'0'`):

- `monto_aplicado_venta` numeric(18,4)
- `monto_aplicado_propina` numeric(18,4)

**Invariantes:**

Por pago (neto):

```
monto_aplicado_venta + monto_aplicado_propina = monto - vuelto
```

Por venta cerrada con tip (mesa):

```
Σ(monto - vuelto)              = total_final + venta_propina.monto_pagado
Σ monto_aplicado_venta         = total_final
Σ monto_aplicado_propina       = venta_propina.monto_pagado
```

Ventas sin tip (POS/online o tip $0): `monto_aplicado_propina = 0` y
`monto_aplicado_venta = monto - vuelto` en cada pago.

Backfill: filas existentes de `pagos` → `monto_aplicado_venta = monto - vuelto`,
`monto_aplicado_propina = 0` (idempotente en `startup-pos.sql` / bootstrap si aplica).

### Algoritmo de split (determinista)

Entrada: lista de pagos ya con `vuelto` calculado (regla actual), `total_final`,
`propinaMonto`, y mapa `metodoPagoId → permiteVuelto`.

1. Neto_i = monto_i − vuelto_i.
2. `restantePropina = propinaMonto`.
3. Ordenar pagos candidatos a tip: primero los con `permite_vuelto = false`,
   ordenados por `metodo_pago_id` ascendente; después los con `permite_vuelto = true`,
   mismo orden por id. **No** usar el orden de ingreso del array.
4. Para cada pago en ese orden: `aplicado_propina = min(neto, restantePropina)`;
   `aplicado_venta = neto − aplicado_propina`; restar de `restantePropina`.
5. Al final `restantePropina` debe ser 0 (garantizado si Σ netos = target).

Ejemplo (mismos montos, distinto orden de captura → mismo resultado):

- Venta 50.000, propina 5.000; Efectivo 30.000 + Tarjeta 25.000.
- Tarjeta (`permite_vuelto=false`) recibe tip 5.000 y venta 20.000;
  Efectivo recibe venta 30.000 y tip 0.

## API

### `POST /cuentas/:id/cerrar` (extensión)

Body:

```ts
{
  pin: string                 // 6 dígitos (igual que hoy)
  propinaMonto?: string       // Decimal ≥ 0; omitido = '0'
  propinaSugerida?: string    // Decimal ≥ 0; opcional, para auditar sugerencia
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
   `total_final + propinaMonto` (extender `PagosService.registrar` para aceptar
   `propinaTarget` y persistir split).
4. Insertar `venta_propina` con:
   - `garzon_id = cuenta.garzonResponsableId`
   - `monto_sugerido = propinaSugerida ?? propinaMonto` (si no viene sugerida, usar el pagado)
   - `monto_pagado = propinaMonto`
   - tipo/estado derivados
5. Cerrar cuenta, setear `garzon_cierre_id`, cerrar tramo de asignación (C).
6. Movimientos de caja: sin cambio de semántica — monto del pago completo.

### Lectura

- `GET /ventas/:id` (y respuesta de cierre si ya expone venta): incluir
  `propina: null | { id, montoSugerido, montoPagado, tipo, estado, garzonId, garzonNombre? }`.
- Cada pago en detalle: `montoAplicadoVenta`, `montoAplicadoPropina`.

No hay CRUD independiente de propinas en D.

### Validaciones → 400

| Caso | Mensaje orientativo |
|---|---|
| `propinaMonto` &lt; 0 | Propina inválida |
| Σ(neto) ≠ total_final + propinaMonto | Los pagos no cubren venta + propina |
| Excedente sin método con vuelto | (regla actual de pagos) |
| PIN / sin sesión / cuenta no abierta | (igual B/C) |

### Estado de venta

`calcularEstadoVenta(total_final, Σ monto_aplicado_venta)`. La propina **no**
interviene en `pagada` / `pagada_parcial` / `pendiente`.

## Frontend

### Salones (`pages/salones/index.vue` + `VentasCobroModal`)

Al iniciar cobro de cuenta:

1. Calcular `sugerida = (totalCuenta × 0.10)` con Decimal.js, **half-up a 0
   decimales** (pesos enteros; tip de restaurante en Chile). Persistido como
   string numérico compatible con `numeric(18,4)`.
2. Mostrar desglose:
   - Total venta
   - Propina (input editable, default sugerida, permite 0)
   - Total a pagar = venta + propina
3. `CobroModal` / `VentasCobroModal` recibe `total = totalAPagar` (no solo venta).
4. Confirmar → `cerrarCuenta(id, { pin, propinaMonto, propinaSugerida: sugerida, pagos })`.
5. Actualizar estado local de mesa/cuenta (patrón anti-refetch).

POS y `AbonoModal` **no** se modifican en D. Pagos nuevos sin tip quedan con
`aplicado_propina = 0` vía default del backend.

### Tipos / composables

- Extender `useSalones` (`cerrarCuenta` body + tipos de respuesta).
- Helper `sugerirPropina10(total: string): string` (tests unitarios).
- Detalle de venta: mostrar tip si `propina` presente.

## Errores y UX

- Toasts operativos en 400 (mismo patrón de salones: no logout).
- Si tip > 0, toast de cierre puede mencionar propina registrada.
- El cajero **no** ve ni edita el split venta/propina por medio; es interno.

## Testing

### Backend (unit / service)

- Split: solo tarjeta → tip entero en tarjeta.
- Mixto efectivo+tarjeta: mismo resultado independiente del orden del array.
- Solo efectivo → tip en efectivo.
- `propinaMonto = 0` → fila `sin_propina`, todos `aplicado_propina = 0`.
- Estado venta ignora tip (pagos grandes por tip no dejan la venta “de más” en
  estado: el exceso tippeado va a `aplicado_propina`).
- Caja: monto de movimiento = `pago.monto` (incluye tip).
- Cierre sin `propinaMonto` ≡ tip 0.

### Frontend

- `sugerirPropina10` (casos borde, redondeo).
- Cambiar propina recalcula total a pagar del modal.

### Manual

1. Cerrar mesa con tip 10% sugerido.
2. Editar tip (mayor/menor) y confirmar.
3. Tip $0.
4. Cobro mixto efectivo+tarjeta; verificar en detalle de venta el split.
5. Verificar arqueo de caja = dinero recibido.

## Compatibilidad y migración

- `startup-pos.sql`: CREATE `venta_propina` + ALTER `pagos` + backfill de
  columnas nuevas + CHECK opcionales de no-negatividad.
- Entity TypeORM con `type: 'uuid'` en PKs/FKs (ADR-004).
- Soft delete en `venta_propina`.
- Seed: no obligatorio en D (propinas nacen al operar); opcional una venta demo
  con tip si facilita QA.

## Relación con E / F

D congela el **hecho**: cuánto tip se pagó, quién era el responsable, y por qué
medios (vía split). E leerá `venta_propina` + sesiones (B) + config de reparto
para liquidar. F agregará consultas. No distribuir tip en D.
