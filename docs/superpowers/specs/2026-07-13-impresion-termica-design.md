# Diseño: Impresión Térmica (Comandas, Precuenta, Boleta)

**Status**: Draft
**Owner**: Cesar Matheus
**Date**: 2026-07-13

---

## Contexto

El backend corre en Railway (nube); las impresoras térmicas viven en la red local
del restaurante y no son alcanzables directamente desde internet. El proyecto ya
tiene el vertical de restaurante (Salones/Mesas/Garzones) y el POS de mostrador
sobre el mismo `VentasService`.

## Alcance

Tres documentos térmicos, todos impresos **desde el navegador** vía **QZ Tray**
(app local gratuita instalada una vez por dispositivo, que hace de puente entre el
navegador y las impresoras físicas por red — TCP raw, típicamente puerto 9100 — o
por cola del sistema operativo):

- **Comanda** (cocina/barra): botón manual **"Enviar a cocina"** en el drawer de
  cuenta de `/salones`. Imprime solo los ítems **nuevos** desde el último envío,
  agrupados por estación (según categoría del ítem), y marca esos ítems como
  enviados.
- **Precuenta**: botón **"Imprimir precuenta"** en el drawer de cuenta, antes de
  cobrar. Resumen no fiscal del consumo actual.
- **Boleta**: botón **"Imprimir boleta"** tanto al cerrar una cuenta de mesa como
  en el POS de mostrador normal — mismo mecanismo, reusa los datos de la venta ya
  creada.

### Fuera de alcance (v1)

- Notas/instrucciones especiales por ítem (ej. "sin cebolla").
- Reimpresión de la última comanda.
- Impresoras con rol dual (comanda + boleta a la vez).
- Transferencia de ítems ya enviados entre estaciones.
- Certificado firmado de QZ Tray (evita el diálogo de confianza) — mejora futura
  opcional.
- Configuración de corte de papel — se usa el comando de corte estándar del driver.

---

## Decisión de conectividad

Se evaluaron tres approaches para llegar a la impresora física desde un backend
en la nube:

1. **Impresión desde el navegador vía QZ Tray (elegido)** — el dispositivo del
   garzón/cajero (que ya corre el frontend) imprime directo a impresoras de su
   misma red local. No requiere infraestructura nueva del lado del tenant más
   allá de instalar QZ Tray una vez por dispositivo.
2. Agente local con polling al backend — más robusto pero requiere instalar y
   mantener un servicio adicional; descartado por complejidad operativa para v1.
3. Impresoras con IP pública / VPN — descartado por el riesgo de exponer
   impresoras a internet y el costo operativo de mantener VPNs por tenant.

Dentro de "impresión desde el navegador", se eligió **QZ Tray** sobre Web
Serial/WebUSB nativo (solo sirve para impresoras conectadas por USB al mismo
dispositivo, no impresoras de red) y sobre ePOS-Print HTTP (atado a la marca
Epson, con riesgo de mixed-content en frontend https). QZ Tray es genérico,
soporta red y USB, y permite imprimir a varias impresoras desde un solo
dispositivo.

---

## Modelo de datos

### Tabla nueva `impresoras`

| Columna | Tipo | Notas |
|---|---|---|
| `impresora_id` | UUID PK | |
| `tenant_id` | UUID | FK `tenants` |
| `nombre` | TEXT | ej. "Cocina", "Barra", "Caja" |
| `rol` | TEXT | `'comanda'` \| `'boleta'` — una impresora sirve un solo rol |
| `tipo_conexion` | TEXT | `'red'` (host+puerto, ESC/POS TCP) \| `'sistema'` (cola/driver del SO) |
| `host` | TEXT | nullable, requerido si `tipo_conexion = 'red'` |
| `puerto` | INTEGER | nullable, requerido si `tipo_conexion = 'red'` (default 9100) |
| `nombre_cola` | TEXT | nullable, requerido si `tipo_conexion = 'sistema'` |
| `activo` | BOOLEAN | default `true` |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete estándar |

### `categorias` — columna nueva

`impresora_id` (UUID nullable, FK a `impresoras` con `rol = 'comanda'`). Rutea la
comanda de los ítems de esa categoría a la estación correspondiente. Ítems sin
categoría, o cuya categoría no tiene impresora asignada, no generan comanda (se
listan como "sin ruta" en el admin de categorías para que el tenant los
configure).

### `cuenta_lineas` — columna nueva

`cantidad_enviada NUMERIC(18,4) NOT NULL DEFAULT 0`. Al enviar comanda, por cada
línea: `diff = cantidad - cantidad_enviada`; si `diff > 0` se incluye en el
ticket de su estación y se actualiza `cantidad_enviada = cantidad` en la misma
transacción. Resuelve reenvíos parciales (agregar más de un ítem ya enviado) sin
tabla de historial aparte.

Boleta y precuenta no requieren tablas nuevas: usan los datos ya existentes de
`cuentas` / `ventas`.

---

## Backend

### Módulo nuevo `impresoras` (`src/modules/impresoras/`)

RBAC propio `Impresoras` (independiente de `Salones`, porque las boletas también
aplican al POS de mostrador, no solo al vertical de restaurante).

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/impresoras` | `Leer` | Lista impresoras del tenant |
| POST | `/impresoras` | `Crear` | Crea impresora |
| PATCH | `/impresoras/:id` | `Actualizar` | Edita datos/activo |
| DELETE | `/impresoras/:id` | `Eliminar` | Soft delete |

`PATCH /categorias/:id` (endpoint existente) se extiende para aceptar
`impresora_id` opcional.

### Endpoint nuevo en `salones`

`POST /cuentas/:id/comanda` (permiso `Salones:Operar`). Dentro de una
transacción: recorre `cuenta_lineas` de la cuenta, calcula el diff por línea,
actualiza `cantidad_enviada`, y devuelve los ítems nuevos agrupados por
impresora de estación:

```json
{
  "estaciones": [
    {
      "impresoraId": "uuid",
      "nombre": "Cocina",
      "items": [{ "nombre": "Lomo a lo pobre", "cantidad": "2" }]
    }
  ]
}
```

Si no hay diffs, devuelve `estaciones: []` y el frontend no imprime nada.

Boleta/precuenta no requieren endpoint nuevo: el frontend arma el ticket con los
datos que ya trae de `GET /cuentas/:id` (precuenta) o de la respuesta de
`POST /cuentas/:id/cerrar` / `POST /ventas` (boleta), más
`GET /impresoras?rol=boleta` para resolver a qué impresora mandarlo.

---

## Frontend

**Librería:** `qz-tray` (paquete npm oficial), certificado no firmado en v1 (ver
Decisiones).

**Composable nuevo `useImpresoras.ts`:**

- `listar/crear/actualizar/eliminar` — CRUD de impresoras vía `useApiFetch`.
- `conectar()` — `qz.websocket.connect()` contra la instancia local de QZ Tray.
- `imprimirComanda(cuentaId)` — llama `POST /cuentas/:id/comanda`; por cada
  estación en la respuesta arma el ticket ESC/POS (estación, mesa, cuenta,
  garzón, ítems + cantidad, hora) y lo envía con `qz.print(...)` resolviendo
  host/puerto o cola desde la config de esa impresora.
- `imprimirPrecuenta(cuenta)` / `imprimirBoleta(venta)` — arman el ticket
  (encabezado del tenant, ítems, subtotales, descuentos/recargos/impuestos,
  total, medios de pago) usando `useFormatters` para moneda/fecha, y lo envían a
  la impresora `rol = 'boleta'` del tenant.

**UI:**

- `pages/configuracion/impresoras.vue` — CRUD de impresoras (mismo patrón que
  `configuracion/garzones.vue`).
- Admin de categorías gana un selector "Impresora de comanda" por categoría.
- `pages/salones/index.vue` (drawer de cuenta) gana botones **"Enviar a
  cocina"**, **"Imprimir precuenta"** y, tras cerrar, **"Imprimir boleta"**.
- POS de mostrador gana **"Imprimir boleta"** tras confirmar el pago.

Si QZ Tray no está corriendo/instalado, los botones muestran un error claro
("QZ Tray no detectado") sin bloquear el flujo normal de cobro — imprimir es
siempre una acción adicional, nunca bloqueante.

---

## Manejo de errores

- Impresora offline/no encontrada al imprimir → toast de error con el nombre de
  la estación que falló; las demás estaciones que sí respondieron ya imprimieron
  (no es atómico entre estaciones).
- Comanda: el diff queda marcado como `enviado` en BD aunque la impresión física
  falle (se prioriza simplicidad; reimprimir queda fuera de alcance v1).
- QZ Tray no instalado/no conectado → mensaje explícito, no bloquea cobro ni
  cierre de cuenta.

---

## Decisiones

- **QZ Tray** sobre agente local propio o VPN/IP pública: menor infraestructura
  nueva, reutiliza una app ya madura y ampliamente usada en POS web.
- **Certificado no firmado en v1**: QZ Tray mostrará el diálogo "¿Confía en este
  sitio?" en cada impresión hasta que el usuario marque "recordar". Firmar la
  app con certificado pagado queda como mejora futura opcional, no bloqueante.
- **Ruteo por categoría → impresora**: reusa el modelo existente de categorías en
  vez de crear un concepto nuevo de "estación".
- **`cantidad_enviada` en vez de tabla de historial**: resuelve el diff de forma
  simple y consistente con el patrón de columnas materializadas del proyecto
  (ej. `item_producto.stock`).
- **Envío de comanda manual, no automático**: evita comandas prematuras o
  duplicadas mientras el garzón sigue armando el pedido.
- **Módulo RBAC `Impresoras` propio**, no reutiliza `Salones`, porque las
  boletas también aplican al POS de mostrador.

## Related Features

- [salones-mesas.md](../../features/salones-mesas.md)
- [garzones.md](../../features/garzones.md)
- [ventas.md](../../features/ventas.md)
