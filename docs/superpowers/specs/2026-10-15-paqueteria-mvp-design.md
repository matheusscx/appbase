# Paquetería (MVP): repartidores, hojas de ruta y rendición

**Fecha:** 2026-10-15 · **Tipo:** spec de diseño · **Status:** Draft, a revisión del owner.
**Para qué:** un MVP para mostrarle a un cliente (empresa de reparto, mayormente paquetes de
Mercado Libre). No es un frente fiscal: el envío no emite documento tributario.

---

## 0. Cómo se decidió

El owner eligió cada punto el 2026-10-15, en la sesión de brainstorming: las opciones se le
presentaron con su costo (AskUserQuestion) y las secciones de diseño las aprobó en el chat.

| Decisión | Elegida | Descartada, y por qué |
|---|---|---|
| Dónde vive | **Módulo de este SaaS** | App aparte: rehacer login y deploy, y migrar si el cliente compra |
| Repartidor | **Ficha que maneja la oficina, sin login** | Usuario propio con pantalla móvil: suma rol, permisos y UI para la demo |
| Paquete no entregado | **Estados `en_ruta → entregado \| no_entregado`; solo lo entregado suma** | Asignar = pagar (un rechazo descuadra la rendición); pagar la visita igual |
| Qué cobra en destino | **Solo el envío** | Envío + valor del producto (contrarreembolso con plata de un tercero) |
| Valores por defecto | **Uno por empresa, override por paquete** | Tarifa por repartidor; precio por comuna (fase 2) |
| Rendición | **"Rendir" cierra la hoja y congela los totales; no pasa por Caja** | Solo mirar el cálculo; entrar a una Caja (toca cajas: frente aparte) |
| Datos del paquete | **Código (el de ML), destinatario, dirección, remitente opcional** | Sin remitente |
| Carga | **Uno a uno + asignación masiva** | Importar CSV/Excel |
| Modelo | **C: hoja de ruta (repartidor + día) con sus paquetes** | A: todo en el paquete (reasignar pisa el intento anterior y cambia reportes ya rendidos); B: intentos sin cabecera ("el día de Juan" no existe como cosa) |
| Acceso | **Todo con `TenantAdminGuard`** | Sin guard: viola la invariante 6 (un cajero rendiría hojas por API). Los permisos finos van a fase 2 |
| Total general | **Σ `precio_envio` de todos los entregados, con o sin cobro en destino** | — |

## 1. Alcance

**Entra:** configuración de los dos defaults, CRUD de repartidores, CRUD de paquetes,
asignación masiva a una hoja de ruta, marcar entregado / no entregado, rendir la hoja, KPIs
por rango de fechas, seed demo.

**⛔ Fuera (fase 2 o frente propio):** login del repartidor, módulo contratable con permisos
propios (`tenant_modulos`), precio por comuna o por repartidor, importación CSV, integración
con la API de Mercado Libre, contrarreembolso del valor del producto, entrada de la rendición a
una Caja, documento tributario del envío.

## 2. Modelo de datos

Todas las tablas: PK UUID con `type: 'uuid'` explícito, `tenant_id`, `creado_el` /
`actualizado_el` / `eliminado_el`, y toda lectura filtra `eliminado_el IS NULL`. Plata en
`numeric(18,4)` en la **moneda oficial del tenant**, manejada con Decimal.js.

| Tabla | Columnas propias | Restricciones |
|---|---|---|
| `paquete_configuracion` | `precio_envio_defecto`, `pago_repartidor_defecto` | única por tenant (calco de `propina_configuracion`) |
| `repartidores` | `nombre`, `telefono` (nullable), `activo` | — |
| `paquetes` | `codigo`, `destinatario_nombre`, `destinatario_telefono` (nullable), `direccion`, `comuna`, `nota` (nullable), `remitente_tercero_id` (nullable → `terceros`), `cobro_en_destino` (bool), `precio_envio`, `pago_repartidor` | `codigo` único por tenant entre los vivos |
| `hojas_ruta` | `repartidor_id`, `fecha` (`date`, día local del tenant), `estado` (`abierta` \| `rendida`), `rendida_por`, `rendida_el`, totales congelados (`total_asignados`, `total_entregados`, `total_cobro_destino`, `monto_cobrado_destino`, `monto_pago_repartidor`, `neto_a_rendir`) | única por `(tenant, repartidor, fecha)` entre las vivas |
| `hoja_ruta_paquetes` | `hoja_ruta_id`, `paquete_id`, `estado` (`en_ruta` \| `entregado` \| `no_entregado`) | índice único parcial sobre `paquete_id` donde `estado = 'en_ruta'` y vivo: un paquete está en una sola ruta a la vez |

Los totales congelados de `hojas_ruta` son nulos mientras la hoja está abierta; al estar
abierta, se calculan al leer.

## 3. Reglas

1. **Defaults copiados, no referenciados.** El paquete nace con los montos de
   `paquete_configuracion` (el cliente puede mandar otros). Cambiar el default no mueve los
   paquetes existentes.
2. **El estado del paquete se deriva de sus líneas**, no se guarda aparte:
   - *entregado* si tiene una línea `entregado`;
   - *en ruta* si tiene una línea `en_ruta`;
   - *disponible* en cualquier otro caso (nunca salió, o todos sus intentos fueron
     `no_entregado`).
3. **Solo lo entregado suma.** Un `no_entregado` no aporta cobro ni pago al repartidor, y el
   paquete vuelve a quedar disponible para otra hoja, sin borrar el intento anterior.
4. **Totales de una hoja:**
   - `asignados` = líneas de la hoja;
   - `entregados`;
   - `cobro_destino` = cantidad de entregados con `cobro_en_destino`;
   - `monto_cobrado_destino` = Σ `precio_envio` de los entregados con `cobro_en_destino`;
   - `monto_pago_repartidor` = Σ `pago_repartidor` de los entregados;
   - `neto_a_rendir` = cobrado − pago. Si es negativo, la empresa le debe al repartidor y la
     pantalla lo dice así.
5. **Asignar** (`repartidorId`, `fecha`, `paqueteIds[]`): crea la hoja de ese repartidor ese
   día o suma a la existente. Es 400 si la hoja está rendida, si el repartidor está inactivo
   o si algún paquete no está disponible (todo o nada, con la lista de los que fallaron).
6. **Rendir** bloquea la fila de la hoja (`FOR UPDATE`), exige que no quede ninguna línea
   `en_ruta`, congela los totales y anota quién y cuándo. Una hoja rendida es de solo
   lectura: no admite asignar, marcar ni quitar.
7. **Editar un paquete:** se puede mientras no esté *entregado en una hoja rendida*. A partir
   de ahí, montos y `cobro_en_destino` son de solo lectura (cambiarlos movería una rendición
   cerrada).
8. **Borrar un paquete** (soft) solo si está disponible y nunca fue entregado.
   **Quitar de la hoja** (soft sobre la línea) solo con la línea `en_ruta` y la hoja abierta.
9. **Desactivar un repartidor** no toca sus hojas: solo lo saca del selector de asignación.
10. **Plata que entra por la API:** validada en el DTO contra los decimales de la moneda
    oficial (`docs/patterns/backend.md` § 3.1); lo que no cabe es 400. Montos ≥ 0.

### KPIs (por rango de fechas de la hoja)

| KPI | Cálculo |
|---|---|
| Paquetes entregados | cantidad de líneas `entregado` (los asignados se muestran al lado, como referencia) |
| Cobro en destino | cantidad y Σ `precio_envio` de los entregados con `cobro_en_destino` |
| Total general | Σ `precio_envio` de **todos** los entregados, con o sin cobro en destino |
| Total a pagar a repartidores | Σ `pago_repartidor` de los entregados |

Se calculan sobre las líneas, en una sola query agregada; el día se arma con
`rango-fecha.util.ts`.

## 4. API

Todo con `JwtAuthGuard + TenantGuard + TenantAdminGuard`; el `tenantId` sale del token; todo
id que entra se valida como UUID.

```
GET|PUT  /paquetes/configuracion
GET|POST /repartidores                     PATCH|DELETE /repartidores/:id
GET|POST /paquetes                         PATCH|DELETE /paquetes/:id
         GET /paquetes: paginado server-side; filtros estado, cobroEnDestino, búsqueda (código / destinatario)
POST     /hojas-ruta/asignar               { repartidorId, fecha, paqueteIds[] }
GET      /hojas-ruta?desde&hasta           lista con totales (una query agregada, sin N+1)
GET      /hojas-ruta/resumen?desde&hasta   KPIs
GET      /hojas-ruta/:id                   cabecera + líneas
PATCH    /hojas-ruta/:id/paquetes/:paqueteId   { estado: 'entregado' | 'no_entregado' }
POST     /hojas-ruta/:id/entregar-todos    pasa a entregado toda línea en_ruta
DELETE   /hojas-ruta/:id/paquetes/:paqueteId   quitar de la hoja
POST     /hojas-ruta/:id/rendir
```

Backend en `backend/src/modules/paqueteria/`, registrado en `app.module.ts` (también en el
array `entities`).

## 5. Pantallas

Grupo **"Paquetería"** en el menú lateral (`useMenuLateral`), visible solo para el admin.

- **Paquetes** (`/paquetes`): tabla con búsqueda y filtros; *Nuevo paquete* abre un drawer
  con los montos precargados con los defaults; selección múltiple de disponibles →
  *Asignar a repartidor* (repartidor + fecha, por defecto hoy).
- **Rutas** (`/paquetes/rutas`): `AppRangoFechas` arriba, las cuatro tarjetas de KPI del
  rango y una fila por hoja (repartidor, fecha, asignados, entregados, cobro en destino,
  neto a rendir, estado).
- **Detalle de hoja** (`/paquetes/rutas/:id`): totales con el neto destacado; cada paquete
  con *Entregado* / *No entregado* / *Quitar*; *Marcar todos entregados*; **Rendir** con un
  modal que dice *"Juan entrega $50.000"* o *"Se le pagan $X"*, bloqueado mientras quede algo
  en ruta.
- **Configuración → "Paquetería"**: Repartidores (CRUD, activo/inactivo) y Valores por
  defecto.

Montos formateados con los composables existentes de moneda; tokens semánticos de Nuxt UI.

## 6. Seed

En el tenant demo: defaults $10.000 / $5.000, 3 repartidores, ~30 paquetes con códigos con
forma de Mercado Libre (mezcla de pagados y con cobro en destino), dos hojas rendidas en días
anteriores y una abierta hoy, para que la demo abra con números. IDs fijos con el patrón del
seeder.

## 7. Verificación

- **Unitarios** del cálculo de totales: Decimal, neto negativo, `no_entregado` que no suma,
  pagados que suman al total general y no al cobrado en destino.
- **E2E de API** del flujo: crear → asignar → marcar → rendir; y los bloqueos (asignar a hoja
  rendida, paquete en dos hojas, rendir con línea en ruta, editar un paquete rendido, un
  usuario no admin recibe 403, aislamiento entre tenants).
- **Playwright**: recorrer el flujo en el navegador hasta ver el neto rendido.
- Gate completo del `CLAUDE.md` y revisión independiente de `verify-feature`.

## 8. Documentación viva

`docs/features/paqueteria.md` (desde `TEMPLATE.md`) + link en `docs/README.md` + fila en
`docs/ESTADO.md`; `docs/reference/modulos-y-configuraciones.md` (menú y configuración); la
fase 2 (permisos propios y el resto de § 1 Fuera) en `docs/agent/desarrollo-nuevo.md`.
