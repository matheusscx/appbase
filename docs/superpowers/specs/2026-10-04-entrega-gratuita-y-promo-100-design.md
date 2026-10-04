# Spec: la entrega gratuita sin rebaja se ve, y la promo no regala

**Fecha:** 2026-10-04 · **Frente fiscal** (`CLAUDE.md`, ADR-010) · Entrada: `pendientes.md` § 6,
"Una entrega gratuita sin rebaja no deja documento, y un plato regalado con una promo del 100 % no
paga el IVA de la cortesía" (con las decisiones y su procedencia).

## Decisiones (owner y Sesión de esfuerzo máximo, 2026-10-04)

| # | Decisión | Quién |
|---|---|---|
| D1 | La venta de un producto de lista $0, sin rebaja, no paga IVA y **se ve**: deja una fila `nadie` por $0 | owner: *"No paga, pero se ve"* |
| D2 | Se hace con la fila `nadie` y no ampliando el filtro `?documento=sin_documento` | Sesión de esfuerzo máximo |
| D3 | La bolsa de $0 dentro de una compra sigue en la boleta a $0, sin IVA (Oficio 1.420/2010 aceptado como costo) | owner, misma pregunta |
| D4 | Una promo `porcentaje` con valor ≥ 1 se rechaza con 400 y manda a la cortesía; `nxm` no cambia | owner: *"Topar la promo bajo 100 %"* |
| D5 | Las promos al 100 % ya guardadas no se migran (sin datos productivos; el seed no trae ninguna) | Sesión de esfuerzo máximo |

## Diseño

### D1/D2 — `documentarVenta`

Orden nuevo de los cortes:

1. Total negativo → `[]` (sin cambio).
2. Sin tipo de documento (país sin boleta) → `[]` (sin cambio: AR/CO/MX en pausa).
3. **Total $0 y `totalBruto` ≤ 0** (la entrega gratuita) → **una fila `nadie` por $0**, sin tipo,
   sin baldes, sin pago, para todo canal y tipo (boleta, factura, online). Es la "constancia de que
   nadie lo emite" de ADR-028.
4. El resto sigue igual (incluida la venta de $0 por una rebaja → documento por $0).

**Corrección de paso, medida antes de escribirla:** hoy el corte es `totalBruto ≤ 0` **sin mirar
el total**, y `totalBruto` es el `subtotalNeto` del motor, **antes de los recargos**. Un recargo
de venta de monto fijo sobre un producto de $0 (un envío de $2.000) deja una venta **cobrada** con
`totalBruto = 0` y sin ningún documento: lo introdujo 47ca2df8 (antes cortaba por `total ≤ 0`).
La condición del punto 3 (total $0 **y** bruto ≤ 0) la devuelve a la regla de lo cobrado (E1). No
es una regla nueva: es la de ADR-028 para toda venta con total > 0.

**Lectores de `venta_documentos`:** se barren y se listan en el cierre los que ven la fila nueva.
La fila es de $0 y la venta no tiene pagos ni saldo, así que ninguna suma cambia. Lo que se mira
es la conducta que depende de que exista **alguna** fila (`hayDocumentos`, la devolución interna).

### D4 — promociones

- `PromocionesService.validarFormaSegunTipo` (el lugar donde ya vive la regla entre hermanos
  `tipo` ↔ valor) rechaza `tipo = 'porcentaje'` con `valorPorcentaje ≥ 1` (Decimal). Mensaje:
  una promoción de porcentaje tiene que ser menor al 100 %, y un regalo se registra como cortesía.
- **No se reusa `monto-regla.util.ts`**: su `validarMonto` es privado, también rechaza el 0 (otra
  regla, de descuentos y recargos) y su mensaje habla de la notación decimal. Cambiarlo movería
  descuentos y recargos (orquestadora: no tocarlo). Es la misma cota, con su propio porqué.
- **Cuándo se valida en un `PATCH`:** si el `PATCH` escribe `valorPorcentaje` o `tipo`, o la
  activa (`activo: true`), y sobre el estado resultante. Así una promo al 100 % ya guardada se
  puede **pausar** con el toggle (si no, un `PATCH { activo: false }` rebotaría y no habría cómo
  apagarla) y renombrar por API con un `PATCH { nombre }` suelto (el drawer reenvía valor y tipo,
  así que desde la pantalla hay que bajar el valor), pero no reactivar (el toggle manda solo
  `{ activo: true }`), y cambiar un `nxm` `1.0000` a `porcentaje` sin mandar el valor sí rebota.
- **Frontend:** el hint del campo deja de decir "1.00 = 100% (gratis)" para `porcentaje` (lo
  sigue diciendo para `nxm`). Sin validación gemela en el formulario: el 400 llega por el toast
  existente.

## Fuera de alcance

- El 99,99 %, dos descuentos que suman más del 100 % y el fijo con piso (costo aceptado de D4).
- El IVA de la entrega gratuita sobre su valor en plaza (costo aceptado de D1/D3).
- La cota inferior del porcentaje de una promo (0 o negativo): no es lo que se decidió acá.
