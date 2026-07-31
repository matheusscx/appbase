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
      "recargoIds": [],                   // opcional (reemplaza los del ítem)
      "impuestoIds": []                   // opcional (reemplaza los ADICIONALES del
                                           // ítem, tipo='otro'; el IVA no se puede
                                           // pisar ni quitar — 400 si trae un id
                                           // tipo='iva', ver ADR-018)
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
    },
    "advertencias": [{ "titulo": "Descuento \"X\"", "detalle": "no se aplicó completo porque superaba el monto disponible" }]
  }],
  "totales": {
    "subtotalNeto", "totalDescuentos", "totalRecargos",
    "totalImpuestos", "totalFinal"
  },
  "trazasVenta": { "descuentos": [...], "recargos": [...] },
  "advertenciasVenta": [{ "titulo": "…", "detalle": "…" }],
  "advertencias": [{ "titulo": "…", "detalle": "…" }]
}
```

**Advertencias.** El motor emite avisos que **no frenan el cálculo**: hoy, cuando un
descuento supera el monto disponible, se topea y se avisa. Cada advertencia viaja
partida en `{ titulo, detalle }` (`AdvertenciaPrecio` en el motor) en vez de una
frase única: el carrito es angosto y una sola línea de texto con todo el mensaje
ocupaba varios renglones, así que `titulo` (ej. `Descuento "X"`) se muestra en la
línea y `detalle` (ej. `no se aplicó completo porque superaba el monto disponible`,
sin nombrar montos: el aplicado ya viaja en la traza, que el front formatea) queda
en un tooltip. El resultado los expone en dos granularidades porque se muestran en
lugares distintos: `ResultadoLinea.advertencias` va bajo la línea que lo produjo, y
`advertenciasVenta` —solo los descuentos a nivel venta, que no pertenecen a ninguna
línea— va junto al total. `advertencias` es el aplanado de ambos. La razón de
separarlos en vez de que el consumidor reste por igualdad: dos advertencias con el
mismo `titulo`+`detalle` son alcanzables (dos descuentos distintos topeados al mismo
monto producen el mismo mensaje).

Al persistir la venta, `ventas.service.ts` vuelve a componer cada advertencia en una
sola frase (`` `${titulo}: ${detalle}` ``) para el campo `advertencias: string[]` de
la respuesta de la venta —el mismo formato de siempre, que consumen los toasts del
POS—. Ese contrato no cambia; la partición en `titulo`/`detalle` solo viaja por el
motor y la previsualización del carrito.

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
descuento/recargo/impuesto en la línea **reemplazan** a los asociados al ítem
(override) — con una excepción: para impuestos, el override solo alcanza a los
**adicionales** (`tipo='otro'`). El IVA nunca sale de `impuestoIds`, ni del ítem
ni de la línea — lo deriva el motor de `clasificacion_tributaria` y no se puede
pisar ni quitar por payload (400 si llega un id `tipo='iva'` explícito, ver
[ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)).

**Piso en cero del descuento** (decisión del owner, 2026-07-28). **Ninguna regla
puede dejar el total bajo cero** — un `precio_base` negativo sí puede, y eso es
otro pendiente. Sin tope, un `monto_fijo` de 500 sobre un ítem de 100
dejaba `totalLinea: -400` y el tenant terminaba pagándole al cliente. Cuatro
precisiones que hacen a la regla:

- Se topea **regla por regla, al aplicarla**, no al final sobre el total. Así la
  traza registra lo que realmente se descontó y el comprobante cuadra
  (`subtotalNeto − totalDescuentos` sigue dando el total). Con tres descuentos
  del 40% en modo `base` sobre 100, la traza queda 40 / 40 / 20.
- Aplica **también a los descuentos a nivel venta**, y ahí el tope se mide
  contra el **total real** (`Σ totalLinea`, ya con descuentos e impuestos de
  línea adentro), **no** contra el neto agregado. El neto sigue siendo la base de
  los `%` —esa es la semántica de las reglas a nivel venta—, pero la plata
  disponible para topear es otra magnitud. Confundirlas dejaba ventas en negativo
  sin advertencia **y** recortaba descuentos sanos cobrando de más; lo detectó la
  revisión independiente porque el primer test usaba una línea pelada, el único
  caso donde las dos magnitudes coinciden.
- **No frena la venta**: emite una advertencia, igual que un ingrediente no
  bloqueante sin stock. Viaja en `advertencias`/`advertenciasVenta`, tanto del
  cálculo como de la respuesta de la venta. La previsualización del carrito
  (POS, Salones, Tienda) ya la muestra **antes** de cobrar — ver "Frontend"
  más abajo. Los caminos de tienda online y suscripciones siguen
  descartándola al crear el pedido/la suscripción (ver
  `docs/agent/pendientes.md`).

- **Ninguna regla aporta una magnitud negativa.** El signo lo pone el tipo de
  regla, nunca el valor calculado. Hace falta porque el acumulado que sirve de
  base en modo `compuesto` **sí** puede quedar negativo a nivel venta (arranca en
  el neto agregado mientras la plata disponible es `Σ totalLinea`), y un `%`
  sobre esa base producía un "recargo" que restaba y un "descuento" que le
  cobraba al cliente, ambos impresos así en la traza. Un fuzz de 40.000 ventas
  con configuración válida encontró el caso en el 0,78%.

Los recargos **no tienen tope superior** —subir el total no tiene el problema
que el piso resuelve— pero sí el piso en cero de arriba: un recargo nunca resta.

---

## Frontend

- **Composable**: `app/composables/useCalculoPrecios.ts` — `calcular(input)` con
  `useApiFetch` a `POST /calculo-precios/calcular`. El tipo `AdvertenciaPrecio`
  (`{ titulo, detalle }`) espeja al del motor; el tipo `ResultadoLinea` incluye
  `advertencias: AdvertenciaPrecio[]` y el tipo `ResultadoVenta` incluye
  `advertencias` + `advertenciasVenta`, ambos `AdvertenciaPrecio[]`.
- **Previsualización del carrito** (POS `components/ventas/CarritoPanel.vue`,
  Salones `pages/salones/index.vue`, Tienda `components/tienda/CarritoOnline.vue`)
  — los tres renderizan el componente compartido `components/AdvertenciasPrecio.vue`:
  por línea con `resultado.lineas[index].advertencias`, junto al total con
  `resultado.advertenciasVenta`. Por cada advertencia el componente muestra el
  ícono de warning + el `titulo` en una sola línea, con un ícono informativo cuyo
  tooltip (alcanzable con teclado, no solo con hover) revela el `detalle`. **El
  cruce línea↔resultado es por índice, nunca por `itemId`**: el mismo ítem puede
  aparecer en dos líneas del carrito con personalizaciones distintas (por
  ejemplo, dos porciones de la misma receta con extras diferentes), y el
  `itemId` no las distingue.
- ⚠️ **`advertenciasVenta` hoy no se puede ver por la UI.** El render junto al
  total está construido y correcto, pero está inerte: depende de que el request
  mande `descuentosVentaIds`/`recargosVentaIds`, y ningún archivo de
  `frontend/app` los arma ni los ofrece al usuario — los descuentos/recargos a
  nivel venta son superficie de API sin pantalla. No es un defecto, es una
  limitación conocida hasta que exista esa UI (ver `docs/agent/pendientes.md`).

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

### E2E (Backend)

```bash
./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json test/calculo-precios.e2e-spec.ts
```

- `calculo-precios.e2e-spec.ts` — descuento `monto_fijo` que supera el monto
  disponible ("Promo fija $5.000", seed): confirma que la advertencia de tope
  aparece en `lineas[].advertencias` cuando el descuento va por línea y en
  `advertenciasVenta` cuando va a nivel venta, sin mezclarse entre sí.

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
