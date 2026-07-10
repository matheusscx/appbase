# Design: Reembolsos — visibilidad en ventas + Nota de Crédito interna elegible

- **Status:** Approved
- **Date:** 2026-07-10
- **Owner:** Cesar Matheus

## Problema

El reembolso de una orden de pasarela (`POST /pasarela/admin/ordenes/:id/reembolsos`)
vive completamente dentro del módulo pasarela: registra la transacción REFUND y el
estado de la orden, pero la venta vinculada y sus pagos no se enteran. Caso real:
se reembolsaron $1.100 de una venta online de $11.305 y el sistema sigue mostrando
$11.305 cobrados en ventas/pagos.

## Contexto de negocio

- El sistema **no emite documentos tributarios reales** (sin integración SII):
  boletas/facturas son registros internos (`tipos_documento_tributario` por país).
- Por lo tanto una **nota de crédito interna** es consistente con el modelo actual
  y mapea 1:1 al documento legal cuando exista facturación electrónica.
- En Chile, la NC anula o corrige boletas y facturas (total o parcial); el
  documento original nunca se modifica.

## Decisiones aprobadas

1. **Visibilidad (siempre):** el detalle de la venta muestra una sección
   "Reembolsos" leída de la(s) orden(es) de pasarela vinculadas
   (`pasarela_ordenes.venta_id`), y el listado de ventas muestra un badge
   **derivado** "Reembolsada parcial/total". No es un estado nuevo en BD.
2. **NC elegible y flexible:** el modal de reembolso agrega dos secciones
   opcionales e **independientes** (visibles solo si la orden tiene venta):
   - Checkbox "Generar nota de crédito" — apagado por defecto.
   - "Devolver a inventario": líneas de la venta original con cantidad a devolver.
   Se puede reembolsar sin NC ni stock, con solo una, o con ambas.
3. **La NC es un documento interno:** venta con `tipo_documento` = "Nota de
   Crédito" (código 61 Chile, nuevo en seed, `activo: false` para que no aparezca
   en el POS), `venta_referencia_id` → venta original, **totales copiados del
   monto reembolsado** (sin motor de precios), estado `pagada`, caja/canal/moneda
   de la venta original. Líneas solo si se eligieron ítems (una NC sin líneas es
   válida). Sin registros en `pagos`.
4. **La venta original SIEMPRE queda `pagada`**, incluso con reembolso total.
   `pagada_parcial` NO se usa: significa cuenta por cobrar, no devolución.
5. **Devolución de stock v1:** solo ítems `modo_inventario = 'cantidad'`;
   serie/lote y servicios quedan deshabilitados (la devolución serializada/por
   lote requiere elegir unidades y es fase posterior). Movimientos
   `entrada / motivo='devolucion'` ligados a la NC si existe, o a la venta
   original si no se generó NC.
6. **Integración pasarela → ventas por registry** (patrón §13 de
   `docs/patterns/backend.md`): nuevo `ReembolsoCallbackRegistry` en pasarela;
   el módulo ventas registra su handler. Pasarela nunca importa ventas.
7. **Si la NC falla tras un reembolso aprobado, el reembolso NO se revierte**
   (la plata ya volvió por Transbank): la respuesta incluye `warning` y el error
   queda en logs. El hook corre **post-commit** de la transacción del reembolso
   (dispararlo dentro se auto-bloquea con el `FOR UPDATE` de la orden).
8. **Validaciones:** Σ(NCs de una venta) ≤ `total_final`; cantidad devuelta por
   ítem ≤ vendida − ya devuelta ("ya devuelta" = SUM de movimientos `devolucion`
   ligados a la venta original y sus NCs hijas).
9. **NCs en el listado de ventas:** aparecen como ventas normales con badge "NC";
   `resumen()` (KPIs) las excluye para no inflar el total facturado.
10. **Permisos:** se reutiliza `Pasarelas:Reembolsar` (la NC nace solo del flujo
    de reembolso; no hay endpoint independiente de NC en esta fase).
11. **Sin cruce monto ↔ líneas:** el monto de la NC se copia del reembolso; las
    líneas devueltas son informativas/de stock. No se valida que coincidan
    (flexibilidad pedida explícitamente).

## Fuera de alcance

- Emisión tributaria real (SII) y folios.
- Devolución de stock para modos `serie`/`lote`.
- Endpoint independiente para crear NC sin reembolso.
- Registro de egreso en el ledger de `pagos` (la trazabilidad monetaria queda en
  `pasarela_transacciones` + la NC).

## Plan de implementación

Ver `docs/superpowers/plans/2026-07-10-reembolso-nc-visibilidad.md`.
