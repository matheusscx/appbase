# Análisis de Funcionalidades para Migración

> Sistema **SaaS multi-tenant de punto de venta / facturación**. Un mismo usuario
> puede operar sobre varios tenants (empresas), cada uno con su propia
> configuración de monedas, catálogo, impuestos, descuentos, cajas y ventas. El
> control de acceso es por rol dentro de cada módulo contratado por el tenant.
>
> Stack original (solo de referencia, **no condiciona** la reimplementación):
> - **Backend:** NestJS 11 + TypeORM + PostgreSQL, autenticación JWT (access + refresh).
> - **Frontend:** Nuxt 3 + Vuetify + Pinia + TailwindCSS.
> - Todas las tablas usan **soft delete** (`eliminado_el`) y timestamps `creado_el` / `actualizado_el`.

---

## Conceptos transversales (leer primero)

- **Tenant ≠ customer.** En este sistema hay dos conceptos de "cliente" que conviene
  distinguir desde el inicio:
  - **Tenant** (`cliente` en el código/BD): la empresa u organización que contrata el SaaS.
    Casi todos los datos de negocio cuelgan de un `cliente_id`. Es el sujeto central del
    sistema multi-tenant.
  - **Customer** (`cliente_final` en el código/BD): el comprador real en una transacción de
    venta. Se modela aparte y solo existe en el contexto de una venta.
- **Usuario ≠ tenant.** Un `usuario` (login) se asocia a uno o más tenants y, dentro
  de cada uno, a un `rol` y a los `módulos` a los que ese rol da acceso.
- **Jerarquía de tenants.** Un tenant puede tener sub-tenants (`mis_clientes`), relación
  padre-hijo entre registros de la misma tabla `clientes`.
- **Soft delete en todo.** Ninguna operación de borrado elimina filas; marca `eliminado_el`.
  Toda lectura debe filtrar `eliminado_el IS NULL`.
- **Multi-moneda con moneda oficial.** Cada tenant habilita varias monedas y marca una como
  "oficial". Los importes de venta se totalizan y persisten convertidos a la moneda oficial.

---

## Funcionalidades

### 1. Autenticación de usuarios (login / refresh / cambio de contraseña)

**Qué hace:** Permite a un usuario iniciar sesión con usuario+contraseña, mantener la sesión
viva mediante refresh token, cambiar su contraseña y validar su token.

**Entradas:**
- Login: `{ nombre_usuario, contrasena }`.
- Refresh: `{ refresh_token }`.
- Cambio de contraseña: `{ contrasena_actual, nueva_contrasena }` + identidad del token.

**Salidas:**
- Login → `{ access_token, refresh_token }`.
- Refresh → `{ access_token }` nuevo.
- Validate → `{ valid: true, usuario: { ... } }`.

**Integraciones externas:** Ninguna. JWT firmado localmente, hashing con bcrypt.

**Persistencia:** Tabla `usuarios` (nombre_usuario único, correo único, contraseña hasheada).
No persiste sesiones ni tokens (stateless).

**Requisitos o dependencias:**
- Dos secretos JWT distintos (access ~15 min, refresh ~7 días).
- Contraseñas hasheadas con bcrypt (cost 10).
- Reglas implícitas: el `tokenVersion` del refresh existe en el payload pero **no se valida**
  contra la BD (no hay revocación real de tokens todavía).

---

### 2. Perfil de usuario y contexto multi-tenant

**Qué hace:** Devuelve el usuario junto con TODOS sus tenants asociados y, por cada tenant,
sus roles, módulos accesibles, permisos, monedas configuradas, razones sociales y sub-tenants.
Es lo que permite al frontend mostrar el selector de empresa y construir el menú según permisos.

**Entradas:** Identidad del usuario (del token). Opcionalmente un `clienteId` para filtrar a un
solo tenant (`GET profile/:clienteId`).

**Salidas:** Objeto agregado: `{ usuario_id, nombre_usuario, correo, clientes: [ { tenant, roles,
modulos, permisos, monedas, razones_sociales, sub_clientes } ] }`. Si se pide un tenant al que el
usuario no tiene acceso → error "no tiene acceso".

**Integraciones externas:** Ninguna.

**Persistencia (modelo conceptual de las relaciones que se leen):**
- `usuarios_clientes`: qué usuarios pertenecen a qué tenants.
- `usuarios_clientes_roles_modulos`: por usuario+tenant, qué rol y qué módulo.
- `roles_permisos`: permisos de cada rol.
- `cliente_moneda`: monedas habilitadas por tenant (con `es_default`, `es_oficial`, `decimales`).
- `razones_sociales`, `mis_clientes`.

**Requisitos o dependencias:** Login válido. Depende de que existan los catálogos de roles,
módulos, permisos y de las relaciones de asignación. Es la pieza central; muchas pantallas
dependen de este agregado.

---

### 3. Control de acceso por roles, módulos y permisos (RBAC)

**Qué hace:** Define qué puede hacer cada usuario dentro de cada tenant. El acceso se evalúa por
combinación **rol → módulo contratado → permisos**.

**Entradas:** CRUD de catálogos (`modulos_app`, `permisos`, `roles`) y de las tablas de relación.

**Salidas:** Asignaciones que el perfil (func. 2) agrega y que el frontend usa para mostrar/ocultar
navegación y bloquear rutas.

**Integraciones externas:** Ninguna.

**Persistencia (modelo conceptual):**
- `modulos_app`: catálogo global de módulos de la app (nombre, descripción, url, icono).
- `permisos`: permisos, cada uno asociado a un módulo.
- `roles`: roles **por tenant** (un rol pertenece a un tenant).
- `roles_permisos`: qué permisos tiene un rol.
- `clientes_modulos_app`: qué módulos ha **contratado** un tenant (con `estado`, `contratado_en`,
  `expira_en`).
- `usuarios_clientes_roles_modulos`: asigna usuario+rol+módulo dentro de un tenant.

**Requisitos o dependencias:**
- Regla implícita clave: un permiso solo aplica si **el módulo está contratado por el tenant** Y
  **el rol del usuario lo incluye**. La contratación de módulos puede expirar (`expira_en`).
- El enforcement real de permisos hoy vive sobre todo en el frontend (ver Notas de Migración).

---

### 4. Gestión de tenants y razones sociales

**Qué hace:** Alta/edición de empresas (tenants), sus datos de contacto y ubicación, y sus razones
sociales (datos legales para facturación).

**Entradas:** Datos del tenant (nombre, correo único, teléfono, dirección, país, provincia) y de la
razón social (nombre legal, RUT, representante legal, correo).

**Salidas:** Registros de `clientes` y `razones_sociales`; sub-tenants vía `mis_clientes`.

**Integraciones externas:** Ninguna (país/provincia son catálogos internos).

**Persistencia:**
- `clientes`: empresa, FK opcional a `pais` y `provincia`.
- `razones_sociales`: 1..N por tenant, datos legales y de representante.
- `mis_clientes`: relación jerárquica tenant → sub-tenant.

**Requisitos o dependencias:** Catálogos `pais` y `provincia` (con zona horaria) deben existir primero.

---

### 5. Catálogos base de localización y monedas

**Qué hace:** Provee catálogos compartidos: países, provincias y monedas del sistema.

**Entradas:** Datos de catálogo (normalmente sembrados por seeders, no por usuario final).

**Salidas:** Listas consultables y referenciables por tenants, items y ventas.

**Integraciones externas:** Ninguna (pero ver moneda/tasa de cambio en func. 6).

**Persistencia:**
- `pais` (nombre, ISO-2, zona horaria), `provincia` (FK país, zona horaria).
- `moneda` (nombre, ISO-3, código numérico, símbolo, decimales).

**Requisitos o dependencias:** Hay seeders dedicados (`pais`, `mi-cliente`). Migrar estos datos
semilla junto con la funcionalidad.

---

### 6. Configuración de monedas por tenant (multi-moneda + tasa de cambio)

**Qué hace:** Cada tenant habilita un subconjunto de monedas, define cuál es la **oficial**, cuál es
default, sus decimales y la **tasa del día** usada para convertir precios a la moneda oficial.

**Entradas:** `{ cliente_id, moneda_id, habilitado, es_default, es_oficial, decimales }` y un
`valor_del_dia` (tasa de cambio) por moneda del tenant.

**Salidas:** Lista de monedas del tenant con flags; la moneda oficial alimenta el cálculo de ventas.

**Integraciones externas:** El valor de la tasa (`valor_del_dia`) es un dato que entra al sistema;
en una reimplementación podría venir de un proveedor de tipos de cambio.

**Persistencia:** `cliente_moneda` (PK compuesta tenant+moneda, flags `es_default`/`es_oficial`/
`habilitado`, `decimales`). La columna de tasa diaria (`valor_del_dia`) se consume en el cálculo.

**Requisitos o dependencias:**
- Regla implícita: **debe existir exactamente una moneda oficial por tenant**; si no, no se pueden
  procesar ventas.
- Reglas de interpretación de porcentajes/decimales descritas en func. 8.

---

### 7. Catálogos de reglas de precio: categorías, impuestos, descuentos, recargos, métodos de pago

**Qué hace:** Permite a cada tenant definir su catálogo financiero reutilizable que luego se asocia a
items y ventas.

**Entradas (por cada catálogo, todo con `cliente_id`):**
- **Categorías:** nombre/descripcion para agrupar items.
- **Impuestos:** nombre + porcentaje + activo.
- **Descuentos / Recargos:** nombre, `modo` (`porcentaje` | `monto_fijo` | escalonado),
  `valor`, `condicion_tipo` (ninguna, monto mínimo, cantidad mínima, producto, categoría,
  customer específico), `condicion_valor`, vigencia (`fecha_inicio`/`fecha_fin`), activo.
- **Métodos de pago:** catálogo global + habilitación por tenant.

**Salidas:** Reglas asociables a items (func. 8) y aplicables en ventas (func. 10).

**Integraciones externas:** Ninguna.

**Persistencia:**
- `categorias`, `impuestos`, `descuentos`, `recargos` (todos por tenant, soft delete, activo).
- `metodos_de_pago` (global) + `metodos_de_pago_cliente` (habilitación por tenant).

**Requisitos o dependencias:**
- Descuentos y recargos comparten enums `ModoRegla` y `CondicionTipo`.
- Nota: el modo escalonado y las `condicion_tipo`/vigencia **están modelados pero la lógica de
  evaluación de condiciones NO está implementada** en el cálculo actual (ver Notas de Migración).

---

### 8. Catálogo de items (productos y servicios) con reglas asociadas

**Qué hace:** Gestiona los items vendibles del tenant. Un item es la base común; puede especializarse
como **producto** (con stock, unidad, fechas de elaboración/vencimiento) o **servicio** (duración,
requiere cita). A cada item se le asocian impuestos, descuentos y recargos.

**Entradas:**
- Item: `{ cliente_id, moneda_id, nombre, descripcion, precio_base, categoria_id, tipo, activo,
  impuestos[], recargos[], descuentos[] }`.
- Producto: `{ item_id, stock, unidad_medida, fecha_elaboracion, fecha_vencimiento }`.
- Servicio: `{ item_id, duracion_estimada, requiere_cita }`.
- Operaciones de stock: sumar/restar cantidad.

**Salidas:** Item con sus relaciones expandidas. Consultas especiales: items por tenant/categoría,
**productos con stock bajo**, **productos con vencimiento próximo**.

**Integraciones externas:** Ninguna.

**Persistencia:**
- `items` (precio en su propia moneda, `tipo` discrimina producto/servicio).
- `productos` y `servicios`: extensión 1:1 con `items` (PK = item_id).
- `items_impuestos`, `items_recargos`, `items_descuentos`: relaciones N:M item↔regla.

**Requisitos o dependencias:**
- Al actualizar relaciones (impuestos/recargos/descuentos) el sistema **borra todas y recrea** las
  asociaciones (reemplazo total, no merge).
- `remove` valida que el item pertenezca al tenant indicado (`cliente_id`) y hace soft delete + `activo=false`.
- Catálogos de func. 6 y 7 deben existir antes.

---

### 8.5. Preferencias financieras (Configuración de fórmula de precios)

**Qué hace:** Permite al administrador del tenant configurar cómo se calculan los precios finales:
modo de cálculo para descuentos (`base` | `compuesto`), modo para recargos (`base` | `compuesto`),
y el orden de aplicación de los tres pasos (descuentos, recargos, impuestos).

**Entradas:** `{ cliente_id, calculo_descuentos, calculo_recargos, formula: [paso1, paso2, paso3] }`
donde cada paso es una de las tres cadenas: 'descuentos', 'recargos', 'impuestos'.

**Salidas:** Configuración persistida consultable por el motor de cálculo (func. 9).

**Integraciones externas:** Ninguna.

**Persistencia:**
- `tenants`: columnas `calculo_descuentos`, `calculo_recargos` (TEXT, default 'base').
- `tenant_formula_precio`: tabla nueva con `(tenant_id, paso, tipo)` — mapea orden de pasos.

**Precisión y redondeo financiero:**

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `calculationScale` | integer | 6 | Decimales usados durante los cálculos intermedios (antes de redondear). Evita pérdida de precisión por redondeos tempranos. Ejemplo: `100 × 12.345678% = 12.345678` (no 12.35). |
| `roundingMode` | enum | `HALF_UP` | Modo de redondeo al presentar o persistir resultados. Valores: `HALF_UP`, `HALF_EVEN`, `FLOOR`, `CEIL`. |
| `toleranceAmount` | decimal | 0.00 | Diferencia máxima permitida en validaciones y conciliaciones para evitar rechazos por desfases de redondeo entre sistemas. Ejemplo: calculado `10.000`, recibido `9.999`, diferencia `1.000` ≤ tolerancia → válido. |

Los decimales de **presentación** siguen siendo responsabilidad de la moneda (`currency.decimalPlaces`), no de estas preferencias.

**Requisitos o dependencias:**
- Validación: la fórmula debe contener exactamente los tres pasos sin duplicados.
- Default al crear tenant: `['descuentos', 'recargos', 'impuestos']` con modo `'base'` para ambos.
- Soporte de acceso: solo admin del tenant puede leer/escribir (RBAC guard).
- Esta es **configuración pura** — el motor de precios (func. 9) la consume pero no está acoplado.

**Estado de migración:** ✅ Implementado (2026-06-24). Ver [docs/features/preferencias-financieras.md](../docs/features/preferencias-financieras.md).

---

### 9. Motor de cálculo de precios de venta (CalculadoraVentas)

**Qué hace:** Dado un item y la moneda oficial del tenant, calcula su totalización: precio base,
impuestos, recargos, descuentos, total, y la conversión a la moneda oficial.

**Entradas:** Item con sus reglas, moneda oficial del tenant, fecha.

**Salidas:** Objeto `CalculoVenta` con `precioBase`, arrays detallados de `impuestos/recargos/
descuentos` (cada uno con su monto), totales por tipo, `total`, y `conversionMonedaOficial`
(`{ precioOriginal, precioConvertido, tasaCambio, ... }` o `null` si ya está en moneda oficial).

**Integraciones externas:** Ninguna.

**Persistencia:** No persiste; es cálculo puro consumido por el procesamiento de ventas.

**Requisitos o dependencias — REGLAS DE NEGOCIO NO OBVIAS (críticas para migrar):**
- **Orden de cálculo:** `total = precioBase + impuestos + recargos − descuentos`. Impuestos,
  recargos y descuentos se calculan **todos sobre `precioBase`** (no compuestos entre sí).
- **Interpretación ambigua de porcentajes:** si el valor de un % es `> 1` se trata como porcentaje
  literal (ej. `19` = 19%); si es `≤ 1` se multiplica por 100 (ej. `0.19` = 19%). Esto aplica a
  impuestos, descuentos y recargos.
- **Modo de descuento/recargo:** `porcentaje` → `precioBase * valor/100`; `monto_fijo` → `valor` tal cual.
- **Conversión:** `precioConvertido = total * tasaCambio`, usando `valor_del_dia` de la moneda del item.
  Si falta la tasa, lanza error. Si la moneda del item == oficial, no hay conversión (`null`).
- **Stock por defecto:** si no hay stock real, el cálculo asume 100 (valor de relleno de desarrollo).

---

### 10. Procesamiento de ventas (transaccional) ✅ Implementado (2026-06-29)

**Qué hace:** Registra una venta completa en una sola transacción atómica: cabecera + líneas +
reglas aplicadas + customer + pagos + movimientos de inventario + movimientos de caja.
Solo canal `fisico`. Auto-determina estado `pagada`/`pendiente` y calcula vuelto.

**Implementación:** `POST /api/ventas` · `GET /api/ventas` · `GET /api/ventas/:id`  
Módulo: `backend/src/modules/ventas/`  
Docs: `docs/features/ventas.md`

**Entradas:** `{ tipoDocumentoId, lineas[{itemId, cantidad, precioUnitario?, descuentoIds?, recargoIds?, impuestoIds?, unidadIds?, loteId?}], pagos[{metodoPagoId, monto, referencia?}], customer?, comentario? }`. Identidad del usuario (del token).

**Salidas:** Cabecera de venta con `id`, `estado`, `totalFinal`. `GET /:id` expande detalles, reglas, customer y pagos.

**Integraciones externas:** Ninguna (pago se registra, no se cobra contra pasarela).

**Persistencia:**
- `ventas`: cabecera con `tipo_documento` (boleta/factura/nota_credito), `estado`
  (borrador/pendiente/aprobada/cancelada), totales (bruto, descuentos, recargos, impuestos, final),
  `caja_id`, `comentario`.
- `venta_detalle`: línea con precio origen, tasa de cambio, precio convertido, cantidad, subtotal y
  totales por línea.
- `venta_impuesto` / `venta_recargo` / `venta_descuento`: cada aplicación con `valor_aplicado`,
  `porcentaje_aplicado` y `aplicado_en` (`detalle` | `venta`).
- `venta_cliente_final`: datos del customer (nombre, RUT, dirección, teléfono, email).

**Requisitos o dependencias — REGLAS NO OBVIAS:**
- Toda la operación va en **una transacción**; cualquier fallo hace rollback.
- **Autoapertura de caja:** si no hay caja abierta para el tenant+usuario, el sistema **abre una
  automáticamente** con saldo inicial 0 (marcado en el código como conveniencia de desarrollo;
  decidir si conservarlo).
- Hoy carga **todos** los items del tenant y los indexa para resolver cada detalle (TODO marcado:
  debería traer solo los items vendidos).
- Los **descuentos/recargos por caja (globales)** se registran con `valor_aplicado = 0`: la lógica
  de cálculo de su monto **no está implementada** (queda pendiente).
- La validación de que el usuario tenga permiso sobre el tenant está **comentada** (deshabilitada).
- Totales por línea = valores unitarios del cálculo **× cantidad**.

---

### 11. Consulta de ventas por tenant (vista enriquecida)

**Qué hace:** Lista las ventas de un tenant con toda su composición lista para mostrar: detalles con
item y moneda origen, descuentos/recargos/impuestos separados en "por detalle" vs "globales", y datos
del customer.

**Entradas:** `clienteId`.

**Salidas:** Array de ventas formateadas (estructura anidada y renombrada para el frontend), ordenadas
por fecha desc.

**Integraciones externas:** Ninguna.

**Persistencia:** Solo lectura (con muchas relaciones cargadas).

**Requisitos o dependencias:** Distingue aplicaciones por `aplicado_en` (`detalle`/`venta`). Las ventas
también tienen CRUD genérico (crear, findAll, findOne, update, soft delete) por `venta_id + cliente_id`.

---

### 12. Gestión de cajas (apertura / cierre / caja activa)

**Qué hace:** Maneja cajas por tenant y usuario: abrir con saldo inicial, consultar la caja activa,
cerrar con saldo final y soft delete.

**Entradas:** `{ cliente_id, usuario_id, moneda_id, saldo_inicial, estado }`; al cerrar, `saldo_final`.

**Salidas:** Caja con `estado` (`abierta`/`cerrada`), fechas de apertura/cierre, saldos.

**Integraciones externas:** Ninguna.

**Persistencia:** `cajas` (PK compuesta `caja_id`; identificada por `cliente_id`+`caja_id`),
opcionalmente `movimiento_caja` (entidad presente para movimientos de caja).

**Requisitos o dependencias:**
- Regla implícita: **una sola caja "abierta" por tenant+usuario** (la "activa" es la primera con
  estado abierta). El flujo de ventas depende de esto.

---

### 13. Registro de pagos de venta

**Qué hace:** Registra los pagos asociados a una venta, en la moneda oficial, contra una caja.

**Entradas:** `{ venta_id, cliente_id, metodo_pago_id, moneda_oficial_id, monto, caja_id }`.

**Salidas:** Registro de `pagos`; CRUD por `pago_id + cliente_id`.

**Integraciones externas:** Ninguna (no hay pasarela de cobro; es registro contable).

**Persistencia:** `pagos` (relaciona venta, tenant, método de pago, moneda oficial y caja).

**Requisitos o dependencias:** El monto se asume **ya convertido a moneda oficial** por quien llama.
Se crea dentro de la transacción de la venta (func. 10).

---

### 14. Aplicación web (frontend SPA con navegación por permisos)

**Qué hace:** SPA que consume la API: login, selección de tenant activo, menús y rutas
filtrados por permisos, y pantallas para cada módulo (tenants, configuración financiera, items,
cajas, ventas, cobros, facturación, roles, etc.).

**Entradas:** Interacción del usuario; tokens en almacenamiento del cliente.

**Salidas:** Peticiones HTTP a la API; estado global en Pinia (`user`, `clientes`,
`cliente_selected`, `rol_selected`, `permisos`).

**Integraciones externas:** La API backend (`apiBaseUrl`, por defecto `http://localhost:3001/`).

**Persistencia:** Tokens y estado de sesión en el cliente (no servidor).

**Requisitos o dependencias:**
- Middleware de auth: si no hay tokens → redirige a login; inicializa la app cargando el perfil;
  bloquea rutas sin permiso redirigiendo a `/home`.
- **Regla a revisar:** hay una lista de rutas en `ignorePaths` que **saltan la verificación de
  permisos** (toda `/configuracion/finanzas/*`, cajas y ventas hoy quedan exentas).
- El menú se arma desde `rol_selected.modulos` y los permisos obtenidos por ruta.

---

### 15. Gestión de inventario (kardex de movimientos de stock)

**Qué hace:** Registra y audita todo cambio de stock de los items de tipo **producto** mediante un
kardex de movimientos. Hoy el stock vive como un único número en `item_producto.stock` y se muta sin
dejar rastro (`ajustarStock` con `entrada`/`salida`); esta funcionalidad agrega trazabilidad: cada
movimiento queda registrado con su tipo, motivo, cantidad y el saldo resultante.

**Entradas:**
- Ajuste manual: `{ item_id, tipo (entrada|salida|ajuste), cantidad, comentario? }` + identidad del
  usuario (del token).
- Movimiento automático por venta: generado por el procesamiento de ventas (func. 10), no por el
  usuario directamente.

**Salidas:**
- Registro en `movimientos_inventario` + actualización del saldo en `item_producto.stock`.
- Consultas: historial de movimientos por item (kardex), saldo actual, y reutilización de las alertas
  ya existentes de **stock bajo** y **vencimiento próximo** (func. 8).

**Integraciones externas:** Ninguna.

**Persistencia:**
- `movimientos_inventario` (espejo conceptual de `movimientos_caja`):
  `{ movimiento_id, tenant_id, item_id, tipo (entrada|salida|ajuste),
  motivo (compra|venta|devolucion|merma|ajuste_manual|inventario_inicial), cantidad,
  stock_anterior, stock_resultante, venta_id?, usuario_id?, comentario? }` + soft delete y timestamps.
- `item_producto.stock` **se conserva** como saldo materializado (cacheado) para lectura rápida y
  alertas; cada movimiento lo actualiza atómicamente en la misma transacción. El kardex es la fuente
  de verdad auditable.

**Requisitos o dependencias — REGLAS DE NEGOCIO:**
- Solo aplica a items con `tipo = 'producto'` (los servicios no tienen stock).
- `cantidad` siempre positiva; el `tipo` define el signo del efecto sobre el saldo. La `salida` valida
  stock suficiente (no se permite saldo negativo), igual que el `ajustarStock` actual.
- **El kardex y el saldo se actualizan en una sola transacción**; cualquier fallo hace rollback.
- **Integración con ventas (func. 10):** al procesar una venta, cada línea genera automáticamente un
  movimiento `salida` con `motivo = 'venta'` y la referencia `venta_id`, dentro de la misma transacción
  de la venta. Esto materializa con rastro la regla ya descrita ("el stock se descuenta automáticamente
  al procesar una venta"). Las notas de crédito / devoluciones generan `entrada` con `motivo = 'devolucion'`.
- `tenant_id` y `usuario_id` provienen del token, nunca del body.

**Fuera de alcance (fases futuras):** bodegas / almacenes y stock por bodega, traspasos entre bodegas,
costeo y valoración de inventario (costo promedio / FIFO), y conteos físicos masivos. Se documentan como
extensiones posibles, no como parte de esta funcionalidad.

---

## Notas de Migración

### Lógica de negocio no obvia / reglas implícitas
- **Interpretación dual de porcentajes** (`>1` literal, `≤1` decimal) en impuestos/descuentos/recargos:
  fuente potencial de errores. Conviene normalizar a una sola convención y migrar datos en consecuencia.
- **Moneda oficial obligatoria por tenant**: sin ella las ventas fallan. Garantizar invariante en datos.
- **Cálculo no compuesto**: impuestos/recargos/descuentos se aplican todos sobre el precio base, no en
  cascada. Si el negocio real espera impuesto sobre (base−descuento), esto debe redefinirse explícitamente.
- **Una caja abierta por tenant+usuario** y **autoapertura de caja** en el flujo de ventas: decidir si la
  apertura automática (saldo 0, marcada como "para desarrollo") se mantiene o se exige apertura manual.
- **Total por línea = unitario × cantidad**: los descuentos/recargos/impuestos se calculan por unidad y
  luego se multiplican por la cantidad.

### Funcionalidad modelada pero NO implementada (decidir si completar)
- **Condiciones y vigencia de descuentos/recargos** (`condicion_tipo`, `condicion_valor`,
  `fecha_inicio`/`fecha_fin`, modo escalonado): existen en el modelo pero el motor de cálculo las ignora.
- **Descuentos/recargos por caja (globales)** en la venta: se persisten con `valor_aplicado = 0`; falta la
  lógica de cálculo de su monto y su impacto en los totales.
- **Validación de permisos en el procesamiento de ventas**: está comentada; el control real de acceso a
  nivel API es débil (la mayoría del enforcement está en el frontend, y varias rutas están exentas).
- **Revocación de tokens**: `tokenVersion` existe en el refresh pero no se valida; no hay logout real
  ni invalidación.
- **Selección de items en la venta**: hoy se cargan todos los items del tenant (TODO explícito);
  optimizar para resolver solo los items del carrito.
- **Trazabilidad de inventario (kardex)**: hoy el stock (`item_producto.stock`) se muta sin historial
  (`ajustarStock` con `entrada`/`salida`). Falta la tabla `movimientos_inventario` y la integración
  automática con ventas/devoluciones descrita en la func. 15.

### Integraciones con comportamiento específico a respetar
- **Tasa de cambio (`valor_del_dia`)** por moneda de tenant: hoy es un dato interno. Si se externaliza a
  un proveedor de FX, respetar que el precio convertido se calcula `total * tasaCambio` y que la ausencia
  de tasa debe ser un error duro, no un silencioso 1.
- **Persistencia de la conversión en cada línea de venta** (`precio_unitario_origen`, `tasa_cambio`,
  `precio_unitario`): las ventas guardan la foto del tipo de cambio del momento; no recalcular a posteriori.

### Datos / estado a migrar junto con la funcionalidad
- **Seeders** de catálogos base: `pais`, `provincia`, `moneda`, `modulos_app`, `permisos`,
  `metodos_de_pago` (catálogos globales) y la semilla `mi-cliente`.
- **Tablas de relación de RBAC** completas: `usuarios_clientes`, `usuarios_clientes_roles_modulos`,
  `roles_permisos`, `clientes_modulos_app` (con `estado`/`expira_en`), `cliente_moneda` (con flags y
  `valor_del_dia`). Sin estas, el perfil multi-tenant y el acceso se rompen.
- **Soft delete y timestamps**: preservar `eliminado_el`, `creado_el`, `actualizado_el` en la migración;
  toda la lógica de lectura asume su presencia.
- **Histórico de ventas, detalle, pagos y cajas**: migrar con sus totales ya convertidos y las marcas
  `aplicado_en` (`detalle`/`venta`) intactas para que la vista enriquecida siga funcionando.

### Configuración / entorno
- Variables: `DB_*` (PostgreSQL), `JWT_SECRET` / `JWT_REFRESH_SECRET` y sus expiraciones, `PORT` (3001),
  `API_BASE_URL` en el frontend.
- TypeORM corre con `synchronize: true` fuera de producción (el esquema se autogenera desde entidades).
  Para la migración a producción, definir migraciones reales en lugar de confiar en synchronize.

---

## Estado de Implementación (2026-06-20)

| Funcionalidad | Backend | Frontend | Notas |
|---|---|---|---|
| 1. Autenticación (login / refresh / logout) | ✅ | ✅ | JWT access + refresh con cookies httpOnly |
| 1b. Configuración — perfil de usuario | ✅ | ✅ | PATCH /me/perfil + PATCH /me/contrasena; página `/configuracion` |
| 2. Perfil multi-tenant — **flujo de selección** | ✅ | ✅ | POST /auth/switch-tenant + selector `/select-tenant` |
| 2. Perfil multi-tenant — **pantallas de gestión** | ✅ | ✅ | CRUD de tenants, invitación de usuarios |
| 3. RBAC (roles, módulos, permisos) | ✅ | ✅ | Config → Roles y permisos (matriz) + Usuarios (asignación multi-rol). Multi-rol por usuario. Mutaciones gated a admin del tenant (`TenantAdminGuard`) |
| 4. Gestión de tenants y razones sociales | ✅ | ✅ | PATCH /tenants/me + CRUD /razones-sociales; páginas /configuracion/empresa y /configuracion/razones-sociales |
| 5. Catálogos base (país, provincia, moneda) | ✅ | ✅ | Datos sembrados por `seeder.service.ts` |
| 6. Configuración de monedas por tenant | ✅ | ✅ | GET/PATCH /monedas; tabla `pais_moneda` + `tenant_moneda`; página /configuracion/monedas. Oficial derivada de `pais.moneda_oficial_id` |
| 7. Catálogos financieros (categorías, impuestos, descuentos, recargos, métodos de pago, tipos de regla) | ✅ | ✅ | Formularios dinámicos por tipo de regla implementados (2026-06-27). 4 tablas de tramos/bridges. Ver [descuentos-recargos.md](../docs/features/descuentos-recargos.md) |
| 8. Catálogo de items | ✅ | ✅ | |
| 9. Motor de cálculo de precios | ✅ | ✅ | Servicio puro stateless `POST /calculo-precios/calcular`. Reglas planas/tramos/método de pago; base vs compuesto; orden de fórmula; redondeo. Reglas fecha/vencimiento diferidas. Ver [motor-calculo-precios.md](../docs/features/motor-calculo-precios.md) |
| 10. Procesamiento de ventas | 🔲 | 🔲 | |
| 11. Gestión de cajas | ✅ | ✅ | Apertura/cierre con cuadre; movimientos manuales; caja virtual por tenant; permisos granulares `@RequiresPermiso`. Ver [gestion-cajas.md](../docs/features/gestion-cajas.md) |
| 12. Registro de pagos | 🔲 | 🔲 | |
| 13. SPA frontend (navegación por permisos) | — | 🔲 parcial | Flujo auth + tenant completo; menú RBAC pendiente |
| 14. Gestión de inventario (kardex de movimientos) | ✅ | ✅ | Kardex auditable con `movimientos_inventario`; endpoint GET /inventario/movimientos; PATCH /items/:id/stock con motivo/comentario; integración automática con ventas |

**Leyenda:** ✅ Implementado · 🔲 Por construir · 🔲 parcial Parcialmente implementado
- CORS está abierto a cualquier origen; endurecer al migrar.
- Prefijo global de API: `/api`.
