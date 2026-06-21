# Producto — SaaS POS Multi-tenant

> Documento vivo. Describe lo que se quiere construir.
> Las secciones marcadas con `[ PENDIENTE ]` requieren decisión antes de implementar.

---

## Qué es

Sistema SaaS de punto de venta y facturación **multi-tenant**. Cada tenant (empresa) opera
de forma completamente aislada: su propio catálogo, monedas, impuestos, usuarios, roles y
ventas. Un mismo usuario puede pertenecer a varios tenants y cambiar de contexto.

Base de datos: **PostgreSQL**. Esquema en `startup-pos.sql`.

**Aritmética financiera:** toda operación con dinero y porcentajes usa **Decimal.js** —
sin `number` nativo de JS para evitar errores de punto flotante. Los valores se persisten
en la BD como `NUMERIC(18,4)` y se operan como `Decimal` en la capa de negocio.

---

## Modelo de datos central

Tres entidades que no deben confundirse:

| Concepto | Tabla | Descripción |
|---|---|---|
| **Tenant** | `tenants` | Empresa que contrata el SaaS. Dueña de todos los datos de negocio. |
| **Usuario** | `usuarios` | Persona que opera el sistema. Puede pertenecer a N tenants. |
| **Customer** | `venta_customer` | Comprador final en una transacción. No tiene login. |

Casi toda tabla de negocio tiene `tenant_id` como parte de su clave o como FK obligatoria.

---

## Funcionalidades

### 1. Autenticación ✅ *ya implementada en la nueva app*

- Login con `nombre_usuario` + contraseña → devuelve `access_token` + `refresh_token`
- Refresh de access token
- Cambio de contraseña
- Validación de token

**Reglas:**
- Dos secretos JWT distintos: uno para access (~15 min), uno para refresh (~7 días)
- Contraseña hasheada (bcrypt)
- Stateless: no se persisten sesiones

**[ PENDIENTE ]** ¿Se implementa revocación real de tokens (logout que invalide el refresh)?

---

### 2. Perfil y contexto multi-tenant

El usuario opera en **un solo tenant por sesión** — selecciona uno al entrar y todo el contexto gira en torno a ese tenant hasta que cambie.

Flujo modular en dos pasos:

1. **GET /perfil** — devuelve datos del usuario + lista de tenants a los que pertenece (solo id y nombre, para mostrar el selector)
2. **GET /perfil/:tenant_id** — al seleccionar un tenant, carga el detalle completo: rol, módulos accesibles, permisos, monedas configuradas, razones sociales, sub-tenants

---

### 3. Control de acceso (RBAC)

Modelo: `rol → módulo contratado → permisos`

**Dos niveles de actor:**

- **Superadmin del SaaS** — contrata/desactiva módulos por tenant (`tenant_modulos`). El tenant no puede gestionar sus propios módulos.
- **Admin del tenant** — crea roles personalizados, les asigna módulos contratados y permisos, y los asigna a usuarios del tenant.

**Roles:**
- `admin` — rol fijo del sistema, acceso completo dentro del tenant. Se crea automáticamente al dar de alta un tenant.
- Roles personalizados — creados por el admin del tenant. Ejemplo: "cajero" con módulo Caja y permisos para crear ventas pero no eliminarlas.

**Multi-rol por usuario:** un usuario puede tener **varios roles** dentro de un mismo
tenant; sus permisos son la **unión** de todos sus roles. Esto permite roles granulares
y componibles (ej. "Caja" + "Reportes") en vez de obligar a crear un rol a medida por
usuario. La administración de roles y la asignación a usuarios se hace desde
**Configuración → Roles y permisos / Usuarios** (solo el admin del tenant).

**Superadmin:** contexto completamente separado. Flag `es_superadmin` en la tabla `usuarios`. Rutas `/admin/*` protegidas por un guard propio, independiente del RBAC de tenants. El superadmin no opera dentro de ningún tenant.

**Enforcement:** real en el backend (decisión B). Cada ruta valida rol + módulo contratado + permiso del usuario sobre el tenant activo.

---

### 4. Gestión de tenants y razones sociales

- Creación de tenants gestionada por el **superadmin** (no hay registro propio por ahora)
- CRUD de datos del tenant: nombre, correo único, teléfono, dirección, provincia
- CRUD de razones sociales del tenant: datos legales para emitir facturas (nombre legal, RUT, dirección)

**Sub-tenants:** funcionalidad futura — no entra en el alcance actual.

---

### 4b. Terceros

Directorio de entidades externas del tenant: proveedores, empresas compradoras y personas naturales recurrentes. No tienen acceso al sistema — son registros de referencia reutilizables.

**Datos:** nombre, RUT, tipo (`proveedor` | `empresa` | `persona_natural`), correo, teléfono, dirección, datos de facturación (nombre legal, RUT fiscal).

**Usos:**
- Al emitir una factura → seleccionar tercero y autocompletar datos de facturación
- Compradores frecuentes → no reingresar datos en cada venta
- Proveedores → referencia para compras y documentos

---

### 5. Catálogos base globales

Tablas sembradas por seeder, no editables por el usuario final:

- `pais` (nombre, ISO-2, zona horaria)
- `provincia` (FK país, zona horaria)
- `moneda` (nombre, ISO-3, símbolo, decimales)
- `modulos_app` (módulos disponibles en el SaaS)
- `permisos` (permisos disponibles por módulo)
- `metodos_pago` (catálogo global de métodos)

---

### 6. Configuración de monedas por tenant

- La **moneda oficial** del tenant la determina su país (`pais.moneda_oficial_id`) — no la elige el tenant. Es la moneda legal para facturación.
- El tenant puede **habilitar monedas adicionales** (USD, UF, etc.) para cobrar en ellas
- Puede marcar una moneda habilitada como **default** (preseleccionada en el UI)
- Registra la **tasa de cambio del día** (`valor_del_dia`) por moneda adicional, actualizable en cualquier momento
- Al procesar una venta en moneda no oficial → se convierte a la moneda oficial usando `valor_del_dia` vigente en ese instante
- Las facturas siempre se emiten en la moneda oficial del país

**Regla crítica:** `pais` debe tener su `moneda_oficial_id` configurado. Sin ella el tenant no puede operar.

**Fase posterior:** integración con proveedor externo para obtener tasas automáticamente.

---

### 7. Catálogos financieros por tenant

Cada tenant define sus propias reglas reutilizables:

**Categorías** — agrupan items (`aplica_a`: productos, servicios o ambos)

**Impuestos** — nombre + porcentaje + activo

**Descuentos y Recargos** — comparten estructura:
- `modo`: `porcentaje` | `monto_fijo`
- `valor`
- `condicion_tipo`: `ninguna` | `customer` | `producto` | `categoria` | `fecha` | `metodo_pago` | `vencimiento`
- `condicion_valor`, `fecha_inicio`, `fecha_fin`

**[ PENDIENTE ]** ¿Se implementa la evaluación de condiciones (`condicion_tipo`, vigencia,
modo escalonado)? En el sistema original estas columnas existen pero la lógica no está
implementada.

**Métodos de pago** — catálogo global habilitado por tenant (`tenant_metodo_pago`)

---

### 8. Catálogo de items

Modelo: **tabla base + extensiones por tipo** — escala limpiamente cuando se agreguen nuevos tipos (combos, suscripciones, modificadores, etc.).

**`items` (base):** campos comunes a todos los tipos — tenant, nombre, descripción, precio base, moneda, categoría, activo, tipo.

Extensiones actuales:
- **`item_producto`** — stock, unidad de medida, fecha elaboración, fecha vencimiento
- **`item_servicio`** — duración estimada, `requiere_cita` (flag informativo, sin agenda por ahora)

Cada item:
- Puede tener N impuestos, N descuentos, N recargos asociados
- El stock se descuenta **automáticamente** al procesar una venta

Extensiones futuras contempladas: combos/paquetes, items digitales, suscripciones, modificadores.

**Alertas útiles:** stock bajo, productos próximos a vencer.

---

### 9. Motor de cálculo de precios

Cálculo puro (sin persistencia). Opera con **Decimal.js** y porcentajes siempre en decimal (decisiones E).

**Fórmula configurable por tenant (`tenant_formula_precio`):**

```
[fijo]   precioNeto      = precioBase sin impuesto
                           (si precio_incluye_impuesto → extraer: neto = base / (1 + tasa))
[paso 1] → aplicar descuentos  ┐
[paso 2] → aplicar recargos    ├ orden configurable por tenant
[paso 3] → aplicar impuestos   ┘
[fijo]   totalFinal      = resultado del último paso
```

Cada paso aplica sobre el resultado acumulado del paso anterior. El tenant puede reordenar los pasos intermedios según su modelo de negocio o requisito legal.

**Configuración por defecto** (sembrada al crear el tenant):
`precioNeto → descuentos → recargos → impuestos → totalFinal`

**Configuración adicional por tenant:**
- `calculo_descuentos`: `'base'` (todos sobre precioNeto) | `'compuesto'` (cada descuento sobre el resultado del anterior)

**Configuración por item:**
- `precio_incluye_impuesto: boolean` — si el precio ingresado ya incluye impuestos o no

**Conversión de moneda:**
- Si la moneda del item ≠ moneda oficial → `totalConvertido = totalFinal × valor_del_dia`
- Si la moneda del item = moneda oficial → sin conversión

---

### 10. Procesamiento de ventas (transaccional)

Dos canales diferenciados:
- **Físico** — requiere caja abierta manualmente por el usuario
- **Online** — pago inmediato, se asigna automáticamente a la caja virtual del tenant

La venta lleva un campo `canal` (`'fisico'` | `'online'`) que determina el flujo y permite filtrar reportes.

**Tipos de documento tributario:** tabla propia `tipos_documento_tributario` vinculada a `pais` — cada país define sus documentos legales. Ejemplos Chile: Boleta, Factura, Nota de Crédito, Nota de Débito. No es un enum fijo.

**Estados de la venta:**
- `borrador` — venta en construcción, no confirmada
- `pendiente` — confirmada, esperando pago (canal físico)
- `pagada` — pago recibido y confirmado. Las ventas online llegan directamente aquí.
- `cancelada` — anulada

**Nota de crédito:** puede ser total (anula la venta completa) o parcial (anula parte). Referencia a la venta original mediante `venta_referencia_id` en la tabla `ventas`.

Registra una venta completa en una sola transacción atómica:

1. Cabecera (`ventas`): tenant, caja, canal, moneda, tipo documento, estado, totales, `venta_referencia_id` (para notas de crédito)
2. Líneas (`venta_detalles`): item, cantidad, precio origen, tasa de cambio, precio convertido, totales por línea
3. Reglas aplicadas (`ventas_descuentos`, `ventas_recargos`, `ventas_impuestos`): valor aplicado, porcentaje y si es por línea o global
4. Customer (`venta_customer`): datos del comprador si aplica
5. Pagos (`pagos`): método, monto en moneda oficial, caja

**Regla:** total por línea = valores unitarios × cantidad. Los descuentos/recargos/impuestos se calculan por unidad y se multiplican.

---

### 11. Consulta de ventas

- Lista las ventas de un tenant con todos sus detalles expandidos
- Distingue reglas aplicadas por línea vs globales (`aplicado_en`)
- CRUD básico por `venta_id + tenant_id`

---

### 12. Gestión de cajas

**Tipos de caja:**
- `fisica` — abierta manualmente por el usuario con saldo inicial en efectivo
- `virtual` — creada automáticamente por el sistema para el tenant, siempre abierta, recibe ventas online

**Operaciones (caja física):**
- **Abrir:** usuario registra el monto inicial de dinero entregado
- **Consultar caja activa:** una sola caja abierta por tenant+usuario en simultáneo
- **Movimientos manuales:** ingresos y egresos fuera de ventas (retiro de efectivo, fondo de cambio, gastos menores). Se registran en `movimientos_caja` con concepto y tipo (`entrada` | `salida`)
- **Cerrar:** el usuario ingresa el monto físico contado. El sistema calcula:
  - `saldo_esperado = saldo_inicial + entradas − salidas`
  - `diferencia = monto_fisico_contado − saldo_esperado`
  - Se persisten ambos valores para auditoría

---

### 13. Registro de pagos

- Una venta puede tener **múltiples pagos** con distintos métodos (ej. parte efectivo + parte tarjeta)
- Cada pago: método de pago, monto en moneda oficial, caja
- El monto llega ya convertido a moneda oficial
- No hay integración con pasarela de cobro en esta fase: es registro contable
- El sistema calcula y registra el **vuelto** cuando la suma de pagos supera el total de la venta
- El vuelto solo aplica en métodos que lo permiten (`permite_vuelto = true` en `tenant_metodo_pago`)

---

## Decisiones pendientes (resumen)

| # | Decisión | Impacto |
|---|---|---|
| A | ~~¿Revocación real de tokens (logout)?~~ → Analizar sistema de tokens de la nueva app. Usa JWT estándar de la empresa: access token + refresh token con tiempos ya definidos. | — |
| B | ✅ Enforcement de permisos **real en el backend**. Cada ruta de la API valida que el usuario tiene el permiso correspondiente para el tenant activo. | Guards por ruta en la API |
| C | 🔜 Evaluación de condiciones en descuentos/recargos (`condicion_tipo`, vigencia, escalas). Estructura en BD lista. Requiere análisis especializado — se implementa en una fase posterior. Por ahora solo aplica `condicion_tipo = 'ninguna'`. | Motor de cálculo (fase posterior) |
| D | ✅ Tasa de cambio **manual en primera fase**, proveedor externo en fase posterior. Cada tenant registra su propio `valor_del_dia` por moneda habilitada (el mismo USD vale distinto para un tenant chileno que para uno argentino). La estructura actual en `tenant_moneda` ya soporta esto correctamente. | `tenant_moneda.valor_del_dia` |
| E | ✅ Porcentajes **siempre en decimal** — `0.19` = 19%, `0.05` = 5%. Sin interpretación dual. | Motor de cálculo |
| F | ✅ Apertura de caja **manual** — el usuario registra el monto inicial al abrir. Sin caja abierta no se puede vender (canal físico). **Ventas online:** se asignan a una **caja virtual por tenant**, creada automáticamente por el sistema, siempre abierta. El pago online es inmediato — no hay flujo de apertura/cierre manual. | Flujo de ventas + cajas |
| G | ✅ Creación de ventas pasa por el mismo guard de permisos del backend (resuelto por decisión B). | Backend guard en POST /ventas |

---

## Esquema de base de datos

Ver `startup-pos.sql`. Toda tabla incluye:
- `creado_el TIMESTAMPTZ`
- `actualizado_el TIMESTAMPTZ`
- `eliminado_el TIMESTAMPTZ` — **soft delete**; toda lectura filtra `eliminado_el IS NULL`
