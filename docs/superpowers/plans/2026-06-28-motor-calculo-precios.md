# Plan: Motor de cálculo de precios

**Status:** Done
**Date:** 2026-06-28
**Owner:** Cesar Matheus

> Al ejecutar, copiar este plan a `docs/superpowers/plans/2026-06-28-motor-calculo-precios.md`
> (convención del proyecto) y trabajar directamente sobre `main`.

## Context

El SaaS POS ya tiene modelados todos los insumos de precio (items con `precio_base` /
`precio_incluye_impuesto`, asociaciones N:M a impuestos/descuentos/recargos, catálogos de
reglas con tramos y método de pago, y la configuración financiera por tenant: fórmula de
3 pasos, `calculo_descuentos`/`calculo_recargos` base|compuesto, `escala_calculo`,
`modo_redondeo`). **Falta la pieza que los combina:** el motor que, dado un conjunto de
líneas y un contexto, devuelve el desglose de precio (neto → descuentos → recargos →
impuestos → total) respetando la configuración del tenant.

Hoy no existe ningún servicio de cálculo ni el módulo de ventas (solo esquema SQL). Este
plan construye el motor como **módulo standalone, stateless y puro**, para que ventas,
notas de crédito y una futura previsualización en el POS lo consuman sin reescribir lógica.
El cálculo de dinero es el punto de mayor riesgo de bug, así que se construye con TDD
aislado (sin BD) sobre Decimal.js.

## Scope / Out of scope

**En alcance**
- Módulo `calculo-precios`: servicio puro + endpoint `POST /calculo-precios/calcular`.
- Cálculo por **línea** y por **venta** (reglas a nivel `detalle` y a nivel `venta`).
- Reglas evaluadas: **plano** (% o monto fijo), **tramos** (`por_mayor` por cantidad,
  `por_monto_venta` por monto) y **método de pago** (filtro por contexto).
- `precio_incluye_impuesto`: desbruteo del neto.
- `base` vs `compuesto`, orden de fórmula configurable, `escala_calculo` + `modo_redondeo`.
- Desglose con trazabilidad por regla (id, nombre, monto) para mostrar y para que ventas
  persista luego.
- Tests unitarios TDD del servicio.

**Fuera de alcance (quedan modelados, sin evaluar)**
- Reglas por **vencimiento** (`mora`, `pronto_pago` por días) — requieren fecha de
  vencimiento de crédito que aún no existe en el modelo.
- Reglas por **rango de fecha** (`promocional`) — diferidas por consistencia.
- Condiciones `monto_minimo`, `cantidad_minima`, `customer`, `categoria`, `producto`
  (CLAUDE.md las marca "fase posterior").
- Persistencia de ventas / `venta_detalles` / `ventas_descuentos` (módulo de ventas aparte).
- Conversión a moneda oficial (la hace ventas al persistir; el motor calcula en la moneda
  recibida).

## Backend

Nuevo módulo `backend/src/modules/calculo-precios/`. **Reusa servicios existentes** vía
inyección — no crea entidades ni SQL nuevo.

### Dependencias inyectadas (reuso)
- `ItemsService.findOne(tenantId, itemId)` → `precioBase`, `precioIncluyeImpuesto`,
  `impuestosIds`, `descuentosIds`, `recargosIds`.
- `ImpuestosService.findAll(tenantId)` → catálogo de impuestos (`porcentaje` decimal).
- `DescuentosService.findAll(tenantId)` → descuentos con `modo`, `valor`, `tramos`,
  `metodoPagoIds`, `tipoReglaId`/`codigo`.
- `RecargosService.findAll(tenantId)` → ídem recargos.
- `TenantsService.getPreferenciasFinancieras(tenantId)` → `formula` (orden de pasos),
  `calculoDescuentos`, `calculoRecargos`, `escalaCalculo`, `modoRedondeo`.

> Verificar/ajustar que `ItemsModule`, `ImpuestosModule`, `DescuentosModule`,
> `RecargosModule`, `TenantsModule` **exporten** su servicio; importarlos en
> `CalculoPreciosModule`. Registrar el módulo en `app.module.ts`.

### Archivos a crear
- `calculo-precios.module.ts`
- `calculo-precios.service.ts` — `CalculoPreciosService`
- `calculo-precios.controller.ts` — `POST /calculo-precios/calcular`, guards
  `JwtAuthGuard, TenantGuard`; `tenantId` SIEMPRE del token (`req.user`), nunca del body.
- `dto/calcular.dto.ts` — `CalcularVentaDto` + `LineaDto`
- `calculo-precios.service.spec.ts` — tests TDD

### Contrato (DTOs)

```
CalcularVentaDto {
  lineas: LineaDto[]               // @ArrayMinSize(1)
  metodoPagoId?: string            // contexto, habilita filtro método de pago
  descuentosVentaIds?: string[]    // reglas a nivel venta (sobre el total)
  recargosVentaIds?: string[]
}
LineaDto {
  itemId: string                   // @IsUUID
  cantidad: string                 // @IsNumberString  (Decimal en JS)
  precioUnitario?: string          // override opcional del precio_base
  descuentoIds?: string[]          // override; si ausente, usa los asociados al item
  recargoIds?: string[]
  impuestoIds?: string[]
}
```

Respuesta:

```
{
  lineas: [{
    itemId, cantidad, precioUnitario,
    subtotalNeto, descuentoAplicado, recargoAplicado, impuestoAplicado, totalLinea,
    trazas: { descuentos:[{id,nombre,monto}], recargos:[...], impuestos:[{id,nombre,tasa,monto}] }
  }],
  totales: { subtotalNeto, totalDescuentos, totalRecargos, totalImpuestos, totalFinal },
  trazasVenta: { descuentos:[...], recargos:[...] }   // reglas a nivel venta
}
```

### Algoritmo (núcleo del servicio)

Helper de redondeo: clonar Decimal con `precision`/`rounding` derivados de
`escalaCalculo` + `modoRedondeo` (`HALF_UP→ROUND_HALF_UP`, `HALF_EVEN→ROUND_HALF_EVEN`,
`FLOOR→ROUND_FLOOR`, `CEIL→ROUND_CEIL`). Redondear el resultado de cada paso a
`escalaCalculo`.

**Por línea:**
1. Resolver `precioUnitario` (override o `precioBase`).
2. **Neto:** si `precioIncluyeImpuesto`, desbrutear:
   `netoUnitario = bruto / (1 + Σ tasasImpuestos)`; si no, `netoUnitario = bruto`.
   `subtotalNeto = netoUnitario × cantidad`.
3. Recorrer la **fórmula** (`paso 1,2,3`) sobre un acumulador `acc = subtotalNeto`:
   - `descuentos`: por cada regla asociada → calcular monto; base de cálculo del % es
     `subtotalNeto` si `calculoDescuentos='base'`, o `acc` si `'compuesto'`. `acc -= monto`.
   - `recargos`: ídem con `calculoRecargos`. `acc += monto`.
   - `impuestos`: tasa sobre `acc` (base imponible = neto tras descuentos/recargos).
     `acc += monto`. (Impuestos no tienen flag base/compuesto.)
4. `totalLinea = acc`. Acumular montos por tipo en las trazas.

**Evaluación de cada regla** (branch por `tipos_regla.codigo` / `modo`):
- **Plano**: `modo='porcentaje'` → `base × valor` (valor ya en decimal, p.ej. 0.10);
  `modo='monto_fijo'` → `valor` aplicado a la línea.
- **Tramos** (`por_mayor`, `por_monto_venta`): elegir el tramo cuyo `minimo` es el mayor
  `≤` magnitud aplicable (`cantidad` para `por_mayor`, monto base para `por_monto_venta`);
  usar el `valor` del tramo según `modo`. Sin tramo aplicable → monto 0.
- **Método de pago** (`metodo_pago`, `recargo_metodo_pago`): aplica solo si
  `metodoPagoId ∈ regla.metodoPagoIds`; si no, monto 0.
- **Diferidas** (`pronto_pago`, `mora`, `promocional` por fecha/vencimiento): se ignoran
  en esta fase (monto 0) — documentar con comentario.

**A nivel venta:** tras calcular todas las líneas, aplicar `descuentosVentaIds` /
`recargosVentaIds` sobre `Σ subtotalNeto` (o sobre el total según corresponda),
respetando los mismos flags y la fórmula; agregar a `totales` y `trazasVenta`.

### Decisiones de implementación
- **`monto_fijo`** se aplica **por línea** (no por unidad). Los porcentajes son
  invariantes de escala. Documentar en el código.
- **Selección de reglas:** por defecto se aplican las **asociadas al item**; si la línea
  trae `descuentoIds`/`recargoIds`/`impuestoIds`, esos **reemplazan** (override) a las
  asociadas.
- **Redondeo final:** cada paso redondea a `escalaCalculo`; los totales devueltos quedan a
  esa escala (ventas decidirá la escala de la moneda oficial al persistir).
- Validar que ítems y reglas pertenezcan al `tenantId` del token (los `findAll`/`findOne`
  ya filtran por tenant → un id ajeno simplemente no aparece y se trata como inválido →
  `BadRequestException`).

## Frontend

Mínimo en esta fase (no hay UI de ventas todavía):
- `frontend/app/composables/useCalculoPrecios.ts` — wrapper con `$fetch` a
  `POST /calculo-precios/calcular` (usa `useRuntimeConfig().public` para la base URL),
  listo para que el carrito del POS lo consuma luego.
- Sin página nueva. La integración visual va con el módulo de ventas.

## Verification

- [ ] `cd backend && npm test` — `calculo-precios.service.spec.ts` cubre:
  - neto con/ sin `precio_incluye_impuesto` (1 y varios impuestos)
  - descuento `base` vs `compuesto`; recargo `base` vs `compuesto`
  - orden de fórmula alterado (p.ej. impuestos antes que recargos)
  - tramos por cantidad y por monto (incl. sin tramo aplicable)
  - filtro por método de pago (aplica / no aplica)
  - override de reglas por línea vs asociadas al item
  - reglas a nivel venta sobre el total
  - redondeo según `escala_calculo` + `modo_redondeo`
  - reglas diferidas (vencimiento/fecha) → monto 0
- [ ] `cd backend && npm run lint`
- [ ] `docker-compose up` y probar el endpoint vía Swagger (`3000/api/docs`):
  `POST /calculo-precios/calcular` con un item real del seed → verificar desglose.
- [ ] Cruzar un caso a mano con Decimal para confirmar el total.

## Documentación viva (en el mismo cambio)
- [ ] `docs/features/motor-calculo-precios.md` (desde TEMPLATE) + link en `docs/README.md`
- [ ] Tabla "Estado actual" de `CLAUDE.md` + `docs/MIGRACION-FUNCIONALIDADES.md`:
      "Motor de cálculo de precios" → ✅ Implementado
- [ ] `docs/patterns/backend.md` si surge un patrón nuevo (servicio de cálculo puro)
- [ ] ADR si se formaliza alguna decisión (p.ej. `monto_fijo` por línea, reglas diferidas)

## Decisions / Open questions
- **Resuelto:** alcance standalone; reglas plano+tramos+método de pago; nivel línea+venta
  (confirmado por el usuario).
- **A confirmar durante implementación:** base de `por_monto_venta` a nivel línea
  (subtotal de la línea) vs solo a nivel venta (total). Default propuesto: evaluable en
  ambos niveles según dónde esté asociado/pasado.
- **A confirmar:** si varios descuentos del mismo item deben sumarse o si hay precedencia.
  Default propuesto: se suman (cada uno aporta su monto en el paso `descuentos`).
