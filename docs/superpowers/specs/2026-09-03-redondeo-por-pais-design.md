# Spec: el redondeo se configura por tenant, con default por país y candado donde es ley

**Fecha:** 2026-09-03
**Estado:** diseño aprobado por el owner — **plan escrito**, listo para ejecutar
**Plan:** [`../plans/2026-09-03-redondeo-por-pais.md`](../plans/2026-09-03-redondeo-por-pais.md)
**Decisión que implementa:** la propuesta del owner en
[ADR-024](../../adr/024-decimales-redondeo-y-unidades-de-cuenta.md)
**Investigación que la sostiene:**
[`2026-09-03-redondeo-por-pais-latam.md`](../../agent/investigaciones/2026-09-03-redondeo-por-pais-latam.md)
**Línea base del sistema:** [ADR-025](../../adr/025-decimales-estado-actual.md)

---

## 1. El problema

El redondeo tiene dos perillas y las dos son **preferencia del tenant**, con defaults globales:

| Perilla | Hoy | Default |
|---|---|---|
| `tenants.modo_redondeo` | preferencia del tenant | `HALF_UP` |
| `tenants.nivel_redondeo` | preferencia del tenant | `linea` |

El producto apunta a **América Latina**, y ahí esos defaults **no son neutrales**: son reglas
tributarias de cada país, y en dos de ellos la norma exige lo contrario de lo que hacemos.

⚠️ **Honestidad sobre la urgencia:** hoy **no hay ningún tenant incumpliendo**, porque el único
país cargado es Chile y no hay tenants operando (el producto está en desarrollo). El valor de
esta spec es **tener el mecanismo antes del primer tenant de la región**, no reparar algo roto.

## 2. Las reglas relevadas, con su cita

De ocho países mirados, **tres tienen la regla citada** — y ninguna es la que usamos por default:

| País | Perilla que fija su norma | Valor | Fuente |
|---|---|---|---|
| **Argentina** | modo | `HALF_EVEN` | Manual del desarrollador de ARCA/AFIP (RG 4291): *"El criterio de redondeo que utilizamos en este servicio es **Round Half Even**"* — **primaria** |
| **Colombia** | modo | `HALF_EVEN` | Anexo técnico DIAN v1.9, Resolución 000165 (01/NOV/2023), § 5.2.1 nota 2: *"La fórmula de redondeo utilizada en estos momentos es la **round-half-to-even** (…) corresponde a la norma técnica colombiana **NTC 3711**"* — **primaria** |
| **México** | nivel | `documento` | SAT, Anexo 20: sumar líneas a hasta 6 decimales y redondear **una sola vez al total** — investigación 2026-08-15 |

Y **cinco no la fijan**: Chile (⛔ lo que hay es una **inferencia**, no una norma), Perú,
Ecuador, Uruguay. Brasil no se relevó.

📌 **`HALF_EVEN` ya existe** en `ModoRedondeo` (`'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL'`).
No hay que agregar el modo: falta el **default por país** y el **candado**.

## 3. La decisión

> **La configuración sigue siendo del tenant. El país aporta el default. Donde es ley, el
> tenant no la puede cambiar.**

Y el refinamiento que la hace expresable:

> **El candado va por PERILLA, no por país.** México fija el **nivel** y deja libre el modo;
> Argentina y Colombia fijan el **modo** y dejan libre el nivel. Un candado a nivel país
> —*"acá no se toca nada"*— no podría expresar ninguno de los dos.

**Qué compra:** cubre los países con ley sin inventar una donde no la hay. Chile entra como
default recomendado y editable, que es exactamente lo que corresponde a una **inferencia**.

## 4. Modelo de datos

### 4.1. `pais` gana cuatro columnas

```ts
// pais.entity.ts — el par (valor sugerido, ¿es ley?) por perilla.
@Column({ name: 'modo_redondeo_sugerido', type: 'varchar', nullable: true })
modoRedondeoSugerido: ModoRedondeo | null;

@Column({ name: 'modo_redondeo_es_ley', type: 'boolean', default: false })
modoRedondeoEsLey: boolean;

@Column({ name: 'nivel_redondeo_sugerido', type: 'text', nullable: true })
nivelRedondeoSugerido: NivelRedondeo | null;

@Column({ name: 'nivel_redondeo_es_ley', type: 'boolean', default: false })
nivelRedondeoEsLey: boolean;
```

⛔ **El `type` explícito NO es opcional y no se puede sacar.** TypeORM infiere el tipo de
columna de `design:type`, y una unión importada con `import type` se borra al compilar: el
metadato queda en `Object` y Postgres corta el arranque con `DataTypeNotSupportedError`. Ya
pasó en este repo con `modo_redondeo`, y **solo lo cazó el e2e** — unit, typecheck, lint y dos
revisiones independientes lo dieron por "cambio sin conducta". Está documentado en el docblock
de `tenants.entity.ts`.

**Dos `@Check`, porque la combinación inválida tiene que ser rechazable por la base:**

```sql
CHECK (NOT modo_redondeo_es_ley  OR modo_redondeo_sugerido  IS NOT NULL)
CHECK (NOT nivel_redondeo_es_ley OR nivel_redondeo_sugerido IS NOT NULL)
```

Un país no puede declarar *"esto es ley"* sin decir **cuál** es la ley. Sin el check, el candado
quedaría cerrado contra `NULL` y nadie podría guardar sus preferencias.

### 4.2. `tenants` no cambia

`modo_redondeo` y `nivel_redondeo` siguen donde están, con sus tipos y sus defaults. Lo que
cambia es **quién los escribe al crear el tenant** y **qué se acepta al actualizarlos**.

## 5. Conducta

### 5.1. Al crear el tenant — el país empuja el default

`TenantsService.create` ya siembra preferencias financieras (`escalaCalculo: 6`,
`modoRedondeo: 'HALF_UP'`, `nivelRedondeo: 'linea'`). Pasa a resolverlas desde el país del
tenant:

- si el país tiene `modo_redondeo_sugerido`, ése es el valor inicial; si no, el default de
  sistema (`HALF_UP`);
- ídem para el nivel (`linea`).

📌 **Es el mismo patrón que ya existe** para el nivel de una regla de descuento —*"el tipo
empuja el default, sin bloquearlo"*— y para la moneda oficial, que ya se deriva del país
(ADR-021). No se estrena un mecanismo: se reusa.

### 5.2. Al actualizar las preferencias — el candado

En `TenantsService.actualizarPreferenciasFinancieras`, junto a las tres combinaciones que ya se
rechazan (ver ADR-025):

- si `modo_redondeo_es_ley` y el DTO trae un `modoRedondeo` distinto del sugerido → **400**;
- si `nivel_redondeo_es_ley` y el DTO trae un `nivelRedondeo` distinto del sugerido → **400**.

**El mensaje nombra el país y la norma**, no dice "no se puede":

> `El redondeo de Colombia lo fija la norma (NTC 3711): tiene que ser HALF_EVEN.`

⚠️ **Mandar el MISMO valor no es un error.** El guard compara contra el valor sugerido, no
contra "vino la clave": un `PATCH` que reenvía la config entera sin tocar el redondeo tiene que
pasar. Rechazar por presencia de la clave rompería el guardado de cualquier otra preferencia.

### 5.3. En la pantalla

La perilla con candado se muestra **deshabilitada y con el motivo a la vista** —el mismo trato
que el tacho de una línea ya despachada— no oculta. El tenant tiene que poder ver **qué** rige y
**por qué**, que es la mitad del valor de esto.

Donde **no** es ley, se muestra el valor sugerido como default y se puede cambiar. Sin aviso ni
fricción: es una recomendación, no una regla.

## 6. Seed

⚠️ **El seed es parte de esta spec y no un anexo.** Hoy el único país cargado es **Chile**;
Argentina, Colombia y México **no existen** en `pais`. Sembrar las columnas sin los países sería
dejar **una columna sin consumidor**, que es el antipatrón que este repo ya documentó al nombrar
`cashRounding` (*"la columna y su consumidor, deliberadamente juntos"*).

| País | Qué se siembra |
|---|---|
| **Chile** (existe) | `modo_redondeo_sugerido = 'HALF_UP'`, **`es_ley = false`**; nivel sugerido `'linea'`, **`es_ley = false`**. ⛔ **Chile NO lleva candado**: lo que tenemos es una inferencia, y poner un candado sobre una inferencia es prohibirle algo a un cliente por una regla que no leímos |
| **Argentina** (nuevo) | moneda **ARS** (2 decimales); `modo_redondeo_sugerido = 'HALF_EVEN'`, **`es_ley = true`**; nivel sin sugerencia |
| **Colombia** (nuevo) | moneda **COP** (2 decimales); `modo_redondeo_sugerido = 'HALF_EVEN'`, **`es_ley = true`**; nivel sin sugerencia |
| **México** (nuevo) | moneda **MXN** (2 decimales); `nivel_redondeo_sugerido = 'documento'`, **`es_ley = true`**; modo sin sugerencia |

Cada país nuevo necesita también `zona_horaria_principal`, su fila en `moneda`, y su fila en
`pais_moneda`. IDs fijos con el patrón del seeder (`550e8400-…-440XXX`, siguiente número libre).

📌 **El comentario del seed lleva la cita de la norma al lado del valor**, no en otro archivo:
es donde mira quien lo quiera cambiar. Lección ya aprendida en este repo con el stock de la
carne molida, que tenía la intención escrita en un docblock lejos del número.

## 7. Alcance — lo que esta spec NO hace, y por qué

| Fuera | Motivo |
|---|---|
| **La UF y las unidades de cuenta** | Otro eje, y el owner lo reabrió sin re-decidirlo. Va solo → [análisis](../../agent/investigaciones/2026-09-03-uf-y-nivel-por-pais-analisis.md) |
| **La aproximación del IVA a múltiplos de $10 (Colombia)** | ✅ **Medido en el anexo de la DIAN: es OPCIONAL** — *"dicha fracción **se podrá** aproximar"*. No es un hueco de cumplimiento, es una función que no ofrecemos. Misma forma que `cashRounding`, que ya es su propia entrada |
| **`PayableRoundingAmount`** | Colombia lo exige para declarar la diferencia entre el total calculado y la suma de parciales. Es un campo del **documento tributario** → va con lo fiscal (ADR-010) |
| **Las tolerancias** (Argentina 0,01%, Colombia ±2.00) | Nuestro motor cierra **exacto**, así que las cumple con margen. No hay nada que construir; se anota para no sobre-diseñar |
| **La medición de `documento` con moneda de 0 decimales** | Sigue pendiente en ADR-024 y no bloquea el mecanismo |
| **Brasil** | No relevado. Es el hueco más grande de la investigación |
| **El panel de superadmin** | No existe (`admin.vue` es un placeholder). Hasta que exista, las reglas viven en el seeder — aceptable **solo** porque no hay tenants operando |

## 8. Verificación

**Lo que un test tiene que fijar, y el mutante que lo prueba:**

1. **El país empuja el default al crear.** Un tenant nuevo en Argentina nace con `HALF_EVEN`.
   Mutante: devolver el default de sistema → el tenant nace en `HALF_UP`.
2. **El candado rechaza.** `PATCH` con `HALF_UP` sobre un tenant argentino → 400 nombrando la
   norma. Mutante: sacar el guard → 200.
3. **El candado NO rechaza el mismo valor.** `PATCH` que reenvía `HALF_EVEN` en un tenant
   argentino → 200. Es el control que descarta el guard escrito "por presencia de la clave", y
   sin él un guard roto pasaría el test 2 igual.
4. **Sin ley no hay candado.** Un tenant chileno puede cambiar su modo libremente → 200.
   Mutante: candado incondicional → 400.
5. **El `CHECK` de la base.** Un país con `es_ley = true` y `sugerido = NULL` es rechazado por
   Postgres.

⚠️ **Los valores de los fixtures tienen que discriminar.** No usar `HALF_UP` como valor sugerido
de un país con ley: coincide con el default de sistema y un test que empuje mal pasaría igual.
Argentina con `HALF_EVEN` sirve justamente porque **no** es el default.

⚠️ **Y el e2e es obligatorio**, no opcional: agregar columnas con tipo estrechado a una entidad
es exactamente el caso que tumba el arranque y que **solo el e2e ve**.
