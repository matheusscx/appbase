# Descuentos y Recargos — Especificación de formularios

El formulario se adapta dinámicamente según el tipo seleccionado.
Cada tipo define qué campos aparecen y si el modo (porcentaje / monto fijo) es libre o está impuesto por el tipo.

**Modo libre** — el usuario elige entre porcentaje y monto fijo.
**Modo fijo** — el tipo impone el modo; no se muestra selector.

---

## Campo global (ambas clases)

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Nombre | Sí | Texto libre. Validación async de duplicado por tenant. |

---

## 1. Descuentos

### Catálogo de tipos

| Código | Nombre | Modo |
|--------|--------|------|
| `METODO_PAGO`    | Descuento por método de pago | Libre |
| `PRONTO_PAGO`    | Pronto pago                  | Fijo: porcentaje |
| `POR_MAYOR`      | Por mayor                    | Libre |
| `POR_MONTO_VENTA`| Por monto de venta           | Libre |
| `PROMOCIONAL`    | Promocional                  | Libre |

---

### METODO_PAGO — Descuento por método de pago

Aplica cuando el cliente paga con uno o más métodos de pago seleccionados (efectivo, débito, transferencia, etc.).

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Métodos de pago | Sí | Multi-select del catálogo de métodos del tenant. Mínimo 1. |
| Modo | Sí | Porcentaje o monto fijo. |
| Valor | Sí | Muestra `%` si modo = porcentaje. |

---

### PRONTO_PAGO — Pronto pago

Aplica cuando el cliente paga antes del vencimiento de la factura dentro del plazo indicado.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Días antes del vencimiento | Sí | Numérico entero positivo. |
| Valor | Sí | Siempre porcentaje. No se muestra selector de modo. |

---

### POR_MAYOR — Por mayor

Aplica escalonadamente según la cantidad de unidades del ítem. El último tramo cubre todo lo que supere su mínimo.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Modo | Sí | Porcentaje o monto fijo. Aplica igual a todos los tramos. |
| Tabla de tramos | Sí | Filas de (cantidad mínima → valor). El usuario agrega y elimina filas. |

---

### POR_MONTO_VENTA — Por monto de venta

Aplica escalonadamente según el monto total de la venta. El último tramo cubre todo lo que supere su mínimo. Las fechas son opcionales: sin fechas aplica siempre; con fechas solo dentro del período definido.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Modo | Sí | Porcentaje o monto fijo. Aplica igual a todos los tramos. |
| Tabla de tramos | Sí | Filas de (monto mínimo → valor). El usuario agrega y elimina filas. |
| Fecha inicio | No | Si se define, el descuento solo aplica a partir de esta fecha. |
| Fecha fin | No | Si se define, el descuento deja de aplicar después de esta fecha. |

---

### PROMOCIONAL — Promocional

Descuento simple para campañas con período definido. Las fechas son obligatorias — es lo que distingue este tipo de un descuento permanente.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Modo | Sí | Porcentaje o monto fijo. |
| Valor | Sí | Muestra `%` si modo = porcentaje. |
| Fecha inicio | Sí | Inicio del período de la campaña. |
| Fecha fin | Sí | Fin del período de la campaña. |

---

## 2. Recargos

### Catálogo de tipos

| Código | Nombre | Modo |
|--------|--------|------|
| `GENERAL`             | Recargo general            | Libre |
| `MORA`                | Mora por atraso            | Libre |
| `RECARGO_METODO_PAGO` | Recargo por método de pago | Libre |
| `INTERES_SIMPLE`      | Interés simple             | Fijo: porcentaje |
| `INTERES_COMPUESTO`   | Interés compuesto          | Fijo: porcentaje |

---

### GENERAL — Recargo general

Recargo plano sin condición de tiempo. Se asigna directamente a un ítem o venta y aplica siempre que esté activo.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Modo | Sí | Porcentaje o monto fijo. |
| Valor | Sí | Muestra `%` si modo = porcentaje. |

---

### MORA — Mora por atraso

Recargo plano que se activa cuando la factura supera el plazo de vencimiento por los días indicados.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Días después del vencimiento | Sí | Numérico entero, rango 0–365. |
| Modo | Sí | Porcentaje o monto fijo. |
| Valor | Sí | Muestra `%` si modo = porcentaje. |

---

### RECARGO_METODO_PAGO — Recargo por método de pago

Recargo que aplica cuando el cliente paga con uno o más métodos de pago seleccionados. Típico en pagos con tarjeta de crédito o en cuotas.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Métodos de pago | Sí | Multi-select del catálogo de métodos del tenant. Mínimo 1. |
| Modo | Sí | Porcentaje o monto fijo. |
| Valor | Sí | Muestra `%` si modo = porcentaje. |

---

### INTERES_SIMPLE — Interés simple

Interés que se acumula linealmente sobre el saldo vencido: `saldo × tasa × meses`.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Tasa mensual | Sí | Siempre porcentaje. No se muestra selector de modo. |

---

### INTERES_COMPUESTO — Interés compuesto

Interés que se acumula de forma exponencial sobre el saldo vencido: `saldo × (1 + tasa)^meses`.

| Campo | Requerido | Notas |
|-------|-----------|-------|
| Tasa mensual | Sí | Siempre porcentaje. No se muestra selector de modo. |
