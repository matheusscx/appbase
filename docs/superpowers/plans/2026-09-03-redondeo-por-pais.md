# Redondeo por país — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el redondeo se configure por tenant, con el default puesto por su país, y que donde la norma lo fija el tenant no lo pueda cambiar.

> ✅ **EJECUTADO ENTERO el 2026-09-03**, cinco tareas en cinco commits
> (`b1385023`, `2f594dc8`, `f9fb7740`, `71553274`, `d77be38b`). Cierre y lo que quedó
> abierto: [`resueltos.md`](../../agent/resueltos.md).
>
> Tres cosas se decidieron **durante** la ejecución y no estaban en este plan, las tres
> anotadas en el cierre: el seed siembra además **una provincia por país** (sin ella no hay
> tenant posible en ese país y el catálogo queda de adorno); con `'documento'` la **escala
> nace en 4** (el único valor con el que el tenant mexicano no nace en un estado que su
> propia API rechaza — y es materia fiscal, escalada al owner); y se cerró el agujero de
> **mudarse de país por un PATCH**, que este mismo frente destapó al sembrar más de un país.

**Architecture:** `pais` gana un trío *(valor sugerido, ¿es ley?, norma que lo dice)* por cada una de las dos perillas de redondeo. `TenantsService.create` lee el sugerido del país en vez de un default global, y `actualizarPreferenciasFinancieras` rechaza cambiar una perilla marcada como ley. La pantalla la muestra deshabilitada con el motivo a la vista.

**Tech Stack:** NestJS + TypeORM (`synchronize: true`), PostgreSQL 15, Nuxt 4 + Nuxt UI.

**Spec:** [`../specs/2026-09-03-redondeo-por-pais-design.md`](../specs/2026-09-03-redondeo-por-pais-design.md)

## Global Constraints

- **`tenant_id` sale siempre del token**, nunca del body/query/ruta.
- **Dinero y porcentajes con Decimal.js.** Este plan no hace aritmética de dinero; si aparece, no se usa `number`.
- **Soft delete en todo.** Las lecturas nuevas filtran `eliminado_el IS NULL`.
- **Nunca una query por iteración (N+1).** El país del tenant se resuelve en UNA query, no una por perilla.
- ⛔ **El `type` explícito de la columna NO es opcional.** TypeORM infiere el tipo de `design:type`, y una unión que entra por `import type` se borra al compilar: el metadato queda en `Object` y Postgres corta el arranque con `DataTypeNotSupportedError`. Ya pasó en este repo con `modo_redondeo` y **solo lo cazó el e2e**.
- **No hay datos productivos.** No se escriben migraciones ni backfills: se cambia el esquema, se actualiza el seeder y se resetea.
- **IDs del seed:** patrón `550e8400-e29b-41d4-a716-446655440XXX`. **El siguiente número libre es `369`.**
- **Gate antes de cada commit:** `cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e` y `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`. Con `./scripts/reset-db.sh` ANTES del e2e y `--verificar` después.

## File Structure

| Archivo | Qué hace |
|---|---|
| `backend/src/modules/tenants/entities/pais.entity.ts` | **Modificar.** Seis columnas nuevas + dos `@Check` (Tarea 1) |
| `backend/src/modules/seeder/seeder.service.ts` | **Modificar.** Tres monedas, tres países, sus `pais_moneda`, y las reglas de los cuatro (Tarea 2) |
| `backend/src/modules/tenants/tenants.service.ts` | **Modificar.** El default sale del país (Tarea 3) y el candado al actualizar (Tarea 4) |
| `backend/test/redondeo-por-pais.e2e-spec.ts` | **Crear.** El e2e del frente entero (Tareas 1-4) |
| `frontend/app/pages/configuracion/preferencias-financieras.vue` | **Modificar.** Perilla deshabilitada con el motivo (Tarea 5) |

---

### Tarea 1: `pais` lleva la regla de cada perilla

**Files:**
- Modify: `backend/src/modules/tenants/entities/pais.entity.ts`
- Test: `backend/test/redondeo-por-pais.e2e-spec.ts` (crear)

**Interfaces:**
- Produces: `Pais.modoRedondeoSugerido`, `.modoRedondeoEsLey`, `.modoRedondeoNorma`, `.nivelRedondeoSugerido`, `.nivelRedondeoEsLey`, `.nivelRedondeoNorma`.
- Consumes: `ModoRedondeo` y `NivelRedondeo` de `../../calculo-precios/calculo-precios.engine`.

- [x] **Paso 1: Agregar las seis columnas y los dos `@Check`**

En `pais.entity.ts`, importar los tipos y `Check`, y agregar sobre la clase:

```ts
@Entity('pais')
@Check(
  'chk_pais_modo_redondeo_ley',
  '(NOT "modo_redondeo_es_ley") OR ("modo_redondeo_sugerido" IS NOT NULL)',
)
@Check(
  'chk_pais_nivel_redondeo_ley',
  '(NOT "nivel_redondeo_es_ley") OR ("nivel_redondeo_sugerido" IS NOT NULL)',
)
export class Pais {
```

y adentro, después de `monedaOficialId`:

```ts
  /**
   * El trío por perilla: qué sugiere el país, si además es **ley**, y cuál es la
   * norma que lo dice.
   *
   * ⛔ El `type` explícito no se puede sacar: `ModoRedondeo` entra por
   * `import type`, la referencia se borra al compilar y el metadato `design:type`
   * queda en `Object` — Postgres corta el arranque con
   * `DataTypeNotSupportedError`. Ya pasó con `tenants.modo_redondeo`.
   *
   * `norma` NO es decorativa: es lo que la pantalla le muestra al tenant cuando
   * la perilla está bloqueada. Un candado sin motivo se lee como un bug.
   */
  @Column({ name: 'modo_redondeo_sugerido', type: 'varchar', nullable: true })
  modoRedondeoSugerido: ModoRedondeo | null;

  @Column({ name: 'modo_redondeo_es_ley', type: 'boolean', default: false })
  modoRedondeoEsLey: boolean;

  @Column({ name: 'modo_redondeo_norma', type: 'text', nullable: true })
  modoRedondeoNorma: string | null;

  @Column({ name: 'nivel_redondeo_sugerido', type: 'text', nullable: true })
  nivelRedondeoSugerido: NivelRedondeo | null;

  @Column({ name: 'nivel_redondeo_es_ley', type: 'boolean', default: false })
  nivelRedondeoEsLey: boolean;

  @Column({ name: 'nivel_redondeo_norma', type: 'text', nullable: true })
  nivelRedondeoNorma: string | null;
```

- [x] **Paso 2: Escribir el test del `CHECK`, y verlo fallar**

Crear `backend/test/redondeo-por-pais.e2e-spec.ts` con el molde de los otros e2e (login + `switch-tenant` a Paris, `cookieParser`, `ValidationPipe`). Primer test:

```ts
it('un país no puede declarar "es ley" sin decir cuál es la ley', async () => {
  // El CHECK es de la BASE, no del service: se prueba por SQL directo, que es
  // el único camino que lo puede violar. Un país mal cargado por el futuro
  // panel de superadmin dejaría el candado cerrado contra NULL y nadie podría
  // guardar sus preferencias.
  await expect(
    ds.query(
      `INSERT INTO pais (pais_id, nombre, codigo_iso, zona_horaria_principal,
                         modo_redondeo_es_ley, creado_el, actualizado_el)
       VALUES ($1, 'Paisdeprueba', 'XX', 'UTC', true, NOW(), NOW())`,
      [randomUUID()],
    ),
  ).rejects.toThrow(/chk_pais_modo_redondeo_ley/);
});
```

Run: `cd backend && npx jest --config ./test/jest-e2e.json test/redondeo-por-pais.e2e-spec.ts`
Expected: FAIL — la columna no existe todavía si el paso 1 no se aplicó, o el INSERT pasa si falta el `@Check`.

- [x] **Paso 3: Correr el e2e completo y verlo pasar**

⚠️ **Obligatorio, no opcional:** agregar columnas con tipo estrechado es exactamente el caso que tumba el arranque y que **solo el e2e ve**.

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

- [x] **Paso 4: Commit**

```bash
git add -A && git commit -m "feat(paises): el país lleva la regla de redondeo de cada perilla"
```

---

### Tarea 2: el seed carga los tres países con regla citada

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Test: `backend/test/redondeo-por-pais.e2e-spec.ts`

**Interfaces:**
- Consumes: las columnas de la Tarea 1.
- Produces: `pais` con cuatro filas (Chile, Argentina, Colombia, México) y `moneda` con ARS/COP/MXN.

- [x] **Paso 1: Tres monedas nuevas en `seedMonedas`**

Agregar al array, siguiendo el mismo shape que las tres que ya están:

```ts
{
  monedaId: '550e8400-e29b-41d4-a716-446655440369',
  nombre: 'Peso Argentino',
  codigoIso: 'ARS', codigoNumero: '032', simbolo: '$', decimales: 2,
  separadorDecimal: ',', separadorMiles: '.', locale: 'es-AR',
},
{
  monedaId: '550e8400-e29b-41d4-a716-446655440370',
  nombre: 'Peso Colombiano',
  codigoIso: 'COP', codigoNumero: '170', simbolo: '$', decimales: 2,
  separadorDecimal: ',', separadorMiles: '.', locale: 'es-CO',
},
{
  monedaId: '550e8400-e29b-41d4-a716-446655440371',
  nombre: 'Peso Mexicano',
  codigoIso: 'MXN', codigoNumero: '484', simbolo: '$', decimales: 2,
  separadorDecimal: '.', separadorMiles: ',', locale: 'es-MX',
},
```

- [x] **Paso 2: Generalizar `seedPais` a los cuatro, con su regla**

Reemplazar el cuerpo de `seedPais` por un loop sobre una tabla. **La cita de la norma va al lado del valor, no en otro archivo** — es donde mira quien lo quiera cambiar:

```ts
private async seedPais(): Promise<void> {
  const paises: (Partial<Pais> & { monedaOficialId: string })[] = [
    {
      paisId: '550e8400-e29b-41d4-a716-446655440000',
      nombre: 'Chile', codigoIso: 'CL',
      zonaHorariaPrincipal: 'America/Santiago',
      monedaOficialId: '550e8400-e29b-41d4-a716-446655440003', // CLP
      // ⛔ Chile NO lleva candado, y es deliberado: que sus totales vayan
      // enteros es una INFERENCIA del formato del DTE, no una frase del SII
      // (corregido el 2026-08-20). Poner un candado sobre una inferencia es
      // prohibirle algo a un cliente por una regla que no leímos.
      modoRedondeoSugerido: 'HALF_UP', modoRedondeoEsLey: false,
      nivelRedondeoSugerido: 'linea', nivelRedondeoEsLey: false,
    },
    {
      paisId: '550e8400-e29b-41d4-a716-446655440372',
      nombre: 'Argentina', codigoIso: 'AR',
      zonaHorariaPrincipal: 'America/Argentina/Buenos_Aires',
      monedaOficialId: '550e8400-e29b-41d4-a716-446655440369', // ARS
      modoRedondeoSugerido: 'HALF_EVEN', modoRedondeoEsLey: true,
      modoRedondeoNorma:
        'ARCA/AFIP, manual del desarrollador (RG 4291): "El criterio de ' +
        'redondeo que utilizamos en este servicio es Round Half Even".',
      // El nivel NO lo fija: valida la suma con tolerancia (error relativo
      // ≤ 0,01%), así que el tenant elige.
      nivelRedondeoSugerido: null, nivelRedondeoEsLey: false,
    },
    {
      paisId: '550e8400-e29b-41d4-a716-446655440373',
      nombre: 'Colombia', codigoIso: 'CO',
      zonaHorariaPrincipal: 'America/Bogota',
      monedaOficialId: '550e8400-e29b-41d4-a716-446655440370', // COP
      modoRedondeoSugerido: 'HALF_EVEN', modoRedondeoEsLey: true,
      modoRedondeoNorma:
        'DIAN, anexo técnico v1.9 (Resolución 000165 del 01/11/2023) § 5.2.1: ' +
        'round-half-to-even, norma técnica colombiana NTC 3711.',
      // Tampoco lo fija: admite que el total difiera de la suma de parciales y
      // pide declarar la diferencia en `PayableRoundingAmount` (fiscal, ADR-010).
      nivelRedondeoSugerido: null, nivelRedondeoEsLey: false,
    },
    {
      paisId: '550e8400-e29b-41d4-a716-446655440374',
      nombre: 'México', codigoIso: 'MX',
      zonaHorariaPrincipal: 'America/Mexico_City',
      monedaOficialId: '550e8400-e29b-41d4-a716-446655440371', // MXN
      // El modo no lo fija; el NIVEL sí.
      modoRedondeoSugerido: null, modoRedondeoEsLey: false,
      nivelRedondeoSugerido: 'documento', nivelRedondeoEsLey: true,
      nivelRedondeoNorma:
        'SAT, Anexo 20: sumar las líneas a hasta 6 decimales y redondear una ' +
        'sola vez al total.',
    },
  ];

  for (const data of paises) {
    const exists = await this.paisRepo.findOne({
      where: { paisId: data.paisId },
    });
    if (!exists) await this.paisRepo.save(this.paisRepo.create(data));
    // El `update` incondicional se conserva del código anterior: asegura que la
    // moneda oficial y la regla queden al día aunque la fila ya exista de una
    // corrida vieja.
    await this.paisRepo.update({ paisId: data.paisId }, data);
  }
}
```

- [x] **Paso 3: `seedPaisMonedas` para los tres nuevos**

Generalizar el método para que cada país habilite su propia moneda oficial (Chile mantiene sus tres: CLP, UF, USD).

- [x] **Paso 4: Los tests del seed**

```ts
it('Argentina y Colombia nacen con half-even, y es ley', async () => {
  const filas = await ds.query(
    `SELECT codigo_iso, modo_redondeo_sugerido, modo_redondeo_es_ley,
            modo_redondeo_norma
       FROM pais WHERE codigo_iso IN ('AR','CO') ORDER BY codigo_iso`,
  );
  expect(filas).toHaveLength(2);
  for (const f of filas) {
    expect(f.modo_redondeo_sugerido).toBe('HALF_EVEN');
    expect(f.modo_redondeo_es_ley).toBe(true);
    // La norma no puede faltar: es lo que la pantalla le muestra al tenant.
    expect(f.modo_redondeo_norma).toBeTruthy();
  }
});

it('México fija el NIVEL y deja libre el modo — el candado es por perilla', async () => {
  const [mx] = await ds.query(
    `SELECT modo_redondeo_es_ley, nivel_redondeo_sugerido, nivel_redondeo_es_ley
       FROM pais WHERE codigo_iso = 'MX'`,
  );
  expect(mx.nivel_redondeo_sugerido).toBe('documento');
  expect(mx.nivel_redondeo_es_ley).toBe(true);
  // La otra mitad, y es la que prueba que el candado NO es por país: si lo
  // fuera, México también tendría el modo bloqueado.
  expect(mx.modo_redondeo_es_ley).toBe(false);
});

it('Chile queda SIN candado: lo que tenemos es una inferencia', async () => {
  const [cl] = await ds.query(
    `SELECT modo_redondeo_es_ley, nivel_redondeo_es_ley
       FROM pais WHERE codigo_iso = 'CL'`,
  );
  expect(cl.modo_redondeo_es_ley).toBe(false);
  expect(cl.nivel_redondeo_es_ley).toBe(false);
});
```

- [x] **Paso 5: Gate + commit**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e
git add -A && git commit -m "feat(seed): Argentina, Colombia y México con su regla de redondeo citada"
```

---

### Tarea 3: el país empuja el default al crear el tenant

**Files:**
- Modify: `backend/src/modules/tenants/tenants.service.ts` (método `create`)
- Test: `backend/test/redondeo-por-pais.e2e-spec.ts`

**Interfaces:**
- Consumes: `pais.modo_redondeo_sugerido` / `nivel_redondeo_sugerido` (Tarea 2).
- Produces: un tenant nuevo nace con las preferencias de su país.

- [x] **Paso 1: Escribir el test primero**

```ts
it('un tenant nuevo en Argentina nace con HALF_EVEN, no con el default de sistema', async () => {
  // `HALF_EVEN` discrimina justamente porque NO es el default de sistema
  // (`HALF_UP`): con un país que sugiriera HALF_UP, un `create` que ignorara
  // el país pasaría igual.
  const tenant = await crearTenantEn('AR');
  expect(tenant.modoRedondeo).toBe('HALF_EVEN');
});

it('un tenant nuevo en Chile sigue naciendo con el default de sistema', async () => {
  const tenant = await crearTenantEn('CL');
  expect(tenant.modoRedondeo).toBe('HALF_UP');
  expect(tenant.nivelRedondeo).toBe('linea');
});
```

Run: FAIL con `Received: "HALF_UP"` en el primero.

- [x] **Paso 2: Resolver el país en UNA query dentro de `create`**

Antes del `manager.create(Tenant, …)`:

```ts
// El país del tenant sale de su provincia. UNA sola query para las dos
// perillas — nunca una por perilla.
const [reglas]: {
  modo_redondeo_sugerido: ModoRedondeo | null;
  nivel_redondeo_sugerido: NivelRedondeo | null;
}[] = await manager.query(
  `SELECT p.modo_redondeo_sugerido, p.nivel_redondeo_sugerido
     FROM provincia prov
     JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
    WHERE prov.provincia_id = $1 AND prov.eliminado_el IS NULL`,
  [dto.provinciaId],
);
```

y en el `create`:

```ts
  modoRedondeo: reglas?.modo_redondeo_sugerido ?? MODO_REDONDEO_DEFAULT,
  nivelRedondeo: reglas?.nivel_redondeo_sugerido ?? 'linea',
```

📌 **Es el mismo patrón que ya existe dos veces** —el tipo empuja el nivel de una regla, y la moneda oficial se deriva del país (ADR-021)—: no se estrena mecanismo.

- [x] **Paso 3: Correr los tests y verlos pasar. Gate + commit.**

---

### Tarea 4: el candado al actualizar, y la API dice por qué

**Files:**
- Modify: `backend/src/modules/tenants/tenants.service.ts` (`actualizarPreferenciasFinancieras` y el GET)
- Test: `backend/test/redondeo-por-pais.e2e-spec.ts`

**Interfaces:**
- Produces: el GET de preferencias devuelve `modoRedondeoBloqueado`, `modoRedondeoNorma`, `nivelRedondeoBloqueado`, `nivelRedondeoNorma`. Los consume la Tarea 5.

- [x] **Paso 1: Los tres tests, y el tercero es el que importa**

```ts
it('un tenant argentino no puede cambiar el modo: 400 nombrando la norma', async () => {
  const res = await patchPreferencias(tokenAR, { modoRedondeo: 'HALF_UP' });
  expect(res.status).toBe(400);
  expect(res.body.message).toContain('Argentina');
  expect(res.body.message).toContain('HALF_EVEN');
});

it('mandar el MISMO valor NO es un error', async () => {
  // El control que descarta el guard escrito "por presencia de la clave". Sin
  // él, un guard roto pasa el test de arriba igual — y rompe el guardado de
  // cualquier otra preferencia, porque la pantalla manda la config entera.
  const res = await patchPreferencias(tokenAR, { modoRedondeo: 'HALF_EVEN' });
  expect(res.status).toBe(200);
});

it('un tenant chileno cambia su modo libremente', async () => {
  const res = await patchPreferencias(tokenCL, { modoRedondeo: 'FLOOR' });
  expect(res.status).toBe(200);
});
```

- [x] **Paso 2: El guard, junto a las tres validaciones que ya existen**

```ts
// El país manda sobre la preferencia cuando la norma lo fija. Se compara
// contra el VALOR, no contra "vino la clave": la pantalla manda la config
// entera en cada guardado, así que rechazar por presencia rompería el resto.
if (pais.modoRedondeoEsLey && dto.modoRedondeo !== pais.modoRedondeoSugerido) {
  throw new BadRequestException(
    `El modo de redondeo de ${pais.nombre} lo fija la norma: tiene que ser ` +
      `${pais.modoRedondeoSugerido}. ${pais.modoRedondeoNorma ?? ''}`.trim(),
  );
}
```

y su gemelo para el nivel.

- [x] **Paso 3: El GET expone el candado y su motivo**

Sin esto la pantalla tendría que adivinar, o peor: dejar tocar la perilla y descubrirlo recién al guardar.

- [x] **Paso 4: Gate + commit.**

---

### Tarea 5: la pantalla muestra el candado con el motivo

**Files:**
- Modify: `frontend/app/pages/configuracion/preferencias-financieras.vue`
- Test: `frontend/app/pages/configuracion/preferencias-financieras.nuxt.spec.ts` (crear si no existe)

**Interfaces:**
- Consumes: los cuatro campos que la Tarea 4 agregó al GET.

- [x] **Paso 1: El test**

```ts
it('con la perilla bloqueada por ley, el control está deshabilitado y el motivo a la vista', async () => {
  preferenciasBackend = { ...base, modoRedondeo: 'HALF_EVEN',
    modoRedondeoBloqueado: true,
    modoRedondeoNorma: 'DIAN, anexo técnico v1.9 (…) NTC 3711.' }
  const wrapper = await montar()

  expect(radioModo().props('disabled')).toBe(true)
  // El motivo se MUESTRA, no se oculta: un candado sin explicación se lee como
  // un bug del sistema, no como una regla del país.
  expect(wrapper.text()).toContain('NTC 3711')
})

it('sin ley, el control sigue habilitado y sin aviso', async () => {
  preferenciasBackend = { ...base, modoRedondeoBloqueado: false }
  const wrapper = await montar()
  expect(radioModo().props('disabled')).toBe(false)
})
```

- [x] **Paso 2: Deshabilitar el `URadioGroup` y mostrar el motivo en el `description` del `UFormField`.** Tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado.

- [x] **Paso 3: Gate del frontend + smoke en Chrome**

⚠️ **El smoke no es opcional acá:** el estado deshabilitado depende de datos que llegan del backend, y ni el build ni el typecheck ven que el control quedó tocable.

- [x] **Paso 4: Commit**

---

## Cierre del frente

- [x] **Docs en el mismo commit que el código**: `docs/features/` (la feature de preferencias financieras), fila en `docs/ESTADO.md`, y el ADR-024 pasa de *"decisión 2 reabierta"* a **resuelta**, apuntando a esta spec.
- [x] **Sacar la entrada de `pendientes.md`** y escribir el cierre en `resueltos.md`.
- [x] **Revisión independiente** (`domain-reviewer`) sobre el diff completo del frente, no solo por tarea: es la que caza las contradicciones ENTRE tareas — acá el riesgo concreto es que el seed de la Tarea 2 cambie la plata de suites e2e ajenas al agregar países y monedas.
