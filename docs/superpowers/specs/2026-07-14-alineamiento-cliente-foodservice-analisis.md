# Análisis de alineamiento — Requerimiento cliente food-service

**Status**: Analysis / Draft
**Date**: 2026-07-14
**Owner**: Cesar Matheus
**Fuente**: especificación enviada por cliente potencial vía email (documento original no versionado; su contenido quedó cruzado punto por punto en este análisis)

> Documento de **análisis de factibilidad**, no un plan ejecutable. Cruza cada
> requerimiento del cliente contra el estado real del sistema (ver `docs/ESTADO.md`
> y las entidades reales) y define el alcance recortado. Los pasos ejecutables, si se
> aprueba, van en `docs/superpowers/plans/`.

## Contexto

Cliente potencial de **food-service** (restaurante/cafetería que vende recetas).
El requerimiento describe un POS de inventario multitenant híbrido con foco en:
recetas, control de stock de ingredientes, mermas y costos. El caso de uso principal
confirmado es food-service, por lo que **el núcleo de recetas/costos es la prioridad**
y los features de retail puro (catálogo global, trazabilidad IMEI) se despriorizan.

## Veredicto por requerimiento

Leyenda: ✅ ya cubierto · 🟡 parcial · 🔴 nuevo · 💡 idea a evaluar

| # | Requerimiento | Estado real | Veredicto |
|---|---|---|---|
| 1.1 | Catálogo Global (`productos_globales`, EAN/UPC compartido) | No existe; catálogos aislados por tenant | 💡 Evaluar / fuera de alcance prioritario |
| 1.2 | Catálogo del comercio (`productos_tenant`) | Ya existe: `items` + `item_producto` (impuestos por item, flag stock vía `tipo='producto'`, modo serie). Falta solo la capa de vínculo al global | 🟡 Cubierto salvo link global |
| 2.1 | Trazabilidad unitaria IMEI/serie | Modelo `serie` completo (`item_unidad`, estados). Falta: escaneo obligatorio de serie en la venta del POS + validación de serie contra el documento original en devolución | 🟡 Parcial |
| 2.2 | Kardex inmutable que congela costo y precio del momento | Kardex auditable/inmutable existe, pero **no guarda `costo_unitario`/`precio_venta` por movimiento y los productos no tienen campo `costo`** | 🔴 Gap de fondo (costo) |
| 3.1 | Recetas + criticidad de ingredientes (bloqueante / no bloqueante) | No existe; no hay productos compuestos | 🔴 Nuevo — PRIORIDAD |
| 3.2 | Motor de conversión de unidades (compra en Kg, receta en g) | No existe; `unidad_medida` es **texto libre sin factor** | 🔴 Nuevo — PRIORIDAD |
| 4.1 | Mermas tipificadas + impacto financiero | `motivo='merma'` existe como razón de kardex, pero sin módulo dedicado, sin tipificación (vencimiento/deterioro/robo) ni "costo de venta perdido" | 🟡 Base mínima, falta lo relevante |
| 4.2 | Simulador de impacto de costos (pre-confirmación) | No existe; depende de recetas + costo | 🔴 Nuevo |
| 5.1 | Multi-impuestos Chile (IVA/exento/ILA) + desglose en POS | Aritmética cubierta (impuestos parametrizables N:M por item; el motor desglosa neto/IVA). **Falta modelar la naturaleza del impuesto y el monto exento** (ver detalle abajo) | 🟡 Cubierto en aritmética, falta modelar naturaleza + exento |
| 5.2 | POS offline-first (caché local, cola de sync, folios diferidos) | No existe | 🔴 Nuevo — esfuerzo alto |

## Ya resuelto — eliminar del alcance a construir

- **1.2 catálogo del comercio**: ya existe (`items`/`item_producto`). Solo queda decidir el link global.
- **5.1 desglose de impuestos en POS**: el motor de cálculo de precios ya desglosa neto/impuestos; es afinamiento, no construcción.
- **Parte de 2.1**: el modelo de series ya está; no se construye desde cero.

## Núcleo prioritario — cluster food-service / control de costos

Los puntos de recetas/stock de ingredientes **no son independientes**: forman una cadena
de dependencias. Orden natural de construcción:

1. **Costo por producto** — campo `costo` + congelarlo en el kardex (resuelve 2.2). Cimiento: sin costo no hay márgenes, ni mermas valorizadas, ni simulador.
2. **Motor de conversión de unidades** (3.2) — `unidad_medida` pasa de texto libre a unidad con factor de conversión.
3. **Recetas + criticidad** (3.1) — productos compuestos que descuentan ingredientes y bloquean/alertan según stock.
4. **Mermas valorizadas** (4.1) — se apoya en (1) y (2).
5. **Simulador de costos** (4.2) — se apoya en (1) y (3).

Este paquete de 5 piezas encadenadas es el corazón del requerimiento del cliente
(hamburguesa: pan/carne bloqueantes, queso/salsa no bloqueantes; 150 g → 0.15 Kg).

### Personalización de ingredientes en el pedido (idea capturada, NO en alcance de la pieza 3)

Durante el diseño de recetas (2026-07-15) surgió un caso real de food-service: el cliente
final puede pedir la receta **sin** un ingrediente aunque sea bloqueante (ej. "sin pan") o
**con** ingredientes extra no definidos en la receta base. La pieza 3 (recetas + criticidad)
solo cubre la **receta estándar** — la plantilla de ingredientes y su descuento de stock al
vender tal cual está definida. La personalización por pedido (agregar/quitar ingredientes al
tomar la orden, con recálculo de costo/stock de esa venta puntual) es una **capacidad
separada y de mayor alcance** (toca la captura de la línea de venta en el POS, no solo el
motor de recetas) — 💡 idea a evaluar como fase posterior, no bloqueante del núcleo.

## Catálogo Global (1.1) — evaluación de factibilidad

Factibilidad técnica **alta**, pero peso arquitectónico y **sin aporte al caso prioritario**:

- **A favor**: onboarding rápido (escanear EAN autocompleta nombre/marca), datos limpios, base para reportes cross-tenant a futuro.
- **En contra**: es data cross-tenant → rompe el aislamiento estricto que hoy es regla dura del sistema; requiere curaduría/gobernanza del maestro (quién lo puebla y mantiene); **un restaurante casi no lo usa** (insumos y platos propios, sin EAN).
- **Recomendación**: fuera del alcance prioritario. Es un feature de almacén/minimarket, no de food-service. Si entra, como fase separada y opt-in, no bloqueante del núcleo de recetas.

## Multi-impuestos / exento (5.1) — precisión

Cómo funciona hoy: la tabla `impuestos` solo tiene `nombre` + `porcentaje` + `activo`
(**sin campo de clase/naturaleza**); `item_impuestos` es N:M (0..N impuestos por item);
el motor de precios, si la línea no tiene impuestos, deja `subtotalNeto = total` e
`impuestos = 0`. Es decir, hoy **"exento = no le asignas impuesto"** da los totales
correctos, pero es insuficiente en lo fiscal por tres razones:

1. **Ambigüedad.** "Exento por ley" y "afecto pero sin IVA asignado" quedan idénticos en
   BD (ambos sin fila en `item_impuestos`). No se pueden auditar ni distinguir. "Exento"
   debe ser un estado **explícito**, no la ausencia de dato.
2. **Monto Exento (MntExe).** Un DTE con líneas mixtas exige reportar en baldes separados
   `MntNeto` (neto afecto), `MntExe` (monto exento) e `IVA`. Hoy todo lo sin impuesto se
   mete en `subtotalNeto`, sin separar neto afecto de monto exento → no se podrá poblar
   `MntExe` al emitir.
3. **Adicionales (ILA).** El ILA convive con el IVA (aplican ambos). El modelo ya permite
   asignar dos impuestos y el motor los suma sobre la base, pero **sin `tipo` no se sabe
   cuál es IVA y cuál adicional** para desglosarlos por separado en el documento.

Fix propuesto (esfuerzo bajo, prerrequisito de la emisión electrónica):
- Campo `clase`/`naturaleza` en `impuestos`: `afecto_iva` | `exento` | `adicional`.
- Perfil fiscal explícito en el item → "exento" pasa a ser un estado, no la falta de fila.
- El motor pasa a **bucketizar**: neto afecto / monto exento / IVA / adicionales.

Contexto: **hoy no hay emisión SII** (la impresión térmica es física vía QZ Tray, sin
DTE). El bucketizado anterior es el prerrequisito para cuando la emisión electrónica entre
al alcance. Ver "Preparación para SII" abajo.

## Preparación para SII

La emisión al SII entra a futuro, no ahora; se diseña todo compatible sin integrarlo. Esto
se elevó a **regla transversal del sistema** — ver **[ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md)**
y el bullet "Fiscal (SII)" en `CLAUDE.md`. Resumen: capturar y congelar el hecho fiscal en
la transacción (naturaleza del impuesto explícita, snapshot fiscal inmutable, tipo de
documento, datos de receptor); diferir lo que solo transmite/formatea (DTE, folios/CAF,
firma); no sobre-construir infraestructura DTE (YAGNI).

## Offline-first (5.2) — diferir

Esfuerzo desproporcionado (PWA, caché indexada, cola de sync, emisión de folios diferida
con reconciliación). **Diferir explícitamente** a fase posterior y sacar de esta
negociación, salvo que el cliente lo declare bloqueante.

## Alcance propuesto

**En alcance (prioridad):** cluster 1→5 de recetas/costos (costo, conversión, recetas, mermas, simulador).

**Diferido / opcional:** trazabilidad de serie en POS (2.1) — solo si el cliente vende también tecnología.

**Fuera de alcance:** catálogo global (1.1), offline-first (5.2).

## Preguntas abiertas para el cliente

- ¿Maneja también productos con IMEI/serie (tecnología), o es 100% food-service? Define si 2.1 entra.
- ¿El costo del insumo es único (último costo) o requiere costeo por lote/promedio? Afecta el diseño de 2.2 y 4.1.
- ¿La conversión de unidades es libre por tenant o basta una matriz estándar (masa/volumen/unidad)? Afecta 3.2.
- ~~¿Emisión electrónica SII en alcance?~~ **Resuelto: SII entra a futuro, no ahora. Diseñar compatible sin integrar (ver "Preparación para SII").**
