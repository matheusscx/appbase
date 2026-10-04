# Módulos y configuraciones

Inventario de los módulos contratables del sistema y de todo lo que un tenant puede
configurar. Foto del código al 2026-10-02: la fuente de verdad sigue siendo
`backend/src/modules/seeder/seeder.service.ts` (`seedModulosApp`, `seedModuloAppPermisos`)
y `frontend/app/pages/configuracion.vue` (el menú).

**Leyenda de guards**

- **Admin** — `TenantAdminGuard`: solo el rol `admin` del tenant.
- **Abierto** — `JwtAuthGuard + TenantGuard`: cualquier miembro del tenant (típico en los `GET` de catálogos).
- **`Módulo:Permiso`** — `PermisosGuard` con `@RequiresPermiso`.

---

## 1. Módulos contratables

Un tenant contrata módulos (`tenant_modulos`); cada rol recibe permisos sobre los módulos
contratados (`rol → módulo → permisos`). Permisos posibles: Leer, Crear, Actualizar,
Eliminar, Ver todas, Reembolsar, Nota de crédito, Operar, Configurar, Liquidar, Anular, Pagar.

| Módulo | Ruta | Permisos | Para qué |
|---|---|---|---|
| MiCaja | `/mi-caja` | Leer, Crear, Actualizar, Eliminar | Caja propia del usuario: apertura, cierre, arqueo |
| Cajas | `/cajas` | Leer, Crear, Actualizar, Eliminar | Supervisión de cajas de todos, historial, tendencia, pendientes de revisión; cajones |
| Ventas | `/ventas` | Leer, Crear, Actualizar, Eliminar, Ver todas, Anular, Nota de crédito | POS, historial y detalle de ventas, notas de crédito |
| Tienda Online | `/tienda` | Leer, Crear | Storefront del cliente: catálogo, checkout, tarjetas |
| Suscripciones | `/suscripciones` | Leer, Actualizar, Eliminar | Suscripciones recurrentes |
| Pagos | `/pagos` | Leer, Crear | Registro de pagos |
| Inventario | `/inventario` | Leer, Crear, Actualizar, Ver todas | Stock por ubicación, recuentos, traslados, stock mínimo, mermas |
| Items | `/configuracion/items` | Leer, Crear, Actualizar, Eliminar | Catálogo: productos, ingredientes, servicios, recetas, combos, suscripciones |
| Terceros | `/terceros` | Leer, Crear, Actualizar, Eliminar | Proveedores y entidades externas |
| Pasarelas | `/configuracion/pasarelas` | Leer, Crear, Actualizar, Eliminar, Reembolsar | Pasarelas de pago online, API keys, órdenes y reembolsos |
| Salones | `/salones` | Leer, Crear, Actualizar, Eliminar, Operar, Ver todas, Anular | Salones y mesas, cuentas, garzones, turnos, anulaciones |
| Impresoras | `/configuracion/impresoras` | Leer, Crear, Actualizar, Eliminar | Impresoras térmicas de comanda y boleta |
| Propinas | `/propinas` | Leer, Crear, Actualizar, Eliminar, Configurar, Liquidar | Pool de propinas, distribución y liquidaciones |
| Resumen del negocio | `/` | Leer | Dashboard "Hoy" del dueño (separado de Ventas a propósito) |
| Compras | `/compras` | Leer, Crear, Actualizar, Anular, Pagar | Recepción de compras y deuda con proveedores |
| Varianza | `/reportes/varianza` | Leer | Reporte de varianza real vs. teórico (AVT) |

Fuera de los módulos:

- **Superadmin** (`es_superadmin`, rutas `/admin/*`, `SuperadminGuard`): CRUD de tenants y
  asignación de módulos (`POST /admin/tenants/:id/modules`). Solo backend; `/admin` en el
  frontend es un placeholder.
- **Rol `admin` del tenant**: fijo y automático; ve todas las configuraciones marcadas "Admin".

### Menú lateral

El menú lateral lo arma `frontend/app/composables/useMenuLateral.ts` (el layout
`dashboard.vue` solo lo dibuja) **agrupado por módulo** desde el 2026-10-02: un módulo con
varias pantallas es un grupo que se despliega, y uno de una sola, un link suelto. Cada pantalla
se muestra si el usuario es admin o tiene el permiso indicado, y un grupo, si le queda al menos
una pantalla visible (en orden de aparición):

| Grupo | Pantalla | Ruta | Módulo · permiso que la muestra |
|---|---|---|---|
| — | Inicio | `/` | Siempre visible (el contenido lo filtra *Resumen del negocio*) |
| — | Mi caja | `/mi-caja` | MiCaja · Leer |
| — | Cajas | `/cajas` | Cajas · Leer |
| Ventas | Punto de venta | `/ventas/pos` | Ventas · Crear |
| Ventas | Historial | `/ventas` | Ventas · Leer |
| Ventas | Pagos | `/pagos` | Pagos · Leer |
| Ventas | Órdenes | `/ordenes` | Pasarelas · Leer |
| — | Propinas | `/propinas` | Propinas · Leer |
| Salones | Mesas | `/salones` | Salones · Operar |
| Salones | Sesiones | `/sesiones-garzon` | Salones · Leer |
| Salones | Anulaciones | `/salones/anulaciones` | Salones · Ver todas |
| Tienda Online | Catálogo | `/tienda` | Tienda Online · Leer |
| Tienda Online | Mis suscripciones | `/tienda/suscripciones` | Tienda Online · Leer |
| Tienda Online | Medios de pago | `/tienda/medios-pago` | Tienda Online · Leer |
| — | Suscripciones | `/suscripciones` | Suscripciones · Leer |
| — | Terceros | `/terceros` | Terceros · Leer |
| Inventario | Stock | `/inventario` | Inventario · Leer |
| Inventario | Recuentos | `/inventario/recuentos` | Inventario · Leer |
| Inventario | Traslados | `/inventario/traslados` | Inventario · Leer |
| Inventario | Mermas | `/mermas` | Inventario · Leer |
| Inventario | Stock mínimo | `/inventario/stock-minimo` | Inventario · Leer |
| Inventario | Costos desfasados | `/desfases` | Items · Leer |
| Compras | Recepciones | `/compras` | Compras · Leer |
| Compras | Por pagar | `/compras/por-pagar` | Compras · Pagar |
| — | Reportes | `/reportes` | Algún reporte visible (hoy solo *Varianza* · Leer) |
| — | Administración | `/admin` | Solo superadmin |
| *(abajo)* | Configuración | `/configuracion/perfil` | Siempre visible (abre el menú de §3) |
| *(abajo)* | Cerrar sesión | — | Siempre visible |

Suma: 8 sueltas + Ventas 4 + Salones 3 + Tienda Online 3 + Inventario 6 + Compras 2 = las 26
pantallas que el menú plano tenía, cada una una vez; más las 2 de abajo.

Pagos y Órdenes viven en Ventas y Costos desfasados en Inventario aunque su permiso sea de
otro módulo: son decisiones del owner (el porqué, en
[patterns/frontend](../patterns/frontend.md) § 1).

*Items*, *Pasarelas* e *Impresoras* no tienen entrada propia en el menú lateral: sus pantallas
principales viven dentro de Configuración (§3).

---

## 2. Configuración a nivel tenant (columnas de `tenants`)

| Columna | Valores (default) | Qué hace | Pantalla |
|---|---|---|---|
| `calculo_descuentos` | `base` \| `compuesto` (`base`) | Base: todos sobre el precio neto. Compuesto: en cascada | Preferencias |
| `calculo_recargos` | `base` \| `compuesto` (`base`) | Igual, para recargos | Preferencias |
| `escala_calculo` | entero 0–12 (6) | Decimales de los cálculos intermedios; máx. 4 con `nivel_redondeo = documento` | Preferencias |
| `modo_redondeo` | `HALF_UP` \| `HALF_EVEN` \| `FLOOR` \| `CEIL` (`HALF_UP`) | Cómo se cuantiza; puede venir bloqueado por la norma del país | Preferencias |
| `nivel_redondeo` | `linea` \| `documento` (`linea`) | Cuantiza cada línea, o solo el total; puede venir bloqueado por el país | Preferencias |
| `monto_tolerancia` | monto ≥ 0 (0) | Diferencia máxima tolerada (0 = ninguna) | Preferencias |
| `promos_acumulan_descuentos` | bool (false) | Promo + descuento se suman, o aplica solo la rebaja mayor | Preferencias |
| `umbral_descuadre_aviso` | monto ≥ 0 (0 = desactivado) | Al cerrar caja, advierte al cajero si un medio de pago descuadra más que esto | Preferencias |
| `umbral_descuadre_alto` | monto ≥ 0 (0 = desactivado) | Marca el cierre como descuadre alto → "Pendientes de revisar"; debe ser ≥ aviso | Preferencias |
| `arqueo_ciego` | bool (false) | El cajero cuenta sin ver el monto esperado | Cajas |
| `hora_corte` | 0–6 (0) | Hora en que termina el "día del negocio" (se aplica al consultar reportes) | Empresa |
| `facturador` | `sistema` \| `externo` (`sistema`) | Quién emite facturas y documentos de lo adeudado | Métodos de pago |

Además, en `tenant_formula_precio`: el **orden de los pasos** del motor de precios
(permutación de descuentos, recargos e impuestos, entre precio neto y total final).
Se edita en Preferencias. Detalle: [motor-calculo-precios](../features/motor-calculo-precios.md).

---

## 3. Pantallas de configuración (`/configuracion/*`)

El menú de `configuracion.vue` agrupa las pantallas **por lo que configuran**, en el orden en
que se arma un local (owner, 2026-10-02, en el selector interactivo). Cada entrada lleva su
propio gate —la columna *Quién*, que es también la condición del link— y un grupo sin
entradas visibles no muestra el encabezado: un no-admin con solo `Salones:Leer` ve Mi cuenta
y Restaurante, nada más. Las ubicaciones que no son obvias son decisiones, no descuidos; el
owner eligió cada una en el selector, y la razón es la de la opción elegida:

- **Propinas e Impresoras van en Restaurante** aunque un mostrador sin mesas las use: el
  reparto de propinas es entre garzones y cocina, y la impresora principal es la de comanda.
- **Pasarelas va con Métodos de pago en Cobros**, no en Precios: Precios es cuánto vale lo
  vendido; Cobros, cómo se paga.
- **Las dos "Motivos de diferencia"** se distinguen por el grupo (Caja / Inventario); el
  título de la pantalla de inventario sigue diciendo "(inventario)".

Suma: Mi cuenta 1 + Organización 4 + Catálogo 3 + Precios 6 + Cobros 2 + Caja 2 + Inventario 4
+ Restaurante 5 = las 27 entradas del menú plano anterior, cada una una vez.

### Mi cuenta

| Pantalla | Quién | Qué se configura |
|---|---|---|
| **Perfil** | Todo usuario | Nombre, apellido, teléfono, correo; tema (claro/oscuro) y filas por página (10/15/25/50); contraseña; PIN propio si está vinculado a un garzón |

### Organización

| Pantalla | Quién | Qué se configura |
|---|---|---|
| **Empresa** | Admin | Nombre, correo, teléfono, dirección, provincia, hora de corte |
| **Razones sociales** | Admin | Entidades legales: nombre legal, RUT, dirección, teléfono, habilitada, preferida |
| **Usuarios** | Admin | Alta por invitación, roles por miembro, flag "tótem compartido", baja (decidiendo qué pasa con el garzón vinculado) |
| **Roles y permisos** | Admin | Roles (nombre, descripción) y matriz de permisos por módulo contratado |

### Catálogo

| Pantalla | Quién | Qué se configura |
|---|---|---|
| **Items** | `Items:Leer` | Catálogo completo (tipo, precio, moneda, categoría, impuestos, modo de inventario cantidad/serie/lote, recetas, combos, modificadores, frecuencia de suscripción) |
| **Categorías** | Admin | Nombre, aplica a productos/servicios/ambos, impresora de comanda, activa |
| **Grupos de modificadores** | Admin | Grupos reutilizables de opciones (ítem, cantidad, unidad, precio extra) y overrides por receta |

### Precios

| Pantalla | Quién | Qué se configura |
|---|---|---|
| **Preferencias** | Admin | Ver §2: cálculo de descuentos/recargos, fórmula, escala, redondeo, tolerancia, acumulación de promos, umbrales de descuadre |
| **Impuestos** | Admin | Impuestos personalizados: nombre, porcentaje (decimal), activo. Los de sistema (IVA) no se crean acá |
| **Descuentos** | Admin | Reglas: tipo (`directo`, `metodo_pago`, `pronto_pago`, `por_mayor`, `por_monto_venta`), nivel línea/venta, porcentaje o monto fijo, valor único o por tramos, métodos de pago, vigencia |
| **Recargos** | Admin | Reglas: tipo (`general`, `mora`, `recargo_metodo_pago`, `interes_simple`, `interes_compuesto`, `recargo_por_monto_venta`), mismo esquema que descuentos |
| **Promociones** | Admin | Tipo `porcentaje` / `nxm` / `precio_fijo`; fechas, horario, días de la semana, canal (físico/online/ambos), alcance (ítems, categoría, venta) |
| **Monedas** | Admin | Monedas habilitadas y valor del día (la oficial viene del país) |

### Cobros

| Pantalla | Quién | Qué se configura |
|---|---|---|
| **Métodos de pago** | Admin | Por método: habilitado, permite vuelto, quién emite el documento (`sistema`/`maquina`/`nadie`). Por tenant: `facturador` |
| **Pasarelas** | `Pasarelas:Leer` | Pasarela, ambiente (pruebas/producción), modo (mall/individual), códigos de comercio, prioridad, activo; API keys |

### Caja

| Pantalla | Quién | Qué se configura |
|---|---|---|
| **Cajas** | `Cajas:Leer` (arqueo ciego: Admin) | Cajones (nombre, activo, usuarios habilitados) y arqueo ciego |
| **Motivos de diferencia** | Admin | Motivos de descuadre de caja: nombre, activo, requiere comentario |

### Inventario

| Pantalla | Quién | Qué se configura |
|---|---|---|
| **Ubicaciones** | Admin | El local (único, predefinido) y las bodegas |
| **Motivos de baja** | Admin | Nombre, tipo (`merma`/`cortesia`/`no_elaborado`/`consumo_personal`), activo; los fijos no se editan |
| **Motivos de diferencia** | Admin | Motivos de descuadre de recuento |
| **Motivos de traslado** | Admin | Motivos de traslado entre ubicaciones |

**Stock mínimo** (mínimo por ítem y ubicación, para el aviso de stock bajo) no está en este
menú: vive en `/inventario/stock-minimo`, en el grupo Inventario del menú lateral (§1).

### Restaurante

| Pantalla | Quién | Qué se configura |
|---|---|---|
| **Salones** | `Salones:Leer` | Salones y mesas: forma, tamaño, posición en el plano |
| **Garzones** | `Salones:Leer` | Nombre, tipo (garzón/cocina/barra), activo, usuario vinculado, PIN de 6 dígitos, permiso de operar |
| **Turnos** | `Salones:Leer` | Nombre, hora de inicio y fin, activo |
| **Propinas** | `Propinas:Leer` o `Propinas:Configurar` | % sugerido, habilitada en POS y en salones; grupos de reparto (tipo, %, criterio, base de ventas, miembros y pesos) |
| **Impresoras** | `Impresoras:Leer` | Rol (comanda/boleta), conexión red (host, puerto) o sistema (cola), activo |

El listado de garzones (`GET /garzones`) también lo lee quien tiene `Propinas:Leer` —el
reparto los necesita—, pero el link del menú pide `Salones:Leer`.

Los criterios de reparto de propinas son `PARTES_IGUALES`, `VENTAS_NETAS`,
`HORAS_TRABAJADAS`, `CANTIDAD_CUENTAS` y `MANUAL` (por pesos o por montos).

### Rutas que solo redirigen

`/configuracion` → perfil · `/configuracion/inventario` → `/inventario` ·
`/configuracion/mermas` → `/mermas` · `/configuracion/recetas-desfases` → `/desfases` ·
`/configuracion/sesiones-garzon` → `/sesiones-garzon` · `/configuracion/roles/:id` → roles.

---

## 4. Lo que se siembra al crear un tenant

Rol `admin`, fórmula de precio por defecto y caja virtual (CLAUDE.md § Convenciones).

## Ver también

- [ESTADO.md](../ESTADO.md) — qué está construido y qué falta.
- [roles-permisos](../features/roles-permisos.md) — cómo se resuelven los permisos.
- [preferencias-financieras](../features/preferencias-financieras.md) — detalle del motor y del redondeo.
