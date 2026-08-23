# Plan: El `valor` de las reglas se parte en `valor_monto` / `valor_porcentaje`

> **Para agentes:** ejecutar con `superpowers:executing-plans` o
> `superpowers:subagent-driven-development`, tarea por tarea, marcando los checkboxes.

**Status:** Draft · **Date:** 2026-08-23 · **Owner:** Cesar Matheus

**Spec:** [`specs/2026-08-23-valor-monto-porcentaje-design.md`](../specs/2026-08-23-valor-monto-porcentaje-design.md)
— el plan argumenta desde ahí; quien ejecute lee los dos.

**Goal:** que el importe de un descuento o recargo diga por sí solo si es plata o
porcentaje, para que el borde de escala pueda rechazar la plata que no cabe en la moneda.

**Architecture:** `valor` se parte en `valor_monto` (`decimal(18,4)`) y `valor_porcentaje`
(`decimal(7,4)`) en las cuatro tablas de reglas. `modo` **sobrevive** como discriminador y
sigue siendo la clave de orden del motor. La coherencia la sostienen un `@Check()` por tabla
más la validación que ya existe en los services.

## ⛔ Condición de entrada — leer antes de empezar

**Toca el motor de cálculo de precios: va sola y con el sistema quieto** (`CLAUDE.md` →
*"Detenerse y preguntar"*). No se mezcla con ninguna otra tarea, ni siquiera con el tramo en
cero, que toca la misma validación.

## Global Constraints

- **Dinero y porcentajes con Decimal.js**, nunca `number` nativo. Porcentajes en decimal:
  `0.19` = 19%, nunca `19`.
- **`tenant_id` sale siempre del token**, nunca del body ni de la ruta.
- **Soft delete en todo**; toda lectura filtra `eliminado_el IS NULL`.
- **Nunca una query por iteración (N+1).**
- **No hay datos productivos:** se cambia el esquema, se actualiza el seeder y se resetea.
  Nada de backfills ni migraciones incrementales.
- **El esquema real lo manda `synchronize` desde las entities.** `startup-pos.sql` es
  documentación y se actualiza igual.
- **Nunca `git commit --no-verify`.**

## Scope

**Adentro:** las cuatro tablas de reglas, sus DTOs, los dos services, el motor, el service de
cálculo, el seeder, las dos pantallas de configuración y la doc.

**Afuera, explícito:**

- El rastro congelado de la venta (`venta_descuentos` / `venta_recargos`). Ya está partido.
- **Permitir que un tramo valga cero.** Se va a tocar `validarMontosDeRegla` y va a ser
  tentador aflojar el `> 0` de paso. **No se hace:** es otra entrada y otra decisión del owner.
- Los cinco tipos de regla que no hacen lo que la pantalla promete.

## File Structure

| Archivo | Responsabilidad después del cambio |
|---|---|
| `backend/src/modules/descuentos/entities/descuento.entity.ts` | dos columnas + `@Check` de coherencia con `modo` |
| `backend/src/modules/descuentos/entities/descuento-tramo.entity.ts` | dos columnas + `@Check` de exactamente-una |
| `backend/src/modules/recargos/entities/recargo.entity.ts` | espejo del de descuentos |
| `backend/src/modules/recargos/entities/recargo-tramo.entity.ts` | espejo del de descuentos |
| `backend/src/common/utils/monto-regla.util.ts` | valida cada columna con su vara, y que no vengan las dos |
| `backend/src/modules/descuentos/dto/create-descuento.dto.ts` | `valorMonto` con `@EsMontoCobrado()`, `valorPorcentaje` sin marca |
| `backend/src/modules/recargos/dto/create-recargo.dto.ts` | espejo |
| `backend/src/modules/{descuentos,recargos}/*.service.ts` | exigen la columna del modo resultante |
| `backend/src/modules/{descuentos,recargos}/*.controller.ts` | `@Body(EscalaMonedaPipe)` |
| `backend/src/modules/{descuentos,recargos}/*.module.ts` | importan `MonedasModule` |
| `backend/src/modules/calculo-precios/calculo-precios.engine.ts` | `ReglaResuelta` con dos campos; `valorDelModo()` elige |
| `backend/src/modules/calculo-precios/calculo-precios.service.ts` | `indexarReglas` mapea los dos campos |
| `backend/src/modules/seeder/seeder.service.ts` | las 12 reglas a la columna que les toca |
| `frontend/app/pages/configuracion/{descuentos,recargos}.vue` | dos campos en el form, uno por unidad |

---

## Task 1 — Backend: el corte del dato

**Por qué va en una sola tarea:** la columna no puede existir a medias. Cualquier corte
intermedio (entities sí, services no) no compila, y el gate del proyecto prohíbe commitear en
rojo. Los *pasos* son chicos; la tarea es una.

**Files:**
- Modify: `backend/src/modules/descuentos/entities/descuento.entity.ts:25-26`
- Modify: `backend/src/modules/descuentos/entities/descuento-tramo.entity.ts:22-23`
- Modify: `backend/src/modules/recargos/entities/recargo.entity.ts` (espejo)
- Modify: `backend/src/modules/recargos/entities/recargo-tramo.entity.ts` (espejo)
- Modify: `backend/src/common/utils/monto-regla.util.ts`
- Modify: `backend/src/modules/descuentos/dto/create-descuento.dto.ts:16-40`
- Modify: `backend/src/modules/recargos/dto/create-recargo.dto.ts` (espejo)
- Modify: `backend/src/modules/descuentos/descuentos.service.ts:136,150-173,222-262,495-620`
- Modify: `backend/src/modules/recargos/recargos.service.ts` (espejo)
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts:20-36,362-440`
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts:319-352`
- Modify: `backend/src/modules/seeder/seeder.service.ts:2860-3078`
- Test: `backend/src/common/utils/monto-regla.util.spec.ts`
- Test: `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts`
- Test: `backend/src/modules/descuentos/descuentos.service.spec.ts`
- Test: `backend/src/modules/recargos/recargos.service.spec.ts`

**Interfaces:**

- **Produces** (lo que las tareas 2, 3 y 4 consumen):
  ```ts
  // entidades Descuento / Recargo
  valorMonto: string | null;       // columna valor_monto,      decimal(18,4)
  valorPorcentaje: string | null;  // columna valor_porcentaje, decimal(7,4)

  // entidades DescuentoTramo / RecargoTramo — mismos dos campos

  // common/utils/monto-regla.util.ts
  export function validarMontosDeRegla(
    modo: string,
    valores: { valorMonto?: string | null; valorPorcentaje?: string | null },
    tramos?: { valorMonto?: string | null; valorPorcentaje?: string | null }[],
  ): void;

  // calculo-precios.engine.ts
  export interface ReglaResuelta {
    id: string; nombre: string; codigo: string | null; modo: ModoRegla;
    valorMonto: string | null;
    valorPorcentaje: string | null;
    tramos: { minimo: string; valorMonto: string | null; valorPorcentaje: string | null }[];
    metodoPagoIds: string[]; activo: boolean;
  }
  ```
- **Contrato de la API** (lo consume la tarea 3): el body de `POST`/`PATCH` de
  `/descuentos` y `/recargos` reemplaza `valor` por `valorMonto` / `valorPorcentaje`, y lo
  mismo dentro de cada `tramos[]`. Las respuestas devuelven los dos campos.

---

- [ ] **Paso 1: Escribir el test que falla en el util**

En `backend/src/common/utils/monto-regla.util.spec.ts`, agregar:

```ts
describe('validarMontosDeRegla — columnas partidas', () => {
  it('rechaza que vengan las dos columnas a la vez', () => {
    expect(() =>
      validarMontosDeRegla('porcentaje', {
        valorMonto: '1000',
        valorPorcentaje: '0.10',
      }),
    ).toThrow(BadRequestException);
  });

  it('rechaza la columna que no corresponde al modo', () => {
    expect(() =>
      validarMontosDeRegla('porcentaje', { valorMonto: '1000' }),
    ).toThrow(BadRequestException);
    expect(() =>
      validarMontosDeRegla('monto_fijo', { valorPorcentaje: '0.10' }),
    ).toThrow(BadRequestException);
  });

  it('el porcentaje sigue teniendo que ser decimal menor a 1', () => {
    expect(() =>
      validarMontosDeRegla('porcentaje', { valorPorcentaje: '50' }),
    ).toThrow('El porcentaje debe expresarse en decimal (0.10 = 10%) y ser menor a 1');
  });

  it('un monto fijo grande es válido y NO se lee como porcentaje', () => {
    expect(() =>
      validarMontosDeRegla('monto_fijo', { valorMonto: '5000' }),
    ).not.toThrow();
  });

  it('valida cada tramo con la vara de su columna', () => {
    expect(() =>
      validarMontosDeRegla('porcentaje', {}, [{ valorPorcentaje: '50' }]),
    ).toThrow(BadRequestException);
  });
});
```

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
cd backend && npx jest src/common/utils/monto-regla.util.spec.ts
```

Esperado: FAIL — la firma vieja recibe `valor` como segundo argumento, así que el objeto
`{ valorMonto: ... }` no se valida y los `toThrow` no se cumplen.

- [ ] **Paso 3: Reescribir el util**

`backend/src/common/utils/monto-regla.util.ts`:

```ts
/** Un monto suelto ya sabe de qué unidad es: se lo dice la columna en la que vino. */
function validarMonto(unidad: 'monto' | 'porcentaje', valor: string | null | undefined): void {
  if (!valor) return;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) {
    throw new BadRequestException('El valor debe ser un número mayor a 0');
  }
  if (unidad === 'porcentaje' && numero >= 1) {
    throw new BadRequestException(
      'El porcentaje debe expresarse en decimal (0.10 = 10%) y ser menor a 1',
    );
  }
}

/**
 * Una expresión de monto: exactamente una de las dos columnas, y la que
 * corresponde al `modo` de la regla.
 *
 * Antes esto recibía un `valor` suelto y el `modo` decidía cómo leerlo — que es
 * la ambigüedad que este cambio vino a matar. Ahora el `modo` solo dice cuál de
 * las dos columnas puede venir llena; la unidad la dice la columna.
 */
function validarExpresion(
  modo: string,
  valores: { valorMonto?: string | null; valorPorcentaje?: string | null },
): void {
  if (valores.valorMonto && valores.valorPorcentaje) {
    throw new BadRequestException(
      'El importe se expresa en una sola unidad: monto o porcentaje, no las dos',
    );
  }
  if (modo === 'porcentaje' && valores.valorMonto) {
    throw new BadRequestException(
      'Esta regla es un porcentaje: el importe va en valorPorcentaje',
    );
  }
  if (modo === 'monto_fijo' && valores.valorPorcentaje) {
    throw new BadRequestException(
      'Esta regla es un monto fijo: el importe va en valorMonto',
    );
  }
  validarMonto('monto', valores.valorMonto);
  validarMonto('porcentaje', valores.valorPorcentaje);
}

export function validarMontosDeRegla(
  modo: string,
  valores: { valorMonto?: string | null; valorPorcentaje?: string | null },
  tramos?: { valorMonto?: string | null; valorPorcentaje?: string | null }[],
): void {
  validarExpresion(modo, valores);
  for (const tramo of tramos ?? []) validarExpresion(modo, tramo);
}
```

⚠️ El docblock de cabecera del archivo explica el bug que justificó centralizar esto (el
tramo `50` que producía un 5000%). **No borrarlo:** agregarle que ahora la unidad la lleva la
columna, y que ese bug ya no es expresable.

- [ ] **Paso 4: Correr el test y verificar que pasa**

```bash
cd backend && npx jest src/common/utils/monto-regla.util.spec.ts
```

Esperado: PASS.

- [ ] **Paso 5: Partir las columnas en las cuatro entidades**

`descuento.entity.ts` — reemplazar el `@Column` de `valor` por:

```ts
  @Column({ name: 'valor_monto', type: 'decimal', precision: 18, scale: 4, nullable: true })
  valorMonto: string | null; // plata; null cuando la regla es porcentaje o usa tramos

  @Column({ name: 'valor_porcentaje', type: 'decimal', precision: 7, scale: 4, nullable: true })
  valorPorcentaje: string | null; // decimal (0.10 = 10%); null cuando es monto o usa tramos
```

y sobre la clase, junto a `@Entity('descuentos')`:

```ts
@Check(
  'chk_descuentos_valor_segun_modo',
  `("modo" = 'monto_fijo' AND "valor_porcentaje" IS NULL)
   OR ("modo" = 'porcentaje' AND "valor_monto" IS NULL)`,
)
```

`descuento-tramo.entity.ts` — mismas dos columnas, y el CHECK de exactamente-una, con la
misma forma XOR que ya usa `impuesto.entity.ts:13`:

```ts
@Check(
  'chk_descuento_tramos_una_unidad',
  '("valor_monto" IS NULL) <> ("valor_porcentaje" IS NULL)',
)
```

Los dos archivos de `recargos` son el espejo exacto, con `chk_recargos_valor_segun_modo` y
`chk_recargo_tramos_una_unidad`.

⚠️ **No hace falta tocar `app.module.ts`:** no se agregan entidades nuevas, solo columnas. Si
el trabajo terminara agregando una entidad, va también al array `entities` — no hay
`autoLoadEntities` y eso solo lo caza el e2e real.

- [ ] **Paso 6: Partir el campo en los DTOs**

`create-descuento.dto.ts` (y su espejo en recargos):

```ts
export class TramoDto {
  @IsNumberString()
  minimo: string;

  @IsOptional()
  @IsNumberString()
  @EsMontoCobrado()
  valorMonto?: string | null;

  @IsOptional()
  @IsNumberString()
  valorPorcentaje?: string | null;
}
```

y en `CreateDescuentoDto`, reemplazando `valor`:

```ts
  // Cuál de las dos puede venir lo decide `modo`, y lo valida el service.
  // `valorMonto` lleva la marca de escala; `valorPorcentaje` no es plata.
  @IsOptional()
  @IsNumberString()
  @EsMontoCobrado()
  valorMonto?: string | null;

  @IsOptional()
  @IsNumberString()
  valorPorcentaje?: string | null;
```

El `@Type(() => TramoDto)` de la línea 49 **ya está** y es lo que hace que el pipe recorra los
tramos: no tocarlo.

- [ ] **Paso 7: Actualizar los dos services**

En `descuentos.service.ts` y `recargos.service.ts`, tres lugares por service:

1. `validarSegunTipoCreate` — el chequeo de valor requerido pasa a mirar la columna del modo
   resultante, y la llamada al util cambia de forma:

```ts
    const modoResultante = tiposFijoPorcentaje.includes(codigo)
      ? 'porcentaje'
      : (dto.modo ?? 'porcentaje');
    const importe =
      modoResultante === 'monto_fijo' ? dto.valorMonto : dto.valorPorcentaje;
    if (TIPOS_CON_VALOR_UNICO.includes(codigo) && !importe)
      throw new BadRequestException('El valor es requerido para este tipo');
    validarMontosDeRegla(
      modoResultante,
      { valorMonto: dto.valorMonto, valorPorcentaje: dto.valorPorcentaje },
      dto.tramos,
    );
```

2. `validarEstadoResultante` — mismo criterio, con los valores que QUEDAN:

```ts
    const modoResultante = tiposFijoPorcentaje.includes(codigo)
      ? 'porcentaje'
      : (dto.modo ?? actual.modo);
    const valorMontoFinal =
      dto.valorMonto !== undefined ? dto.valorMonto : actual.valorMonto;
    const valorPorcentajeFinal =
      dto.valorPorcentaje !== undefined ? dto.valorPorcentaje : actual.valorPorcentaje;
    const importeFinal =
      modoResultante === 'monto_fijo' ? valorMontoFinal : valorPorcentajeFinal;
    if (TIPOS_CON_VALOR_UNICO.includes(codigo) && !importeFinal)
      throw new BadRequestException('El valor es requerido para este tipo');
```

   y la llamada al util con `{ valorMonto: valorMontoFinal, valorPorcentaje: valorPorcentajeFinal }`
   y `tramosFinales`.

   📌 El comentario que hoy explica por qué los tramos se leen siempre —*"un PATCH que solo
   cambia el modo reinterpreta los valores ya guardados"*— **se reescribe, no se borra**: ese
   peligro deja de existir (la columna nueva queda vacía y falla ruidoso), pero los tramos se
   siguen leyendo por la otra razón que el mismo comentario da: un cambio de tipo puede dejar
   tramos huérfanos que el motor igual evalúa.

3. Los `manager.create(...)` de `create` y `update` escriben los dos campos en vez de `valor`.

- [ ] **Paso 8: Escribir los tests de service que fijan las dos reglas nuevas**

En `descuentos.service.spec.ts` (y el espejo en recargos):

```ts
// `update` recibe TRES argumentos: (tenantId, id, dto). Verificado en
// `descuentos.service.ts:200` — no lleva `usuarioId`.
it('rechaza un PATCH que manda la columna que no corresponde al modo', async () => {
  await expect(
    service.update(tenantId, descuentoPorcentajeId, { valorMonto: '5000' }),
  ).rejects.toThrow('Esta regla es un porcentaje: el importe va en valorPorcentaje');
});

it('un PATCH que cambia el modo sin traer el importe falla en vez de reinterpretar', async () => {
  await expect(
    service.update(tenantId, descuentoPorcentajeId, { modo: 'monto_fijo' }),
  ).rejects.toThrow('El valor es requerido para este tipo');
});
```

- [ ] **Paso 9: Actualizar el motor**

`calculo-precios.engine.ts` — `ReglaResuelta` como quedó declarada arriba en **Interfaces**, y
la elección de columna en una función con nombre:

```ts
/**
 * La columna que corresponde al modo. No elige entre dos valores: nombra cuál
 * de las dos existe. Que nunca estén las dos llenas lo garantiza el CHECK de
 * tabla, no esta función.
 */
function valorDelModo(
  modo: ModoRegla,
  valorMonto: string | null,
  valorPorcentaje: string | null,
): string | null {
  return modo === 'monto_fijo' ? valorMonto : valorPorcentaje;
}
```

`aplicarValor` **no cambia de firma**: se le sigue pasando `modo` y un valor ya elegido. En
`evaluarRegla`, los tres `return` pasan a:

```ts
    const valor = valorDelModo(regla.modo, regla.valorMonto, regla.valorPorcentaje);
    return { monto: aplicarValor(regla.modo, valor, ctx.base), valorEfectivo: valor };
```

y el de tramos usa `valorDelModo(regla.modo, tramo.valorMonto, tramo.valorPorcentaje)`.

⚠️ **Lo que NO se toca:** el `sort` de la línea 518 sigue ordenando por `modo`, y
`valorEfectivo` / `valorSolicitado` conservan su forma. Si el diff los toca, se fue de alcance.

- [ ] **Paso 10: Escribir el test del motor que distingue las dos unidades**

En `calculo-precios.engine.spec.ts`:

Primero, el factory `regla()` del propio spec (`calculo-precios.engine.spec.ts:35-45`)
cambia su default de `valor: '0.10'` a las dos columnas:

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
  ...over,
});
```

`evaluarRegla` es privada del módulo: las reglas se ejercitan por `calcularVenta`, como ya
hace el resto del spec. La línea por defecto tiene base 100.

```ts
it('un monto fijo de 25 cobra 25, no 2.500%', () => {
  const r = calcularVenta(
    venta({
      lineas: [
        linea({
          descuentos: [regla({ modo: 'monto_fijo', valorMonto: '25', valorPorcentaje: null })],
        }),
      ],
    }),
  );
  expect(r.lineas[0].descuentoAplicado).toBe('25.000000');
});

it('un porcentaje de 0.10 sobre la línea de 100 cobra 10', () => {
  const r = calcularVenta(
    venta({ lineas: [linea({ descuentos: [regla({ valorPorcentaje: '0.10' })] })] }),
  );
  expect(r.lineas[0].descuentoAplicado).toBe('10.000000'); // 100 * 0.10
});

it('la columna que no corresponde al modo se ignora', () => {
  // Estado imposible por CHECK; el test fija que el motor no lo lea igual.
  const r = calcularVenta(
    venta({
      lineas: [
        linea({
          descuentos: [
            regla({ modo: 'porcentaje', valorMonto: '5000', valorPorcentaje: '0.10' }),
          ],
        }),
      ],
    }),
  );
  expect(r.lineas[0].descuentoAplicado).toBe('10.000000');
});
```

⚠️ El tercero monta un estado que la base no permite. Va igual **como red del motor**, y así
etiquetado en el propio test — si algún día alguien afloja el CHECK, el motor sigue leyendo la
columna correcta.

- [ ] **Paso 11: Mapear los dos campos en el service de cálculo**

`calculo-precios.service.ts:319-352` — `indexarReglas` recibe y mapea `valorMonto` /
`valorPorcentaje`, y los tramos igual. Los `?? '0'` de hoy sobre `t.valor` **no se copian a
las dos columnas**: un `'0'` en la columna que no va sería exactamente el dato ambiguo que
esto viene a matar. El default se aplica **después** de elegir la columna, en el motor.

- [ ] **Paso 12: Repartir las 12 reglas del seed**

`seeder.service.ts` — las 10 con `ModoRegla.PORCENTAJE` (`:2860`, `:2871`, `:2882`, `:2892`,
`:2902`, `:3023`, `:3033`, `:3043`, `:3054`, `:3078`) pasan su valor a `valorPorcentaje`, y
las 2 con `ModoRegla.MONTO_FIJO` (`:2914`, `:3068`) a `valorMonto`. Los tramos seedeados, lo
mismo según el modo de su regla.

- [ ] **Paso 13: Correr el gate de unidad**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

Esperado: todo verde. Si `npm test` marca specs que todavía construyen reglas con `valor`,
son los que hay que mover — no se saltean.

- [ ] **Paso 14: Resetear la base y correr el e2e completo**

```bash
./scripts/reset-db.sh
cd backend && npm run test:e2e
```

⚠️ **El e2e va entero, no un subconjunto.** Este cambio toca DTOs de dos módulos y el motor:
es justo la forma que un subset local no ve. `test/reglas-valor.e2e-spec.ts` es el que más se
va a mover.

⚠️ **No tocar ningún `.ts` del backend con el e2e corriendo:** el compose re-siembra y salen
fallos repartidos que no son regresiones. Ante un rojo raro, primero
`./scripts/reset-db.sh --verificar`.

- [ ] **Paso 15: Probar el mutante — que revierta, no que rompa**

Volver **una** regla del motor a la forma vieja (leer un único `valor` interpretado por
`modo`) y verificar que el test del paso 10 se pone rojo. Un test que sigue verde con el
código anterior no estaba fijando el cambio.

Después de revertir el mutante, **verificar la hora del restart en los logs del backend**: el
watcher tiene que haber recompilado el fuente limpio antes de seguir.

- [ ] **Paso 16: Commit**

```bash
git add backend/src
git commit
```

Mensaje: qué se partió, por qué `modo` sobrevive, y que el PATCH que cambia de unidad ahora
falla ruidoso en vez de reinterpretar. El pre-commit va a exigir el recibo de la revisión
independiente porque el diff toca services de backend: correrla antes (`verify-feature` paso
7), nunca `--no-verify`.

---

## Task 2 — Backend: enchufar el borde de escala

**Por qué va aparte:** es la razón de ser del cambio y se puede aceptar o rechazar sola. Sin
esto, las columnas están partidas y nadie valida la escala.

**Files:**
- Modify: `backend/src/modules/descuentos/descuentos.controller.ts:65,75`
- Modify: `backend/src/modules/recargos/recargos.controller.ts:62,72`
- Modify: `backend/src/modules/descuentos/descuentos.module.ts`
- Modify: `backend/src/modules/recargos/recargos.module.ts`
- Test: `backend/test/reglas-valor.e2e-spec.ts`

**Interfaces:**
- Consumes: `valorMonto` con `@EsMontoCobrado()` en los DTOs (Task 1, paso 6).
- Produces: `POST`/`PATCH` de reglas devuelven **400** cuando `valorMonto` trae más decimales
  de los que admite la moneda oficial del tenant.

- [ ] **Paso 1: Escribir el e2e que falla**

En `backend/test/reglas-valor.e2e-spec.ts`, con un tenant de moneda CLP (`decimales = 0`):

```ts
it('rechaza un monto fijo con decimales que la moneda no admite', async () => {
  const res = await request(app.getHttpServer())
    .post('/api/descuentos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: 'Descuento con centavos',
      tipoReglaId: tipoDirectoId,
      modo: 'monto_fijo',
      valorMonto: '1000.55',
    });
  expect(res.status).toBe(400);
  expect(res.body.message).toContain('decimales');
});

it('acepta el mismo monto sin decimales', async () => {
  const res = await request(app.getHttpServer())
    .post('/api/descuentos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: 'Descuento redondo',
      tipoReglaId: tipoDirectoId,
      modo: 'monto_fijo',
      valorMonto: '1000',
    });
  expect(res.status).toBe(201);
});

it('el porcentaje NO se valida contra la escala de la moneda', async () => {
  // 0.0750 tiene 4 decimales y CLP admite 0: si el pipe lo mirara, sería 400.
  const res = await request(app.getHttpServer())
    .post('/api/descuentos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: 'Descuento 7,5%',
      tipoReglaId: tipoDirectoId,
      modo: 'porcentaje',
      valorPorcentaje: '0.0750',
    });
  expect(res.status).toBe(201);
});

it('valida también el monto de un tramo, que viaja anidado', async () => {
  const res = await request(app.getHttpServer())
    .post('/api/descuentos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: 'Por volumen con centavos',
      tipoReglaId: tipoPorMayorId,
      modo: 'monto_fijo',
      tramos: [{ minimo: '10', valorMonto: '500.25' }],
    });
  expect(res.status).toBe(400);
});
```

- [ ] **Paso 2: Correr los cuatro y verificar que los dos de rechazo fallan**

```bash
./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json reglas-valor
```

Esperado: los `expect(400)` fallan con 201 — el pipe todavía no está enchufado.

- [ ] **Paso 3: Enchufar el pipe en los dos controllers**

```ts
  create(@Req() req: Request, @Body(EscalaMonedaPipe) dto: CreateDescuentoDto) {
```

y lo mismo en el `@Body()` del `update`. **No** en `RestaurarDto`: no lleva plata.

- [ ] **Paso 4: Importar `MonedasModule` en los dos módulos**

Nest inscribe los pipes de parámetro como injectables del módulo del controller, así que sin
este import el arranque falla por dependencia sin resolver.

```ts
  imports: [TypeOrmModule.forFeature([...]), MonedasModule],
```

- [ ] **Paso 5: Correr el e2e del spec y verificar que pasa**

```bash
./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json reglas-valor
```

Esperado: los cuatro en verde.

- [ ] **Paso 6: Correr el e2e completo**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

Enchufar un pipe toca **todas** las rutas de los dos controllers, no solo las dos del test.

- [ ] **Paso 7: Commit**

```bash
git add backend/src backend/test
git commit
```

Mensaje: el borde de escala ahora cubre las reglas, y qué rechaza (monto con más decimales de
los que admite la moneda, también dentro de un tramo).

---

## Task 3 — Frontend: un campo por unidad en las dos pantallas

**Files:**
- Modify: `frontend/app/pages/configuracion/descuentos.vue:18-21,77-80,127-138,235-238,276-277,418,478-480,596-602,646,661-662`
- Modify: `frontend/app/pages/configuracion/recargos.vue` (mismas líneas, offset ~5)

**Interfaces:**
- Consumes: el contrato de API de la Task 1 (`valorMonto` / `valorPorcentaje`, también dentro
  de `tramos[]`).

- [ ] **Paso 1: Partir el tipo `Regla` y el `form`**

```ts
interface Regla {
  // ...
  modo: string | null
  valorMonto: string | null
  valorPorcentaje: string | null
  tramos: { minimo: string; valorMonto: string | null; valorPorcentaje: string | null }[]
  // ...
}
```

y el estado inicial del form con `valorMonto: ''`, `valorPorcentaje: ''` y los tramos con los
dos campos.

- [ ] **Paso 2: Adaptar el cambio de modo**

El handler de las líneas 135-138 **ya limpia** el importe al cambiar de modo, y su comentario
explica por qué (el `MoneyInput` mostraba `$0` mientras el valor seguía siendo `0.10`). Se
conserva la limpieza y se le agrega que ahora hay dos campos:

```ts
function cambiarModo(value: string) {
  if (value === form.value.modo) return
  form.value.modo = value
  // Se limpian los DOS: el abandonado no puede viajar en el body —el backend
  // rechaza que vengan las dos columnas— y el nuevo arranca vacío.
  form.value.valorMonto = ''
  form.value.valorPorcentaje = ''
  for (const tramo of form.value.tramos) {
    tramo.valorMonto = ''
    tramo.valorPorcentaje = ''
  }
}
```

- [ ] **Paso 3: Enlazar cada input a su campo**

```vue
<MoneyInput v-if="form.modo === 'monto_fijo'" v-model="form.valorMonto" oficial />
<UInput v-else v-model="form.valorPorcentaje" inputmode="decimal" placeholder="0.10 (= 10%)" />
```

y en la fila de tramos, igual con `tramo.valorMonto` / `tramo.valorPorcentaje`.

📌 El comentario que hoy dice que el frontend *"es la única capa que puede distinguirlos"*
porque el backend no lee el campo hermano **se reescribe**: ya no es cierto. Ahora el backend
valida cada columna, y la pantalla elige el input por comodidad, no por ser el único
enforcement.

- [ ] **Paso 4: Mandar solo la columna que corresponde**

```ts
      if (cfg.campoValor) {
        if (form.value.modo === 'monto_fijo') body.valorMonto = form.value.valorMonto
        else body.valorPorcentaje = form.value.valorPorcentaje
      }
```

y en el armado de `tramos`, lo mismo por tramo.

- [ ] **Paso 5: Arreglar la celda de la tabla**

Hoy (línea 478-480 de `descuentos.vue`) multiplica por 100 cuando `modo === 'porcentaje'`.
Pasa a leer la columna:

```vue
<template v-else-if="row.original.valorPorcentaje || row.original.valorMonto">
  {{ row.original.valorPorcentaje
      ? `${(Number(row.original.valorPorcentaje) * 100).toFixed(0)}%`
      : row.original.valorMonto }}
  ({{ row.original.valorPorcentaje ? 'porcentaje' : 'monto fijo' }})
</template>
```

- [ ] **Paso 6: Correr el gate del frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

- [ ] **Paso 7: Smoke en el navegador, con la base ya reseteada**

`./scripts/reset-db.sh` **primero**, después `docker-compose up`, y en el Chrome real (no el
navegador embebido — el owner mira su ventana y su log de red muestra las llamadas a
`localhost:3000`):

1. Crear un descuento **directo** en modo monto fijo con `$1000` → guarda.
2. Editarlo a modo porcentaje: el campo tiene que quedar **vacío**, no mostrar `1000`.
3. Guardar con `0.10` → la tabla tiene que decir `10% (porcentaje)`.
4. Crear uno **por volumen** con dos tramos en monto fijo → guarda y la tabla los muestra.
5. En CLP, intentar `$1000,55` → el input no lo deja tipear, y si se fuerza por API es 400.

⚠️ El drawer no tiene test unitario: build, typecheck y las revisiones **no ven** bugs de
runtime acá. Este paso no es opcional.

- [ ] **Paso 8: Commit**

```bash
git add frontend/app
git commit
```

Mensaje: cada unidad tiene su campo, y por qué el comentario de "el frontend es la única capa
que puede distinguirlos" dejó de ser cierto. El pre-commit va a exigir el recibo de la
revisión independiente por tocar `.vue` de `pages`.

---

## Task 4 — Documentación viva y cierre del backlog

**Files:**
- Modify: `docs/features/descuentos-recargos.md`
- Modify: `docs/features/motor-calculo-precios.md`
- Modify: `startup-pos.sql`
- Modify: `docs/agent/pendientes.md` (sacar la entrada)
- Modify: `docs/agent/resueltos.md` (mudarla con el texto de cierre)
- Modify: `docs/ESTADO.md` si la fila de reglas cambia de estado

- [ ] **Paso 1: `docs/features/descuentos-recargos.md`**

La forma del dato (dos columnas), la invariante y **dónde vive cada mitad**: el CHECK de tabla
para la regla y para el tramo, y la coherencia tramo↔regla en el service. Decir que es en el
service, no dejar creer que la base la garantiza.

- [ ] **Paso 2: `docs/features/motor-calculo-precios.md`**

De dónde lee el motor el valor de una regla, y que `modo` sigue siendo la clave de orden.

- [ ] **Paso 3: `startup-pos.sql`**

Las cuatro tablas, con sus CHECK. Es documentación: el esquema real lo manda `synchronize`.

- [ ] **Paso 4: Mudar la entrada del backlog**

Sacarla de `pendientes.md` § 3 y ponerla en `resueltos.md` **con el texto de su cierre** —
incluido lo que se midió y resultó distinto de lo que la entrada decía: la trampa (c) del
DTO anidado **no aplicaba**, porque `create-descuento.dto.ts:49` ya tenía `@Type()`.

📌 Y dejar dicho lo que **no** se hizo: el tramo en cero sigue abierto, y ahora toca una
validación que cambió de forma. Su entrada tiene que decir que `validarMontosDeRegla` ya no
recibe un `valor` suelto.

- [ ] **Paso 5: Commit** (en el mismo commit que el código si el gate lo permite; si no, inmediatamente después)

---

## Verification — el gate completo, antes de dar por terminado

```bash
./scripts/reset-db.sh
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
./scripts/reset-db.sh --verificar
```

- [ ] Los ocho comandos en verde, **mirando el exit code y no la última línea** (un `| tail`
  descarta el status y el `&&` siguiente corre igual).
- [ ] Revisión independiente (`verify-feature` paso 7) sobre el diff exacto que se va a
  commitear — el pre-commit la exige porque el diff toca services de backend y `.vue`.
- [ ] Sin `TODO`, sin código comentado, sin código muerto.
- [ ] Ninguna invariante violada.
- [ ] Tras el push: revisar **el deployment de Railway** además del CI. Este cambio toca
  entidades, y `synchronize` corre al arrancar.

## Decisions / Open questions

**Decidido (no reabrir sin decisión nueva):**

- Una regla es toda en pesos o toda en porcentaje, tramos incluidos (owner, 2026-08-23).
- `modo` sobrevive como discriminador (spec, enfoque A).
- `valor_porcentaje` es `decimal(7,4)`: el tope es inalcanzable por la API, y se elige que un
  camino futuro que se saltee la validación falle ruidoso en vez de guardar un 50.000%.

**Abierto, y a propósito fuera de este plan:**

- El tramo en cero. Toca `validarMontosDeRegla`, que este plan cambia de forma. Su entrada de
  `pendientes.md` hay que actualizarla (Task 4, paso 4), pero **el arreglo no entra acá**.
