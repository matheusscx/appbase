# Feature: Motor de cálculo de precios

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-06-28

---

## Overview

### What is it?

Motor que, dada una lista de líneas (ítem + cantidad) y un contexto (método de
pago, reglas a nivel venta), devuelve el **desglose de precio**: neto →
descuentos → recargos → impuestos → total, con trazabilidad por regla. Es un
**servicio puro y stateless**: no persiste nada. Lo consumirán ventas, notas de
crédito y la previsualización de precio en el POS.

### Why does it exist?

Todos los insumos de precio ya estaban modelados (ítems, impuestos, descuentos,
recargos, fórmula y preferencias financieras por tenant) pero faltaba la pieza
que los combina aplicando la configuración del tenant de forma consistente y
auditable. El cálculo de dinero usa **Decimal.js** en todo (nunca `number`).

### Scope

- **Incluido**: cálculo por línea y por venta; reglas planas (% o monto fijo),
  tramos (`por_mayor` por cantidad, `por_monto_venta` por monto) y filtro por
  método de pago; desbruteo cuando `precio_incluye_impuesto`; `base` vs
  `compuesto`; orden de fórmula configurable; `escala_calculo` + `modo_redondeo`.
- **NO incluido (futuro)**: reglas por fecha (`promocional`) y por vencimiento
  (`mora`, `pronto_pago`) — requieren datos de venta/crédito aún inexistentes;
  condiciones `monto_minimo`/`cantidad_minima`/`customer`/`categoria`;
  persistencia de ventas; conversión a moneda oficial.

---

## API Endpoints

```
POST /calculo-precios/calcular
Authorization: Bearer <token>   (JwtAuthGuard + TenantGuard; tenant del token)

Request:
{
  "lineas": [
    { "itemId": "uuid", "cantidad": "2",
      "precioUnitario": "100",            // opcional (override de precio_base)
      "descuentoIds": ["uuid"],           // opcional (reemplaza los del ítem)
      "recargoIds": [], "impuestoIds": [] // opcionales
    }
  ],
  "metodoPagoId": "uuid",                 // opcional (habilita reglas metodo_pago)
  "descuentosVentaIds": ["uuid"],         // opcional (reglas a nivel venta)
  "recargosVentaIds": []
}

Response (201):
{
  "lineas": [{
    "itemId", "cantidad", "precioUnitario",
    "subtotalNeto", "descuentoAplicado", "recargoAplicado",
    "impuestoAplicado", "totalLinea",
    "trazas": {
      "descuentos": [{ "id", "nombre", "monto" }],
      "recargos":   [...],
      "impuestos":  [{ "id", "nombre", "tasa", "monto" }]
    }
  }],
  "totales": {
    "subtotalNeto", "totalDescuentos", "totalRecargos",
    "totalImpuestos", "totalFinal"
  },
  "trazasVenta": { "descuentos": [...], "recargos": [...] }
}
```

Todos los montos son strings con `escala_calculo` decimales.

---

## Backend

### Module & Services

- **Module**: `src/modules/calculo-precios/calculo-precios.module.ts`
  (importa `ItemsModule`, `ImpuestosModule`, `DescuentosModule`,
  `RecargosModule`, `TenantsModule` — **reúsa** sus servicios, no crea entidades).
- **Controller**: `calculo-precios.controller.ts` — `POST /calculo-precios/calcular`.
- **Service**: `calculo-precios.service.ts` — resuelve datos del tenant (ítems,
  catálogos de reglas, preferencias) y delega en el motor puro. **Carga el
  carrito entero en 2 queries fijas**, no una por línea:
  `ItemsService.cargarBasePorIds` (fila base + validación de pertenencia al
  tenant, 404 si falta) y `cargarReglasPorIds` (los ids de
  impuestos/descuentos/recargos de todos los ítems en un `UNION ALL`).
  `resolverLinea` no hace I/O.
- **Motor puro**: `calculo-precios.engine.ts` — `calcularVenta(VentaResuelta)`,
  sin BD ni NestJS; 100% testeable de forma aislada.

**Orden de las reglas (decisión abierta).** En modo `compuesto` cada regla se
aplica sobre el acumulado de la anterior, así que el orden dentro de la lista de
un ítem **cambia el total** cuando se mezclan `monto_fijo` y porcentaje (entre
porcentajes no conmuta el redondeo, pero la composición sí es multiplicativa).
Ese orden nunca estuvo definido y la tabla puente no guarda cuándo se asoció cada
regla.

Desde el batch de 2026-07-28 el orden es **determinista por id**
(`ORDER BY` en `cargarReglasPorIds`). No es el mismo que antes: `EXPLAIN` sobre
esas tablas da `Bitmap Heap Scan`, que reordena por página del heap, así que las
queries por ítem devolvían **orden de inserción**. El cambio por lo tanto
**puede** dar un total distinto en un tenant `compuesto` que mezcle modos en un
mismo ítem — hoy no existe ninguno (ambos tenants del seed están en `base`,
ningún ítem tiene dos reglas de la misma clase, y no hay datos productivos), pero
la garantía es "determinista", no "idéntico a antes". Qué orden debería tener es
una decisión de negocio abierta — ver
[`docs/agent/pendientes.md`](../agent/pendientes.md).

### DTOs

- `CalcularVentaDto` / `LineaDto` (`dto/calcular.dto.ts`) — validación con
  `class-validator`. `cantidad`/`precioUnitario` como `@IsNumberString`.

### Algoritmo (núcleo)

Por línea: neto unitario (desbruteo si incluye impuesto) × cantidad → recorrer la
fórmula (`paso 1,2,3`) sobre un acumulador. Descuentos restan, recargos suman;
el `%` se calcula sobre el neto (`base`) o sobre el acumulado (`compuesto`).
Impuestos sobre la base ya descontada/recargada (sin impuesto sobre impuesto).
Cada paso redondea con `escala_calculo` + `modo_redondeo`. Reglas a nivel venta
se aplican sobre el neto agregado.

**Decisiones**: `monto_fijo` se aplica por línea (no por unidad); las reglas
diferidas (`promocional`, `mora`, `pronto_pago`) devuelven monto 0; los ids de
regla en la línea **reemplazan** a los asociados al ítem (override).

---

## Frontend

- **Composable**: `app/composables/useCalculoPrecios.ts` — `calcular(input)` con
  `useApiFetch` a `POST /calculo-precios/calcular`. Sin páginas todavía; la
  integración visual va con el módulo de ventas.

---

## Testing

### Unit Tests (Backend)

```bash
cd backend && npm test            # incluye los specs del motor y del servicio
```

- `calculo-precios.engine.spec.ts` — neto/desbruteo, base vs compuesto, orden de
  fórmula, tramos, método de pago, reglas diferidas, redondeo, nivel venta.
- `calculo-precios.service.spec.ts` — resolución de reglas asociadas vs override,
  errores (regla inexistente, cantidad ≤ 0).

### Manual (Swagger)

1. `docker-compose up` → http://localhost:3000/api/docs
2. Autenticar con Bearer token.
3. `POST /calculo-precios/calcular` con un ítem del seed → verificar desglose.

---

## Related Features

- [features/preferencias-financieras.md](./preferencias-financieras.md) — fórmula, base/compuesto, redondeo
- [features/descuentos-recargos.md](./descuentos-recargos.md) — reglas, tramos, método de pago
- Catálogo de ítems e impuestos (insumos del motor)

---

## Notes

Primera pieza de la cadena de ventas. El módulo de ventas (por construir)
consumirá este motor para calcular y luego persistir `ventas` / `venta_detalles`
/ `ventas_descuentos`, y para convertir a moneda oficial.
