# Spec: un monto calculado que no cabe en `NUMERIC(18,4)` es 400, no 500

**Date**: 2026-10-08 · **Owner**: sesión del guard del motor, lanzada por la orquestadora ·
**Autorizado por el owner** el 2026-10-08 (*"solo el guard técnico, lanzalo"*; sin tope de
negocio).

## Qué pasa hoy (medido por HTTP el 2026-10-08, base nueva)

- Servicio en CLP, `precioBase` 99.999.999.999.999: `/calcular` → 201 con `totalFinal`
  118.999.999.999.999; `POST /ventas` → **500** (`22003 numeric field overflow`).
- USD con `valorDelDia` 0,5 (la API acepta cualquier tasa), receta en USD con `precioBase`
  99.999.999.999.999 + un extra de 1: `/calcular` → 201 con total 50.000.000.000.000;
  `POST /ventas` → **500**. Lo único que no cabe es `venta_detalles.precio_unitario_origen`
  (100.000.000.000.000,0000), que el motor no ve: lo arma `ventas.service`.

## La regla

Un solo guard, en `CalculoPreciosService.calcular`, **después** de `calcularVenta` y antes
de devolver: si algún monto que la venta va a persistir no cabe en su columna, 400 en
lenguaje de local. Solo mira y rechaza: ningún cálculo, orden ni cuantización cambia, y
todo lo que hoy se guarda sigue dando exactamente el mismo resultado.

**Qué es "caber".** Postgres, al escribir en `NUMERIC(p, s)`, primero redondea a `s`
decimales (mitad hacia afuera del cero) y después exige `|x| < 10^(p−s)`. Con `(18, 4)`:
`99.999.999.999.999,9999` cabe; `99.999.999.999.999,99995` redondea a `10^14` y **no**
cabe. El guard replica exactamente eso con `ROUND_HALF_UP` de Decimal.js, que también
redondea el empate hacia afuera del cero. El techo se deriva de `(18, 4)` y un test fija
que todas las columnas que revisa sean de verdad `(18, 4)`.

## Qué revisa: cada columna de plata que la venta escribe desde el motor

| Tabla | Columna | Sale de |
|---|---|---|
| `ventas` | `total_bruto`, `total_descuentos`, `total_recargos`, `total_impuestos`, `total_final` | `totales.*` |
| `ventas` | `base_ventas_total_final` | `= totales.totalFinal` |
| `ventas` | `base_ventas_sin_impuestos` | `totalFinal − totalImpuestos`, calculado igual que en `ventas.service` |
| `venta_detalles` | `precio_unitario`, `subtotal`, `descuento_aplicado`, `recargo_aplicado`, `ajuste_venta`, `impuesto_aplicado`, `total_linea` | `lineas[i].*` |
| `venta_detalles` | `precio_unitario_origen` | **canal interno nuevo** `precioUnitarioOrigenResuelto` (venta) o el origen que la preview ya arma |
| `ventas_descuentos` | `valor_aplicado`, `valor_solicitado` | `trazas.descuentos[]` y `trazasVenta.descuentos[]` |
| `ventas_recargos` | `valor_aplicado` | `trazas.recargos[]` y `trazasVenta.recargos[]` |
| `ventas_impuestos` | `valor_aplicado` | `trazas.impuestos[]` |
| `ventas_promociones` | `monto`, `valor_efectivo` | `trazas.promociones[]` |

Quedan afuera, y por qué: `venta_documentos.monto` y sus baldes (un reparto no negativo de
`totalFinal`: caben si cabe el total, salvo a una unidad mínima del techo), `cantidad` (no es plata; la acota `MAX_UNIDADES_POR_VENTA`),
`tasa_cambio` (18,6, sale del catálogo de monedas), los `porcentaje_aplicado` (7,4, salen de
columnas de catálogo de la misma precisión o más angostas).

## Las puertas

Todas pasan por `calcular` antes de escribir nada:

| Puerta | Hoy | Con el guard |
|---|---|---|
| `POST /ventas` canal `fisico` (POS) | 500 | 400, sin escribir |
| `POST /ventas` canal `online` (el paso que persiste de la tienda demo) | 500 | 400, sin escribir |
| `POST /cuentas/:id/cerrar` (salón) | 500 | 400, sin escribir; la cuenta sigue abierta |
| `POST /calculo-precios/calcular` (preview, con o sin `cuentaId`) y `POST /online/checkout` | 201 con totales que no se pueden guardar | 400 |
| `POST /online/pagar` y `POST /suscripciones` | 400 por el umbral SII (inalcanzable en Chile) | 400 por el guard, antes del umbral; nunca llega al cobro |

Las notas de crédito no llaman al motor.

## El canal interno nuevo

`LineaCalculo.precioUnitarioOrigenResuelto`, hermano de `precioUnitarioResuelto`: fuera de
`LineaDto` (el pipe global con `forbidNonWhitelisted` rechaza un body que lo traiga), lo pone
solo `ventas.service`. La preview usa el origen que ya arma (`precioBase + precioExtraTotal`,
o `precioBase`). El motor no lo lee.

## Fuera de alcance (anotado en `pendientes.md`)

- **Caja** (§ 3, entrada propia): `POST /caja/:id/conteo` da 500 sin ninguna venta (saldo
  inicial al tope + un movimiento de $1), y con el guard puesto, con dos ventas que caben
  cada una. El guard del motor no lo cierra.
- **Línea de cuenta** (§ 3): `POST /cuentas/:id/lineas` da 500 al pedir con un precio al
  tope + un extra; no pasa por el motor.
- **`pasarela_orden.monto`** (§ 2): `NUMERIC(18,6)`, techo 10^12. Leído, no medido.
- **La preview no muestra el motivo de un 400 del motor** (§ 1): frontend.
