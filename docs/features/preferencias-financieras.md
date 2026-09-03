# Feature: Preferencias Financieras

**Status**: Complete  
**Owner**: Desarrollo Backend/Frontend  
**Last Updated**: 2026-08-21

---

## Overview

### What is it?

Preferencias Financieras es una pantalla de configuración que permite al administrador del tenant personalizar cómo se calculan los precios finales de venta. Específicamente:

1. **Modo de cálculo de descuentos**: `base` (todos los descuentos se aplican sobre el precio neto) o `compuesto` (cada descuento se aplica en cascada sobre el resultado anterior).
2. **Modo de cálculo de recargos**: `base` (todos sobre precio neto) o `compuesto` (en cascada).
3. **Orden de la fórmula de precios**: reordenar los tres pasos (descuentos, recargos, impuestos) en la secuencia que prefiera.
4. **Escala de cálculo** (`escalaCalculo`, default 6): la precisión del **borrador**, o sea de los cálculos intermedios. Con `nivelRedondeo = 'linea'` **no decide nada de lo persistido** — eso lo decide la escala de la moneda oficial. Con `'documento'` sí, porque ahí las líneas se guardan sin cuantizar: por eso esa combinación tiene tope 4 (ver la validación del service).
5. **Modo de redondeo** (`modoRedondeo`, default `HALF_UP`): con qué criterio se redondea (`HALF_UP` | `HALF_EVEN` | `FLOOR` | `CEIL`). Es el modo que usa la cuantización final, así que hoy los cuatro producen totales distintos sobre el mismo carrito.
6. **Nivel de redondeo** (`nivelRedondeo`, default `linea`): `linea` (cada línea de la venta se cuantiza a la escala de la moneda y el total es la suma) o `documento` (las líneas quedan a `escalaCalculo` y solo el total final se cuantiza — la regla mexicana). El motor de cálculo de precios la consume vía `ConfigCalculo`.
7. **Tolerancia de conciliación** (`montoTolerancia`, default `'0'`): diferencia máxima permitida antes de rechazar una conciliación.
8. **Avisar al cajero desde** (`umbralDescuadreAviso`, default `'0'`) y 9. **Avisar al encargado desde** (`umbralDescuadreAlto`, default `'0'`): los dos umbrales de descuadre al **cerrar caja**. Ninguno bloquea el cierre; el alto además deja el cierre en la bandeja de pendientes de revisar. ⚠️ **Acá `'0'` DESACTIVA el umbral**, al revés que `montoTolerancia` de arriba, donde `0` es "cero tolerancia" — con `0` activo cualquier peso dispararía, y un control que avisa siempre deja de avisar. Regla completa: [`gestion-cajas.md`](./gestion-cajas.md#umbral-de-descuadre-al-cierre--dos-niveles-ninguno-bloquea).

⚠️ **Esta lista enumeraba 3 campos cuando la pantalla mostraba 6.** Se corrigió el 2026-08-21, contando los controles del `.vue` en vez de asumirlos: hoy son **9** (eran 7 hasta que el umbral de descuadre agregó dos el 2026-08-23), y `nivelRedondeo` es el que agregó el frente de redondeo de plata.

La configuración se persiste en la base de datos y **el motor de cálculo de precios la consume en cada venta** desde junio de 2026 (ver [motor-calculo-precios.md](./motor-calculo-precios.md)). Este documento decía *"pendiente"* hasta el 2026-08-21.

### Why does it exist?

Diferentes tipos de negocio y regímenes fiscales requieren distintas estrategias de cálculo de precios. Algunos aplican todos los descuentos sobre el precio base; otros los aplican en cascada. El orden de aplicación de impuestos, descuentos y recargos también varía según la jurisdicción. Esta pantalla permite a cada tenant configurar su propia lógica sin cambiar el código.

### Scope

- **Included in this version:**
  - Lectura y escritura de preferencias (`GET` y `PUT`)
  - Validación de la fórmula (contiene exactamente los 3 pasos, sin duplicados)
  - Validación de la matriz `nivelRedondeo` × moneda oficial × `escalaCalculo`: rechaza
    `documento` con moneda de 0 decimales, `escalaCalculo` menor que los decimales de la
    moneda oficial, y `documento` con `escalaCalculo` mayor que 4
  - Persistencia en `tenants.calculo_descuentos`, `tenants.calculo_recargos`,
    `tenants.nivel_redondeo`, y tabla `tenant_formula_precio`
  - **El candado del país sobre las dos perillas de redondeo** (2026-09-03): el país
    fija el default con el que nace el tenant y, donde la norma lo exige, la perilla
    queda cerrada. Ver *"El país manda donde la norma lo dice"*, más abajo
  - Acceso restringido a admin del tenant (guard RBAC)
  
- **NOT included (future):**
  - Interfaz gráfica de reordenamiento interactivo (drag-and-drop); la v1 espera un array en el body
  - Evaluación de condiciones de descuentos/recargos (`monto_minimo`, `cantidad_minima`, etc.)

---

## API Endpoints

### GET /api/tenants/preferencias-financieras

Recupera las preferencias financieras del tenant actual.

```
GET /api/tenants/preferencias-financieras

Authorization: Bearer <access_token>

Response (200):
{
  "calculoDescuentos": "base",
  "calculoRecargos": "compuesto",
  "formula": ["descuentos", "recargos", "impuestos"],
  "escalaCalculo": 6,
  "modoRedondeo": "HALF_UP",
  "nivelRedondeo": "linea",
  "montoTolerancia": "0",

  // El candado del país, por perilla. `Impuesto` es el valor que la norma
  // obliga y NO es redundante con el guardado de arriba; `Norma` es el texto
  // que la pantalla muestra como motivo. Los tres salen sólo con `es_ley`.
  "modoRedondeoBloqueado": false,
  "modoRedondeoImpuesto": null,
  "modoRedondeoNorma": null,
  "nivelRedondeoBloqueado": false,
  "nivelRedondeoImpuesto": null,
  "nivelRedondeoNorma": null
}
```

---

### PUT /api/tenants/preferencias-financieras

Actualiza las preferencias financieras del tenant. Requiere rol admin.

```
PUT /api/tenants/preferencias-financieras

Authorization: Bearer <access_token>

Request:
{
  "calculoDescuentos": "compuesto",
  "calculoRecargos": "base",
  "formula": ["recargos", "descuentos", "impuestos"],
  "escalaCalculo": 4,
  "modoRedondeo": "HALF_EVEN",
  "nivelRedondeo": "linea",
  "montoTolerancia": "1500"
}

Response (200):
{
  "calculoDescuentos": "compuesto",
  "calculoRecargos": "base",
  "formula": ["recargos", "descuentos", "impuestos"],
  "escalaCalculo": 4,
  "modoRedondeo": "HALF_EVEN",
  "nivelRedondeo": "linea",
  "montoTolerancia": "1500"
}

Response (400):
{
  "message": "Formula debe contener exactamente ['descuentos', 'recargos', 'impuestos'] sin duplicados",
  "statusCode": 400
}

Response (400) — matriz nivelRedondeo × moneda:
{
  "message": "El nivel \"documento\" deja decimales en las líneas y la moneda oficial del tenant no admite decimales. Usá \"linea\".",
  "statusCode": 400
}

Response (400) — matriz nivelRedondeo × escalaCalculo:
{
  "message": "El nivel \"documento\" persiste las líneas con la escala de cálculo (6 decimales) y las columnas de dinero son NUMERIC(18,4): el recorte lo terminaría decidiendo Postgres, fuera del modo de redondeo del tenant. Bajá la escala de cálculo a 4 o menos, o usá \"linea\".",
  "statusCode": 400
}

Response (400) — escala de `montoTolerancia` (`EscalaMonedaPipe`):
{
  "message": "montoTolerancia tiene más decimales de los que admite la moneda (0).",
  "statusCode": 400
}
```

⚠️ **`montoTolerancia` es un monto cobrado, no un número libre.** El ejemplo de arriba
usa `"1500"` a propósito: para todo tenant sembrado la moneda oficial es CLP (0
decimales), así que un `"1.5"` —que este documento mostraba como request válido hasta
el 2026-08-21— hoy es un 400. En un tenant en dólares `"1.5"` sí entra.

---

## Backend

### Module & Services

- **Module**: `src/modules/tenants/tenants.module.ts`
- **Controller**: `src/modules/tenants/tenants.controller.ts`
- **Service**: `src/modules/tenants/tenants.service.ts`

Se integra en el módulo de tenants existente (no es un módulo nuevo).

### Entity & Database

**Tables**:

1. **`tenants`** (columnas nuevas/modificadas)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Ya existe |
| `calculo_descuentos` | TEXT | NOT NULL, default 'base' | Valores: 'base', 'compuesto' |
| `calculo_recargos` | TEXT | NOT NULL, default 'base' | Valores: 'base', 'compuesto' |
| `escala_calculo` | SMALLINT | NOT NULL, default 6 | Decimales para cálculos intermedios (0–12) |
| `modo_redondeo` | TEXT | NOT NULL, default 'HALF_UP' | Valores: 'HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL' |
| `nivel_redondeo` | TEXT | NOT NULL, default 'linea', CHECK IN ('linea','documento') | 'linea' cuantiza cada línea; 'documento' solo el total (regla mexicana) |
| `monto_tolerancia` | NUMERIC(18,6) | NOT NULL, default 0 | Tolerancia máxima en conciliaciones |
| `umbral_descuadre_aviso` | NUMERIC(18,4) | NOT NULL, default 0 | Umbral de AVISO del descuadre al cierre de caja. `0` = desactivado |
| `umbral_descuadre_alto` | NUMERIC(18,4) | NOT NULL, default 0 | Umbral ALTO: manda el cierre a la bandeja de revisión. `0` = desactivado. Escala 4 (no 6) porque se compara contra `caja_arqueo_medio.diferencia`, que es NUMERIC(18,4) |

2. **`tenant_formula_precio`** (tabla nueva)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `tenant_id` | UUID | PK, FK (tenants.id) | Identifica el tenant |
| `paso` | SMALLINT | PK | 1, 2, 3 — orden de aplicación |
| `tipo` | TEXT | NOT NULL | Valores: 'descuentos', 'recargos', 'impuestos' |
| `creado_el` | TIMESTAMPTZ | default NOW() | Timestamp de creación |
| `actualizado_el` | TIMESTAMPTZ | default NOW() | Timestamp de actualización |

**Índices**: 
- PK compuesto: `(tenant_id, paso)`
- Único: `(tenant_id, tipo)` — garantiza que no hay duplicados de tipo en la fórmula

### DTOs

```typescript
// GET response + PUT request/response
export class PreferenciasFinancierasDto {
  calculoDescuentos: 'base' | 'compuesto';
  calculoRecargos: 'base' | 'compuesto';
  formula: ('descuentos' | 'recargos' | 'impuestos')[];
  escalaCalculo: number;        // entero 0-12
  modoRedondeo: string;         // 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL'
  nivelRedondeo: string;        // 'linea' | 'documento'
  montoTolerancia: string;      // numeric como string (Decimal.js)
  umbralDescuadreAviso: string; // idem — '0' desactiva
  umbralDescuadreAlto: string;  // idem — '0' desactiva
}

// PUT request
export class UpdatePreferenciasFinancierasDto {
  calculoDescuentos: 'base' | 'compuesto';
  calculoRecargos: 'base' | 'compuesto';
  formula: ('descuentos' | 'recargos' | 'impuestos')[];
  escalaCalculo: number;        // @IsInt @Min(0) @Max(12)
  modoRedondeo: string;         // @IsIn(['HALF_UP','HALF_EVEN','FLOOR','CEIL'])
  nivelRedondeo: string;        // @IsIn(['linea','documento'])
  montoTolerancia: string;      // @IsNumberString @IsDecimalNoNegativo @EsMontoCobrado
  umbralDescuadreAviso: string; // idem
  umbralDescuadreAlto: string;  // idem — el service exige además alto >= aviso
}
```

Validación con `class-validator`:
- `formula` debe ser un array con exactamente 3 elementos
- Cada elemento debe ser uno de: 'descuentos', 'recargos', 'impuestos'
- No hay duplicados
- `escalaCalculo`: entero entre 0 y 12
- `modoRedondeo`: uno de 'HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL'
- `nivelRedondeo`: 'linea' o 'documento'
- `montoTolerancia`: number string, nunca negativo, y con **como mucho los decimales que
  admite la moneda oficial del tenant** (`@EsMontoCobrado()` + `EscalaMonedaPipe`, colgado
  del `@Body` de esta ruta). En CLP eso es cero: `"1.5"` es un 400.
- `umbralDescuadreAviso` / `umbralDescuadreAlto`: misma regla de signo y escala. La
  relación **entre** los dos (con ambos activos, `alto >= aviso`) no la puede expresar un
  decorador de campo y la valida el service: con el alto por debajo, el nivel de aviso
  sería inalcanzable.

Validación adicional en el service (no expresable con `class-validator`, depende de la
moneda oficial del tenant — `MonedasService.decimalesOficiales`). Son **tres** reglas, y
las tres existen por la misma razón: que ninguna combinación configurable devuelva el
último redondeo al cast de Postgres.
- `nivelRedondeo = 'documento'` con moneda oficial de 0 decimales → 400. Las líneas
  quedarían con decimales que la moneda no puede representar; es exactamente el bug que
  el frente de redondeo de plata vino a cerrar, ofrecido como opción de configuración.
- `escalaCalculo` menor que los decimales de la moneda oficial → 400. El borrador de los
  cálculos intermedios no puede ser más grueso que el resultado final.
- `nivelRedondeo = 'documento'` con `escalaCalculo` mayor que **4** → 400. Con
  `'documento'` las líneas se persisten sin cuantizar, formateadas a `escalaCalculo`, y
  toda columna de plata de `venta_detalles` es `NUMERIC(18,4)`: una escala mayor deja el
  recorte final en manos de Postgres y rompe la identidad `Σ totalLinea − dv + rv =
  totalFinal` al releer las filas. El tope es la escala de la **columna**, no los
  decimales de la moneda, porque lo que se controla es lo que entra a la columna. Con
  `'linea'` no aplica: ahí el valor ya sale cuantizado a los decimales de la moneda (≤ 4
  por el `@Check` de `moneda.decimales`) y lo que agrega el formateo son ceros — por eso
  el default sembrado (escala 6, nivel `'linea'`) sigue siendo válido.

### El país manda donde la norma lo dice

Las dos perillas de redondeo no son solo preferencia: en varios países de LatAm la
norma fija el criterio. Cada fila de `pais` lleva **un trío por perilla** — el valor
sugerido, si además es **ley**, y la **norma** que lo dice — y dos `@Check` impiden
declarar "es ley" sin un valor que imponer.

| País | Modo | Nivel | Norma citada |
|---|---|---|---|
| Chile | `HALF_UP` sugerido, sin ley | `linea` sugerido, sin ley | — (lo que tenemos es una **inferencia** del formato del DTE, no una frase del SII: por eso no lleva candado) |
| Argentina | **`HALF_EVEN`, es ley** | libre | ARCA/AFIP, manual del desarrollador (RG 4291) |
| Colombia | **`HALF_EVEN`, es ley** | libre | DIAN, anexo técnico v1.9 (Res. 000165/2023) § 5.2.1, NTC 3711 |
| México | libre | **`documento`, es ley** | SAT, Anexo 20 |

Tres consecuencias que no se deducen de la tabla:

1. **El candado es por PERILLA, no por país.** México fija el nivel y deja libre el
   modo; Argentina al revés. Un guard "el tenant es de un país con ley" sería incorrecto.
2. **Al crear el tenant el país empuja su default** (`TenantsService.create`, una sola
   query para las dos perillas). Y con `'documento'` la escala nace en **4**, no en 6:
   es la única forma de que el tenant no nazca en un estado que su propia API rechaza
   (ver la tercera validación de más abajo). El Anexo 20 habla de 6 decimales por línea
   y las columnas admiten 4 — la diferencia está medida y anotada en
   [`pendientes.md`](../agent/pendientes.md) § 3.
3. **El guard compara contra el VALOR, no contra "vino la clave".** La pantalla manda la
   configuración entera en cada guardado: rechazar por presencia rompería el guardado de
   todas las demás preferencias. Mandar el mismo valor que impone la norma es un `200`.

El `GET` viaja con `<perilla>Bloqueado`, `<perilla>Impuesto` y `<perilla>Norma`. El
**valor impuesto no es redundante** con el guardado: un tenant creado antes de que la
regla existiera tiene persistido otro, y una pantalla que solo deshabilitara el control
sobre lo guardado le rebotaría con 400 **todos** sus guardados, sin salida por la UI.

La norma tampoco es decorativa: es literalmente el texto que la pantalla muestra como
motivo. Un candado sin explicación se lee como un bug del sistema, no como una regla del
país.

→ Diseño y relevamiento: [`spec`](../superpowers/specs/2026-09-03-redondeo-por-pais-design.md)
y [la investigación de ocho países](../agent/investigaciones/2026-09-03-redondeo-por-pais-latam.md).

### Key Methods

**Service**:
- `getPreferenciasFinancieras(tenantId: string): Promise<PreferenciasFinancierasDto>` — Lee de `tenants` y `tenant_formula_precio`
- `updatePreferenciasFinancieras(tenantId: string, dto: UpdatePreferenciasFinancierasDto): Promise<PreferenciasFinancierasDto>` — Actualiza ambas tablas en una transacción

**Controller**:
- `GET /api/tenants/preferencias-financieras` — Endpoint admin-only (TenantAdminGuard)
- `PUT /api/tenants/preferencias-financieras` — Endpoint admin-only (TenantAdminGuard)

---

## Frontend

### Pages

- `pages/configuracion/preferencias-financieras.vue` — Única página, muestra formulario de edición en línea (edit-inline)

### Components

La página usa estado local (`ref`) — sin Pinia store. Secciones del formulario:
- `URadioGroup` para `calculoDescuentos` y `calculoRecargos`
- Lista reordenable (botones arriba/abajo) para `formula`
- Sección "Precisión y redondeo":
  - `UInput type="number"` para `escalaCalculo` (entero real → excepción del patrón, @IsInt).
    Su `max` **no es fijo**: baja a **4** cuando el nivel es `'documento'`, porque el
    backend rechaza con 400 toda escala mayor con ese nivel. Mismo criterio que
    `MoneyInput oficial` con los decimales de la moneda: no dejar tipear lo que el
    backend va a rechazar
  - `URadioGroup` con 4 opciones para `modoRedondeo`
  - `URadioGroup` con 2 opciones para `nivelRedondeo` ("Por línea" / "Por documento"),
    con texto de ayuda en lenguaje de negocio, no técnico
  - **Los dos vienen `:disabled` cuando el país los fija por ley**, con la norma en el
    `description` de su `UFormField` — el motivo va debajo de **su** perilla, no de la
    vecina. Y cuando lo guardado no coincide con lo que impone la norma, el texto lo
    dice: hasta que alguien guarde, el motor de precios sigue calculando con el viejo
  - `MoneyInput oficial` para `montoTolerancia` (string end-to-end): es un monto cobrado
    en la moneda oficial y el backend lo rechaza con 400 si trae más decimales de los que
    ésta admite, así que el input no lo deja tipear. Era un `UInput inputmode="decimal"`
    hasta el 2026-08-21 — mismo caso que el monto manual de propinas
- Sección "Diferencias al cerrar caja": dos `MoneyInput oficial`
  (`umbralDescuadreAviso` / `umbralDescuadreAlto`) con el texto que explica que ninguno
  frena el cierre y que `0` apaga el umbral, más un enlace a `/cajas/tendencia` — el
  número se elige mirando la distribución real, no a ojo
- Botón guardar

### State

```typescript
{
  calculoDescuentos: 'base' | 'compuesto' — ref
  calculoRecargos: 'base' | 'compuesto'   — ref
  formula: string[]                        — ref
  escalaCalculo: number                    — ref (default 6)
  modoRedondeo: string                     — ref (default 'HALF_UP')
  nivelRedondeo: string                    — ref (default 'linea')
  montoTolerancia: string                  — ref (default '0', string end-to-end)
  umbralDescuadreAviso: string             — ref (default '0' = desactivado)
  umbralDescuadreAlto: string              — ref (default '0' = desactivado)

  // El candado del país. Los dos `Bloqueado` y los dos `Norma` llegan del GET;
  // los `Desalineado` los deriva `cargar()` comparando lo que vino guardado
  // contra el valor que quedó en la perilla — el `Impuesto` no vive en un ref
  // porque su único uso es pisar ese valor al cargar.
  modoRedondeoBloqueado: boolean           — ref (default false)
  modoRedondeoNorma: string | null         — ref
  modoRedondeoDesalineado: boolean         — ref (default false)
  nivelRedondeoBloqueado: boolean          — ref (default false)
  nivelRedondeoNorma: string | null        — ref
  nivelRedondeoDesalineado: boolean        — ref (default false)
  escalaBajadaPorElNivel: boolean          — ref (default false)
}
```

⚠️ **Con la perilla bloqueada, `cargar()` pisa el valor guardado con el que impone la
norma.** No es cosmética: el `PUT` rechaza con 400 cualquier otro valor, y la pantalla
manda la configuración **entera** en cada guardado — así que mostrar el valor viejo
dejaría a ese tenant sin poder guardar **ninguna** preferencia, ni las que nada tienen
que ver con el redondeo.

Tres consecuencias de ese pisado, y las tres tienen test:

1. **Cuando pisa, lo dice.** Hasta que alguien guarde, el motor de precios sigue
   calculando con el valor viejo: el aviso no puede afirmar en presente lo que todavía
   no es cierto.
2. **Y deja de decirlo al guardar.** `guardar()` apaga los tres flags en el éxito —
   dejar la frase debajo del toast de "Preferencias actualizadas" es el mismo bug al
   revés.
3. **Con el nivel `'documento'` impuesto por ley, la escala baja a 4 en la misma
   pasada** — y también se dice. Un tenant legado nació con escala 6 y nivel `'linea'`;
   pisarle solo el nivel lo deja sin salida, porque `'documento'` con escala 6 es un 400
   y el escape que sugiere ese error (*"usá linea"*) es justo el radio recién
   deshabilitado. Es la misma regla que aplica `TenantsService.create` al nacer el
   tenant, acá para el que nació antes.

   ⚠️ **Pide el candado, no solo el nivel.** Un tenant con `'documento'` elegido y **sin**
   ley sí tiene salida —volver a «Por línea», que ahí es un radio habilitado—, así que la
   escala no se le toca: bajársela sería tomarle una decisión que él puede tomar. Esa
   cláusula es **deliberadamente defensiva**: el backend de hoy no produce ese estado
   (rechaza `'documento'` con escala > 4). Y la frase de la escala es independiente del
   aviso de desalineado: un legado cuyo nivel ya coincide con la norma pero con escala 6
   igual pierde el número, y hay que decírselo — mientras que el mexicano recién creado,
   que nace con escala 4, no lee ninguna de las dos frases.

**Actions**:
- `fetch()` — `GET /api/tenants/preferencias-financieras`
- `update(dto)` — `PUT /api/tenants/preferencias-financieras`

---

## Data Flow

### Load & Display

```
[User navigates to Configuración > Preferencias Financieras]
  ↓
[Page mounted, composable usePreferenciasFinancieras()]
  ↓ store.fetch()
[GET /api/tenants/preferencias-financieras]
  ↓
[Backend service lee tenants.calculo_descuentos, .calculo_recargos]
[Backend service lee tenant_formula_precio ordenado por paso]
  ↓ respuesta PreferenciasFinancierasDto
[Store actualiza state]
  ↓
[UI renderiza form con valores]
```

### Save

```
[User modifica valores y hace clic en "Guardar"]
  ↓ store.update(nuevasPreferencias)
[PUT /api/tenants/preferencias-financieras, body = dto]
  ↓
[Backend valida DTO]
  ↓ si inválido: 400 Bad Request
[Backend inicia transacción]
  ↓
[Actualiza tenants.calculo_descuentos, tenants.calculo_recargos]
[Borra filas de tenant_formula_precio para este tenant]
[Inserta nuevas filas con los pasos en orden]
  ↓ commit
[Response 200 con PreferenciasFinancierasDto]
  ↓
[Store actualiza estado]
[UI muestra toast "Guardado"]
```

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/tenants/tenants.service.spec.ts
npm test -- modules/tenants/tenants.controller.spec.ts
```

**Casos clave:**
- Validación de fórmula: rechaza fórmulas incompletas, con duplicados, con valores inválidos
- Lectura por tenant: verifica que se lean `calculo_descuentos`, `calculo_recargos` y el array de pasos
- Escritura: verifica que se actualicen ambas tablas atómicamente
- Permissions: verifica que solo admin pueda escribir (PUT)

### Manual Testing (Swagger)

1. Open http://localhost:3000/api/docs
2. Autenticar como usuario admin
3. Navegar a `GET /api/tenants/preferencias-financieras` — debe retornar las prefs actuales
4. Llamar a `PUT /api/tenants/preferencias-financieras` con una fórmula válida — debe actualizar
5. Llamar a `PUT` con una fórmula inválida (p. ej. duplicados) — debe retornar 400

### Manual Testing (Frontend)

1. Start: `docker-compose up`
2. Login como admin
3. Navegar a Configuración > Preferencias Financieras
4. Modificar cálculos y fórmula
5. Guardar y verificar que persista (recarga la página)
6. Verificar que valores inválidos muestren error

---

## Acceptance Criteria

- [x] Tabla `tenant_formula_precio` creada en BD
- [x] Columnas `calculo_descuentos`, `calculo_recargos` agregadas a `tenants`
- [x] DTOs con validación
- [x] Endpoint GET implementado
- [x] Endpoint PUT implementado con validación de fórmula
- [x] `nivelRedondeo` configurable, con la matriz de combinaciones prohibidas contra la
      moneda oficial del tenant
- [x] Guard RBAC en PUT (admin only)
- [x] Transacción atomic en actualización
- [x] Página frontend (form de edición)
- [x] Pinia store con fetch + update
- [x] Documentación actualizada (este archivo, CLAUDE.md)

---

## Related Features

- [Motor de cálculo de precios](./motor-calculo-precios.md) — consume estas preferencias
- [Configuración de monedas por tenant](./configuracion-monedas.md) — otra configuración financiera del tenant
- [Catálogos financieros](../ESTADO.md) — definición de descuentos, recargos, impuestos

---

## Notes

- **Default al crear un tenant:** la fórmula default es `['descuentos', 'recargos', 'impuestos']` con `calculo_descuentos = 'base'` y `calculo_recargos = 'base'`. Ver seeder en `backend/src/modules/seeder/seeder.service.ts`.
- **Moneda:** la mayoría de las preferencias son globales por tenant, independientes de la moneda. La excepción es `nivelRedondeo`: el service la valida contra `MonedasService.decimalesOficiales(tenantId)` (misma noción de "moneda oficial" que usa el motor de precios) porque 'documento' solo tiene sentido si la moneda admite decimales.
- **Consumo real (desde 2026-06-28):** el motor consulta estas prefs en cada línea de venta para aplicar descuento, recargo e impuesto en el orden y modo configurado, y las **congela** en `ventas.config_calculo` — junto con `nivelRedondeo` y la escala de la moneda con la que cerró. Cambiar una preferencia no reescribe el pasado: una venta vieja se lee con su propio snapshot.
