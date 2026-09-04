# Plan: la devolución se acredita por línea, reponga o no el stock

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan
> checkbox (`- [ ]`).

**Goal:** que cualquier ítem vendido se pueda acreditar por línea en una nota de crédito —reponga
o no el stock— y que acreditar menos de lo que vale la mercadería deje de rechazarse.

**Architecture:** `devoluciones` deja de significar *"ítems a devolver a stock"* y pasa a
significar *"ítems que se acreditan"*, con la reposición como propiedad de cada línea. Las
validaciones de inventario dejan de disparar por nombrar el ítem y pasan a disparar solo por
pedir que reponga. Cuando lo devuelto vale más que la nota, las líneas se **escalan** para sumar
el monto con `repartirProporcional`, y el motivo pasa a ser obligatorio. Sobrevive un solo
rechazo —el tope por porción fiscal— evaluado sobre las líneas **ya escaladas**.

**Tech Stack:** NestJS + TypeORM (`db.transaccion` / `@InjectRepository`, ADR-020), Decimal.js,
PostgreSQL 15 con `synchronize`, Jest + supertest, Nuxt 4 + Nuxt UI.

**Spec:** [`../specs/2026-09-04-devolucion-con-credito-parcial-design.md`](../specs/2026-09-04-devolucion-con-credito-parcial-design.md)

---

## ✅ Ejecutado el 2026-09-04 — y lo que salió distinto

Las seis tareas están construidas y commiteadas (`ead5849c`, `f701b7c1`, `767c5227`, `e965903e`,
`7fe7046b`, más el cierre). Cierre completo en
[`resueltos.md`](../../agent/resueltos.md). Lo que el plan **no** anticipaba, todo encontrado por
la revisión independiente y no por los tests que el plan pedía:

1. **El tope por cantidad se quedó ciego** (tarea 2). Contaba `movimientos_inventario`, y eso era
   fiel mientras toda línea aceptada moviera stock. Con líneas que se acreditan sin reponer, dos
   notas seguidas podían acreditar la misma receta. Salió `unidadesComprometidasPorItem`, que
   toma por documento el mayor entre lo acreditado en líneas y lo movido en stock.
2. **La política de reposición son TRES, no dos** (tarea 2). El plan proponía un booleano
   `rechazarReposicionImposible`; con él, `registrarDevolucionesPorReembolso` reponía lo que se
   pidió no reponer. Quedó `politicaReposicion: 'rechazar-imposible' | 'ignorar' | 'exigir'`.
3. **El escalado metía líneas en cero** en el documento (tarea 3), contra la regla que el propio
   módulo ya aplicaba al reparto del ajuste. Se filtran.
4. **La glosa** (tarea 3). El plan la ponía en la `descripcion` de la línea, pisando el nombre
   del ítem — que es justo lo que la tarea 2 vino a arreglar. Va **pegada**: *"Empanada ·
   Volvieron abiertas"*.
5. **El `precio_unitario` de una línea escalada** (tarea 3). Sin tocarlo, la pantalla afirmaba
   `7 × $1.190 = $368`. Se deriva del importe escalado — y **solo ahí**: derivarlo también en la
   línea no escalada movía el número persistido en el 52,6 % de las líneas.
6. **`disponibleNotaCredito` prometía sobre documentos inelegibles** (tarea 4), el 37 % de la
   base. Salió el gemelo de los cuatro cortes de elegibilidad de la emisión.
7. **El modo de la lista compartida no es fijo** (tarea 5): en el modal de reembolso depende del
   checkbox "generar nota de crédito", así que cambia con el modal abierto.
8. **Dos handlers del drawer** pintaban optimista un campo del que el disponible ahora depende
   (tarea 5): uno ofrecía lo imposible, el otro escondía lo posible.

## Global Constraints

Además de las invariantes de `CLAUDE.md`, para este frente:

- **Materia fiscal: va solo.** No se toma ninguna otra tarea de arrastre (ADR-010).
- **El motor de cálculo de precios NO se toca.** `repartirProporcional` ya está exportado desde
  el frente anterior (`20452024`); se consume, no se modifica. Cualquier cambio en
  `calculo-precios.engine.ts` **detiene el plan** y se consulta.
- **Plata y porcentajes con `Decimal.js`**, nunca `number`.
- **El navegador no recalcula plata.** El disponible por porción lo calcula el backend y el
  frontend lo muestra. Replicar la cuantización del motor en el frontend ya se intentó y falló
  (2026-09-04): bloqueaba notas que el backend acepta.
- **Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`.**
- **Nunca una query por iteración.**
- **`./scripts/reset-db.sh` ANTES de cada `test:e2e`** y `--verificar` DESPUÉS. No tocar un
  `.ts` del backend con el e2e corriendo.
- **Nunca `git commit --no-verify`.** El recibo de la revisión independiente se ata al diff
  staged.
- El gate completo de `CLAUDE.md` corre **entero** al cerrar.

---

## Estructura de archivos

| Archivo | Qué hace |
|---|---|
| `backend/src/modules/ventas/nota-credito-composicion.ts` | **Modificar:** agregar `escalarDevoluciones`. |
| `backend/src/modules/ventas/nota-credito-composicion.spec.ts` | **Modificar:** unitarios del escalado. |
| `backend/src/modules/ventas/dto/create-nota-credito.dto.ts` | **Modificar:** `reponerStock` en `DevolucionNotaCreditoDto`. |
| `backend/src/modules/ventas/ventas.service.ts` | **Modificar:** `DevolucionReembolso`, `validarDevolucionesReembolso`, `crearNotaCreditoEnTransaccion`, `findOne`. |
| `backend/src/modules/ventas/ventas.controller.ts` | **Modificar:** pasar `reponerStock` del DTO. |
| `backend/src/modules/pasarela/services/reembolso-callback.registry.ts` | **Modificar:** `reponerStock` opcional en el evento. |
| `backend/test/nota-credito-composicion.e2e-spec.ts` | **Modificar:** los casos nuevos. |
| `frontend/app/composables/useDevolucionInventario.ts` | **Modificar:** el flag de reposición por fila. |
| `frontend/app/components/ventas/NotaCreditoModal.vue` | **Modificar:** columna de reponer, motivo pedido, disponible por porción. |
| `frontend/app/components/ventas/VentaDetalleDrawer.vue` | **Modificar:** consumir `disponibleNotaCredito` del backend. |
| `docs/features/reembolsos-nota-credito.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md` | **Modificar:** cierre. |

---

## Tarea 1: el escalado, puro y testeado

**Files:**
- Modify: `backend/src/modules/ventas/nota-credito-composicion.ts`
- Test: `backend/src/modules/ventas/nota-credito-composicion.spec.ts`

**Interfaces:**
- Consume: `repartirProporcional`, `ConfigCalculo`, `Cuantizador` (ya importados en ese archivo).
- Produce: `escalarDevoluciones(brutos: Decimal[], monto: Decimal, cfg: ConfigCalculo, q: Cuantizador): Decimal[]`, que consume la Tarea 3.

Entra `Decimal`, sale `Decimal`. No toca la base ni el service: es lo que permite probar el
residuo sin levantar Postgres.

- [x] **Paso 1: escribir los tests que fallan**

⚠️ **Los valores tienen que discriminar.** Nada de dos ítems del mismo valor ni de factores que
dividan exacto: con eso, un escalado que divida línea por línea pasa igual.

```ts
describe('escalarDevoluciones', () => {
  it('si lo devuelto entra en el monto, las líneas NO se tocan', () => {
    const partes = escalarDevoluciones(
      [new Decimal('1190'), new Decimal('3000')],
      new Decimal('8000'),
      CFG,
      q,
    );
    expect(partes.map((p) => p.toString())).toEqual(['1190', '3000']);
  });

  it('si no entra, las líneas suman EXACTAMENTE el monto', () => {
    // 1.190 + 3.000 = 4.190 devueltos, se acreditan 1.000.
    // Proporción despareja y factor que no divide exacto: es lo que discrimina.
    const partes = escalarDevoluciones(
      [new Decimal('1190'), new Decimal('3000')],
      new Decimal('1000'),
      CFG,
      q,
    );
    const suma = partes.reduce((a, p) => a.plus(p), new Decimal(0));
    expect(suma.toString()).toBe('1000');
    // 1.000 × 1.190/4.190 = 284,00…  y  1.000 × 3.000/4.190 = 715,99…
    expect(partes.map((p) => p.toString())).toEqual(['284', '716']);
  });

  it('el monto igual a lo devuelto no escala nada', () => {
    const partes = escalarDevoluciones(
      [new Decimal('1190'), new Decimal('3000')],
      new Decimal('4190'),
      CFG,
      q,
    );
    expect(partes.map((p) => p.toString())).toEqual(['1190', '3000']);
  });

  it('sin devoluciones devuelve una lista vacía', () => {
    expect(escalarDevoluciones([], new Decimal('1000'), CFG, q)).toEqual([]);
  });

  it('devoluciones que valen cero no dividen por cero', () => {
    const partes = escalarDevoluciones(
      [new Decimal(0), new Decimal(0)],
      new Decimal('1000'),
      CFG,
      q,
    );
    expect(partes.map((p) => p.toString())).toEqual(['0', '0']);
  });
});
```

⚠️ Los números esperados están calculados a mano con `decimalesMoneda: 0` (el `CFG` que ya
existe en ese spec). **Correr los tests antes de dar por buena cualquier constante**: si uno no
da, se revisa el número contra la aritmética, no al revés.

- [x] **Paso 2: correrlos y verlos fallar**

```bash
cd backend && npm test -- nota-credito-composicion
```

Esperado: FAIL — `escalarDevoluciones` no existe.

- [x] **Paso 3: escribir la función**

```ts
/**
 * Escala las líneas de devolución para que sumen, **como máximo**, el monto de
 * la nota. Con `Σ devoluciones ≤ monto` las devuelve intactas —que es la
 * conducta de siempre— y con `Σ devoluciones > monto` las baja a prorrata.
 *
 * Se acredita menos de lo que vale la mercadería en casos reales: cargo por
 * reposición, producto que vuelve dañado, un monto acordado en el mostrador. El
 * documento no puede mostrar el valor original **porque sus líneas tienen que
 * sumar `total_final`**; el porqué lo lleva la glosa, que en ese caso es
 * obligatoria. La alternativa —línea negativa de "cargo por reposición"— se
 * descartó: ningún POS la usa y el DTE no tiene un campo con esa semántica
 * (investigación del 2026-09-04).
 *
 * Reparte con `repartirProporcional` y no dividiendo línea por línea: con un
 * factor que no divide exacto, dividir cada una por separado deja la suma
 * corrida. Es la misma regla de residuo que usa el ajuste afecto/exento.
 */
export function escalarDevoluciones(
  brutos: Decimal[],
  monto: Decimal,
  cfg: ConfigCalculo,
  q: Cuantizador,
): Decimal[] {
  if (!brutos.length) return [];
  const valorDevuelto = brutos.reduce((a, b) => a.plus(b), ZERO);
  // Sin valor no hay proporción que repartir, y `repartirProporcional` mandaría
  // todo a la primera línea.
  if (valorDevuelto.lte(0)) return brutos.map(() => ZERO);
  return repartirProporcional(q(Decimal.min(valorDevuelto, monto)), brutos, cfg, q);
}
```

- [x] **Paso 4: correrlos y verlos pasar**

```bash
cd backend && npm test -- nota-credito-composicion && npm run lint:check && npm run typecheck
```

- [x] **Paso 5: mutantes — cada uno tiene que REVERTIR al código anterior, no solo romper**

Guardar copia antes de cada mutante y restaurar con `diff -q`, **nunca** con `git checkout`.

| Mutante | Test que debe caer |
|---|---|
| `Decimal.min(valorDevuelto, monto)` → `monto` | "si lo devuelto entra en el monto, las líneas NO se tocan" |
| `repartirProporcional(...)` → `brutos.map((b) => q(b.times(monto).dividedBy(valorDevuelto)))` | "las líneas suman EXACTAMENTE el monto" |
| Sacar el guard de `valorDevuelto.lte(0)` | "devoluciones que valen cero no dividen por cero" |

Si un mutante **sobrevive**, sospechar del test antes que del código: probablemente el fixture no
discrimina.

- [x] **Paso 6: commit**

```bash
git add backend/src/modules/ventas/nota-credito-composicion.ts backend/src/modules/ventas/nota-credito-composicion.spec.ts
git commit -m "feat(ventas): el escalado de las líneas de devolución, puro y testeado"
```

---

## Tarea 2: cualquier ítem se acredita; reponer es una elección

**Files:**
- Modify: `backend/src/modules/ventas/dto/create-nota-credito.dto.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts` — `DevolucionReembolso` (`:90`),
  `validarDevolucionesReembolso`, el loop de inventario de `crearNotaCreditoEnTransaccion`
- Modify: `backend/src/modules/ventas/ventas.controller.ts` (`:55`)
- Modify: `backend/src/modules/pasarela/services/reembolso-callback.registry.ts` (`:15`)
- Test: `backend/test/nota-credito-composicion.e2e-spec.ts`

**Interfaces:**
- Produce: `DevolucionReembolso` con `reponerStock?: boolean`, y las líneas validadas con
  `reponeStock: boolean` ya resuelto, que consume el loop de inventario.

⚠️ **Esta tarea es INDIVISIBLE.** Abrir la validación sin el flag hace que una receta se acredite
y después `registrarMovimiento` la rechace con 400: el reembolso entero falla, **peor que hoy**.
El flag sin abrir la validación no hace nada. Los dos cambios entran juntos o no entra ninguno.

- [x] **Paso 1: escribir los e2e que fallan**

Sobre ítems propios del spec (no los del seed). El spec ya crea un producto afecto y un servicio
exento; agregar **una receta** para el caso que más importa.

```ts
it('una receta se acredita por línea, sin mover inventario', async () => {
  const ventaId = await crearVentaConReceta();
  const { id } = await emitirNC(ventaId, {
    monto: '4000',
    devoluciones: [{ itemId: itemRecetaId, cantidad: '1' }],
  });

  const nc = await leerNC(id);
  const linea = nc.detalles.find((l) => l.itemId === itemRecetaId);
  // Antes de esta tarea la receta caía al balde de ajuste: la nota decía
  // "Ajuste" y no el nombre del plato.
  expect(linea).toBeDefined();

  const movs: unknown[] = await ds.query(
    `SELECT 1 FROM movimientos_inventario
      WHERE venta_id = $1 AND eliminado_el IS NULL`,
    [id],
  );
  expect(movs).toHaveLength(0);
});

it('un producto con reponerStock false se acredita y NO vuelve al stock', async () => {
  const ventaId = await crearVentaMixta();
  const { id } = await emitirNC(ventaId, {
    monto: '2000',
    devoluciones: [{ itemId: itemAfectoId, cantidad: '1', reponerStock: false }],
  });

  const nc = await leerNC(id);
  expect(nc.detalles.some((l) => l.itemId === itemAfectoId)).toBe(true);
  const movs: unknown[] = await ds.query(
    `SELECT 1 FROM movimientos_inventario
      WHERE venta_id = $1 AND eliminado_el IS NULL`,
    [id],
  );
  expect(movs).toHaveLength(0);
});

it('sin el flag, un producto por cantidad sigue reponiendo como antes', async () => {
  const ventaId = await crearVentaMixta();
  const { id } = await emitirNC(ventaId, {
    monto: '2000',
    devoluciones: [{ itemId: itemAfectoId, cantidad: '1' }],
  });
  const movs: { item_id: string }[] = await ds.query(
    `SELECT item_id FROM movimientos_inventario
      WHERE venta_id = $1 AND eliminado_el IS NULL`,
    [id],
  );
  expect(movs).toHaveLength(1);
  expect(movs[0].item_id).toBe(itemAfectoId);
});

it('pedir que un servicio reponga se rechaza', async () => {
  const ventaId = await crearVentaMixta();
  const res = await request(app.getHttpServer())
    .post(`/api/ventas/${ventaId}/notas-credito`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      monto: '3000',
      devoluciones: [{ itemId: itemExentoId, cantidad: '1', reponerStock: true }],
    });
  expect(res.status).toBe(400);
  expect((res.body as { message: string }).message).toContain('no maneja stock');
});
```

⚠️ **`crearVentaConReceta` es un helper nuevo del spec.** Crear la receta por la API con su
ingrediente, como hace `items.e2e-spec.ts` — **abrir ese archivo y copiar el patrón**, no
inventar el payload.

- [x] **Paso 2: correrlos y verlos fallar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion
```

- [x] **Paso 3: el campo en el DTO y en el tipo**

En `create-nota-credito.dto.ts`, dentro de `DevolucionNotaCreditoDto`:

```ts
  /**
   * ¿Vuelve al stock? Ausente = repone **si el ítem puede**, que es la conducta
   * de antes de este campo. Para lo que no puede reponer —servicios, recetas,
   * combos, y los modos `serie`/`lote`— pedirlo explícitamente se rechaza, para
   * no confirmar en silencio algo que no pasó.
   */
  @IsOptional()
  @IsBoolean()
  reponerStock?: boolean;
```

Y en `ventas.service.ts:90`:

```ts
export interface DevolucionReembolso {
  itemId: string;
  cantidad: string;
  reponerStock?: boolean;
}
```

⚠️ `ventas.controller.ts` pasa `devoluciones: dto.devoluciones` entero, así que **no hace falta
tocarlo** — verificarlo antes de darlo por hecho. Sí hay que agregar el campo al evento de
`reembolso-callback.registry.ts:15`, que declara su propia forma.

- [x] **Paso 4: la validación deja de disparar por nombrar el ítem**

En `validarDevolucionesReembolso`, reemplazar los dos `throw` de inventario. Hoy disparan por el
solo hecho de aparecer en la lista; pasan a disparar **solo si se pide reponer**:

```ts
      // Antes de esta tarea estos dos cortes disparaban por nombrar el ítem, y
      // por eso 82 de los 193 ítems vendibles del tenant demo —recetas, combos,
      // servicios— no se podían acreditar por línea: caían al balde de ajuste y
      // la nota decía "Ajuste" en vez del nombre del plato. La razón de los dos
      // cortes es el INVENTARIO, así que ahora disparan solo cuando se pide que
      // el ítem vuelva al stock.
      const puedeReponer = detalle.modo_inventario === 'cantidad';
      const quiereReponer = dev.reponerStock ?? puedeReponer;
      if (quiereReponer && !puedeReponer) {
        // Por el webhook de reembolso NO se puede tirar: la plata ya volvió por
        // el proveedor y el hook corre después del commit, así que un throw se
        // traga como warning y se pierden la nota Y el movimiento de stock
        // (decisión P3). Ahí se ignora el pedido y se acredita igual; el que
        // decide es `rechazarReposicionImposible`, que solo pone el camino
        // manual.
        if (!rechazarReposicionImposible) return { ...linea, reponeStock: false };
        throw new BadRequestException(
          detalle.modo_inventario === null
            ? `"${detalle.descripcion ?? dev.itemId}" no maneja stock (servicio): no admite devolución a inventario`
            : `"${detalle.descripcion ?? dev.itemId}" usa inventario por ${detalle.modo_inventario}: la devolución debe registrarse manualmente desde Inventario`,
        );
      }
```

⚠️ El `return` de arriba es esquemático: `linea` es el objeto que el `map` ya arma más abajo, así
que en el código real el corte va **después** de construirlo, o se resuelve `reponeStock` en una
variable y se usa una sola salida. **Escribir la forma que quede legible, no calcarla de acá** —
lo que no se negocia es que el camino del webhook no tire.

El método gana el parámetro, y los tres llamadores lo pasan explícito:

```ts
  private async validarDevolucionesReembolso(
    manager: EntityManager,
    ventaOriginalId: string,
    devoluciones: DevolucionReembolso[],
    /**
     * ¿Rechazar cuando se pide reponer algo que no puede? `true` en el camino
     * manual, donde el operador está mirando y puede corregir. `false` por el
     * webhook, donde un throw pierde el evento: ahí se acredita igual y no se
     * repone.
     */
    rechazarReposicionImposible: boolean,
  )
```

- `crearNotaCreditoEnTransaccion` → `params.validarVentaElegible === true`.
- `registrarDevolucionesPorReembolso` → **`true`**. Ese camino existe solo para mover stock: una
  devolución que no repone no tiene nada que hacer ahí, y silenciarla dejaría al operador
  creyendo que repuso.


Y en el objeto que devuelve, junto a `valorUnitarioBruto`:

```ts
        // Ya resuelto acá: después de los dos cortes de arriba, `quiereReponer`
        // implica que el ítem puede.
        reponeStock: quiereReponer,
```

Agregarlo también al tipo de retorno del método, con su docblock.

- [x] **Paso 5: el loop de inventario mira el flag**

En `crearNotaCreditoEnTransaccion`, el loop que hoy recorre `devoluciones`:

```ts
      const aReponer = devoluciones.filter((l) => l.reponeStock);
      const costosOriginales = aReponer.length
        ? await this.costosDeSalidaPorItem(manager, params.ventaOriginalId)
        : new Map<string, string | null>();
      for (const linea of aReponer) {
```

⚠️ **`registrarDevolucionesPorReembolso` —el otro llamador— no cambia.** Ese camino solo mueve
stock; una devolución que no repone no tiene nada que hacer ahí. Verificar que sigue pasando sus
devoluciones sin el flag, o sea reponiendo.

- [x] **Paso 6: correr el e2e y verlo pasar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion && ./scripts/reset-db.sh --verificar
```

- [x] **Paso 7: la suite entera, no un subset**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && cd backend && npm run test:e2e && ./scripts/reset-db.sh --verificar
```

Un DTO o un tipo tocado rompe specs lejanos: el subset no lo ve.

- [x] **Paso 8: mutantes**

| Mutante | Test que debe caer |
|---|---|
| `quiereReponer` vuelve a ser siempre `true` | "una receta se acredita por línea" |
| El loop de inventario recorre `devoluciones` en vez de `aReponer` | "reponerStock false … NO vuelve al stock" |
| `dev.reponerStock ?? puedeReponer` → `dev.reponerStock ?? false` | "sin el flag … sigue reponiendo como antes" |

- [x] **Paso 9: revisión independiente y commit**

Lanzar `domain-reviewer` sobre el diff staged, atar el recibo al diff exacto y commitear. El
arreglo que pida la revisión **se vuelve a revisar**.

```bash
git add -A
git diff --cached | git hash-object --stdin > "$(git rev-parse --git-dir)/verify-feature.receipt"
git commit -m "feat(ventas): cualquier ítem vendido se acredita por línea, reponga o no el stock"
```

---

## Tarea 3: acreditar menos de lo que vale la mercadería

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` — el bloque `noEntraEnElDocumento`
- Modify: `backend/test/nota-credito-composicion.e2e-spec.ts`

**Interfaces:**
- Consume: `escalarDevoluciones` (Tarea 1), `reponeStock` (Tarea 2).

⚠️ **INDIVISIBLE.** Sacar el rechazo sin escalar las líneas deja un documento cuyas líneas no
suman su total — que es exactamente lo que el frente anterior vino a arreglar.

- [x] **Paso 1: escribir los e2e que fallan**

```ts
it('acreditar menos de lo que vale la mercadería: las líneas se escalan', async () => {
  const ventaId = await crearVentaMixta();
  // 2 empanadas valen 2.380 en esa boleta; se acreditan 500.
  const { id } = await emitirNC(ventaId, {
    monto: '500',
    devoluciones: [{ itemId: itemAfectoId, cantidad: '2' }],
    comentario: 'Volvieron abiertas',
  });

  const nc = await leerNC(id);
  // Una sola línea, la de la devolución, escalada al monto. Sin ajuste.
  expect(nc.detalles).toHaveLength(1);
  expect(nc.detalles[0].itemId).toBe(itemAfectoId);
  expect(new Decimal(nc.detalles[0].totalLinea).toString()).toBe('500');
  expect(suma(nc.detalles, 'totalLinea')).toBe(
    new Decimal(nc.totalFinal).toString(),
  );
  // La glosa explica por qué la línea vale menos que la mercadería.
  expect(nc.detalles[0].descripcion).toBe('Volvieron abiertas');

  // Y el stock volvió igual, atado a la nota.
  const movs: { cantidad: string }[] = await ds.query(
    `SELECT cantidad FROM movimientos_inventario
      WHERE venta_id = $1 AND eliminado_el IS NULL`,
    [id],
  );
  expect(movs).toHaveLength(1);
  expect(new Decimal(movs[0].cantidad).toString()).toBe('2');
});

it('sin motivo, acreditar menos de lo que vale se rechaza', async () => {
  const ventaId = await crearVentaMixta();
  const res = await request(app.getHttpServer())
    .post(`/api/ventas/${ventaId}/notas-credito`)
    .set('Authorization', `Bearer ${token}`)
    .send({ monto: '500', devoluciones: [{ itemId: itemAfectoId, cantidad: '2' }] });
  expect(res.status).toBe(400);
  expect((res.body as { message: string }).message).toContain('motivo');
});

it('cuando lo devuelto entra en el monto, nada se escala', async () => {
  const ventaId = await crearVentaMixta();
  // 1 empanada vale 1.190 y se acreditan 2.000: la línea va a su valor real y
  // los 810 restantes salen como ajuste. Es la conducta de antes de esta tarea.
  const { id } = await emitirNC(ventaId, {
    monto: '2000',
    devoluciones: [{ itemId: itemAfectoId, cantidad: '1' }],
  });
  const nc = await leerNC(id);
  const devuelta = nc.detalles.find((l) => l.itemId === itemAfectoId)!;
  expect(new Decimal(devuelta.totalLinea).toString()).toBe('1190');
  expect(nc.detalles.length).toBeGreaterThan(1);
});

it('el tope por porción se evalúa sobre las líneas YA escaladas', async () => {
  const ventaId = await crearVentaMixta();
  // Una nota previa por monto libre se lleva 735 de la porción afecta.
  await emitirNC(ventaId, { monto: '1000' });
  // Ahora se devuelven las 7 empanadas (8.330) acreditando solo 500: escalado,
  // eso asigna 500 a la porción afecta, que tiene 7.595 libres. Evaluar el tope
  // sobre los valores CRUDOS rechazaría este caso, que es perfectamente válido.
  const { id } = await emitirNC(ventaId, {
    monto: '500',
    devoluciones: [{ itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA }],
    comentario: 'Cortesía',
  });
  const nc = await leerNC(id);
  expect(suma(nc.detalles, 'totalLinea')).toBe('500');
});

it('la porción agotada sigue rechazándose, diciendo cuánto queda', async () => {
  const ventaId = await crearVentaMixta();
  await emitirNC(ventaId, { monto: '1000' });
  // Devolver las 7 empanadas acreditando su valor entero: 8.330 contra los
  // 7.595 que le quedan a la porción afecta. Sin este corte, la SERIE acredita
  // más IVA del que la venta cobró.
  const res = await request(app.getHttpServer())
    .post(`/api/ventas/${ventaId}/notas-credito`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      monto: '8330',
      devoluciones: [{ itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA }],
    });
  expect(res.status).toBe(400);
  expect((res.body as { message: string }).message).toContain('7595');
});
```

- [x] **Paso 2: correrlos y verlos fallar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion
```

- [x] **Paso 3: escalar antes de mirar la porción**

Reemplazar el bloque que hoy arranca en el comentario `// 3. ¿Entra esta devolución en el
documento?`. El orden es el de la § 4.1 de la spec y **no es libre**:

```ts
      // 3. Las líneas se escalan para sumar, como máximo, el monto de la nota.
      // Acreditar menos de lo que vale la mercadería es un caso real —cargo por
      // reposición, producto que vuelve dañado, un monto acordado— y desde el
      // 2026-09-04 se acepta: ni el SII lo prohíbe (cantidad y precio unitario
      // son condicionales en la Zona Detalle de una NC) ni el mercado lo rechaza
      // (de 11 productos relevados, solo uno).
      const brutosEscalados = escalarDevoluciones(
        devoluciones.map((l) => l.bruto),
        new Decimal(params.monto),
        cfgReparto,
        q,
      );
      const escaladas = devoluciones.map((l, i) => ({
        ...l,
        bruto: brutosEscalados[i],
      }));
      const seEscalo = new Decimal(params.monto).lt(valorDevuelto);

      // El motivo pasa a ser obligatorio: es lo único que va a explicar, en el
      // documento, por qué la línea vale menos que la mercadería. Es el patrón
      // de Square y Toast —donde el monto es libre, el motivo es obligatorio— y
      // reemplaza a la confirmación modal, que ninguno de los 11 productos usa.
      //
      // Guardado con `validarVentaElegible` por lo mismo de siempre: por el
      // webhook un throw pierde el evento. Hoy el handler siempre manda glosa
      // (`NC por reembolso orden X`), así que el guard no cambia nada — está
      // para que un llamador futuro sin glosa no pierda una nota.
      if (seEscalo && !params.comentario?.trim() && params.validarVentaElegible)
        throw new BadRequestException(
          `La mercadería a devolver vale ${valorDevuelto.toString()} y la nota acredita ` +
            `${new Decimal(params.monto).toString()}: indicá el motivo, que queda escrito en el documento.`,
        );

      // 4. Recién ahora la porción, y sobre las líneas YA ESCALADAS: evaluarla
      // sobre los valores crudos rechazaría casos que el escalado deja adentro
      // —devolver 2.380 acreditando 500 asigna 500 a la porción afecta, no
      // 2.380—.
      const devueltoAhora = new Map<string, Decimal>();
      for (const l of escaladas)
        devueltoAhora.set(
          l.clasificacionTributaria,
          (devueltoAhora.get(l.clasificacionTributaria) ?? new Decimal(0)).plus(
            l.bruto,
          ),
        );
```

⚠️ El `devueltoAhora` de hoy se arma **antes** y sobre `devoluciones`: hay que moverlo acá y
cambiarlo a `escaladas`. Dejarlo donde está es el bug que el cuarto e2e caza.

- [x] **Paso 4: el único rechazo que sobrevive**

`acreditablePorPorcion` y `porcionAgotada` quedan como están. Lo que cambia es que
`noEntraEnElDocumento` **deja de mirar el monto**:

```ts
      // El de "vale más que el monto" se fue: ahora se escala. Queda solo el de
      // la porción agotada, y queda porque es INVARIANTE FISCAL y no preferencia
      // de producto: sin él la SERIE de notas acredita más IVA del que la venta
      // cobró —medido: 1.447 contra 1.330— y ese error no se ve en el documento,
      // se ve sumando la serie.
      const noEntraEnElDocumento = porcionAgotada !== undefined;
```

El `if (noEntraEnElDocumento && params.validarVentaElegible)` se queda con **un solo** throw, el
de `porcionAgotada`; el otro se borra. Y las líneas del documento salen de `escaladas`:

```ts
      const devolucionesDelDocumento = noEntraEnElDocumento ? [] : escaladas;
      const ajusteTotal = new Decimal(params.monto).minus(
        devolucionesDelDocumento.reduce((a, l) => a.plus(l.bruto), new Decimal(0)),
      );
```

📌 Esa resta cubre los tres casos sin ramas: escalado → `0`; con lugar → el resto; líneas fuera
del documento → el monto entero.

⚠️ **El loop de inventario NO se toca en esta tarea y NO usa `escaladas`.** Lo que vuelve al
stock son unidades, no plata: escalar el valor de la línea no cambia cuántas empanadas
volvieron. Sigue recorriendo `aReponer`, derivado de `devoluciones` (Tarea 2, paso 5).

- [x] **Paso 5: correr el e2e y verlo pasar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion && ./scripts/reset-db.sh --verificar
```

- [x] **Paso 6: la suite entera**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && cd backend && npm run test:e2e && ./scripts/reset-db.sh --verificar
```

⚠️ **Hay e2e y unitarios que hoy afirman el rechazo que esta tarea saca.** No relajarlos: hay que
**reescribirlos** al contrato nuevo, que es lo que este plan viene a hacer. Los que se sabe que
tocan: el caso *"devolver mercadería que vale más que la nota se rechaza"* y el unitario del
webhook.

- [x] **Paso 7: mutantes**

| Mutante | Test que debe caer |
|---|---|
| `escaladas` vuelve a ser `devoluciones` en el documento | "las líneas se escalan" |
| El motivo deja de ser obligatorio | "sin motivo … se rechaza" |
| `devueltoAhora` se arma sobre `devoluciones` en vez de `escaladas` | "el tope se evalúa sobre las líneas YA escaladas" |
| `noEntraEnElDocumento` vuelve a mirar el monto | "las líneas se escalan" |

⚠️ Después de revertir un mutante, **verificar la hora del restart en los logs del backend**: el
fuente limpio no prueba que el proceso lo esté.

- [x] **Paso 8: revisión independiente y commit**

```bash
git add -A
git diff --cached | git hash-object --stdin > "$(git rev-parse --git-dir)/verify-feature.receipt"
git commit -m "feat(ventas): acreditar menos de lo que vale la mercadería deja de rechazarse"
```

---

## Tarea 4: el disponible por porción sale del backend

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` — `findOne`
- Test: `backend/test/nota-credito-composicion.e2e-spec.ts`

**Interfaces:**
- Produce: `disponibleNotaCredito: { total: string; porPorcion: { clasificacion: string; monto: string }[] }`
  en la respuesta de `GET /ventas/:id`, que consume la Tarea 5.

Es lo que hace que el rechazo de la Tarea 3 casi nunca dispare: el operador ve el número **antes**
de tipear. **El backend calcula, el frontend muestra** — no es duplicar lógica de plata, es el
servidor diciendo el número.

- [x] **Paso 1: escribir el e2e que falla**

```ts
it('el detalle de la venta trae el disponible por porción fiscal', async () => {
  const ventaId = await crearVentaMixta();
  await emitirNC(ventaId, { monto: '1000' }); // 735 afecto / 265 exento

  const res = await request(app.getHttpServer())
    .get(`/api/ventas/${ventaId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const d = (res.body as { disponibleNotaCredito: {
    total: string;
    porPorcion: { clasificacion: string; monto: string }[];
  } }).disponibleNotaCredito;

  expect(new Decimal(d.total).toString()).toBe('10330');
  const porClas = new Map(d.porPorcion.map((p) => [p.clasificacion, p.monto]));
  expect(new Decimal(porClas.get('afecto')!).toString()).toBe('7595');
  expect(new Decimal(porClas.get('exento')!).toString()).toBe('2735');
  // Y las porciones suman el total: es lo que el modal va a mostrar al lado.
  const suma = d.porPorcion.reduce((a, p) => a.plus(p.monto), new Decimal(0));
  expect(suma.toString()).toBe(new Decimal(d.total).toString());
});
```

- [x] **Paso 2: correrlo y verlo fallar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion
```

- [x] **Paso 3: la consulta**

En `findOne`, junto a las otras lecturas. **Una sola query agregada**, con el mismo criterio que
la consulta de `notasCredito` que ya está ahí:

```ts
    // El remanente acreditable por porción fiscal. Mismo criterio que la
    // composición que usa `crearNotaCreditoEnTransaccion`, y por eso el modal
    // muestra exactamente el número que el backend después va a exigir.
    //
    // Filtra por `venta_referencia_id` sin mirar el tipo de documento porque
    // **esa columna la escribe un solo lugar**: la creación de la nota de
    // crédito (medido el 2026-09-04, `ventas.service.ts` es su único escritor).
    // Es el mismo criterio de la consulta de `notasCredito` de más arriba.
    const disponiblePorPorcion: { clasificacion: string; monto: string }[] =
      await this.db.query(
        `SELECT d.clasificacion_tributaria AS clasificacion,
                COALESCE(SUM(
                  CASE WHEN d.venta_id = $1 THEN d.total_linea ELSE -d.total_linea END
                ), 0)::text AS monto
           FROM venta_detalles d
          WHERE d.eliminado_el IS NULL
            AND (d.venta_id = $1
                 OR d.venta_id IN (SELECT venta_id FROM ventas
                                    WHERE venta_referencia_id = $1
                                      AND tenant_id = $2
                                      AND eliminado_el IS NULL))
          GROUP BY 1
          ORDER BY 1`,
        [ventaId, tenantId],
      );
```

- [x] **Paso 4: exponerlo en la respuesta**

Junto a `baseVentasSinImpuestos` en el objeto que arma `findOne`:

```ts
      /**
       * Cuánto se puede acreditar todavía por nota de crédito, en total y por
       * porción fiscal. Lo calcula el backend a propósito: el navegador no
       * replica la cuantización del motor —se intentó el 2026-09-04 y bloqueaba
       * notas que el backend acepta—.
       *
       * `porPorcion` es una LISTA y no dos campos fijos: hoy las clasificaciones
       * son `afecto` y `exento`, pero el resto del modelo ya las trata como dato
       * (`clasificacion_tributaria` es `text`, no un enum) y ADR-010 anticipa
       * países con más baldes.
       */
      disponibleNotaCredito: {
        total: Decimal.max(
          0,
          new Decimal(v.total_final).minus(
            notasCredito.reduce(
              (a, n) => a.plus(n['total_final'] as string),
              new Decimal(0),
            ),
          ),
        ).toFixed(4),
        porPorcion: disponiblePorPorcion.map((p) => ({
          clasificacion: p.clasificacion,
          monto: Decimal.max(0, new Decimal(p.monto)).toFixed(4),
        })),
      },
```

⚠️ **`total` sale de `total_final` menos las notas previas, no de la suma de las porciones.** Son
el mismo número mientras las líneas de toda nota sumen su total —que es lo que el frente anterior
garantizó— pero el tope que el backend **exige** es el primero, y el modal tiene que mostrar el
que se va a aplicar.

- [x] **Paso 5: correr el e2e y la suite**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion && ./scripts/reset-db.sh --verificar
cd backend && npm run lint:check && npm run typecheck && npm test
```

- [x] **Paso 6: mutante**

| Mutante | Test que debe caer |
|---|---|
| El `CASE WHEN` suma en vez de restar las notas previas | "el disponible por porción" (daría 9.065 / 3.265) |

- [x] **Paso 7: commit**

```bash
git add -A backend
git commit -m "feat(ventas): el detalle de la venta dice cuánto queda por acreditar, por porción"
```

---

## Tarea 5: la pantalla

**Files:**
- Modify: `frontend/app/composables/useDevolucionInventario.ts`
- Modify: `frontend/app/composables/useDevolucionInventario.spec.ts`
- Modify: `frontend/app/components/ventas/NotaCreditoModal.vue`
- Modify: `frontend/app/components/ventas/VentaDetalleDrawer.vue`

**Interfaces:**
- Consume: `disponibleNotaCredito` (Tarea 4); `reponerStock` en el payload (Tarea 2).

- [x] **Paso 1: el flag por fila en el composable**

`FilaDevolucion` gana `reponerStock: boolean` y `puedeReponer: boolean`, y
`agruparFilasDevolucion` los completa desde `modoInventario`:

```ts
      puedeReponer: d.modoInventario === 'cantidad',
      reponerStock: d.modoInventario === 'cantidad',
```

Y `devolucionesPayload` los manda:

```ts
    .map(f => ({ itemId: f.itemId, cantidad: f.cantidad, reponerStock: f.reponerStock }))
```

⚠️ **`filaDevolvible` deja de significar lo que significaba.** Hoy decide si la fila se puede
tocar; ahora **toda** fila de un ítem vendido se puede acreditar, y lo que `modoInventario`
decide es solo si el switch de reponer está disponible. Revisar sus dos llamadores antes de
cambiarla, y `notaDevolucion` con ella: sus textos pasan de *"no se puede devolver"* a *"no
vuelve al stock"*.

⚠️ **`ReembolsoModal.vue` usa el mismo composable.** Ese camino solo mueve stock, así que ahí las
filas que no pueden reponer **no deben ofrecerse**. Verificarlo antes de cambiar el composable, y
si hace falta, que el modal filtre en vez de que el composable cambie de contrato.

- [x] **Paso 2: los tests del composable**

Con fixtures que discriminen —`modoInventario` distinto por fila— y afirmando que el payload
lleva el flag:

```ts
it('el payload lleva la reposición de cada fila', () => {
  const filas = [
    fila('a', { cantidad: '2', reponerStock: true }),
    fila('b', { cantidad: '1', reponerStock: false }),
  ]
  expect(devolucionesPayload(filas)).toEqual([
    { itemId: 'a', cantidad: '2', reponerStock: true },
    { itemId: 'b', cantidad: '1', reponerStock: false },
  ])
})
```

- [x] **Paso 3: el modal**

Tres cosas, con tokens semánticos de Nuxt UI (nunca Tailwind hardcodeado):

1. **El disponible por porción**, debajo del total, leído de `disponibleNotaCredito.porPorcion`.
   Se muestra solo si hay más de una porción: en una venta toda afecta repetir el total es ruido.
2. **Un switch de reponer por fila**, deshabilitado con su nota cuando `puedeReponer` es `false`.
3. **El motivo pedido** cuando lo devuelto alcanza o supera el monto.

⚠️ **El motivo se PIDE, nunca se bloquea el botón.** La cuenta del navegador es aproximada —no
cuantiza— así que se usa `≥` y no `>`: pedir el motivo un peso antes de tiempo no molesta;
comerse un 400 que no se anticipó, sí. **El único guard es el del backend.**

- [x] **Paso 4: el drawer usa el número del backend**

`disponibleNC` (`VentaDetalleDrawer.vue:224`) hoy resta las notas previas en el navegador. Pasa a
leer `venta.disponibleNotaCredito.total`, con el `computed` reducido a eso. **Un número menos
calculado en dos lados.**

- [x] **Paso 5: spec de pantalla**

En `VentaDetalleDrawer.nuxt.spec.ts`, agregar el fixture de `disponibleNotaCredito` y un caso que
afirme que el modal recibe el total del backend. ⚠️ **Verificar que el body que afirma el mock
pasaría el DTO del backend**, o el test congela un caso imposible.

- [x] **Paso 6: el gate del frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

- [x] **Paso 7: mirarlo en el navegador**

Con `docker-compose up` y la base **reseteada antes**: crear una venta mixta, abrir el modal y
mirar el disponible por porción, el switch de reponer en un producto y en una receta, y el motivo
apareciendo al bajar el monto. **Por chrome-devtools** (la ventana real de Chrome), no por el
navegador embebido.

- [x] **Paso 8: revisión independiente y commit**

```bash
git add -A
git diff --cached | git hash-object --stdin > "$(git rev-parse --git-dir)/verify-feature.receipt"
git commit -m "feat(ventas): el modal de nota de crédito elige qué vuelve al stock"
```

---

## Tarea 6: el cierre

**Files:**
- Modify: `docs/features/reembolsos-nota-credito.md`, `docs/ESTADO.md`,
  `docs/agent/pendientes.md`, `docs/agent/resueltos.md`,
  `docs/superpowers/specs/2026-09-04-nota-credito-descompone-su-monto-design.md`,
  `docs/adr/010-preparacion-sii-datos-fiscales.md`

- [x] **Paso 1: la documentación de la feature**

Reescribir —no anexar— la sección de la nota de crédito en
`docs/features/reembolsos-nota-credito.md`: qué se acredita por línea, la reposición elegible, el
escalado con su motivo obligatorio, y el único rechazo que queda. **Sacar el banner de "REGLA YA
DECIDIDA, TODAVÍA NO CONSTRUIDA"**, que deja de ser cierto.

- [x] **Paso 2: los otros dos banners**

`docs/superpowers/specs/2026-09-04-nota-credito-descompone-su-monto-design.md` § 6.1 y
`docs/adr/010-preparacion-sii-datos-fiscales.md`: el rechazo que describen ya no existe. Que
apunten a este frente en vez de anunciar una decisión pendiente.

- [x] **Paso 3: cerrar la entrada del backlog**

Mover la de `pendientes.md` § 3 a `resueltos.md` con el detalle y los commits. **Listar todos los
consumidores antes de redactar el cierre**: declarar cerrado lo que sigue vivo manda al próximo a
no buscarlo.

- [x] **Paso 4: `ESTADO.md`**

Actualizar la fila de la nota de crédito compuesta: ahora acredita cualquier ítem por línea.

- [x] **Paso 5: commit y push**

```bash
git add -A
git diff --cached | git hash-object --stdin > "$(git rev-parse --git-dir)/verify-feature.receipt"
git commit -m "feat(ventas): la devolución se acredita por línea, y cierra el frente"
git push
```

Después del push: **revisar el CI y además el deployment de Railway** — un push a `main`
despliega.
