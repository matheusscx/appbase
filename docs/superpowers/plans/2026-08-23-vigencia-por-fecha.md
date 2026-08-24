# La vigencia por fecha se evalúa — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una regla de precio con fechas se aplique **solo entre esas fechas**, con el día local del tenant y con el instante en que se abrió la cuenta.

**Architecture:** El motor recibe un `vigente: boolean` ya resuelto y lo descarta en el mismo bucle donde ya descarta las pausadas. Toda la aritmética de fechas y husos queda en la capa de servicio, que es la que puede hacer I/O. El instante que decide viaja por **id de cuenta**, nunca como fecha mandada por el cliente.

**Tech Stack:** NestJS + TypeORM (backend), Nuxt 4 + Nuxt UI (frontend), Jest (unit + e2e de API), Playwright (e2e de navegador), Decimal.js.

**Spec:** [`docs/superpowers/specs/2026-08-23-vigencia-por-fecha-design.md`](../specs/2026-08-23-vigencia-por-fecha-design.md) — **leerla entera antes de empezar.** Este plan argumenta desde ella.

## Global Constraints

- ⛔ **Toca el motor de precios: va solo y con el sistema quieto** (`CLAUDE.md`). No mezclar con otro frente.
- **Cada tarea termina en commit**, y el pre-commit **exige el recibo de la revisión independiente** cuando el diff staged toca `backend/src/modules/**/*.service.ts` o un `.vue` de `pages`/`components`. Las tareas 1, 3, 4, 5 y 6 lo tocan: **cada una necesita su propia pasada de `verify-feature`**. No es opcional y no se saltea con `--no-verify`.
- **El gate del cierre corre entero**, nunca un subconjunto: `cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e` y `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`. Mirar **exit codes**, no la última línea.
- **`./scripts/reset-db.sh` ANTES de cada `test:e2e`** y `./scripts/reset-db.sh --verificar` después. **No tocar ningún `.ts` del backend con el e2e corriendo**: el watcher recompila, re-siembra y salen decenas de fallos que no son regresiones.
- **Registro de módulos:** `RepositoriosModule.forFeature`, **jamás** `TypeOrmModule.forFeature` (ADR-020, deadlock medido).
- **`Db` se inyecta sin importar ningún módulo**: `CommonModule` es `@Global()` y lo exporta (verificado 2026-08-23).
- **Sin dependencias nuevas.** La conversión de husos usa `Intl`, que ya está: el Node del contenedor tiene **ICU completo** (medido 2026-08-23).
- **Los dos bordes de fecha son inclusivos del día.**
- **Ninguna regla fuera de vigencia produce advertencia.** La pausada sí; ver la spec.
- **Los tests de fecha no pueden depender del día en que corren.**

## File Structure

| Archivo | Responsabilidad en este plan |
|---|---|
| `backend/src/modules/calculo-precios/calculo-precios.engine.ts` | Campo `vigente` en `ReglaResuelta` + guard en el bucle. Nada más: el motor no aprende de fechas |
| `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts` | Factory `regla()` + tests del guard |
| `backend/src/common/utils/rango-fecha.util.ts` | `fechaLocalTenant` — colapsa un instante a la fecha local del tenant |
| `backend/src/common/utils/rango-fecha.util.spec.ts` | Tests de esa función |
| `backend/src/modules/calculo-precios/calculo-precios.service.ts` | Calcula `vigente`, resuelve el instante desde `cuentaId` |
| `backend/src/modules/calculo-precios/dto/calcular.dto.ts` | `cuentaId?` |
| `backend/src/modules/ventas/ventas.service.ts` | Recibe el `cuentaId` como parámetro y lo reenvía |
| `backend/src/modules/salones/salones.service.ts` | Único llamador que pasa el `cuentaId` |
| `backend/src/modules/descuentos/descuentos.service.ts` | Sacar las dos ramas de `promocional` |
| `backend/src/modules/seeder/seeder.service.ts` | Sacar el tipo; la regla sembrada pasa a `directo` |
| `frontend/app/utils/reglas-form-config.ts` | Sacar `promocional`; `directo` gana fechas |
| `frontend/app/pages/configuracion/descuentos.vue` y `recargos.vue` | Badge "Vencida" / "Programada" |

---

### Task 1: El motor descarta la regla no vigente

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts`
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts` (solo para que compile: `vigente: true` fijo)
- Test: `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts`

**Interfaces:**
- Produces: `ReglaResuelta.vigente: boolean` (requerido). Lo consume el bucle de reglas del motor y lo produce `indexarReglas` en la Task 3.

- [ ] **Step 1: Agregar `vigente` al factory del spec y escribir los dos tests que fallan**

En `calculo-precios.engine.spec.ts`, el factory de la línea 35 gana el campo:

```ts
const regla = (over: Partial<ReglaResuelta> = {}): ReglaResuelta => ({
  id: 'r1',
  nombre: 'Regla',
  codigo: 'general',
  modo: 'porcentaje',
  valorMonto: null,
  valorPorcentaje: '0.10',
  tramos: [],
  metodoPagoIds: [],
  activo: true,
  vigente: true,
  ...over,
});
```

Y los tests, justo después del `describe('reglas pausadas (activo = false)', ...)`:

```ts
  describe('reglas fuera de vigencia (vigente = false)', () => {
    it('no descuenta nada y —a diferencia de la pausada— NO avisa', () => {
      // Una promo fuera de su rango es la regla funcionando como se configuró,
      // no una anomalía. Avisar la convertiría en un toast en cada venta
      // durante los meses que no rige; ver la spec.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [regla({ nombre: 'Promo verano', vigente: false })],
            }),
          ],
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('0.000000');
      expect(r.lineas[0].totalLinea).toBe('100.000000');
      expect(r.lineas[0].advertencias).toEqual([]);
      expect(r.lineas[0].trazaDescuentos).toEqual([]);
    });

    it('pausada Y fuera de vigencia sigue avisando por la PAUSA', () => {
      // Los dos guards conviven y el orden importa: si el de vigencia corriera
      // primero, una regla pausada dejaría de avisar apenas se le pongan
      // fechas vencidas, y el aviso de pausa es el que el owner sí quiere.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [
                regla({ nombre: 'Promo vieja', activo: false, vigente: false }),
              ],
            }),
          ],
        }),
      );
      expect(r.lineas[0].advertencias).toEqual([
        { titulo: 'Descuento "Promo vieja"', detalle: 'está en pausa y no se aplicó' },
      ]);
    });
  });
```

⚠️ Si el nombre del campo de traza por línea no es `trazaDescuentos`, **abrir `ResultadoLinea` en el engine y usar el real** — no adivinarlo.

- [ ] **Step 2: Correr y ver que falla por compilación**

Run: `cd backend && npx jest src/modules/calculo-precios/calculo-precios.engine.spec.ts`
Expected: FAIL — `vigente` no existe en `ReglaResuelta`.

- [ ] **Step 3: Agregar el campo a `ReglaResuelta`**

En `calculo-precios.engine.ts`, dentro de `ReglaResuelta`, justo después de `activo`:

```ts
  /**
   * `false` = fuera de su rango de fechas: no se aplica y **NO** avisa.
   *
   * La diferencia con `activo` no es un descuido: una regla **pausada** es una
   * anomalía que alguien provocó y el aviso se la recuerda; una regla **fuera de
   * fecha** es la regla funcionando como se configuró, y avisarla sería un toast
   * en cada venta durante los meses que no rige.
   *
   * Requerido a propósito, igual que `activo`: si fuera opcional, olvidarse de
   * mapearlo en el service haría que una regla vencida volviera a cobrarse en
   * silencio, que es justo el bug que esto cierra. Lo calcula
   * `CalculoPreciosService.indexarReglas` — el motor no sabe de fechas ni de
   * husos horarios.
   */
  vigente: boolean;
```

- [ ] **Step 4: Agregar el guard en el bucle**

En la función que aplica las reglas, **después** del bloque `if (!regla.activo) { ... continue; }` y **antes** de `const base =`:

```ts
    // Fuera de vigencia: mismo trato que la pausada —no aplica, no deja traza,
    // el `continue` va antes de evaluar— salvo que acá NO se avisa. Ver el
    // docblock de `ReglaResuelta.vigente`.
    if (!regla.vigente) continue;
```

⚠️ **El orden es parte del diseño:** el guard de `activo` va primero, para que una regla pausada siga avisando aunque además esté vencida.

- [ ] **Step 5: Hacer que el service compile sin cambiar conducta**

En `calculo-precios.service.ts`, dentro del objeto que arma `indexarReglas`, junto a `activo: r.activo`:

```ts
          // Fijo en esta tarea: la Task 3 lo calcula de verdad. Puesto acá para
          // que el compilador no deje pasar el campo sin mapear.
          vigente: true,
```

- [ ] **Step 6: Correr los tests del motor y del service**

Run: `cd backend && npx jest src/modules/calculo-precios`
Expected: PASS, sin cambios en ningún test existente.

- [ ] **Step 7: Mutante — borrar el guard**

Comentar la línea `if (!regla.vigente) continue;` y correr `npx jest src/modules/calculo-precios/calculo-precios.engine.spec.ts`.
Expected: rojo **solo** el test *"no descuenta nada y —a diferencia de la pausada— NO avisa"*. Restaurar y volver a verde.

- [ ] **Step 8: Gate + revisión + commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

El diff toca un service → correr el skill `verify-feature` (revisión independiente sobre el diff staged) y dejar el recibo antes de commitear.

```bash
git add -A && git commit -m "feat(motor): una regla fuera de vigencia no se aplica y no avisa"
```

---

### Task 2: `fechaLocalTenant` — el instante a fecha local

**Files:**
- Modify: `backend/src/common/utils/rango-fecha.util.ts`
- Test: `backend/src/common/utils/rango-fecha.util.spec.ts`

**Interfaces:**
- Consumes: `zonaHorariaTenant(db, tenantId): Promise<string>`, que ya existe en ese mismo archivo y **desde el 2026-08-23 devuelve la zona de la provincia**.
- Produces: `fechaLocalTenant(db, tenantId, instante: Date): Promise<string>` → `'YYYY-MM-DD'`. La consume `CalculoPreciosService` en la Task 3.

- [ ] **Step 1: Escribir los tests que fallan**

En `rango-fecha.util.spec.ts`, dentro del `describe('rango-fecha.util', ...)`:

```ts
  describe('fechaLocalTenant', () => {
    const TENANT = 'tenant-uuid';

    function dbConZona(zona: string) {
      return {
        query: jest.fn().mockResolvedValue([{ zona_horaria: zona }]),
      } as unknown as DataSource;
    }

    it('colapsa el instante al día del LOCAL, no al de UTC', async () => {
      // 02:30 UTC del 1-dic todavía es 30-nov en Chile. Si esto se resolviera
      // en UTC, una promo que arranca el 1-dic empezaría a las 21:00 del 30.
      const instante = new Date('2026-12-01T02:30:00Z');
      await expect(
        fechaLocalTenant(dbConZona('America/Santiago'), TENANT, instante),
      ).resolves.toBe('2026-11-30');
    });

    it('respeta la zona de la provincia, que puede no ser la del país', async () => {
      // Isla de Pascua está dos horas detrás del continente. El test existe
      // para que el día que alguien devuelva la zona del país esto se ponga
      // rojo — ver `resueltos.md` § "Una sola noción de zona horaria".
      const instante = new Date('2026-12-01T04:30:00Z');
      const santiago = await fechaLocalTenant(
        dbConZona('America/Santiago'),
        TENANT,
        instante,
      );
      const pascua = await fechaLocalTenant(
        dbConZona('Pacific/Easter'),
        TENANT,
        instante,
      );
      expect(santiago).toBe('2026-12-01');
      expect(pascua).toBe('2026-11-30');
    });

    it('devuelve siempre `YYYY-MM-DD`, que es lo que se compara contra las columnas `date`', async () => {
      const fecha = await fechaLocalTenant(
        dbConZona('America/Santiago'),
        TENANT,
        new Date('2026-03-05T15:00:00Z'),
      );
      expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
```

Agregar `fechaLocalTenant` al `import` que ya está arriba del archivo.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd backend && npx jest src/common/utils/rango-fecha.util.spec.ts`
Expected: FAIL — `fechaLocalTenant` no existe.

- [ ] **Step 3: Implementar**

Al final de `rango-fecha.util.ts`, después de `zonaHorariaTenant`:

```ts
/**
 * El día del calendario **local del tenant** en el que cae un instante.
 *
 * Se usa para comparar contra columnas `date` —`fecha_inicio` / `fecha_fin` de
 * las reglas— que no llevan hora: la pregunta que contestan es "¿qué día es
 * hoy para este local?", y la respuesta cambia con el huso.
 *
 * ⚠️ **Por qué acá se convierte con `Intl` y no con Postgres, que es lo que hace
 * el resto de este archivo.** No es el mismo problema: los helpers de arriba
 * **expanden** una fecha a un rango dentro de un `WHERE`, y eso tiene que estar
 * en SQL. Acá hay que **colapsar** un instante a una fecha para compararlo
 * contra datos que ya están en memoria, y hacerlo en SQL sería un viaje a la
 * base solo para formatear. `Intl` es DST-correcto y no agrega dependencia: el
 * Node del contenedor tiene ICU completo (medido el 2026-08-23).
 *
 * `'en-CA'` no es una preferencia de idioma: es el locale cuyo formato corto ES
 * `YYYY-MM-DD`, que es exactamente la forma que comparan las columnas.
 */
export async function fechaLocalTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
  instante: Date,
): Promise<string> {
  const zona = await zonaHorariaTenant(db, tenantId);
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(instante);
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd backend && npx jest src/common/utils/rango-fecha.util.spec.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Mutante — usar UTC en vez de la zona**

Cambiar `{ timeZone: zona }` por `{ timeZone: 'UTC' }`. Correr el spec.
Expected: rojo los dos primeros tests. Restaurar.

- [ ] **Step 6: Gate + commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

El diff **no** toca un service (`common/utils`), así que el hook no pide recibo.

```bash
git add -A && git commit -m "feat(fechas): el día local del tenant a partir de un instante"
```

---

### Task 3: El servicio calcula `vigente`

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts`
- Test: `backend/src/modules/calculo-precios/calculo-precios.service.spec.ts`

**Interfaces:**
- Consumes: `fechaLocalTenant` (Task 2), `ReglaResuelta.vigente` (Task 1).
- Produces: reglas con `vigente` real. La Task 4 le cambia de dónde sale el instante.

- [ ] **Step 1: Verificar de qué forma llegan las fechas**

⚠️ **No asumir.** `fechaInicio`/`fechaFin` son columnas `date` y la entidad las declara `string | null`, pero hay que confirmar que TypeORM las entrega como `'YYYY-MM-DD'` y no como `Date`:

```bash
docker exec tecnica_backend node -e "console.log('confirmar en el paso siguiente con un test, no con esto')"
```

La confirmación real es el test del Step 2: si llegaran como `Date`, la comparación de strings fallaría y el test lo dice. Si falla por eso, **normalizar en `indexarReglas`** con `String(r.fechaInicio).slice(0, 10)` y dejar comentado por qué.

- [ ] **Step 2: Escribir los tests que fallan**

En `calculo-precios.service.spec.ts`, un `describe` nuevo. Los mocks de `descuentosService.findAll` tienen que devolver reglas con fechas; **usar la forma que ya usan los tests existentes de ese archivo** para no inventar una segunda.

```ts
  describe('vigencia por fecha', () => {
    // Las fechas del test son fijas: el instante entra por el service, nunca
    // se afirma contra `new Date()` del runner.
    it('una regla cuyo rango ya pasó llega al motor con vigente = false', async () => {
      // Fecha local del tenant: 2026-03-05. Rango: diciembre a enero.
      // Sin este chequeo la promo de verano descuenta en marzo.
    });

    it('una regla dentro del rango llega con vigente = true', async () => {});

    it('el primer día y el último día están DENTRO (bordes inclusivos)', async () => {});

    it('una regla sin fechas está vigente siempre', async () => {});
  });
```

⚠️ **Los cuerpos vacíos de arriba son el esqueleto, no el entregable.** Cada uno se completa con la forma de mock que ya usa el archivo — abrirlo y copiarla, no inventarla. Un test que no ejerza `indexarReglas` de verdad no sirve.

- [ ] **Step 3: Correr y ver que fallan**

Run: `cd backend && npx jest src/modules/calculo-precios/calculo-precios.service.spec.ts`
Expected: FAIL — hoy `vigente` es `true` fijo (Task 1).

- [ ] **Step 4: Inyectar `Db` en el service**

En el constructor de `CalculoPreciosService`, agregar:

```ts
    private readonly db: Db,
```

con `import { Db } from '../../common/db/db.service';`.

⚠️ **No hay que tocar `calculo-precios.module.ts`**: `CommonModule` es `@Global()` y exporta `Db` (verificado 2026-08-23). Y **nunca** `TypeOrmModule.forFeature` (ADR-020).

- [ ] **Step 5: Calcular la fecha local en `calcular()`**

Al principio de `calcular()`, junto a la resolución de `config`:

```ts
    // El día del local para el instante que decide. En esta tarea es siempre
    // "ahora"; la Task 4 lo hace salir de la cuenta cuando hay una.
    const fechaLocal = await fechaLocalTenant(this.db, tenantId, new Date());
```

- [ ] **Step 6: Pasar la fecha a `indexarReglas` y calcular `vigente`**

`indexarReglas` gana un parámetro y su tipo inline gana las dos columnas:

```ts
      fechaInicio: string | null;
      fechaFin: string | null;
      activo: boolean;
    }[],
    fechaLocal: string,
  ): Map<string, ReglaResuelta> {
```

y en el objeto que arma, reemplazar el `vigente: true` de la Task 1:

```ts
          // Fuera de rango no se aplica. Comparación de strings: las fechas
          // ISO ordenan lexicográficamente igual que cronológicamente, así que
          // es exacta y no necesita librería. Bordes INCLUSIVOS los dos, mismo
          // criterio que los filtros de fecha (2026-08-22).
          vigente:
            (!r.fechaInicio || r.fechaInicio <= fechaLocal) &&
            (!r.fechaFin || fechaLocal <= r.fechaFin),
```

Actualizar las dos llamadas: `this.indexarReglas(descuentos, fechaLocal)` y `this.indexarReglas(recargos, fechaLocal)`.

⚠️ **El mapa sigue conservando las reglas no vigentes**, igual que las pausadas: sacarlas haría que `requerir()` tire 400 por id ausente en cada ítem asociado y el POS deje de vender.

- [ ] **Step 7: Correr y ver que pasan**

Run: `cd backend && npx jest src/modules/calculo-precios`
Expected: PASS.

- [ ] **Step 8: Mutante — `vigente: true` fijo**

Reemplazar la expresión por `vigente: true`. Correr el spec del service.
Expected: rojo los tests de rango pasado y de bordes. Restaurar.

- [ ] **Step 9: Gate completo + revisión + commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd backend && npm run test:e2e
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh --verificar
```

⚠️ Acá el e2e puede **cambiar de color por un motivo legítimo**: la regla sembrada *"Promo verano 2026-27"* rige del 1-dic al 31-ene. Si el e2e corre fuera de ese rango la promo deja de aplicar, y **cualquier test que dependiera de que aplicara** se cae. Es la conducta correcta; ajustar el test, no el código.

Revisión independiente (`verify-feature`) + recibo + commit:

```bash
git add -A && git commit -m "feat(reglas): la vigencia por fecha se evalúa con el día local del tenant"
```

---

### Task 4: El instante sale de la cuenta

**Files:**
- Modify: `backend/src/modules/calculo-precios/dto/calcular.dto.ts`
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts:186` (firma de `crearEnTransaccion`) y `:458` (armado de `calcularDto`)
- Modify: `backend/src/modules/salones/salones.service.ts:1171` (llamada a `crearEnTransaccion`)
- Test: `backend/src/modules/calculo-precios/calculo-precios.service.spec.ts`, `backend/test/` (e2e nuevo)

**Interfaces:**
- Produces: `CalcularVentaDto.cuentaId?: string`; `VentasService.crearEnTransaccion(manager, tenantId, usuarioId, dto, cuentaId?)`.

- [ ] **Step 1: Escribir el e2e que falla**

Archivo nuevo `backend/test/vigencia-cuenta.e2e-spec.ts`. Copiar el arranque (login, `switch-tenant`, `cookieParser`, `ValidationPipe`) de `test/reglas-valor.e2e-spec.ts` — **no inventarlo**. El test:

```ts
  it('un `cuentaId` inexistente es 400, no un silencioso "entonces ahora"', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
        cuentaId: '550e8400-e29b-41d4-a716-4466554409ff',
      });
    expect(res.status).toBe(400);
  });
```

⚠️ **El caso que de verdad importa —cuenta abierta dentro de la vigencia y cerrada fuera— necesita una cuenta de salón real.** Escribirlo también, siguiendo el flujo de `frontend/e2e/salones/` o del e2e de salones del backend si existe; si montarlo resulta más caro que esta tarea, **parar y decirlo**, no reemplazarlo por un test que no prueba la decisión del owner.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json vigencia-cuenta`
Expected: FAIL — `cuentaId` hoy lo descarta el `whitelist: true` del `ValidationPipe`.

- [ ] **Step 3: Agregar `cuentaId` al DTO**

En `CalcularVentaDto`, después de `recargosVentaIds`:

```ts
  /**
   * Cuenta de salón cuyo instante de apertura decide la vigencia de las reglas.
   *
   * Se manda el **id**, no la fecha: aceptar un instante del cliente sería la
   * forma de hacer que una promo vencida aplique. El servidor lee `abierta_el`.
   */
  @IsOptional()
  @IsUUID('4')
  cuentaId?: string;
```

- [ ] **Step 4: Resolver el instante en el service**

Reemplazar la línea de la Task 3 por:

```ts
    const fechaLocal = await fechaLocalTenant(
      this.db,
      tenantId,
      await this.instanteDeVigencia(tenantId, dto.cuentaId),
    );
```

y agregar el método privado:

```ts
  /**
   * El instante que decide la vigencia: la apertura de la cuenta si hay una, y
   * si no, ahora.
   *
   * Un `cuentaId` que no resuelve —inexistente, o de otro tenant— es 400 y no
   * un silencioso "entonces ahora": el descarte mudo esconde el error justo
   * donde cambia la plata.
   */
  private async instanteDeVigencia(
    tenantId: string,
    cuentaId?: string,
  ): Promise<Date> {
    if (!cuentaId) return new Date();
    const filas: { abierta_el: Date }[] = await this.db.query(
      `SELECT abierta_el FROM cuentas
        WHERE cuenta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [cuentaId, tenantId],
    );
    if (!filas[0]) throw new BadRequestException('La cuenta no existe');
    return filas[0].abierta_el;
  }
```

⚠️ **Confirmar los nombres reales de la tabla y de la PK** abriendo `salones/entities/cuenta.entity.ts` antes de escribir esta consulta. Si la columna de borrado no existe en `cuentas`, sacar ese filtro — pero **mirarlo**, no suponerlo.

- [ ] **Step 5: Hacer que el `cuentaId` viaje desde salones**

`crearEnTransaccion` gana un quinto parámetro **opcional y explícito**:

```ts
  async crearEnTransaccion(
    manager: EntityManager,
    tenantId: string,
    usuarioId: string,
    dto: CreateVentaDto,
    // La cuenta cuyo instante de apertura decide la vigencia. Va como parámetro
    // y NO en `CreateVentaDto` a propósito: en el body, un cliente podría dejar
    // una cuenta abierta en diciembre y mandar su id en marzo para cobrar con
    // la promo de verano. Solo `salones.cerrarCuenta` lo pasa.
    cuentaId?: string,
  ) {
```

y lo suma al `calcularDto`:

```ts
      recargosVentaIds: dto.recargosVentaIds,
      cuentaId,
    };
```

En `salones.service.ts`, la llamada pasa a:

```ts
      const venta = await this.ventasService.crearEnTransaccion(
        manager,
        tenantId,
        usuarioId,
        ventaDto,
        cuentaId,
      );
```

- [ ] **Step 6: Correr el e2e y ver que pasa**

Run: `cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json vigencia-cuenta`
Expected: PASS.

- [ ] **Step 7: Mutante — que el `cuentaId` malo caiga a "ahora"**

Cambiar el `throw` por `return new Date()`. Correr el e2e nuevo.
Expected: rojo el test del 400. Restaurar.

- [ ] **Step 8: Gate completo + revisión + commit**

Igual que la Task 3, con `reset-db.sh` antes y `--verificar` después.

```bash
git add -A && git commit -m "feat(reglas): la vigencia la decide el momento en que se abrió la cuenta"
```

---

### Task 5: `promocional` se elimina y `directo` gana fechas

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts:2525-2533` (el tipo) y `:2896-2906` (la regla sembrada)
- Modify: `backend/src/modules/descuentos/descuentos.service.ts:570` y `:704-711`
- Modify: `backend/src/modules/descuentos/descuentos.service.spec.ts` (los tests que usan el tipo)
- Modify: `frontend/app/utils/reglas-form-config.ts` y su spec
- Modify: `backend/test/reglas-valor.e2e-spec.ts:35` y `:207`
- Modify: `docs/features/descuentos-recargos.md`, `docs/ESTADO.md`

**Interfaces:** ninguna nueva. Esta tarea **quita**.

- [ ] **Step 1: Sacar el tipo del seeder**

Borrar el bloque `codigo: 'promocional'` de `seedTiposRegla` (id `…440121`), y en `seedDescuentos` la regla *"Promo verano 2026-27"* pasa a `directo`:

```ts
      {
        id: '550e8400-e29b-41d4-a716-446655440128',
        tenantId: PARIS,
        tipoReglaId: TIPO_DIRECTO,
        nombre: 'Promo verano 2026-27',
        modo: ModoRegla.PORCENTAJE,
        valorPorcentaje: '0.15',
        // `NINGUNA` y no `FECHA`: es lo que `derivarCondicionTipo` produce para
        // `directo`, así una fila sembrada y una creada por API son iguales.
        // Verificado el 2026-08-23: nadie lee `condicion_tipo`.
        condicionTipo: CondicionTipo.NINGUNA,
        fechaInicio: '2026-12-01',
        fechaFin: '2027-01-31',
        activo: true,
      },
```

Borrar la constante `TIPO_PROMOCIONAL` si queda sin uso.

- [ ] **Step 2: Sacar las dos ramas de validación**

En `descuentos.service.ts`, borrar el `if (codigo === 'promocional' && …)` de `validarSegunTipoCreate` (:570) y el equivalente de `validarSegunTipoUpdate` (:704-711). Sacar `'promocional'` de cualquier lista donde aparezca.

- [ ] **Step 3: `directo` gana fechas en la pantalla**

En `reglas-form-config.ts`, borrar la fila `promocional` y en la de `directo` poner `campoFechaInicio: true, campoFechaFin: true, fechasRequeridas: false`.

⚠️ **Esto no es opcional.** Sin esto el frente **quita** la capacidad de expresar *"10% del 15 al 20"* en vez de arreglarla.

- [ ] **Step 4: Arreglar los tests que usaban el tipo**

En `test/reglas-valor.e2e-spec.ts`, `TIPO_DESCUENTO_PROMOCIONAL` se reemplaza por `TIPO_DESCUENTO_DIRECTO` **conservando las fechas del body** (el test que lo usa manda `fechaInicio`/`fechaFin`, y ahora `directo` las acepta). Lo mismo en `descuentos.service.spec.ts` y en el spec de la config del frontend.

⚠️ **No borrar los tests para que pase.** El que verificaba *"promocional sin fechas es 400"* pierde sentido y **se borra a conciencia**, dejando dicho en el commit que la obligación se mudó al módulo de promociones.

- [ ] **Step 5: Agregar un e2e que fije la eliminación**

En `test/reglas-valor.e2e-spec.ts`:

```ts
  it('el tipo `promocional` ya no existe en el catálogo', async () => {
    // Se eliminó el 2026-08-23: su caso se mudó al módulo de promociones, y
    // `directo` con fechas cubre el descuento con vigencia. Sin este test, el
    // tipo puede volver por un merge del seeder y nadie se entera.
    const res = await request(app.getHttpServer())
      .get('/api/tipos-regla?clase=descuento')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const codigos = (res.body as { codigo: string }[]).map((t) => t.codigo);
    expect(codigos).not.toContain('promocional');
    expect(codigos).toContain('directo');
  });
```

- [ ] **Step 6: Gate completo + docs + revisión + commit**

Actualizar `docs/features/descuentos-recargos.md` (la tabla de qué se aplica: sacar `promocional` de "no se aplica") y la fila de `docs/ESTADO.md`.

```bash
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh --verificar
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Revisión independiente + recibo + commit:

```bash
git add -A && git commit -m "feat(reglas): el tipo promocional se elimina y directo gana vigencia"
```

---

### Task 6: La pantalla marca "Vencida" y "Programada"

**Files:**
- Modify: `frontend/app/pages/configuracion/descuentos.vue`, `frontend/app/pages/configuracion/recargos.vue`
- Test: los `.nuxt.spec.ts` que ya existen al lado de cada uno

**Interfaces:** ninguna nueva. Deriva de `fechaInicio`/`fechaFin`, que la respuesta ya trae.

- [ ] **Step 1: Escribir el test que falla**

En `descuentos.nuxt.spec.ts`, con el backend fake devolviendo una regla con `fechaFin` pasada, montar la pantalla y esperar el badge:

```ts
  it('una regla cuyo rango ya pasó se muestra como Vencida', async () => {
    // Sin esto, una regla vencida se ve idéntica a una vigente y el local
    // puede pasar semanas creyendo que da un descuento que no da.
  })
```

Completar el cuerpo con la forma de montaje que ya usa ese archivo — abrirlo y copiarla.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run app/pages/configuracion/descuentos.nuxt.spec.ts`

- [ ] **Step 3: Implementar el badge**

Un composable de presentación en `app/composables/` (las utilidades de presentación **no** viven locales a un `.vue`, `CLAUDE.md`) que dado `fechaInicio`/`fechaFin` devuelva `'vigente' | 'vencida' | 'programada'`, y un `UBadge` en la columna de la tabla de las dos pantallas.

⚠️ **Tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado** — lo bloquea el pre-commit.

⚠️ **Limitación asumida y que va escrita en el docblock del composable:** usa la fecha del navegador, no la del tenant. Es una etiqueta, no plata; la alternativa exacta es que el backend devuelva el estado calculado, y cuesta más.

- [ ] **Step 4: Correr los dos specs**

Run: `cd frontend && npx vitest run app/pages/configuracion`

- [ ] **Step 5: Smoke en navegador**

El drawer y la tabla de estas pantallas **no** los cubre el build ni el typecheck. Abrir `configuracion/descuentos` en Chrome contra el stack real y ver el badge en la fila de *"Promo verano 2026-27"*.

- [ ] **Step 6: Gate completo + docs + revisión + commit**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Revisión independiente (toca `.vue` de `pages`) + recibo + commit.

```bash
git add -A && git commit -m "feat(reglas): la pantalla marca las reglas vencidas y las programadas"
```

---

## Cierre del frente

- [ ] Mover la entrada de `pendientes.md` § 6 a `resueltos.md`, dejando **lo que NO se hizo**: `mora`, `pronto_pago` y los dos intereses siguen esperando el vencimiento de venta.
- [ ] Confirmar que el requisito heredado —*"una campaña sin fecha de fin no debería aceptarse"*— sigue escrito en la entrada del motor de promociones (§ 3).
- [ ] `git push origin main` y **revisar el deployment de Railway además del CI**: este frente toca el seeder, y un cambio de datos sembrados ya tumbó un deploy antes.

## Self-review

- **Cobertura de la spec:** las cuatro decisiones tienen tarea (1 → Task 4; 2 → Task 2; 3 → Task 3 Step 6; 4 → Task 1). La eliminación del tipo y las fechas en `directo` → Task 5. El badge → Task 6. Los dos tipos por escalones que hoy cobran fuera de rango quedan arreglados por la Task 3 sin trabajo extra: su vigencia se evalúa igual que la de cualquier regla.
- **Huecos conocidos y declarados:** los cuerpos de test de las Tasks 3, 5 y 6 son esqueletos con su intención escrita, porque la forma de los mocks hay que copiarla del archivo real — inventarla acá propagaría un patrón que no existe. Está dicho en cada paso.
- **Riesgo que el ejecutor va a encontrar:** el e2e puede cambiar de color según la fecha en que corra, por la promo sembrada de diciembre a enero. Anotado en la Task 3 Step 9 con qué hacer.
