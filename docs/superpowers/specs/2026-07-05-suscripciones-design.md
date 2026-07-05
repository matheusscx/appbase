# Diseño: Suscripciones reales (tipo de item + alta con primer cobro)

- **Status:** Approved
- **Date:** 2026-07-05
- **Owner:** Cesar Matheus

## Contexto

La sección Suscripciones de la Tienda Online hoy es un mock frontend
(`useSuscripciones` en `localStorage`, con seed de ejemplos y acciones
pausar/reanudar/cancelar). Esta fase la convierte en funcionalidad real:

- El **admin del tenant** define qué se puede suscribir creando items de un
  nuevo tipo `suscripcion` en Configuración → Items (ej. "Mensualidad
  Gimnasio").
- El **usuario** se suscribe desde la Tienda: elige el item, su día de
  cobro y su tarjeta, y paga el primer período a través de la pasarela
  dummy. La suscripción nace `activa` junto con la venta del primer cobro.

## Decisiones validadas con el usuario

1. **Nuevo tipo de item `suscripcion`** — no se extiende `servicio`. Sigue
   el patrón base + extensión existente (`item_producto`, `item_servicio`),
   que fue diseñado explícitamente para escalar a suscripciones.
2. **Todo backend**: tanto el tipo de item como la tabla `suscripciones`
   con endpoints CRUD. Sin scheduler de cobro recurrente (fase futura):
   `proximo_cobro` queda registrado pero nadie lo ejecuta todavía.
3. **La frecuencia la define el admin en el item** (una sola: `semanal` o
   `mensual`). Si un tenant quiere ofrecer plan semanal y mensual del mismo
   servicio, crea dos items, cada uno con su precio por período. El precio
   del item ES el precio del período.
4. **El día lo elige el cliente al suscribirse**: día del mes (1–28) si el
   item es mensual; UN día de la semana si es semanal (sin multiselección).
5. **Primer cobro al suscribirse**: el alta pasa por la pasarela dummy y,
   al aprobar, se crea la venta online `pagada` del primer período y la
   suscripción `activa` en una sola transacción. Al rechazar no se crea
   nada (regla anti-basura del checkout existente).

## Modelo de datos

### Item tipo `suscripcion`

- `items.tipo` acepta `'suscripcion'` (hoy: `'producto' | 'servicio'`).
- Nueva tabla extensión `item_suscripcion`:

| Columna | Tipo | Notas |
|---|---|---|
| `item_id` | UUID PK/FK → `items` | `type: 'uuid'` explícito (ADR-004) |
| `frecuencia` | text | `'semanal' \| 'mensual'` |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | estándar del repo |

- Sin stock (como servicios): las ventas de items `suscripcion` **no**
  generan movimiento de inventario. Todo branch que hoy distingue
  `producto` vs `servicio` debe tratar `suscripcion` como servicio
  (sin kardex, sin validación de stock).

### Tabla `suscripciones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID FK | siempre del token |
| `usuario_id` | UUID FK | quién se suscribió, del token |
| `item_id` | UUID FK → `items` | debe ser tipo `suscripcion` del tenant |
| `frecuencia` | text | snapshot del item al suscribirse |
| `dia_mes` | smallint nullable | 1–28, solo si `frecuencia = 'mensual'` |
| `dia_semana` | smallint nullable | 0–6 (domingo–sábado), solo si `'semanal'` |
| `estado` | text | `'activa' \| 'pausada' \| 'cancelada'` |
| `proximo_cobro` | date | calculado al crear; informativo hasta que exista el scheduler |
| `tarjeta_marca` / `tarjeta_last4` | text nullable | snapshot visual — las tarjetas siguen siendo mock en `localStorage`, nunca se persiste PAN/CVV |
| `venta_inicial_id` | UUID FK → `ventas` | la venta del primer cobro |
| `creado_el` / `actualizado_el` / `eliminado_el` | timestamptz | estándar del repo |

### Cálculo de `proximo_cobro`

El primer período queda pagado al alta, así que `proximo_cobro` es la
primera ocurrencia del día elegido en el período siguiente:

- **Mensual**: el `dia_mes` del mes siguiente al alta.
- **Semanal**: el `dia_semana` de la semana siguiente al alta.

Aritmética con fechas simples (`date`), sin zona horaria compleja; 1–28
evita el problema de meses cortos.

## Backend

### Módulo `items` (cambios)

- Enum/validación de `tipo` acepta `'suscripcion'`; DTO de creación exige
  `frecuencia` cuando `tipo = 'suscripcion'` (y la rechaza en otros tipos).
- Entity `ItemSuscripcion` + join en las lecturas del catálogo (igual que
  producto/servicio).
- Seeder: 2–3 items suscripción de ejemplo (ej. "Mensualidad Gimnasio"
  mensual, "Clase semanal de yoga" semanal) con UUIDs fijos siguientes
  libres.

### Módulo `ventas` (cambios)

- Donde se descuenta stock por línea, tratar `suscripcion` igual que
  `servicio` (sin movimiento de inventario).

### Módulo nuevo `suscripciones`

Esqueleto estándar (`docs/patterns/backend.md`), guards
`JwtAuthGuard` + `TenantGuard`:

- `POST /suscripciones` — body: `itemId`, `diaMes` o `diaSemana` (según
  frecuencia del item), `pago: { metodoPagoId }`, `tarjeta?: { marca,
  last4 }`. En **una transacción**: valida el item (tenant, tipo, activo),
  crea la venta online `pagada` del primer período (reutiliza la lógica de
  `VentasService.crear` con canal `'online'`, caja virtual, pago completo),
  y crea la suscripción `activa` con `proximo_cobro` calculado y
  `venta_inicial_id`. Si algo falla, no queda nada creado.
- `GET /suscripciones` — las del usuario autenticado en el tenant activo
  (filtra `usuario_id` del token), con nombre y precio del item.
- `PATCH /suscripciones/:id` — cambio de estado: `pausar` (activa→pausada),
  `reanudar` (pausada→activa), `cancelar` (activa|pausada→cancelada).
  Transiciones inválidas → 400. Solo el dueño (`usuario_id` del token).
- Tests unitarios del service: alta feliz (venta + suscripción), item
  inexistente/de otro tenant/tipo incorrecto, día inválido para la
  frecuencia, transiciones de estado válidas e inválidas.

### RBAC

Reutiliza el módulo "Tienda Online" existente: `Leer` para ver
suscripciones, `Crear` para suscribirse. No se crea módulo RBAC nuevo.

## Frontend

### Configuración → Items

- El formulario de items suma el tipo "Suscripción"; al elegirlo aparece el
  select de frecuencia (Semanal/Mensual) y se ocultan los campos de stock.

### Tienda → Suscripciones (`pages/tienda/suscripciones.vue`)

- La lista pasa de mock a `GET /suscripciones` (patrón de páginas CRUD con
  update optimista). Se elimina `useSuscripciones` de `localStorage`; las
  acciones pausar/reanudar/cancelar llaman al `PATCH`.
- Botón **"Nueva suscripción"** (visible con permiso `Tienda Online:Crear`)
  abre un `AppDrawer` interactivo:
  1. Select de item suscribible (`GET /items?tipo=suscripcion`), mostrando
     precio y frecuencia.
  2. Según la frecuencia del item elegido: select de **día del mes** (1–28)
     o select de **día de la semana** (lunes–domingo).
  3. Tarjeta a usar (la preferida del mock por defecto; si no hay tarjetas,
     aviso con link a Medios de pago).
  4. Resumen: precio del período + próximo cobro estimado.
- **Confirmar** navega a la pasarela dummy en modo suscripción.

### Pasarela dummy (`pages/tienda/pasarela.vue`)

- Se agrega el modo suscripción (estado compartido `useState`, mismo patrón
  que el checkout del carrito): muestra el resumen de la suscripción y la
  tarjeta elegida.
- **Aprobar** → `POST /suscripciones` (el backend crea venta + suscripción
  en una transacción) → pantalla de éxito con links a la suscripción y al
  detalle de la venta. **Rechazar** → vuelve a Suscripciones sin crear nada.

## Fuera de alcance (fases futuras)

- Scheduler / cobro recurrente automático (ejecutar `proximo_cobro`).
- Backend de tarjetas (siguen mock en `localStorage`).
- Prorrateo, upgrades/downgrades entre planes, períodos de prueba.
- Historial de cobros por suscripción (solo queda `venta_inicial_id`).

## Docs vivas a actualizar en el mismo cambio

- `CLAUDE.md`: tabla Estado actual (fila de suscripciones) + modelo de items.
- `docs/features/tienda-online.md`: sección suscripciones (de mock a real).
- `docs/PRODUCTO.md`: regla de negocio del alta con primer cobro.
- `startup-pos.sql`: tablas nuevas.
