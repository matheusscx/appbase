# Plan: módulo de reportes + reporte de varianza (AVT)

> **Para agentes:** ejecutar con `superpowers:subagent-driven-development` o
> `superpowers:executing-plans`, tarea por tarea, marcando los checkboxes.

**Status:** In Progress
**Date:** 2026-09-19
**Owner:** Cesar Matheus
**Spec:** [`../specs/2026-09-19-modulo-reportes-varianza-design.md`](../specs/2026-09-19-modulo-reportes-varianza-design.md)
— el plan argumenta desde la spec; leer las dos.

**Goal:** estrenar un módulo de reportes con el patrón que el próximo reporte copia, y su primer
reporte: la varianza de inventario (AVT), consumo teórico contra consumo real entre dos conteos.

**Arquitectura:** `backend/src/modules/reportes/<slug>/` con una carpeta por reporte; cada reporte
es su propio `modulo_app` con permiso `Leer`. El reporte lee `movimientos_inventario` en consultas
agregadas, con la ventana de cada fila anclada en la `secuencia` de los movimientos de los dos
recuentos que la cierran. Lo compartido del frontend (selector de rango, gráfica) vive en la raíz
de `app/components/`, no adentro de `reportes/`, para que una pantalla vieja lo use sin mudarse.

**Stack:** NestJS + SQL crudo vía `Db` (ADR-020) · Decimal.js · Nuxt 4 SPA (`ssr:false`, ADR-017)
· Nuxt UI v4 · **Unovis** (`@unovis/vue` + `@unovis/ts`, dependencia nueva aprobada por el owner).

---

## Global Constraints

Valen para **todas** las tareas. Salen de `CLAUDE.md` y de la spec.

- **`tenant_id` sale del token** (`req.user.tenantId`), nunca del body, query ni ruta.
- **Plata y cantidades con `Decimal.js`**, nunca `number` nativo.
- **Soft delete filtrado en toda lectura nueva**: `eliminado_el IS NULL` en cada `SELECT`/`JOIN`.
- **Sin N+1**: todo dato derivado por fila sale de un `JOIN`/agregación o de un batch
  `WHERE id = ANY($1)`. Nunca una consulta por iteración.
- **El día lo arma `rango-fecha.util.ts`**, nunca a mano. Hay una invariante que barre
  `src/modules` y lo rechaza (`common/invariants/dia-negocio.invariant.spec.ts`).
- **Borde superior: `bordeHastaSql`** (inclusivo del día), nunca la convención de propinas.
- **Frontend:** tokens semánticos de Nuxt UI, nunca Tailwind neutral hardcodeado
  (`npm run design:check` lo bloquea). `useApiFetch`/`$fetch`, nunca axios.
- **Una sola dependencia nueva autorizada: Unovis.** Cualquier otra se pregunta al owner.
- **Nunca `git commit --no-verify`.** Stagear siempre por ruta explícita, nunca `git add -A`.
- **Bloque de UUIDs de seed reservado para este frente: `…447` a `…460`.** ⛔ **No pasarse de
  `…460` sin avisar a la sesión orquestadora**: `…461`–`…465` están asignados a la sesión "Serie
  única por producto", que corre en paralelo. Verificar igual con un grep antes de fijar cada uno
  —otra sesión puede haberlo tomado entre que se planifica y que se escribe—:

  ```bash
  grep -rn "550e8400-e29b-41d4-a716-4466554404[4-6][0-9]" backend/src backend/test frontend/app
  ```

  ⚠️ **El grep va contra el código, no contra `docs/`.** Esta plan y la spec nombran `…447`–`…449`
  en prosa, así que incluir `docs/` los devuelve como "ocupados" y el resultado se lee al revés:
  un ID está tomado cuando lo usa el **seed**, no cuando lo menciona el documento que planea
  usarlo (medido 2026-09-19, al correr este mismo paso).

### Entorno del worktree (una sola vez, antes de la Tarea 1)

```bash
cp /Users/m2pro/cmatheus/startup-app/.env /Users/m2pro/cmatheus/startup-app/.claude/worktrees/reportes-varianza/.env
```

```bash
npm --prefix /Users/m2pro/cmatheus/startup-app/.claude/worktrees/reportes-varianza/backend ci
```

```bash
npm --prefix /Users/m2pro/cmatheus/startup-app/.claude/worktrees/reportes-varianza/frontend ci
```

```bash
/Users/m2pro/cmatheus/startup-app/scripts/db-aislada.sh reset 5436
```

⚠️ El `test:e2e` de la API va contra ese Postgres propio en el 5436, **sin pedir turno**. Cada
`reset` deja base vacía y **la corrida que vale es la primera**. Playwright y el smoke manual sí
usan el stack compartido de `docker-compose` y piden turno a la sesión orquestadora.

⛔ **Para correr UNA sola suite, el patrón tiene que incluir `.e2e-spec`** — medido el 2026-09-19:

```bash
cd backend && npm run test:e2e -- reportes-varianza.e2e-spec
```

`npm run test:e2e -- reportes-varianza` **no filtra nada**: corre las 85 suites (~6 min). Y la
causa no es jest, es el nombre del worktree. El patrón se matchea contra la **ruta absoluta**, y
acá toda ruta empieza con `…/worktrees/reportes-varianza/backend/test/…`, así que el nombre del
frente matchea todos los archivos. Vale para cualquier worktree bautizado como su feature — y el
síntoma es engañoso, porque la suite igual pasa: solo tarda veinte veces más.

### Gate de cierre de cada tarea

```bash
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
```

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Más la revisión independiente del skill `verify-feature` paso 7 (`domain-reviewer`, y
`api-security-reviewer` si la tarea tocó controller/DTO/guard/entidad). El pre-commit **exige el
recibo de esa revisión** para el diff exacto que se está por commitear: re-stagear antes de pedir
la re-revisión, o el revisor audita una versión vieja.

---

## Contratos compartidos

Los definen las tareas 1–5 y los consumen las 6–8. **Los nombres y tipos de acá son los que
mandan**: una tarea que use otro nombre rompe a su vecina.

```ts
// backend/src/modules/reportes/varianza/varianza.service.ts

/** Σ por moneda, sin convertir nunca entre monedas. */
export interface CostoPorMoneda {
  monedaId: string;
  monto: string; // Decimal serializado, escala ESCALA_COSTO
}

/** Los dos recuentos que cierran la ventana de un (item, ubicación). */
export interface VentanaVarianza {
  itemId: string;
  ubicacionId: string;
  recuentoInicialId: string;
  recuentoFinalId: string;
  desdeEl: Date; // A.aplicado_el — para mostrar, NO para filtrar
  hastaEl: Date; // B.aplicado_el — para mostrar, NO para filtrar
  /** Ancla real del filtro. `null` cuando ese recuento no escribió movimiento. */
  secuenciaDesde: string | null;
  secuenciaHasta: string | null;
}

/** Una fila del reporte. Los números son string a escala 4; `null` si `medible: false`. */
export interface VarianzaFila {
  itemId: string;
  itemNombre: string;
  unidadMedida: string;
  ubicacionId: string;
  ubicacionNombre: string;
  medible: boolean;
  desdeEl: Date | null;
  hastaEl: Date | null;
  recuentoInicialId: string | null;
  recuentoFinalId: string | null;
  teorico: string | null;
  merma: string | null;
  cortesia: string | null;
  sinExplicacion: string | null;
  /** Residuo. Siempre viaja, incluso en '0.0000'. */
  otros: string | null;
  costoSinExplicacion: CostoPorMoneda[];
  faltaCosto: boolean;
}
```

📌 **`CostoPorMoneda` se duplica** respecto de `anulaciones-reporte.service.ts` a propósito: es el
**segundo** uso, y la convención del repo es duplicar dos veces y extraer a la tercera. El tercer
reporte que la necesite la mueve a `common/`.

---

## Tarea 1 — El módulo `reportes` y el permiso `Varianza`

Es la tarea que **fija el patrón**: deja una ruta que responde, con su permiso real y su seed
completo, y nada más. Todo lo que sigue rellena el service.

**Archivos:**
- Crear: `backend/src/modules/reportes/reportes.module.ts`
- Crear: `backend/src/modules/reportes/varianza/varianza.controller.ts`
- Crear: `backend/src/modules/reportes/varianza/varianza.service.ts`
- Crear: `backend/src/modules/reportes/varianza/dto/query-varianza.dto.ts`
- Modificar: `backend/src/app.module.ts` (importar `ReportesModule`)
- Modificar: `backend/src/modules/seeder/seeder.service.ts` (`seedModulosApp`,
  `seedModuloAppPermisos`, `seedTenantModulo`, `seedRolesInventario`)
- Modificar: `docs/patterns/backend.md` (sección nueva: dónde vive un reporte)
- Test: `backend/test/reportes-varianza.e2e-spec.ts`

**Interfaces:**
- Consume: nada.
- Produce: `VarianzaService.findAll(tenantId, query): Promise<PaginatedResponse<VarianzaFila>>`,
  los tipos de **Contratos compartidos** y la ruta `GET /api/reportes/varianza`.

**IDs de seed** (consecutivos desde el primero libre):

| ID | Qué |
|---|---|
| `550e8400-e29b-41d4-a716-446655440447` | `modulos_app` → `Varianza` |
| `550e8400-e29b-41d4-a716-446655440448` | `modulos_app_permisos` → Varianza + Leer |
| `550e8400-e29b-41d4-a716-446655440449` | `tenant_modulos` → Paris + Varianza |

- [x] **Paso 1: escribir el e2e que falla — los dos casos del permiso**

En `backend/test/reportes-varianza.e2e-spec.ts`. El molde de login y bootstrap se copia de
`backend/test/resumen-negocio.e2e-spec.ts`, que ya tiene exactamente el caso "módulo no
contratado → 403".

```ts
it('devuelve 200 y una lista paginada para el admin del tenant que contrató Varianza', async () => {
  const res = await request(app.getHttpServer())
    .get('/api/reportes/varianza')
    .set('Authorization', `Bearer ${tokenAdminParis}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('data');
  expect(res.body).toHaveProperty('meta.total');
});

it('devuelve 403 al tenant que NO contrató el módulo Varianza', async () => {
  const res = await request(app.getHttpServer())
    .get('/api/reportes/varianza')
    .set('Authorization', `Bearer ${tokenAdminFalabella}`);

  expect(res.status).toBe(403);
});
```

⚠️ Cada `res.body` lleva su `expect(res.status)` **al lado**: el pre-commit lo exige sobre lo
staged y bloquea si falta.

- [x] **Paso 2: correrlo y verificar que falla**

```bash
cd backend && npm run test:e2e -- reportes-varianza
```

Esperado: FAIL con 404 en los dos casos (la ruta todavía no existe).

- [x] **Paso 3: ~~el DTO de rango compartido~~ — NO se crea acá**

⚠️ **Corregido al ejecutar (2026-09-19), tras el hallazgo del revisor de dominio.** La primera
versión de este plan creaba `reportes/dto/rango-reporte.dto.ts` como "la base que todo reporte
extiende". **Nadie la extiende.** `QueryVarianzaDto` no puede —el `extends` ya lo ocupa
`PaginationQueryDto`— y el `/resumen` no existe hasta la Tarea 6, así que el archivo quedaba
**cinco tareas sin un solo consumidor**: código muerto, que el checklist de cierre prohíbe.

La base sube a `reportes/dto/` **cuando exista el segundo consumidor** (Tarea 6, con
`ResumenVarianzaDto`). Mientras tanto cada reporte declara sus dos campos, y la convención que
siguen vive en `docs/patterns/backend.md` § 10c — que es donde el próximo la va a buscar, no en un
`extends`.

📌 La lección general, por si vuelve a aparecer: **un "scaffold para el futuro" que el plan crea
por anticipado es código muerto con buena intención.** El plan lo tenía porque planificar invita a
dibujar la estructura completa; ejecutar la desarma.

- [x] **Paso 4: el DTO de la query de varianza**

`backend/src/modules/reportes/varianza/dto/query-varianza.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';

export class QueryVarianzaDto extends PaginationQueryDto {
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;

  @IsOptional()
  @IsUUID()
  ubicacionId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  soloConVarianza?: boolean;
}
```

⚠️ **Declara `desde`/`hasta` acá, sin clase base**: TypeScript no tiene herencia múltiple y la
paginación ya ocupa el `extends` (ver el Paso 3). La base compartida nacería como la de los
reportes **sin** paginación (el `/resumen` de la Tarea 6 sí la extiende). Si un tercer reporte
necesita las dos, ahí se evalúa un mixin — no antes.

⚠️ **`@IsUUID()` en todo id que entre del cliente** (`docs/patterns/backend.md` § 4): sin eso un
id basura llega al SQL y vuelve como 500 en vez de 400.

- [x] **Paso 5: el service con la consulta vacía todavía**

`varianza.service.ts`: exportar los tipos del bloque **Contratos compartidos** (copiarlos tal
cual) y un `findAll` que ya resuelve paginación y día del negocio, y devuelve `data: []`. Un
docblock de clase que diga que las tareas 2–5 lo completan y apunte a la spec § 5.

```ts
async findAll(
  tenantId: string,
  query: QueryVarianzaDto,
): Promise<PaginatedResponse<VarianzaFila>> {
  const { page, pageSize } = resolvePagination(query);
  return { data: [], meta: buildPaginationMeta(page, pageSize, 0) };
}
```

- [x] **Paso 6: el controller**

Copiar la forma exacta de `propina-reportes.controller.ts` (guards, `ApiTags`, `ApiBearerAuth`,
`tenantId` del token):

```ts
@ApiTags('reportes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('reportes/varianza')
export class VarianzaController {
  constructor(private readonly varianza: VarianzaService) {}

  @Get()
  @RequiresPermiso('Varianza', 'Leer')
  findAll(@Req() req: Request, @Query() query: QueryVarianzaDto) {
    const user = req.user as JwtUser;
    return this.varianza.findAll(user.tenantId!, query);
  }
}
```

- [x] **Paso 7: el módulo y su registro**

`reportes.module.ts` con `controllers: [VarianzaController]`, `providers: [VarianzaService]`.
Importarlo en `app.module.ts`.

⚠️ **Esta tarea no agrega ninguna entidad de TypeORM**, así que **no hay nada que sumar al array
`entities` de `app.module.ts`** — el repo no usa `autoLoadEntities` y esa omisión es un error
clásico, pero acá no aplica porque el reporte solo lee tablas que ya existen.

- [x] **Paso 8: el seed, las cuatro partes**

En `seeder.service.ts`, en este orden:

1. `seedModulosApp` → al array `modulos`:
   ```ts
   {
     // Reporte de varianza (AVT). Módulo propio y no un `Reportes:Leer` común:
     // el guard solo hace O, nunca Y, así que un permiso compartido haría que
     // todo reporte futuro le aparezca solo a quien tiene éste (spec § 2).
     moduloAppId: '550e8400-e29b-41d4-a716-446655440447',
     nombre: 'Varianza',
     url: '/reportes/varianza',
     icono: 'mdi-scale-balance',
     tieneConfiguracion: false,
   },
   ```
2. `seedModuloAppPermisos` → `{ moduloAppPermisoId: '…448', moduloAppId: VARIANZA, permisoId: LEER }`,
   con la constante `VARIANZA` declarada como las que ya están.
3. `seedTenantModulo` → Paris → Varianza, `moduloTenantId: '…449'`, `estado: 'activo'`.
   ⛔ **Falabella NO lo contrata**: es el caso de 403 del e2e del Paso 1.
4. `seedRolesInventario` → agregar `{ modulo: VARIANZA_TENANT, permiso: VARIANZA_LEER }` al rol
   **`Inventario · Aprobación`** (el encargado de bodega), con sus dos constantes nuevas. Es el
   rol con el que corre el Playwright de la Tarea 7 — probar la pantalla como admin taparía un
   permiso faltante.

- [x] **Paso 9: correr el e2e y verificar que pasa**

```bash
/Users/m2pro/cmatheus/startup-app/scripts/db-aislada.sh reset 5436
```

```bash
cd backend && npm run test:e2e -- reportes-varianza
```

Esperado: PASS los dos casos.

- [x] **Paso 10: documentar el patrón**

En `docs/patterns/backend.md`, sección nueva **"Dónde vive un reporte"**: la tabla de § 3.2 de la
spec (rutas, permiso, el día, rango, paginación, plata, consultas) y el aviso de que un
`modulo_app` sin su fila en `tenant_modulos` da 403 hasta al admin.

- [x] **Paso 11: gate completo y commit**

Correr el gate de cierre entero (ambos bloques) + `verify-feature` paso 7 con `domain-reviewer` y
`api-security-reviewer` (esta tarea toca controller, DTOs y guards).

```bash
git add backend/src/modules/reportes backend/src/app.module.ts backend/src/modules/seeder/seeder.service.ts backend/test/reportes-varianza.e2e-spec.ts docs/patterns/backend.md
```

```bash
git commit -m "feat(reportes): el módulo de reportes y el permiso Varianza"
```

✅ **Cerrada el 2026-09-19 en `e4eac506`.** Gate: lint 0 errores · typecheck OK · unit
**2887/2887** · e2e **completo** 1045 pasan, 0 fallos. Revisión independiente: dominio y seguridad
de API LIMPIO, más dos re-revisiones del diff corregido, también LIMPIO.

Lo que salió distinto de lo planeado, y quedó escrito donde dura:
- **El DTO base no entró** (Paso 3), y la razón está ahí arriba.
- **El permiso quedó en `Inventario · Aprobación`**, confirmado por el owner el 2026-09-20.
- **Dos hallazgos de ejecución se mudaron a `docs/patterns/backend.md`** —el filtro de jest que
  choca con el nombre del worktree, y el grep de IDs que no puede incluir `docs/`—. Van ahí y no
  acá porque **este plan se borra cuando el frente se completa** (`docs/superpowers/README.md`),
  así que dejarlos en el plan era garantizar que se perdieran justo al terminar.

⚠️ **Todo hash escrito en este plan vale hasta el próximo rebase.** La rama se rebasó sobre main
`2ed4be9b` antes de la Tarea 2 (ver su cabecera), y eso reescribió los ocho hashes anteriores. Los
definitivos se copian de `git log` en el **hito de integración**, no antes: cualquiera anotado
mientras el frente vive afuera es provisorio por definición.

---

## Tarea 2 — La ventana: los dos recuentos de cada (producto, ubicación)

📌 **La rama se rebasó sobre main `2ed4be9b` antes de arrancar esta tarea**, adelantando el rebase
que estaba previsto para el hito de la Tarea 6. El motivo: main extrajo `assertSinHuecos` a
`backend/src/common/db/db.spec-helper.ts` —la aserción que verifica que **todo `$n` del SQL tenga
su bind y todo bind esté referenciado**, el bug `42P18` que un mock de `Db.query` **nunca** ve—, y
`docs/patterns/backend.md` § 10b exige ese test en toda consulta de este frente. Esta tarea arma
`$n` en posiciones dinámicas: es exactamente su caso. Sin rebasar, habría que escribir una
**quinta** copia inline de algo que main acababa de deduplicar de cuatro.

Se verificó antes de rebasar que **ningún archivo del frente coincide con los que main tocó**
(cero solape), así que el replay fue sin conflictos.

**Archivos:**
- Modificar: `backend/src/modules/reportes/varianza/varianza.service.ts`
- Test: `backend/src/modules/reportes/varianza/varianza.service.spec.ts` (nuevo)
- Test: `backend/test/reportes-varianza.e2e-spec.ts`

**Interfaces:**
- Consume: `VarianzaService` de la Tarea 1.
- Produce: `private async resolverVentanas(tenantId, filtros): Promise<VentanaVarianza[]>` y las
  filas con `medible`, `desdeEl`, `hastaEl`, `recuentoInicialId`, `recuentoFinalId` ya pobladas.
  Los cinco números siguen en `null` hasta la Tarea 3.

- [x] **Paso 1: escribir los tests unitarios que fallan**

Cuatro casos, todos sobre `resolverVentanas` con el `Db` mockeado:

1. Un (item, ubicación) con **dos** recuentos aplicados en el rango → una `VentanaVarianza` con
   `recuentoInicialId` = el más viejo y `recuentoFinalId` = el más nuevo por `aplicado_el`.
2. Con **tres** recuentos aplicados → toma el primero y el último, **ignora el del medio** como
   borde (sus movimientos quedan dentro de la ventana, que es lo correcto: son varianza).
3. Con **un solo** recuento → **no** produce ventana; la fila sale `medible: false`.
4. Un recuento en estado `borrador` o `cancelado` dentro del rango → **no cuenta como borde**.

- [x] **Paso 2: correrlos y verificar que fallan**

```bash
cd backend && npm test -- varianza.service
```

Esperado: FAIL, `resolverVentanas is not a function`.

- [x] **Paso 3: implementar `resolverVentanas`**

⚠️ **Corregido al ejecutar (2026-09-20): NO va el `HAVING COUNT(DISTINCT …) >= 2`** que este plan
pedía más abajo. Escondería las filas con **un solo** recuento en el rango — y ésas tienen que
verse, como *"falta contarlo"*. La consulta **cuenta** los recuentos por grupo y **el service
decide** con ese número (`mapGrupo`, `medible = recuentos >= 2`). Con el `HAVING`, el reporte
sería invisible justo para quien recién empieza a contar, que es el que más lo necesita.

El spec lo fija con un `expect(sql).not.toContain('HAVING')`, para que nadie lo "arregle" de
vuelta leyendo la versión original de este plan.

📌 **Y las filas se listan por (item, ubicación) con al menos UN recuento aplicado en el rango**,
no sobre el catálogo entero: un producto que nadie contó no tiene nada que decir, y llenar la
tabla de "falta contarlo" enterraría las filas que sí dicen algo.

Una sola consulta agregada, nunca una por producto. La forma:

- `FROM recuento_inventario r JOIN recuento_inventario_linea rl ON rl.recuento_id = r.recuento_id`
- `WHERE r.tenant_id = $1 AND r.estado = 'aplicado' AND r.eliminado_el IS NULL AND rl.eliminado_el IS NULL`
- bordes del rango sobre `r.aplicado_el` con `bordeFechaSql` / **`bordeHastaSql`**, previo
  `diaNegocioTenant` + `requiereDiaNegocio` + `empujarDiaNegocio`.
- `GROUP BY rl.item_id, r.ubicacion_id`, `HAVING COUNT(DISTINCT r.recuento_id) >= 2`
- Para cada grupo, sacar el `recuento_id`, el `aplicado_el` y **la `secuencia` del movimiento**
  del borde inferior y del superior. La `secuencia` sale de
  `LEFT JOIN movimientos_inventario mv ON mv.movimiento_id = rl.movimiento_id`
  (`LEFT` a propósito: el recuento que dio justo no tiene `movimiento_id`, y esa fila **tiene que
  sobrevivir** con `secuenciaDesde`/`secuenciaHasta` en `null`).

⛔ **La `secuencia` es el ancla del filtro; `aplicado_el` es solo para mostrar.** El kardex
documenta que `creado_el` no sirve para ordenar (spec § 5.2). Escribir ese porqué en el docblock
de la consulta, no solo acá.

- [x] **Paso 4: verificar que los unitarios pasan**

```bash
cd backend && npm test -- varianza.service
```

Esperado: PASS los cuatro.

- [x] **Paso 5: el mutante que prueba que el test sirve**

📌 **Medido el 2026-09-20, y el segundo mutante es el hallazgo de la tarea:**

| Mutante | Resultado |
|---|---|
| `r.estado = 'aplicado'` → `<> 'cancelado'` | muere, y **solo** su test |
| **`LEFT JOIN` → `JOIN`** | **sobrevivió** a los 9 unitarios |
| `LEFT JOIN` → `JOIN`, con el control agregado | muere en el unitario **y** en el e2e, cada uno en su test |

⛔ **Un mutante de JOIN no lo puede cazar un unitario con `Db` mockeado**, y la razón vale para
todo este service: el mock devuelve las filas que el test le pide **sin importar qué consulta se
armó**. El test de "secuencia en `null` → sigue siendo medible" pasaba porque el fixture *ya
traía* el `null`; nunca probó que el SQL produjera esa fila.

Quedaron **dos** controles, y no son intercambiables:
1. **Unitario, prueba DÉBIL:** `expect(sql).toContain('LEFT JOIN movimientos_inventario mv')`.
   Afirma sobre el texto del SQL, no sobre la conducta. Sirve para el ciclo corto.
2. **E2E, prueba FUERTE:** un recuento que cuenta **exactamente** lo que hay (delta cero, sin
   movimiento) seguido de uno con faltante; la fila tiene que seguir siendo medible. Verificado
   que el mutante lo mata.

Cambiar `HAVING COUNT(DISTINCT r.recuento_id) >= 2` por `>= 1` y correr los unitarios: **el caso 3
tiene que fallar**. Después cambiar `r.estado = 'aplicado'` por `r.estado <> 'cancelado'`: **el
caso 4 tiene que fallar**. Revertir los dos.

⚠️ El mutante tiene que **revertir al comportamiento anterior**, no solo romper: mutarlo a algo
absurdo prueba que el test toca la línea, no que habría cazado el bug.

⚠️ Tras revertir, confirmar en los logs que el watcher del backend reinició: el fuente limpio no
prueba que el proceso lo esté.

- [x] **Paso 6: e2e que arma el escenario real**

Un producto con dos recuentos aplicados y ventas en el medio; verificar que la fila trae
`medible: true` y las dos fechas correctas, con su `expect(res.status)` al lado.

- [x] **Paso 7: gate y commit**

```bash
git add backend/src/modules/reportes backend/test/reportes-varianza.e2e-spec.ts
```

```bash
git commit -m "feat(reportes): la ventana de varianza, anclada en la secuencia del kardex"
```

---

## Tarea 3 — Los cuatro números

**Archivos:**
- Modificar: `backend/src/modules/reportes/varianza/varianza.service.ts`
- Test: `backend/src/modules/reportes/varianza/varianza.service.spec.ts`
- Test: `backend/test/reportes-varianza.e2e-spec.ts`

**Interfaces:**
- Consume: `VentanaVarianza[]` de la Tarea 2.
- Produce: `teorico`, `merma`, `cortesia`, `sinExplicacion` poblados en `VarianzaFila`. `otros`
  sigue en `null` hasta la Tarea 4.

- [x] **Paso 1: escribir los tests unitarios que fallan**

Cinco casos sobre el clasificador de movimientos:

1. Una salida `motivo='venta'` de 10 → `teorico = '10.0000'`.
2. Esa venta más una entrada `motivo='anulacion'` de 4 → `teorico = '6.0000'` (**el teórico es
   neto**: cancelar una venta repone los ingredientes).
3. Una salida `motivo='merma'` con `motivo_baja.tipo='merma'` → suma a `merma`, **no** a
   `cortesia`.
4. Una salida `motivo='merma'` con `motivo_baja.tipo='cortesia'` → suma a `cortesia`, **no** a
   `merma`.
5. Un recuento con **sobrante** (entrada) de 3 → `sinExplicacion = '-3.0000'`. El signo importa:
   un sobrante resta consumo.

⚠️ **Los valores de los fixtures tienen que discriminar.** Nada de 1, y nada de dos buckets con la
misma cantidad: si merma y cortesía valen las dos 5, un bug que las sume al mismo lado pasa el
test. Usar cantidades distintas y primas entre sí (7, 11, 13…).

- [x] **Paso 2: correrlos y verificar que fallan**

```bash
cd backend && npm test -- varianza.service
```

- [x] **Paso 3: implementar la consulta agregada**

Una sola consulta sobre `movimientos_inventario mv` para **todas** las ventanas, con
`FILTER (WHERE …)` por bucket:

- ventana: `mv.secuencia > $anclaDesde AND mv.secuencia <= $anclaHasta` por (item, ubicación).
  Para las ventanas sin ancla (recuento de borde sin movimiento), el respaldo es
  `mv.creado_el > $desdeEl AND mv.creado_el <= $hastaEl` — con el comentario de por qué, que la
  spec § 5.2 explica.
- `teorico`: `SUM(cantidad) FILTER (WHERE motivo='venta' AND tipo='salida')` menos
  `SUM(cantidad) FILTER (WHERE motivo IN ('anulacion','devolucion') AND tipo='entrada')`
- `merma` / `cortesia`: `FILTER (WHERE motivo='merma' AND EXISTS (… motivo_baja mb … mb.tipo='merma'|'cortesia'))`
- `sinExplicacion`: `SUM(cantidad) FILTER (WHERE motivo='recuento' AND tipo='salida')` menos
  `SUM(cantidad) FILTER (WHERE motivo='recuento' AND tipo='entrada')`
- `AND mv.eliminado_el IS NULL` y `mv.tenant_id = $1`.

⛔ **Las N ventanas se resuelven en UNA consulta**, pasando los pares como arrays
(`unnest($2::uuid[], $3::uuid[], $4::bigint[], $5::bigint[])` y un `JOIN` contra eso). Una
consulta por ventana es el N+1 que `docs/agent/anti-patterns.md` prohíbe.

- [x] **Paso 4: verificar que pasan**

```bash
cd backend && npm test -- varianza.service
```

- [x] **Paso 5: el mutante por bucket**

⛔ **Lo que este paso prometía es FALSO, y medirlo fue lo más valioso de la tarea.** El plan decía
"uno por bucket, y cada uno tiene que matar **solo** su test" sobre los **unitarios**. No mata
ninguno: la clasificación vive entera en el SQL (`SQL_BUCKETS`) y con `Db` mockeado el mock
devuelve los buckets **ya clasificados**. Medido el 2026-09-20 — los cuatro mutantes sobrevivieron
a los 18 unitarios:

| Mutante | 18 unitarios | E2E de buckets |
|---|---|---|
| `merma` se come la cortesía (`mb.tipo IN ('merma','cortesia')`) | **sobrevive** | muere, solo su test |
| El sobrante suma en vez de restar (signo de `sin_explicacion`) | **sobrevive** | muere, solo su test |
| La compra entra al teórico | **sobrevive** | muere, solo su test |
| El teórico deja de restar anulaciones | **sobrevive** | muere, solo su test |

Lo que los unitarios sí cubren es el **mapeo y el formato**: que el número llegue a su columna,
con su signo y a escala 4. Que el movimiento haya caído en el bucket correcto solo lo puede
probar Postgres real.

📌 **Por eso la clasificación tiene archivo propio:** `backend/test/reportes-varianza-buckets.e2e-spec.ts`.
Necesita el andamiaje completo de salones —impresora, categoría, garzón propio, salón, mesa y caja
abierta— porque **la cortesía no se puede generar por `/api/mermas`**: ese endpoint rechaza a
propósito todo motivo que no sea de tipo `merma`, así que el único camino real es anular una línea
despachada en una mesa. Meter ese andamiaje en el e2e de la ventana sería peso muerto.

⚠️ Y un detalle de dominio que el test destapó, verificado en el código y no supuesto: **anular
una venta exige que NO tenga documento tributario**, no solo que esté pendiente. Con boleta
devuelve 400 *"se revierte con nota de crédito, no se anula"* — emitido el documento hay hecho
fiscal que compensar (ADR-010).

Uno por bucket, y cada uno tiene que matar **solo** su test:
- `motivo='venta'` → `motivo IN ('venta','merma')`: cae el caso 1, no los demás.
- quitar el `menos anulacion/devolucion`: cae el caso 2.
- `mb.tipo='merma'` → `mb.tipo IN ('merma','cortesia')`: caen 3 y 4.
- invertir el signo de `sinExplicacion`: cae el caso 5.

⚠️ Correr **todos** los mutantes y anotar el resultado real de cada uno, no solo los que se
suponen nuevos. Si uno sobrevive, sospechar del control antes que de la línea.

⚠️ Si un `toContain` sobre el SQL matchea el **comentario** en vez de la cláusula, el test no
prueba nada: acotar la aserción a la cláusula funcional.

- [x] **Paso 6: e2e con los cuatro buckets a la vez**

Un producto, dos recuentos, y en el medio: ventas de una receta, una venta cancelada, una merma de
bodega y una cortesía de mesa. Verificar los cuatro números, cada `res.body` con su
`expect(res.status)` al lado.

⚠️ Usar un **garzón propio** para la cortesía, no el del seed: la sesión es única por garzón y
varias specs comparten el de Ana.

- [x] **Paso 7: gate y commit**

```bash
git add backend/src/modules/reportes backend/test/reportes-varianza.e2e-spec.ts
```

```bash
git commit -m "feat(reportes): teórico, merma, cortesía y sin explicación"
```

✅ **Cerrada el 2026-09-20.** Gate: lint 0 · typecheck OK · unit **2908/2908** · e2e completo
**1063**, 0 fallos. Revisión independiente: **BLOQUEÓ** una vez, con razón, y el arreglo salió
mejor que lo pedido (abajo).

**Dos cosas que este paso enseñó y que no estaban en el plan:**

⛔ **El gate completo cazó una regresión que el subset filtrado no veía.** El e2e nuevo abría una
caja y el `afterAll` no podía cerrarla —cobraba en efectivo y `cerrarCaja` cuenta exactamente el
saldo inicial, así que el descuadre hacía fallar el cierre—. Como solo puede haber **una caja
abierta por tenant+usuario**, eso rompió **17 suites**: caja, ventas, salones, promociones,
combos, propinas, costeo CPP. Mi archivo daba **6/6 en verde**; el daño estaba entero afuera, como
409 y 400 crípticos que no apuntaban a varianza. Arreglado usando `test/helpers/caja.ts`, que
existe exactamente para esto.

⛔ **Una medición contaminada es peor que ninguna.** Corrí una suite suelta mientras mi propia
corrida completa seguía viva, y encima le reseteé el Postgres por debajo. Salieron
`index … does not exist`, reintentos de conexión y un test de concurrencia contando 3 y después 4
esperas de lock en vez de 2 — estuve a punto de diagnosticar una regresión inexistente. Lo destapó
`ps -ax | grep "[j]est --config"`, no el log. **Antes de correr el e2e, contar procesos.**

**El bloqueo de la revisión, y por qué el resultado fue mejor que el arreglo pedido:** marcó que
el `LEFT JOIN motivo_baja` no filtraba `tenant_id` ni `eliminado_el`, inconsistente con el docblock
que este mismo diff escribe para las otras tablas. Al ir a redactar el porqué —que `CLAUDE.md`
exige para que sea excepción y no olvido— **la justificación que iba a escribir resultó falsa**:
`MotivosBajaService.remove` **impide borrar un motivo en uso** (400, mira `movimientos_inventario`
y `cuenta_linea_anulaciones`). O sea que el escenario que la excepción defendía **no existe**.
Quedó: `tenant_id` agregado, `eliminado_el` fuera con el motivo REAL escrito, y un test que ata esa
garantía por si algún día se afloja el borrado.

---

## Tarea 4 — Los saldos de borde y la columna «Otros»

**Archivos:**
- Modificar: `backend/src/modules/reportes/varianza/varianza.service.ts`
- Test: `backend/src/modules/reportes/varianza/varianza.service.spec.ts`
- Test: `backend/test/reportes-varianza.e2e-spec.ts`

**Interfaces:**
- Consume: los cuatro números de la Tarea 3.
- Produce: `otros` poblado en `VarianzaFila`, y `private async saldosDeBorde(ventanas)`.

- [x] **Paso 1: escribir los tests que fallan**

Tres casos:

1. **Cierra:** una ventana con solo ventas, mermas y recuento → `otros = '0.0000'`.
2. **No cierra:** la misma ventana más un movimiento con un `motivo` que el reporte no clasifica
   → `otros` vale **exactamente** esa cantidad.
3. **El saldo de borde no es `cantidad_contada`:** montar un recuento donde se contaron 11.800 y
   se vendieron 500 **entre contar y aplicar**; el saldo al cerrar tiene que ser 11.300. Un
   `otros` distinto de cero acá delata que se tomó el valor contado.

⚠️ El caso 2 es el que distingue el detector del adorno: un `otros` cableado a `'0.0000'` pasa el
caso 1 igual.

⚠️ El caso 3 es el más fácil de escribir mal: si el fixture aplica el recuento sin ventas en el
medio, los dos números coinciden y el test no discrimina nada.

- [x] **Paso 2: correrlos y verificar que fallan**

```bash
cd backend && npm test -- varianza.service
```

- [x] **Paso 3: implementar `saldosDeBorde` y el residuo**

- Saldo en cada borde = `stock_resultante` del movimiento que apunta
  `recuento_inventario_linea.movimiento_id`. Sin `movimiento_id`, el último movimiento con
  `creado_el <= r.aplicado_el` ordenado por `secuencia DESC` (el respaldo de la spec § 5.2).
- Abastecimiento de la ventana = entradas `compra`, `correccion_compra`, `inventario_inicial` y
  `traslado`, menos salidas `traslado`.
- `consumoPorSaldos = saldoA + abastecimiento − saldoB`
- `otros = consumoPorSaldos − (teorico + merma + cortesia + sinExplicacion)`, todo con
  `Decimal.js`, a escala 4.

⛔ **`otros` se calcula como residuo, nunca como "la suma de los motivos que no conozco"** — una
lista solo caza un motivo nuevo; el residuo caza además un motivo conocido que cambie de
comportamiento (spec § 5.4). Escribir ese porqué en el docblock.

- [x] **Paso 4: verificar que pasan**

```bash
cd backend && npm test -- varianza.service
```

- [x] **Paso 5: el mutante**

Reemplazar el residuo por `new Decimal(0)`: **el caso 2 tiene que fallar** y el 1 tiene que seguir
pasando. Si el caso 2 pasa con el mutante, el test no prueba nada. Revertir.

- [x] **Paso 6: el e2e de la identidad**

Escenario completo (compra, venta, venta cancelada, merma, cortesía y un faltante al contar) y
exigir `otros === '0.0000'`. ✅ Hecho: la identidad cierra contra Postgres real con movimientos de
todos los tipos.

⛔ **Escribí acá que ese control "no se puede montar" y lo etiqueté como "medido, no supuesto".
Las dos cosas eran falsas.** Lo cazó la revisión independiente (2026-09-20) y es el peor error del
frente, porque la etiqueta le daba autoridad a algo que no había verificado.

**Lo que pasó:** el plan pedía falsear un movimiento `ajuste_manual` con SQL directo. Mi primer
intento hizo eso, la invariante `costo-stock-choke-point` lo rechazó —correctamente: prohíbe
escribir `stock_ubicacion` fuera de `inventario.service`, y barre también `backend/test`—, y de ahí
concluí que **el caso era inalcanzable por la API**. No lo era.

**`ajuste_manual` lo escribe la API**: `AjusteStockDto` lo acepta junto con `compra`, `devolucion`
e `inventario_inicial`, y `ItemsService.ajustarStock` lo pasa tal cual al kardex, que actualiza
`stock_ubicacion` **dentro** de su choke-point. Ninguna invariante se toca.

⚠️ **Y el dato estaba a la vista, en mi propio archivo:** el e2e usa
`PATCH /items/:id/stock` con `motivo: 'compra'` **dos líneas antes** del comentario donde afirmé
que ese endpoint no podía producir el caso. Vi que la invariante rechazaba *mi manera* de montarlo
y lo leí como que el caso era imposible, en vez de buscar otra manera.

📌 **Lo que sí era cierto:** sin el `UPDATE` prohibido, *ese* test no probaba nada —el delta caía
entero en "sin explicación"—. Pero eso solo invalidaba el camino del SQL directo, no el caso.

**Cómo quedó:** el test existe, se monta por la API real, y el mutante que cablea `otros` a cero lo
mata. Y destapó algo de producto que ahora está escrito en el código: **todo tenant que use
"Ajustar stock" dentro de una ventana va a ver «Otros» distinto de cero.** Es la conducta correcta
—el reporte avisa que hay algo que no sabe explicar— pero nadie lo había dicho.

📌 Es la lección de la Tarea 3 al revés: allá el unitario no podía probar la clasificación; acá el
e2e no puede probar el detector. Cada uno cubre lo que el otro no, y **decir cuál es cuál importa
más que tener los dos**.

- [x] **Paso 7: gate y commit**

```bash
git add backend/src/modules/reportes backend/test/reportes-varianza.e2e-spec.ts
```

```bash
git commit -m "feat(reportes): la columna Otros como residuo de la identidad"
```

---

## Tarea 5 — La plata

**Archivos** (rehecho al cerrar contra el estado real del arbol, no de memoria — la lista original
no tenia el e2e nuevo, el helper ni las docs, y la primera correccion todavia se comia dos de los
e2e):
- Modificar: `backend/src/modules/reportes/varianza/varianza.service.ts`
- Test: `backend/src/modules/reportes/varianza/varianza.service.spec.ts`
- Test **nuevo**: `backend/test/reportes-varianza-plata.e2e-spec.ts`
- Helper **nuevo**: `backend/test/helpers/recuentos.ts` (tercera copia de `contarYAplicar`)
- Test, migrados al helper: `backend/test/reportes-varianza.e2e-spec.ts` y
  `backend/test/reportes-varianza-buckets.e2e-spec.ts`
- Docs: `docs/patterns/backend.md` § 10c, y en la spec la fila de `soloConVarianza` mas el ⛔ que
  explica que esconde y que cuesta

**Interfaces:**
- Consume: los números de las tareas 3–4.
- Produce: `costoSinExplicacion: CostoPorMoneda[]` y `faltaCosto: boolean`, y el `ORDER BY` final.

⚠️ **Corrección medida el 2026-09-20, antes de escribir código.** La tarea decía "copiar el molde
de anulaciones", y eso da por hecho que la plata es una decoración de la página. No lo es, y
cambia la forma de la consulta:

1. **La spec § 7.1 pide ordenar por plata desc.** Hoy la página se elige en SQL con
   `ORDER BY i.nombre ASC … LIMIT/OFFSET`, y la plata se calcularía DESPUÉS, en una consulta que
   solo ve las filas ya elegidas. Ordenar ahí ordena *dentro* de la página: la página 1 traería
   las 15 primeras alfabéticamente ordenadas entre sí, no las 15 de mayor pérdida. El orden tiene
   que salir de la misma consulta que pagina.
2. **`soloConVarianza` está en el DTO y no lo consume nadie** (medido: `grep` en `backend/src` y
   `backend/test` lo encuentra solo en su propia declaración). La API acepta
   `?soloConVarianza=true` y devuelve todo igual: un filtro que miente, peor que código muerto.
   Filtra sobre "sin explicación", que vive en la consulta de buckets — el mismo problema
   estructural que el orden. El plan nunca lo implementaba en ninguna tarea.
3. **Por fila, la lista de monedas tiene a lo sumo UN elemento**: `items.moneda_id` es `NOT NULL`
   y una fila es un solo ítem. El array existe porque el `/resumen` (Tarea 6) sí suma monedas
   distintas. Conviene saberlo antes de escribir un test que pretenda dos monedas en una fila:
   el caso 2 del paso 1 se prueba con **dos filas**, no con una.

**Consecuencia:** los tres puntos son el mismo cambio —el número que decide orden y filtro tiene
que estar en la consulta paginada—, así que van juntos. Hacer solo la plata dejaría un reporte que
dice ordenar por pérdida y ordena alfabéticamente: un estado peor que el actual
(memoria "dos tareas, un mismo número").

**Cómo:** la agregación de grupos pasa a una subconsulta y la consulta paginada le cuelga un
`LEFT JOIN LATERAL` con "sin explicación" y su plata; el `ORDER BY` y el `WHERE` de
`soloConVarianza` van ahí. Para que "sin explicación" no quede calculado con dos criterios que
puedan derivar, la expresión y el predicado de ventana salen a constantes compartidas con
`SQL_BUCKETS`. El `COUNT` incluye el `LATERAL` **solo** cuando `soloConVarianza` viene activo: si
no, filtraría por nada y pagaría el costo igual. Las dos formas llevan e2e.

**`faltaCosto` y la cifra parcial.** El paso 1 decía "`faltaCosto: true` y ese monto no se suma".
Se sigue el criterio que el repo ya fijó en anulaciones el 2026-09-18 (`resolverCosto`): si algún
movimiento del grupo no tiene costo, la fila va con `costoSinExplicacion: []`, nunca con una cifra
parcial que parezca completa. Y el caso es **alcanzable por la API real** (medido, no supuesto):
un producto creado sin `costo` queda con `costo_actual` en `NULL` (`items.service.ts`,
`costoActual = dto.costo ?? null`), `PATCH /items/:id/stock` acepta la entrada sin `costoUnitario`,
y el recuento no pasa costo propio — el kardex congela ese `NULL` (`costoUnitarioCongelado` cae en
`costoActualPrevio`).

⚠️ **Cómo terminó siendo, después de seis revisiones — y los errores de método que quedaron en el
medio.** La tercera revisión midió que la forma de conjunto (`CTE` + `GROUP BY`) costaba
`shared hit=21` contra `87` del `LATERAL`, y cambié la implementación por eso. La cuarta escaló el
kardex a 198.293 movimientos y la conclusión se dio vuelta: **36,9 ms** la de conjunto contra
**7,3 ms** el `LATERAL`. Volvió al `LATERAL`.

⛔ **La causa que escribí para ese vuelco era falsa, y la quinta revisión la midió.** Había puesto
que "con las claves del `JOIN` saliendo del `CTE` no hay nada que empujar a un índice". Sí lo hay:
la misma forma de conjunto, filtrando un solo producto, planifica `Bitmap Index Scan` con
`Index Cond: (item_id = g.item_id)` y sale en **0,5 ms**. Lo que pasa de verdad es que **cambia de
plan según cuántos grupos sobrevivan**, y la vista por defecto del reporte es la de muchos grupos.
La versión que vale es esa; la anterior sobrevivió un commit entero en este mismo archivo,
contradiciendo a la lección (b) tres líneas más abajo.

📌 **Tres lecciones, que no son la misma.** (a) Una medición sobre datos de seed puede elegir la
forma equivocada: la tabla chica hace barato el `Seq Scan`. (b) Y una con el filtro puesto también:
la forma de conjunto da 0,5 ms filtrando un producto y 36,9 ms sin filtrar, porque **cambia de plan
según cuántos grupos sobrevivan** — hay que medir el caso que la pantalla abre primero. (c) Acepté
el número de una revisión sin escalarlo, igual que había aceptado antes su comentario al paso sobre
rendimiento — **dos veces en la misma tarea**. Un revisor mide lo que le pediste, no lo que hacía
falta medir.

⚠️ **El índice candidato de la Tarea 9 ya está medido, y no sirve.** `(item_id, ubicacion_id,
secuencia)` se creó y se midió: 7,28 ms → 8,20 ms, o sea nada, con los mismos `Heap Blocks`. De las
677 filas que descarta el `Filter`, `ubicacion_id` saca 34; las otras las sacan los bordes de la
ventana, que van dentro de un `CASE`, y **ningún índice sirve un `CASE` como `Index Cond`**.

📌 **El método del inflado, para que se pueda repetir:** copiar los movimientos del tenant ×250
dentro de una transacción revertida. Se probaron las dos variantes —`creado_el` corrido unos
segundos y `creado_el = now()`— y dan lo mismo: 678 leídas y 677 descartadas por vuelta. El número
no depende de esa elección.

⚠️ **Y cuál aplanado del `CASE`, porque no son equivalentes** (medido, mirando el plan y no el
reloj): el aplanado con `OR` y guarda de `IS NOT NULL` da los **mismos 30 resultados** pero su
`Index Cond` sigue siendo solo `item_id` —no desbloquea nada—; el que compara `secuencia` a secas
mete los dos bordes en el `Index Cond` y baja de ~7 ms a menos de 1, pero **cambia el resultado de
9 de los 30 grupos** (caen a cero) porque pierde el respaldo por `creado_el` del recuento de delta
cero. La palanca existe y su precio es exactamente ese, no una excusa. Decisión de la Tarea 9.

⛔ **Las dos cifras de arriba estuvieron mal en el commit anterior —14 grupos y "577 en vez de
677"— y el modo de falla es el que este frente repitió siete veces: las tomé de una revisión y las
escribí sin medirlas.** Medidas después: 9 grupos y 677 con los dos inflados. Un revisor que mide
no exime de medir; lo que entrega es una hipótesis con número, no un hecho.

⚠️ **Ojo con el seed**: 17 de 30 grupos tienen `secuencia_desde` en `NULL` y 8 `secuencia_hasta`,
así que buena parte de lo medido pasa por la rama de respaldo y no por la de `secuencia`.

⚠️ **El argumento de "seguir la forma que ya usa el repo" también estaba mal aplicado.**
`SQL_BUCKETS` agrega sobre las ventanas de **la página** (15, por `unnest`); esta agregación tiene
que cubrir **todos** los grupos del rango para poder ordenar. Son dos problemas distintos, y por eso
la respuesta es otra forma.

⚠️ **Rendimiento: lo que queda para la Tarea 9, dicho sin invertirlo.** El `ORDER BY` está por
encima del `LIMIT`, así que **todos** los grupos del rango se evalúan, no los 15 de la página —y la
página paga ese barrido siempre, con filtro o sin él; con filtro son dos por request, contando el
del `COUNT`—. Es intrínseco a ordenar por un agregado. Lo que hay que medir es **cómo escala ese
barrido** con miles de (ítem, ubicación), no la latencia de una página chica, que da verde siempre.
(La primera versión de este párrafo decía lo contrario —"la rama cara no es la página"— y estaba
marcada como medida sin estarlo: la escribí copiando un comentario al paso de una revisión. Es la
segunda afirmación falsa marcada como medida en este frente.)

📌 **La decisión del owner sobre `soloConVarianza` entró en ESTE commit y no en uno propio.** La
regla anotada el 2026-09-20 —una decisión del owner a mitad de tarea va en su propio commit— se
saltea acá con motivo: la tercera revisión BLOQUEÓ justamente por esa conducta (sin decidir, sin
comentario y sin test), así que separarla habría significado commitear a sabiendas un diff
bloqueado. La decisión va nombrada en el mensaje del commit y fijada por un e2e propio.

- [x] **Paso 1: escribir los tests que fallan**

1. Un producto en CLP con 4 kg sin explicación a `costo_unitario` 3.100 →
   `costoSinExplicacion: [{ monedaId: CLP, monto: '12400.0000' }]`.
2. Dos productos en **monedas distintas** → dos entradas, **sin convertir** ni sumar entre sí.
3. Un movimiento con `costo_unitario IS NULL` → `faltaCosto: true` y ese monto **no** se suma.
4. El orden: el producto de menos cantidad pero más plata queda **primero**.

- [x] **Paso 2: correrlos y verificar que fallan**

```bash
cd backend && npm test -- varianza.service
```

- [x] **Paso 3: implementar**

Copiar el molde exacto de `anulaciones-reporte.service.ts` → `cargarCostosPorAnulacion`:
`SUM(ROUND(mv.cantidad * mv.costo_unitario, 4))` agrupado por `i.moneda_id`, con
`bool_or(mv.costo_unitario IS NULL) AS falta_costo`.

⛔ **`Σ ROUND(...)`, nunca `ROUND(Σ ...)`** — es la regla que la spec de anulaciones ya fijó.

⛔ **Nunca convertir entre monedas.** Lo que se implementó, y por qué difiere de como estaba
escrito acá: la regla original —"compara dentro de cada moneda; con más de una desempata el monto
de la moneda oficial"— **no se puede aplicar a nivel de fila**, porque una fila tiene UNA sola
moneda (`items.moneda_id` es `NOT NULL`). Lo que existe de verdad es el orden ENTRE filas de
monedas distintas, y ahí cualquier orden total es una convención: sin conversión no hay forma de
decir si 20 USD es más o menos que 12.400 CLP. Se ordena por `monto DESC` comparando los números
como están, con nombre de producto y de ubicación como desempate estable. Eso acierta en el caso
real —todas las filas en la moneda del local— y es determinista en el otro. El docblock del
`ORDER BY` lo dice con todas las letras, en vez de dar a entender que compara valor.

- [x] **Paso 4: verificar que pasan**

```bash
cd backend && npm test -- varianza.service
```

- [x] **Paso 5: el mutante**

Mutar `SUM(ROUND(mv.cantidad * mv.costo_unitario, 4))` a `ROUND(SUM(mv.cantidad * mv.costo_unitario), 4)`
—o sea, volver al orden **incorrecto**— y verificar que el caso 1 falla.

⚠️ **Para que ese mutante muera, el fixture tiene que tener con qué.** Con un `costo_unitario`
entero y redondo los dos órdenes dan exactamente igual y el mutante sobrevive sin que la línea
esté mal: hacen falta varios movimientos con costos de muchos decimales, donde redondear antes y
después difiera. Revertir después.

⚠️ Un segundo mutante, para la moneda: borrar `GROUP BY i.moneda_id` y verificar que **cae el
caso 2** (dos monedas). Si no cae, el fixture tiene las dos en la misma moneda. Revertir.

**Medido el 2026-09-20 — cinco mutantes, uno por vez, revirtiendo entre cada uno.** Todos contra
`reportes-varianza-plata.e2e-spec` (5 tests) y Postgres real:

| Mutante (vuelve a la conducta anterior) | Resultado | Qué test murió |
|---|---|---|
| `Σ ROUND(...)` → `ROUND(Σ ...)` | **muere** | solo el del redondeo: `1.5000` esperado contra `1.4999` recibido |
| `ORDER BY c.monto DESC` → solo por nombre | **muere** | el del orden **y** el de monedas (ver abajo) |
| `soloConVarianza` deja de filtrar la página | **muere** | solo el del filtro |
| `faltaCosto` vuelve al placeholder `false` | **muere** | solo el del movimiento sin costo |
| el `COUNT` ignora el filtro y usa siempre la forma barata | **muere** | el del filtro, por `meta.total` |

📌 **Dos tests mueren con el mutante del orden, y es deliberado.** El de monedas afirma también
cuál fila encabeza, porque **el orden es el único lugar donde una conversión se haría visible**:
20 USD es menos que 12.400 CLP como número, pero a la tasa del tenant son 19.000 y la fila en
dólares pasaría a encabezar.

⚠️ **La primera versión de ese test no discriminaba nada, y lo destapó este mutante.** Estaba
escrito con 6 USD contra 12.400 CLP y un comentario que afirmaba que, convertidos, los dólares se
pondrían primeros. Falso: 6 × 950 = 5.700, que sigue siendo menos que 12.400 — con esos números la
aserción pasaba con conversión y sin conversión. Se cambió a 20 USD, donde las dos cuentas dan
órdenes opuestos. Es la lección de "el valor del fixture decide si el mutante vive", otra vez.

⚠️ **El segundo mutante que este plan pedía —borrar `GROUP BY i.moneda_id`— ya no aplica**, y el
motivo es el punto 3 de la corrección de arriba: la moneda no se agrupa, viaja con el grupo, porque
una fila es un ítem y un ítem tiene una sola moneda. Borrar ese `GROUP BY` hoy no produce un
número mal: produce un error de Postgres. Lo reemplaza el mutante del `ORDER BY`, que es el que
ejerce la conducta que aquel quería proteger.

- [ ] **Paso 6: gate y commit**

```bash
git add backend/src/modules/reportes backend/test/reportes-varianza.e2e-spec.ts
```

```bash
git commit -m "feat(reportes): la varianza valorizada por moneda, sin convertir"
```

---

## Tarea 6 — `/resumen`: totales, top 10 y el aviso de teórico incompleto

**Archivos:**
- Crear: `backend/src/modules/reportes/varianza/dto/resumen-varianza.dto.ts`
- Modificar: `varianza.service.ts`, `varianza.controller.ts`
- Test: `varianza.service.spec.ts`, `backend/test/reportes-varianza.e2e-spec.ts`

📌 **Patrón del frente, para no volver a discutirlo en la 7 y la 8: las bases compartidas de este
plan se crean cuando hay DOS consumidores, no antes.** Ya pasó dos veces. La Tarea 1 creó
`RangoReporteDto` "para que los reportes lo extiendan" y hubo que sacarlo: nadie lo extendía,
porque `QueryVarianzaDto` ya ocupa su `extends` con la paginación. Esta tarea volvía a pedirlo, y
el único hijo sería el DTO del resumen — una base con un hijo es la misma deuda con mejor
intención. El molde del repo va igual: `ResumenAnulacionesDto` declara sus dos fechas y no hereda
de nada.

**Interfaces:**
- Consume: todo lo anterior.
- Produce: `GET /api/reportes/varianza/resumen` → `ResumenVarianza`:

```ts
export interface ResumenVarianza {
  totales: {
    teorico: CostoPorMoneda[];
    merma: CostoPorMoneda[];
    cortesia: CostoPorMoneda[];
    sinExplicacion: CostoPorMoneda[];
    otros: CostoPorMoneda[];
  };
  /** Top 10 por plata perdida, para la gráfica. Ya ordenado desc. */
  top: {
    itemId: string;
    itemNombre: string;
    merma: string;
    cortesia: string;
    sinExplicacion: string;
    monedaId: string;
  }[];
  /** Cuántos productos con varianza quedaron fuera del top. */
  fueraDelTop: number;
  // ⚠️ `totales` va SOLO en plata, nunca en cantidad: sumar los kilos de la
  // harina con los litros del aceite no significa nada. La cantidad se lee
  // por fila, en la tabla; la plata es lo único comparable entre productos,
  // y por eso es también lo que ordena el reporte.
  /**
   * ⛔ **Este campo NO se implementó.** Decisión del owner del 2026-09-20 sobre
   * una medición: los dos casos que iba a avisar no los deja producir la API
   * (una receta exige un ingrediente al crearse y al editarse; un ingrediente
   * de receta es `tipo='ingrediente'`, y ese tipo siempre recibe ficha en
   * `item_producto`). Habría sido una consulta que devuelve vacío siempre.
   * El detalle y lo que se pierde al sacarlo: spec § 5.6.
   */
  // teoricoIncompleto: …
  /**
   * Lo que NO se puede medir en el rango, **abierto en dos** — decisión del
   * owner del 2026-09-20, respondiendo la pregunta que dejó la Tarea 5.
   *
   * ⛔ **Son dos problemas distintos y por eso van separados:** al primero le
   * falta **empezar** a contarse, al segundo le falta **cerrar** el conteo. Un
   * solo número sumado (51) diría cuánto falta pero no qué hacer sin abrirlo, y
   * dejar solo el primero escondía a los de uno: con `soloConVarianza` tildado
   * tampoco salen en la tabla, así que no aparecían en ninguna parte.
   *
   * Universo de los dos: ítems con `activo = true` (ver abajo por qué no el
   * catálogo entero). `contadoUnaSolaVez` son los que tienen **exactamente un**
   * recuento aplicado en el rango — los mismos que la tabla muestra con
   * `medible: false`.
   */
  sinConteo: {
    nuncaContado: { total: number; items: { itemId: string; nombre: string }[] };
    contadoUnaSolaVez: {
      total: number;
      items: { itemId: string; nombre: string }[];
    };
  };
}
```

### El faltante de conteo — decisión del owner, 2026-09-20

El reporte sigue listando **solo** las filas con al menos un recuento aplicado en el rango (§ 3.3
de la spec). Encima de la tabla va **una línea con el faltante**: *"43 productos activos sin
conteo en este período"*, con cómo ver cuáles son.

⛔ **El universo son los ítems `activo = true`, no el catálogo entero**, y el porqué es del owner:
si un producto ya no se vende, **lo correcto es archivarlo**, no inventar una regla en el reporte
para esconderlo. El ruido lo saca él pausando, no el reporte filtrando.

Eso se apoya en algo que ya existe y funciona, verificado el 2026-09-20:
`items.activo` (`item.entity.ts:47`, default `true`), editable por `PATCH /items/:id`, y las
cuatro pantallas de venta ya piden `activo=true` (`items.service.ts:660`). La UI que lo maneja es
`frontend/app/pages/configuracion/items.vue`, que ya separa activos de pausados.

Por qué gana a las dos alternativas: el catálogo entero da un número que nunca baja y mezcla lo
que ya no se vende; "solo lo que tuvo movimiento" deja invisible al **producto activo sin un solo
movimiento**, que es justo el caso del robo completo.

Al implementarlo:
- ⛔ **El faltante sale de una agregación**, no de traer el catálogo y restar en memoria: sería un
  N+1 de manual sobre una tabla que crece.
- ⛔ **El total y el detalle tienen que cerrar, y ahora son DOS pares.** Si la línea dice 43 y 8,
  que 43 y 8 sean lo que aparece al pedir cada lista. Un total que no coincide con su detalle es
  peor que no mostrar nada — el owner lo va a leer como tarea pendiente.
- ⛔ **Los dos conjuntos son disjuntos por construcción** (cero recuentos contra exactamente uno),
  así que ningún ítem puede aparecer en los dos. Va un test que lo fije: si alguna vez se cambia
  el criterio de uno, el solapamiento sería silencioso.

⚠️ **Arista aceptada a sabiendas** (owner, 2026-09-20): pausar un ítem que **todavía tiene stock**
lo saca del reporte con existencias adentro. Pausar es *"no lo vendo más"*, no *"no lo tengo
más"*. No bloquea nada, no se arregla en este frente, y se documenta para que el próximo no lo
lea como bug.

- [ ] **Paso 1: escribir los tests que fallan**

1. `desde`/`hasta` ausentes → **400** (son obligatorios acá, a diferencia del listado).
2. Rango de 400 días → **400** con el mensaje del tope.
3. Con 14 productos con varianza → `top` trae 10 y `fueraDelTop` vale 4.
4. ~~Un ítem `tipo='receta'` vendido 12 veces sin filas en `receta_ingredientes`.~~ **No se puede
   montar: la API lo rechaza.** Fue el test que destapó que el aviso sobraba.
5. ~~Un ingrediente en `receta_ingredientes` y no en `item_producto`.~~ **Tampoco.**
6. El faltante de conteo **abierto en dos**: uno nunca contado y otro contado una sola vez, cada
   total cerrando con su lista, y **ninguno de los dos en la lista del otro**.
7. El que se contó **dos** veces no está en ninguna de las dos listas: ese sí se puede medir.

- [ ] **Paso 2: correrlos y verificar que fallan**

```bash
cd backend && npm test -- varianza.service
```

- [ ] **Paso 3: el DTO del resumen**

**Acá nace la base compartida** (Paso 3 de la Tarea 1 explica por qué no antes): crear
`reportes/dto/rango-reporte.dto.ts` con `desde`/`hasta` opcionales y `@IsDateString()`, y después
`ResumenVarianzaDto extends RangoReporteDto` con los dos **requeridos** (redeclararlos sin
`@IsOptional()`) y la validación del tope de 366 días, con el mismo mensaje que
`ResumenAnulacionesDto`.

⚠️ **El tope no es cosmético:** este endpoint corre sin `LIMIT` sobre todo el rango, y sin piso un
`{}` traía a memoria el historial entero del tenant — es el bug exacto que la ronda de fix de
anulaciones cerró.

- [ ] **Paso 4: implementar el resumen y el aviso**

Los totales y el top salen de la misma agregación de las tareas 3–5, sin `LIMIT`. El aviso son
**dos consultas agregadas más** (no una por plato):

⛔ **El aviso no se construyó, y las dos consultas de abajo quedaron sin escribir.** Al montar el
test del primer caso, la API devolvió `400 Las recetas requieren al menos un ingrediente`: el
estado que el aviso iba a detectar **no se puede producir**. Medido también el segundo (el tipo
`ingrediente` siempre recibe ficha de stock). Decisión del owner: sacarlo y dejar escrito por qué,
en spec § 5.6 y en el docblock de `resumen()`.

📌 **La lección de método, que es la que vale para las tareas que siguen:** el test no falló por
estar mal escrito — falló porque el caso no existe. Cuando montar un escenario por la API devuelve
400, la primera hipótesis no es "me falta un campo" sino **"el sistema no deja que esto pase, así
que ¿para quién es esta función?"**. Es la misma señal que ya está anotada como
"test de estado inalcanzable", cobrada del lado contrario al de la Tarea 4.

~~- `platosSinReceta`: ventas del rango de ítems `i.tipo='receta'` que no tienen filas vivas en
`receta_ingredientes`.~~
~~- `ingredientesSinFichaDeStock`: `receta_ingredientes ri LEFT JOIN item_producto ip` donde
`ip.item_id IS NULL`.~~

- [ ] **Paso 5: la ruta**

```ts
// ⚠️ Ruta ESTÁTICA: va declarada en este controller que no tiene ninguna
// ruta con `:param`, así que no hay riesgo de que se la coman — pero la
// regla del repo es igual: estáticas antes que paramétricas.
@Get('resumen')
@RequiresPermiso('Varianza', 'Leer')
resumen(@Req() req: Request, @Query() query: ResumenVarianzaDto) {
  const user = req.user as JwtUser;
  return this.varianza.resumen(user.tenantId!, query);
}
```

- [ ] **Paso 6: verificar que pasan, más el e2e**

```bash
cd backend && npm test -- varianza.service
```

```bash
cd backend && npm run test:e2e -- reportes-varianza
```

- [ ] **Paso 7: gate y commit**

```bash
git add backend/src/modules/reportes backend/test/reportes-varianza.e2e-spec.ts
```

```bash
git commit -m "feat(reportes): resumen de varianza con top 10 y aviso de teórico incompleto"
```

---

## Hito de integración — al cerrar la Tarea 6

- [ ] **Entrada nueva en `docs/agent/anti-patterns.md`: el mock de `Db` tapa el SQL.**
  Encargo de la sesión orquestadora (2026-09-20), con el presupuesto de **30 líneas por entrada**
  que ahora rige ese archivo.

  Lo que tiene que decir, con los números medidos en este frente —**ya van dos veces, así que es
  patrón del módulo y no accidente**—:
  - Tarea 2: mutar `LEFT JOIN` → `JOIN` **sobrevivió a los 9 unitarios**. El `LEFT` era lo único
    que mantenía en el reporte al recuento de delta cero.
  - Tarea 3: **los cuatro** mutantes de clasificación sobrevivieron a los **18** unitarios. La
    clasificación vive entera en el SQL y el mock devuelve los buckets **ya clasificados**.
  - La trampa que lo esconde: un test que le **pasa la respuesta al mock** y después la afirma no
    prueba nada sobre la consulta. El mío se llamaba *"secuencia en null → sigue siendo medible"*
    y pasaba porque el fixture ya traía el `null`.
  - La salida: **dos controles rotulados**, débil (aserción sobre el texto del SQL, para el ciclo
    corto) y fuerte (e2e contra Postgres que monte el caso). Decir cuál es cuál en el propio test.

- [ ] **Regla de commits, desde 2026-09-20:** si una decisión del owner llega **a mitad de una
  tarea**, va en **su propio commit** aunque sean tres líneas. El commit de la Tarea 3 mezcló el
  cierre con la decisión del faltante de conteo (§ 5.7, que es de la Tarea 4); la revisión lo
  marcó con razón. No se deshace —ya está en main—, pero no se repite.

- [ ] ⚠️ **El stack compartido va a tener cola en la Tarea 7.** A la sesión de compras se suma el
  frente de los cuatro mecánicos (puerto 5439). **Pedir el turno con anticipación**, no al llegar.
  Y ⛔ **no informarle a otra sesión sobre el estado del reparto**: ese dato lo tiene la
  orquestadora y el mío ya estuvo desactualizado una vez.

Decisión de la sesión orquestadora (2026-09-19): **no esperar a la Tarea 10 para integrar.** Main
se mueve rápido —hoy hubo dos rebases seguidos por commits de docs de otras sesiones— y diez
tareas afuera es mucha superficie de conflicto. Se mergea la mitad de backend y las tareas 7–10
siguen sobre main ya actualizado.

- [ ] **Paso 1: que la mitad se sostenga sola en main**

⚠️ Mergear las tareas 1–6 deja en main **dos rutas que ninguna pantalla llama todavía**. Eso por
sí solo no molesta —el módulo está detrás de su permiso y solo un rol del seed lo tiene—, pero sí
molesta que main quede con una feature **sin doc viva**, que es justo lo que `CLAUDE.md` pide
evitar. Así que este hito **adelanta parte de la Tarea 10**:

- Escribir ya `docs/features/reporte-varianza.md` con el modelo de la spec § 5 (la parte de
  backend: ventana, los cuatro números, la identidad, «Otros», los tres agujeros del teórico).
- Fila en `docs/ESTADO.md` marcada explícitamente como **backend listo, pantalla pendiente**, no
  como feature terminada.
- `docs/features/modulo-reportes.md` y el resto del backlog quedan para la Tarea 10, cuando el
  patrón esté completo con su mitad de frontend.

- [ ] **Paso 2: revisión de rama de las tareas 1–6**

No alcanza con las revisiones por tarea: la de rama caza contradicciones **entre** tareas —un seed
de la Tarea 6 que rompa el e2e de la Tarea 3, un nombre que derivó entre la 2 y la 5— que ninguna
revisión por-tarea puede ver.

- [ ] **Paso 3: gate completo de nuevo, sobre el conjunto**

Los dos bloques enteros, no un subset. Un DTO requerido agregado tarde rompe specs que pasaban, y
tocar el constructor de un service rompe unitarios que nadie estaba mirando.

```bash
/Users/m2pro/cmatheus/startup-app/scripts/db-aislada.sh reset 5436
```

- [ ] **Paso 4: avisar a la orquestadora**

Rama, hash **copiado de `git log`**, gate con conteos y veredictos. ⛔ **No mergear ni pushear**:
el fast-forward lo hace ella con el OK del owner.

- [ ] **Paso 5: retomar sobre main actualizado**

Después del merge, rebasar la rama sobre main antes de arrancar la Tarea 7.

📌 **Si al llegar acá la mitad de backend no se sostiene sola** —por ejemplo si la doc de la
feature no se puede escribir sin hablar de la pantalla—, **decírselo a la orquestadora y revisar
el corte**. El criterio lo pone el owner, no esta tarea.

---

## Tarea 7 — `AppRangoFechas` y la pantalla de varianza (tabla)

La gráfica **no** entra acá: entra en la Tarea 8 sobre esta misma pantalla. Así ningún componente
queda muerto esperando a su consumidor.

**Archivos:**
- Crear: `frontend/app/components/AppRangoFechas.vue`
- Crear: `frontend/app/components/AppRangoFechas.nuxt.spec.ts`
- Crear: `frontend/app/pages/reportes/index.vue`
- Crear: `frontend/app/pages/reportes/varianza.vue`
- Crear: `frontend/app/pages/reportes/varianza.nuxt.spec.ts`
- Crear: `frontend/e2e/reportes/varianza.spec.ts`
- Modificar: `frontend/app/layouts/dashboard.vue` (grupo "Reportes")
- Modificar: `docs/patterns/frontend.md`

**Interfaces:**
- Consume: `GET /api/reportes/varianza` y `/resumen` de las tareas 1–6.
- Produce: `AppRangoFechas` con `v-model:desde` / `v-model:hasta` (`string | null`, `YYYY-MM-DD`)
  y prop `qa`, disponible para **cualquier** pantalla.

- [x] **Paso 1: el spec de render de `AppRangoFechas` que falla**

Tres aserciones: emite `YYYY-MM-DD` (no un `Date` ni un timestamp) en los dos `update:`; monta
`DiaNegocioNota` debajo; y con `desde` posterior a `hasta` muestra el aviso y **no** emite.

- [x] **Paso 2: correrlo y verificar que falla**

```bash
cd frontend && npm test -- AppRangoFechas
```

- [x] **Paso 3: implementar `AppRangoFechas`**

⛔ **Hay una invariante que barre `frontend/app` y va a rechazar la forma fácil de armar la
fecha** (`frontend/app/invariants/fecha-local.invariant.spec.ts`, entró a main el 2026-09-20).
Falla si encuentra el día armado desde UTC, y cubre **tres** formas, no una:
`toISOString().slice(0, 10)`, `.substring/.substr(0, 10)` y `toISOString().split('T')[0]`.
Stripea comentarios, así que un docblock que nombre el patrón no la rompe.

La fecha se arma **por componentes locales** (`getFullYear`/`getMonth`/`getDate`), que es lo que
ya hace `hoyLocal()` en `useVigenciaRegla.ts` — importarlo, no reescribirlo. El porqué: un `Date`
no lleva zona, la elige el formateador, y `toISOString()` elige UTC **siempre**; en husos
negativos eso adelanta un día desde las ~21:00 local.

Dos `AppDateInput` + `DiaNegocioNota`, con `hoyLocal()` importado de `useVigenciaRegla`.

⛔ **No copiar el `fechaLocal()`/`haceDias()` local de `CajaTendencia.vue`**: esa duplicación es
justamente lo que este componente viene a cerrar. Y ⛔ **no tocar `CajaTendencia.vue` ni las otras
tres pantallas** para que lo usen — es refactor fuera de alcance; el owner decidió no mudar nada
ahora. El componente queda disponible, nada más.

- [x] **Paso 4: la pantalla de varianza**

`CrudPageHeader` → `AppRangoFechas` → aviso de teórico incompleto (`UAlert`, solo si viene) →
tarjetas de total → `CrudTable` con `usePaginatedList<VarianzaFila>` → `UPagination` si
`meta.total > pageSize`.

Columnas: Producto · Lugar · Ventana · Teórico · Merma · Cortesía · **Sin explicación** ·
$ sin explicación · **Otros**.

- Cantidades con `useFormatters.formatStock(cantidad, unidadMedida)`; plata con
  `formatCostoPorMoneda`.
- Fila `medible: false` → una sola celda *"falta contarlo"*, sin números.
- **`Otros`**: `text-muted` cuando es `'0.0000'`; color de alerta cuando no, con un
  `AppInfoButton` que explica en lenguaje del local (*"hay movimientos de stock que este reporte
  no supo clasificar; el número de al lado puede estar incompleto"*).
- ⛔ **La columna «Otros» no se esconde** cuando todas las filas dan cero: una columna que aparece
  y desaparece entrena a no buscarla.
- Gate: `definePageMeta({ middleware: ['auth','permiso'], permiso: 'Varianza:Leer' })` — el
  declarativo, **no** el chequeo manual en `onMounted` de `propinas/index.vue`.

- [x] **Paso 5: el índice y el menú**

`pages/reportes/index.vue`: una tarjeta por reporte que el usuario puede ver (hoy, una).
`layouts/dashboard.vue`: grupo "Reportes" con la misma forma
`permissionsStore.esAdmin || permissionsStore.can('Varianza','Leer')` que usan los demás ítems.

- [x] **Paso 6: los specs de render pasan**

```bash
cd frontend && npm test -- AppRangoFechas varianza
```

- [x] **Paso 7: el e2e de navegador, con el rol real**

⛔⛔ **ANTES DE TOCAR `reset-db.sh`: si el `.env` apunta al Postgres aislado, ese script BORRA EL
VOLUMEN DEL STACK COMPARTIDO de todas las sesiones — y termina diciendo que salió bien.**
Verificado en el código el 2026-09-20 (aviso de la sesión orquestadora, confirmado línea por
línea):

- `scripts/reset-db.sh:142` — el resguardo acepta `*@postgres:*|*@localhost:*|*@127.0.0.1:*`
  **sin mirar el puerto**, así que `@localhost:5436` (el aislado de este worktree) pasa el filtro
  como si fuera el compose.
- `scripts/reset-db.sh:176` — `compose down -v`, que borra el volumen. Y como el nombre del
  proyecto de compose es el mismo para todas las sesiones, recrea los contenedores **compartidos**
  leyendo este `.env`, o sea apuntando a una base que no es la de ellos.

Ya le pasó a la sesión de compras hoy: dejó el stack con `Seed complete: 0` y el backend sin
responder.

**La secuencia correcta, con el turno ya concedido:**

```bash
/Users/m2pro/cmatheus/startup-app/scripts/db-aislada.sh borrar
```

```bash
grep '^DATABASE_URL=' /Users/m2pro/cmatheus/startup-app/.claude/worktrees/reportes-varianza/.env
```

⚠️ **Ese `grep` no es ceremonia: es el único chequeo que el script NO hace.** Tiene que decir
`@postgres:5432`. Recién ahí:

```bash
/Users/m2pro/cmatheus/startup-app/scripts/reset-db.sh
```

Y al terminar el Playwright, `db-aislada.sh reset 5436` para recuperar la base propia.

⛔ **No arreglar el script**: no es alcance de este frente, es de la orquestadora, y hay otra
sesión que quizá lo tome. ⚠️ **Y el turno se pide con anticipación**: hay cola (compras y el frente
de los cuatro mecánicos).

`frontend/e2e/reportes/varianza.spec.ts`, entrando con el usuario del rol **`Inventario ·
Aprobación`** (el que la Tarea 1 sembró), **no** con el admin. El login no se tipea: se usa
`frontend/e2e/auth.setup.ts`.

⚠️ Requiere el stack compartido (`docker-compose up` + `reset-db.sh`): **pedir turno a la sesión
orquestadora y avisar la hora al soltarlo**.

```bash
cd frontend && npm run e2e -- reportes/varianza
```

- [x] **Paso 8: documentar**

En `docs/patterns/frontend.md`: `AppRangoFechas` con su contrato, y la regla de que **lo
compartido vive en la raíz de `app/components/`** para que una pantalla vieja lo use sin mudarse
de módulo.

📌 **Cómo se ejecutó (2026-09-21), donde se apartó de lo escrito:**
- **El menú no tiene grupos**: es una lista plana. "Reportes" entró como **una** entrada hacia
  `/reportes`, y el catálogo de reportes —con su permiso— vive en `composables/useReportes.ts`,
  compartido por el menú y el índice para que no se desincronicen.
- **Sin aviso de teórico incompleto**: se quitó en la Tarea 6 (decisión del owner).
- **El Paso 7 ya no aplica como está escrito**: `reset-db.sh` y el turno se reemplazaron por
  `scripts/entorno.sh stack` (stack propio del worktree). El Playwright corrió contra el 5176 de
  este worktree —verificado en su base: los productos del test aparecen ahí— como
  `aprobador@paris.cl`.
- **El resumen no recibe `soloConVarianza`** — y el motivo no es un 400: medido contra el backend
  real, el pipe global (`whitelist` sin `forbidNonWhitelisted`) lo borra y contesta 200.

- [x] **Paso 9: gate y commit**

```bash
git add frontend/app/components/AppRangoFechas.vue frontend/app/components/AppRangoFechas.nuxt.spec.ts frontend/app/pages/reportes frontend/app/layouts/dashboard.vue frontend/e2e/reportes docs/patterns/frontend.md
```

```bash
git commit -m "feat(reportes): el selector de rango compartido y la pantalla de varianza"
```

---

## Tarea 8 — Unovis, `AppGrafica` y la gráfica de varianza

**Archivos:**
- Modificar: `frontend/package.json` (`@unovis/vue`, `@unovis/ts`)
- Crear: `frontend/app/components/AppGrafica.vue`
- Crear: `frontend/app/components/AppGrafica.nuxt.spec.ts`
- Modificar: `frontend/app/pages/reportes/varianza.vue`
- Crear: `docs/adr/027-graficas-con-unovis.md`
- Modificar: `docs/adr/README.md`, `docs/patterns/frontend.md`

**Interfaces:**
- Consume: `ResumenVarianza.top` de la Tarea 6 y la pantalla de la Tarea 7.
- Produce: `AppGrafica` con props `series`, `categorias`, `formato`, `cargando`, `vacio`.

- [ ] **Paso 1: instalar la dependencia**

```bash
npm --prefix /Users/m2pro/cmatheus/startup-app/.claude/worktrees/reportes-varianza/frontend install @unovis/vue @unovis/ts
```

⚠️ **Es la única dependencia nueva autorizada.** Si al implementar hiciera falta otra (un plugin,
un polyfill), **parar y preguntarle al owner** — no instalarla.

- [ ] **Paso 2: el spec de render que falla**

Cuatro aserciones: con `cargando` muestra el esqueleto y no la gráfica; con `vacio` muestra el
estado vacío; con series muestra una barra por categoría; y **los colores salen de variables CSS**,
no de literales en el JS (aserción sobre el atributo, no sobre el color computado — happy-dom no
calcula layout).

- [ ] **Paso 3: correrlo y verificar que falla**

```bash
cd frontend && npm test -- AppGrafica
```

- [ ] **Paso 4: implementar `AppGrafica`**

Envuelve Unovis. Reglas, que son el patrón que el próximo reporte copia:

- **Barras horizontales apiladas.** Colores y tipografía desde **variables CSS** de los tokens
  semánticos de Nuxt UI — Unovis dibuja SVG, así que el modo oscuro sale solo. ⛔ Nada de colores
  en JS ni de Tailwind neutral: `design:check` lo bloquea.
- **El formato lo pone el llamador** (`formato`), no la gráfica.
- **Estados propios de carga y vacío**, distinguiendo fallo de red / cargando / vacío real, como
  ya hace `CajaTendencia.vue`.
- **`<ClientOnly>`**: la app es SPA (ADR-017) y la pantalla **tiene que seguir andando si la
  gráfica no monta** — el número vive en la tabla.

- [ ] **Paso 5: la gráfica en la pantalla**

Top 10 por plata perdida, desc, con *"y N productos más — la tabla los tiene todos"* debajo
(`fueraDelTop`). Los datos salen de `/resumen`, **sin ruta aparte**.

⛔ **«Otros» no entra en la gráfica**: es un detector de que la cuenta no cerró, no una parte de la
pérdida; apilarlo lo haría leer como una categoría más de plata perdida. Su lugar es la tabla.

- [ ] **Paso 6: verificar, incluido el modo oscuro**

```bash
cd frontend && npm test -- AppGrafica varianza && npm run design:check
```

Más una pasada en el navegador en modo oscuro (stack compartido, con turno): que los colores de
las barras y los ejes se lean.

- [ ] **Paso 7: el ADR**

`docs/adr/027-graficas-con-unovis.md`: la dependencia y su decisión textual del owner; por qué SVG
+ variables CSS y no colores en JS; y la regla de que la gráfica acompaña a la tabla y nunca es la
fuente de verdad. Agregar la fila en `docs/adr/README.md`.

⚠️ Verificar que **027 sigue libre** antes de escribirlo: otra sesión pudo haber tomado el número.

- [ ] **Paso 8: gate y commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/app/components/AppGrafica.vue frontend/app/components/AppGrafica.nuxt.spec.ts frontend/app/pages/reportes/varianza.vue docs/adr/027-graficas-con-unovis.md docs/adr/README.md docs/patterns/frontend.md
```

```bash
git commit -m "feat(reportes): gráficas con Unovis y la varianza en barras apiladas"
```

---

## Tarea 9 — Medir el rendimiento y, si hace falta, el índice

**Archivos:**
- Posible: `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts` (índice nuevo)
- Modificar: `backend/src/modules/seeder/seeder.service.ts` (solo si el seed no alcanza para medir)
- Crear: nada si la medición dice que no hace falta — **ese también es un resultado válido**

**Interfaces:**
- Consume: las consultas de las tareas 2–6.
- Produce: la medición escrita, y el índice solo si la medición lo justifica.

📌 **Insumo ya medido por la Tarea 5 (2026-09-20), para no volver a medirlo ni empezar por el lado
equivocado.** Todo con el kardex inflado ×250 (198.293 filas en tabla, 198.290 del tenant) dentro
de una transacción revertida:

| Qué | Resultado |
|---|---|
| índice candidato `(item_id, ubicacion_id, secuencia)` | **creado y medido: no sirve.** Mismos `Heap Blocks`; `ubicacion_id` saca 34 filas de 677 |
| por qué no sirve | los bordes de la ventana van dentro de un `CASE`, y **ningún índice sirve un `CASE` como `Index Cond`** |
| la palanca real | aplanar ese `CASE`. El aplanado **equivalente** (`OR` con guarda de `IS NOT NULL`) no desbloquea nada: su `Index Cond` sigue siendo solo `item_id`. El **no equivalente** (comparar `secuencia` a secas) mete los dos bordes en el `Index Cond` y baja de ~7 ms a menos de 1, pero **cambia el resultado de 9 de los 30 grupos**, que caen a cero al perder el respaldo por `creado_el` del recuento de delta cero |
| el `ORDER BY` por plata | obliga a evaluar el agregado en **todos** los grupos del rango, no en los 15 de la página; con `soloConVarianza` son dos barridos por request |

⛔ **Y el seed de esta medición estaba sesgado: 17 de 30 grupos tenían `secuencia_desde` en `NULL`**,
o sea que buena parte de lo medido pasó por la rama de respaldo `creado_el` y no por la de
`secuencia`. Un seed donde todos los recuentos escriban movimiento ejercita la otra rama y puede
dar otro número — es el mismo punto del Paso 1 de esta tarea, cobrado en carne propia.

- [ ] **Paso 1: conseguir un volumen que se pueda medir**

El seed base no alcanza. Generar movimientos hasta un orden realista (decenas de miles) **con
distribución realista**: variedad de `motivo`, de `item_id` y de fechas.

⛔ **La distribución es parte de la medición.** Con el 99 % de las filas en el mismo valor, un
índice parcial "no sirve" y la conclusión es falsa — ya pasó en este repo y está documentado en el
docblock de `idx_movimientos_inventario_venta`.

- [ ] **Paso 2: medir**

```bash
cd backend && npm run test:e2e -- reportes-varianza
```

Y `EXPLAIN (ANALYZE, BUFFERS)` de las consultas del listado y del resumen contra el Postgres del
worktree (5436). Anotar el plan y los tiempos **antes** de tocar nada.

- [ ] **Paso 3: decidir con el número en la mano**

📌 **Candidato nuevo, levantado por la revisión de la Tarea 4 (2026-09-20): `SQL_SALDOS`.** Hace
**dos subconsultas correlacionadas por fila** (`ORDER BY secuencia DESC LIMIT 1`), o sea 2 ×
`pageSize` lookups dentro de una sola sentencia — cumple la letra de "sin N+1" pero no está
medido.

El punto fino: el único índice disponible es `idx_movimientos_inventario_item_secuencia`
**`(item_id, secuencia)`, sin `ubicacion_id`**. Para un ítem con movimientos en varias ubicaciones
—bodega más local, que es el caso que este reporte mira— el backward scan por `item_id` puede
recorrer filas de **otras** ubicaciones antes de dar con la que matchea. Con un producto que se
mueve mucho en el local y poco en la bodega, la consulta de la bodega paga el recorrido entero.

⚠️ Y acá la **distribución del seed decide el resultado**: con todos los movimientos en una sola
ubicación el índice parece perfecto y la conclusión sería falsa. El seed de medición tiene que
repartir el mismo ítem entre local y bodega.

⚠️ **El candidato de la primera versión de este plan estaba mal elegido, y la corrección ya está
medida** (2026-09-19). Decía `(tenant_id, creado_el)` sobre `movimientos_inventario`, pero **esa
consulta no filtra por fecha**: filtra por `(item_id, secuencia)`, porque el ancla de la ventana
es `recuento_inventario_linea.movimiento_id → secuencia` (Tarea 2). Y **ese índice ya existe**:
`idx_movimientos_inventario_item_secuencia`, declarado en la entity por el frente de compras.
Primero comprobar con el `EXPLAIN` si ya la cubre; lo más probable es que sí y que no haga falta
nada sobre esa tabla.

**El candidato real está en la otra tabla:** `resolverVentanas` sí filtra `recuento_inventario`
por `tenant_id` + `estado` + rango de `aplicado_el`, y **esa tabla hoy no tiene ningún índice** —
ni por `@Index` ni por SQL en el seeder (medido 2026-09-19; lo único que hay cerca es
`uq_recuento_linea_item_vivo` sobre `recuento_inventario_linea (recuento_id, item_id)`, que sí
sirve para bajar de recuento a líneas).

Medir **con y sin** antes de fijar nada, y si el candidato correcto resulta ser otro, escribirlo
con el número al lado.

⚠️ **Si no hace falta, no se agrega**, y se escribe por qué. Un índice de más se paga en toda
venta.

📌 Si entra un índice sobre `recuento_inventario`, decidir también **cómo** entra: la entity usa
`@Index` y el seeder usa `CREATE INDEX IF NOT EXISTS` en SQL cruda para lo que `@Index` no puede
expresar (parciales, `lower(...)`). Un índice simple va en la entity.

- [ ] **Paso 4: dejar la medición escrita**

Si entra un índice, su docblock lleva el antes/después medido, como los cuatro que ya tiene la
entidad. Si no entra, la medición va en `docs/features/reporte-varianza.md`.

- [ ] **Paso 5: gate y commit**

Stagear solo lo que la medición justificó — si no entró índice, esta tarea commitea **únicamente**
la doc con el número medido.

```bash
git add backend/src/modules/inventario/entities/movimiento-inventario.entity.ts docs/features/reporte-varianza.md
```

```bash
git commit -m "perf(reportes): la medición del reporte de varianza"
```

⚠️ `docs/features/reporte-varianza.md` lo crea la Tarea 10. Si esta tarea corre **antes**, la
medición va a un comentario en el código y la Tarea 10 la levanta de ahí; si corre después, va
directo al archivo. **Sacar el path del `git add` que no exista todavía** — un `add` de un archivo
inexistente aborta el comando y deja la tarea sin commitear.

---

## Tarea 10 — Docs vivas, estado y backlog

**Archivos:**
- Crear: `docs/features/modulo-reportes.md`, `docs/features/reporte-varianza.md`
- Modificar: `docs/README.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`

- [ ] **Paso 1: `docs/features/modulo-reportes.md`**

Desde `docs/features/TEMPLATE.md`. Lo que **no** puede faltar:
- **El criterio operación contra negocio** (spec § 3.1), con las palabras del owner.
- Dónde vive un reporte y qué convenciones toma (§ 3.2), incluido que un `modulo_app` sin fila en
  `tenant_modulos` da 403 hasta al admin.
- Los compartidos y su contrato (§ 4), y por qué viven en la raíz de `app/components/`.

- [ ] **Paso 2: completar `docs/features/reporte-varianza.md`**

⚠️ **Este archivo ya existe desde el hito de integración** (se escribió al cerrar la Tarea 6, con
la mitad de backend). Acá se le suma la pantalla: la gráfica, la columna «Otros» en pantalla y el
aviso de teórico incompleto. **No reescribirlo de cero** — y no anexar correcciones al final: si
algo de lo que dice quedó viejo, se corrige en su lugar.

- [ ] **Paso 3: el backlog**

En `docs/agent/pendientes.md`, **cuatro** entradas nuevas (la cuarta la agregó la Tarea 5 al
medirla; el docblock del `ORDER BY` en `varianza.service.ts` apunta a ella por ese número):
1. **Persistir la advertencia "se vendió sin ese insumo"** — el agujero del teórico que no es
   medible después. Nombrarla por la **causa**, no por el síntoma.
2. **Candidatos a mudarse al módulo de reportes**: los cinco de negocio de § 3.3, con la regla de
   que se mudan de a uno y con una razón concreta.
3. **El `ValidationPipe` global no usa `forbidNonWhitelisted`** (`main.ts:19`, medido el
   2026-09-19 por la revisión de seguridad de la Tarea 1). Es **preexistente y global**, no algo
   que este frente introduzca: hoy un campo de más en el body se descarta en silencio en vez de
   dar 400. ⚠️ **Entra como entrada MEDIDA, no como sospecha**: antes de escribirla hay que
   contar cuántas rutas cambiarían de conducta al activarlo y si algún cliente manda campos de
   más hoy — el owner pidió que nada quede viviendo solo en un mensaje, y una entrada sin
   número es justamente lo que hace frenar al próximo sin darle con qué decidir.

**Cuarta entrada, que dejó medida la Tarea 5: la fila sin costo se ordena por una suma que no
muestra.** Cuando algún movimiento del grupo no tiene `costo_unitario`, la respuesta manda
`costoSinExplicacion: []` —nunca una cifra parcial— pero el `ORDER BY` sigue usando el `monto`
parcial; si **ningún** movimiento tenía costo, ese monto es `0` y la fila queda entre las que no
perdieron nada. Es justo el producto al que falta cargarle el precio. ⚠️ **Entra como entrada
medida**: el caso es alcanzable por la API real (producto creado sin `costo` → `costo_actual` en
`NULL` → el recuento congela ese `NULL`) y está cubierto por un e2e. Lo que **no** está decidido es
la salida: inventarle una posición en el orden sería peor que el problema, así que la candidata es
que la pantalla lo marque — y eso se decide con el owner, no acá.

⛔ **Nada queda marcado ✅ en `pendientes.md`**: la entrada de la varianza se **muda** a
`docs/agent/resueltos.md` con el detalle. Si su sección queda vacía, queda solo el encabezado.

- [ ] **Paso 4: `ESTADO.md` y `README.md`**

La fila de la varianza **ya existe** desde el hito de integración, marcada *backend listo, pantalla
pendiente*: acá se actualiza a implementada, con fecha. Se agrega la fila del módulo de reportes, y
los dos links en `docs/README.md`.

- [ ] **Paso 5: verificar que ningún número quedó colgando**

```bash
grep -rn "trece\|los 13\|siete módulos" docs/ | grep -i report
```

Esperado: sin resultados. El mapa son **quince endpoints en nueve módulos** (§ 1 de la spec), y la
clasificación suma 8 + 5 + 2. Si el plan o las features repiten un conteo, tiene que coincidir.

- [ ] **Paso 6: gate y commit**

```bash
git add docs/features/modulo-reportes.md docs/features/reporte-varianza.md docs/README.md docs/ESTADO.md docs/agent/pendientes.md docs/agent/resueltos.md
```

```bash
git commit -m "docs(reportes): features, estado y backlog del módulo de reportes"
```

---

## Cierre del frente

- [ ] Revisión de **rama completa** (no solo por tarea): caza contradicciones **entre** tareas que
  ninguna revisión por-tarea puede ver — un seed de la Tarea 8 que rompa el e2e de la Tarea 3, un
  nombre que derivó entre la Tarea 2 y la 6.
- [ ] `./scripts/reset-db.sh --verificar` después del e2e: ¿la base se movió abajo de la suite?
- [ ] Mensaje a la sesión orquestadora con rama, hash **copiado de `git log`**, gate con conteos y
  veredictos.
- [ ] ⛔ **No mergear ni pushear.** El fast-forward lo hace la orquestadora con el OK del owner; el
  push a Railway lo decide el owner. Ojo que un push a `main` despliega: si el frente tocara
  entidades, revisar el deployment además del CI.

## Decisiones tomadas / preguntas abiertas

Todas las decisiones de producto están cerradas en la spec § 2 y § 12. **No hay preguntas
abiertas.** Lo que sí hay son dos puntos donde el plan pide **parar y preguntar** si aparecen:

1. **Otra dependencia además de Unovis** (Tarea 8, paso 1).
2. **Si `bordeHastaSql` o el middleware `permiso` no alcanzan** para este módulo — el owner pidió
   explícitamente que se le avise en vez de resolverlo por cuenta propia.
