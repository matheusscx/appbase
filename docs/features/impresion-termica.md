# Feature: Impresión Térmica (Comandas, Precuenta, Boleta)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-13

---

## Overview

### ¿Qué es?

Impresión de tickets térmicos desde el navegador, vía **QZ Tray** (app local que
hace de puente entre el navegador y las impresoras físicas de la red o USB del
dispositivo). Tres documentos: **comanda** (cocina/barra, ruteada por categoría del
ítem), **precuenta** (resumen no fiscal antes de cobrar) y **boleta** (al cerrar una
cuenta de mesa o en el POS de mostrador).

### ¿Por qué existe?

El backend corre en la nube (Railway); las impresoras térmicas del restaurante viven
en la red local y no son alcanzables desde internet. QZ Tray resuelve esto
imprimiendo directo desde el dispositivo del garzón/cajero, que sí está en esa red.

### Scope

- Incluido: CRUD de impresoras (rol `comanda`/`boleta`, conexión de red o cola del
  sistema), ruteo de comanda por `categorias.impresora_id`, envío manual de comanda
  con diff (`cuenta_lineas.cantidad_enviada`), precuenta y boleta desde Salones y
  desde el POS de mostrador.
- NO incluido (futuro): notas por ítem, reimpresión de comandas, impresoras de rol
  dual, certificado firmado de QZ Tray (evita el diálogo de confianza).

---

## API Endpoints

Todos bajo `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`. Módulo RBAC
**`Impresoras`** (`Leer/Crear/Actualizar/Eliminar`).

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/impresoras` | Leer | Lista impresoras del tenant (`?rol=comanda\|boleta`) |
| POST | `/impresoras` | Crear | Crea impresora |
| PATCH | `/impresoras/:id` | Actualizar | Edita datos/activo |
| DELETE | `/impresoras/:id` | Eliminar | Soft delete |

`PATCH /categorias/:id` (endpoint existente) acepta `impresoraId` opcional —
valida que exista, sea del tenant, esté activa y tenga `rol='comanda'`. Acepta
`null` explícito para desasignar la ruta.

La comanda usa **dos fases** (permiso `Salones:Operar`, ver
[salones-mesas.md](./salones-mesas.md)) para no perder pedidos si la impresión del
navegador falla:

- `GET /cuentas/:id/comanda/pendiente` calcula el diff pendiente por línea agrupado
  por impresora y devuelve `{ estaciones: [{ impresoraId, nombre, items: [{ cuentaLineaId, nombre, cantidad, cantidadEnviada }] }] }` **sin persistir nada**.
- `POST /cuentas/:id/comanda` recibe `{ lineas: [{ cuentaLineaId, cantidadEnviada }] }`
  y marca `cantidad_enviada` — lo llama el frontend **por estación, solo tras** imprimir
  OK. Un fallo de QZ Tray deja las estaciones no confirmadas pendientes y reintentables.

Precuenta y boleta no tienen endpoint propio: el frontend arma el ticket con los
datos que ya tiene (resultado del motor de precios + pagos) y lo imprime en la
impresora `rol='boleta'` del tenant.

---

## Backend

- **Módulo**: `src/modules/impresoras/impresoras.module.ts`.
- **Entity**: `Impresora` → tabla `impresoras` (`rol`, `tipoConexion`, `host`/`puerto`
  o `nombreCola` según conexión).
- **`categorias.impresora_id`**: FK nullable a `impresoras` con `rol='comanda'`,
  validada en `CategoriasService`.
- **`cuenta_lineas.cantidad_enviada`**: columna materializada. `SalonesService.
  previewComanda` calcula `diff = cantidad - cantidad_enviada` por línea **sin
  persistir**; `confirmarComanda` marca `cantidad_enviada` (seteando el total
  absoluto, idempotente) dentro de una transacción, recién cuando el navegador
  confirma que imprimió. `fusionarCuentas` suma también `cantidadEnviada` al mergear
  líneas del mismo ítem, para no reenviar lo ya impreso.

---

## Frontend

- **Composable**: `app/composables/useImpresoras.ts` — CRUD + `imprimirComanda`,
  `imprimirPrecuenta`, `imprimirBoleta` (envuelven `qz-tray`).
- **Formateo puro**: `app/utils/ticket-builder.ts` — `buildComandaTicket`,
  `buildPrecuentaTicket`, `buildBoletaTicket` (sin Nuxt/Vue, 100% Vitest).
- **Admin**: `pages/configuracion/impresoras.vue` (CRUD) + selector "Impresora de
  comanda" en `pages/configuracion/categorias.vue`.
- **Operación**: botones "Enviar a cocina" / "Imprimir precuenta" en el drawer de
  cuenta de `pages/salones/index.vue`, boleta automática tras cerrar cuenta o tras
  cobrar en `pages/ventas/pos.vue`.

### QZ Tray

Requiere instalar QZ Tray una vez por dispositivo (tablet/PC del garzón o caja). En
v1 usa el modo **no firmado**: QZ Tray muestra un diálogo "¿Confía en este sitio?" en
cada impresión hasta que el usuario marca "recordar". Firmar la app con certificado
pagado (evita el diálogo) queda como mejora futura opcional.

`qz-tray` se carga de forma **perezosa** (`await import('qz-tray')` dentro de la
función) para no romper el SSR: es una librería solo-navegador. Los tickets se arman
como `string[]` de líneas lógicas y el composable las une con `\n` antes de enviarlas.

La conexión "de red" (`tipoConexion='red'`) abre un socket raw a `host:puerto`
(típico ESC/POS TCP 9100), sin necesidad de instalar la impresora como cola del
sistema operativo.

---

## Testing

### Unit (backend)

```bash
cd backend && npx jest impresoras categorias salones
```

### Unit (frontend)

```bash
cd frontend && npx vitest run app/utils/ticket-builder.spec.ts
```

### Manual

1. `docker-compose down -v && docker-compose up --build` (BD fresca — el seeder es
   idempotente). El seeder crea el módulo Impresoras y 3 impresoras demo en Paris
   (Cocina, Barra — comanda; Caja — boleta) y rutea "Ropa y accesorios" a Cocina.
2. Instalar y abrir QZ Tray en el dispositivo de prueba.
3. En `/salones`, abrir una cuenta, agregar un producto de esa categoría, "Enviar a
   cocina" → imprime; repetir sin cambios → "No hay productos nuevos para enviar".
4. "Imprimir precuenta" → imprime el resumen. Cerrar y cobrar → imprime la boleta.
5. En `/ventas/pos`, cobrar una venta → imprime la boleta.

---

## Decisiones

Ver `docs/superpowers/specs/2026-07-13-impresion-termica-design.md` para el detalle
completo de decisiones (QZ Tray vs. alternativas, ruteo por categoría, `cantidad_
enviada` vs. tabla de historial, envío de comanda manual, dos fases preview/confirmar).

## Related Features

- [salones-mesas.md](./salones-mesas.md)
- [garzones.md](./garzones.md)
- [ventas.md](./ventas.md)
