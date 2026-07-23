# Spec: Habilitar propinas por canal (POS / Salones)

**Fecha**: 2026-07-23
**Owner**: Cesar Matheus
**Status**: Diseño aprobado — pendiente de plan

---

## Problema

Hoy la propina se ofrece **siempre** en los dos canales de cobro:

| Canal | Front | Entrada backend | % sugerido (endpoint / permiso) |
|---|---|---|---|
| **POS** | `pages/ventas/pos.vue` → `CobroModal modoPropina` | `dto.propinaDirecta` en `POST /ventas` | `GET /propinas/porcentaje-sugerido-venta` (`Ventas:Crear`) |
| **Salones** | `pages/salones/index.vue` → `CobroModal modoPropina` | `dto.propinaCierreMesa` (salones arma esto y crea la venta por la misma vía) | `GET /propinas/porcentaje-sugerido` (`Salones:Operar`) |

El administrador del tenant no puede decidir en qué canal(es) se cobra propina.
Algunos negocios cobran propina en mesa pero no en mostrador, o viceversa.

## Objetivo

Dar al admin dos interruptores en la configuración de propinas para habilitar/
deshabilitar la propina **por canal** (POS y Salones), de forma independiente,
con enforcement real en el backend.

## No incluido (YAGNI)

- No hay un tercer canal (online) que cobre propina hoy; el diseño no construye
  infraestructura especulativa para más canales. Si aparece, se agrega otra
  columna/flag siguiendo el mismo patrón.
- No cambia el motor de reparto, ni el `porcentaje_sugerido`, ni la config de
  distribución de grupos.
- No hay historial/auditoría de quién apagó un canal más allá del versionado que
  ya trae `propina_configuracion`.

---

## Decisiones de diseño (tomadas con el owner)

1. **Enforcement front + backend.** El front oculta el input de propina en el
   canal apagado; el backend además ignora una propina que llegue por un canal
   deshabilitado. Coherente con la invariante 6 (enforcement real en backend).
2. **Al recibir una propina por un canal deshabilitado: ignorar, no rechazar.**
   La venta se registra igual, **sin** `venta_propina`. No se traba el cobro por
   un cliente desincronizado. El toggle "gana" en silencio.
3. **Los flags viven en `propina_configuracion`** (config versionada, misma tabla
   y misma pantalla que `porcentaje_sugerido`). Cambiarlos pasa por el mismo
   `PUT /propinas/distribucion` que ya bumpea `version`.
4. **Default `true`** en ambos flags → los tenants existentes y los nuevos
   conservan el comportamiento actual (propina en ambos canales) sin migración de
   datos manual.

---

## Diseño

### 1. Base de datos — 2 columnas en `propina_configuracion`

```sql
habilitado_pos      BOOLEAN NOT NULL DEFAULT true
habilitado_salones  BOOLEAN NOT NULL DEFAULT true
```

Archivos:
- `startup-pos.sql` — agregar ambas columnas a `CREATE TABLE propina_configuracion`.
- `backend/src/modules/propinas/entities/propina-configuracion.entity.ts` — dos
  `@Column({ type: 'boolean', default: true })`.
- Seeder: al sembrar `propina_configuracion` (default por tenant + Paris), ambos
  quedan en `true` (lo cubre el default de columna; verificar que el seed no
  inserte columnas explícitas que lo pisen).

Sin migración de datos: el `DEFAULT true` cubre las filas existentes en una BD ya
poblada; en dev la BD se resetea (`docker-compose down -v`).

### 2. Backend — lectura para el gating del front

Los dos endpoints por canal ya existen y el front ya los llama una vez por canal.
Cada uno agrega **solo el flag de su canal**:

| Endpoint | Permiso | Devuelve hoy | Agrega |
|---|---|---|---|
| `GET /propinas/porcentaje-sugerido-venta` (POS) | `Ventas:Crear` | `{ porcentajeSugerido }` | `habilitado: boolean` ← `habilitado_pos` |
| `GET /propinas/porcentaje-sugerido` (Salones) | `Salones:Operar` | `{ porcentajeSugerido }` | `habilitado: boolean` ← `habilitado_salones` |

`PropinaDistribucionService.obtenerPorcentajeSugerido()` pasa a devolver
`{ porcentajeSugerido, habilitado }`. Como cada endpoint expone un canal distinto,
o bien el método recibe qué canal se consulta, o se agrega un método hermano por
canal — a decidir en el plan (preferir no duplicar la query).

`GET /propinas/distribucion` (pantalla de config) devuelve **ambos** flags en su
respuesta para que la UI de configuración los muestre.

### 3. Backend — escritura

`UpdateDistribucionDto` suma:

```ts
@IsOptional()
@IsBoolean()
habilitadoPos?: boolean;

@IsOptional()
@IsBoolean()
habilitadoSalones?: boolean;
```

Opcionales para no romper llamadas que no los manden; si faltan, se conserva el
valor actual (o `true` si es la creación del default). `PropinaDistribucionService
.reemplazar` los persiste en `propina_configuracion`.

### 4. Backend — enforcement (choke point único)

Ambos caminos de propina convergen en `ventas.service.ts` (~L474–524), antes de
crear la `venta_propina`. Ahí:

1. Cargar `habilitado_pos` / `habilitado_salones` de `propina_configuracion` del
   tenant **dentro de la misma transacción** (una lectura, indexada por
   `tenant_id`, sin N+1).
2. Si `dto.propinaDirecta` (POS) y `!habilitado_pos` → **no crear** la propina; la
   venta continúa sin tip (`ventaPropinaId = null`, `propinaMonto = '0'`).
3. Si `dto.propinaCierreMesa` (Salones) y `!habilitado_salones` → ídem.

El resto del flujo (pagos, referencia_id) ya maneja el caso "sin propina", así que
ignorar es simplemente no entrar a la rama de creación.

### 5. Frontend — UI de configuración

Dos `USwitch` en `pages/configuracion/propinas-distribucion.vue`:
- "Habilitar propina en POS"
- "Habilitar propina en Salones"

Se agregan al body del `PUT` que ya envía la pantalla, vía `usePropinaDistribucion`.
Tokens semánticos de Nuxt UI (sin Tailwind hardcoded).

### 6. Frontend — gating por canal

- `pages/ventas/pos.vue`: leer `habilitado` del fetch de `porcentaje-sugerido-venta`.
  Si es `false`, no pasar `modo-propina` al `CobroModal` ni armar `propinaDirecta`
  en el body de la venta.
- `pages/salones/index.vue`: leer `habilitado` del fetch de `porcentaje-sugerido`.
  Si es `false`, ídem para el cierre de mesa (`CobroModal modoPropina`, `propina`/
  `propinaSugerida`).

`usePropina.ts` (`fetchPorcentajeSugerido` / `fetchPorcentajeSugeridoVenta`) pasa a
devolver también `habilitado` (hoy devuelven solo el string del porcentaje).

---

## Testing

- **Unit backend**
  - `propina-distribucion.service`: persistir y leer `habilitadoPos` /
    `habilitadoSalones`; default `true` cuando el body no los manda.
  - `ventas.service`: 2 casos de enforcement — con POS deshabilitado + propina
    directa la venta se crea sin `venta_propina`; ídem salones deshabilitado +
    cierre de mesa.
- **E2E API** (`liquidacion-propinas.e2e-spec.ts` o `ventas.e2e-spec.ts`):
  deshabilitar POS vía `PUT /propinas/distribucion` real → `POST /ventas` con
  `propinaDirecta` → assert que la venta quedó sin `venta_propina` y que el pool no
  la ve. Restaurar la config en `afterAll` (mismo patrón que el bloque de config
  alternativa ya existente).
- **Front**: build + typecheck; smoke manual del toggle apagando cada canal y
  verificando que el `CobroModal` no ofrece propina.

## Documentación a actualizar (mismo commit)

- `docs/features/liquidacion-propinas-config.md` — nuevos flags en la config.
- `docs/features/pagos.md` — sección "Propina en el POS": la propina POS depende de
  `habilitado_pos`.
- `docs/ESTADO.md` — fila de la feature.

---

## Invariantes / detenerse

- No toca el motor de cálculo de precios ni impuestos.
- No escribe en `movimientos_inventario`.
- Dinero/porcentajes siguen en Decimal.js; los flags son booleanos, ajenos a eso.
- Soft delete y `tenant_id` desde el token intactos.
- Enforcement en backend (invariante 6): el toggle no se queda solo en el front.

## Riesgos / notas

- **Compat del PUT**: la pantalla manda el body completo; flags opcionales con
  default `true` evitan romper cualquier llamada que no los incluya.
- **`porcentaje_sugerido` independiente**: apagar un canal no borra el %; si se
  reactiva, el % vuelve como estaba.
- **Choke point**: verificar en el plan que `dto.propinaCierreMesa` proviene
  exclusivamente de salones y `dto.propinaDirecta` exclusivamente del POS, para que
  el mapeo flag↔canal sea correcto.
