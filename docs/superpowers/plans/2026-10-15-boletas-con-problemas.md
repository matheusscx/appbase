# Boletas con problemas en el SII — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el admin, el cajero y soporte vean las boletas que el SII rechazó, que llevan más de una
hora sin llegar o que volvieron con reparos, y que la cola deje de mentir con `RLV`/`DOK` y con el
sobre que una boleta mala hace rechazar entero.

**Architecture:** dos arreglos en la cola del módulo `dte` (leer los cuatro estados por boleta del
OpenAPI; validar el sobre contra el XSD en el job antes de mandarlo y aislar la boleta mala), un
módulo puro con la definición de cada grupo y el motivo en palabras del local, y tres lecturas:
la lista del admin (`GET /dte/boletas-con-problemas`, en `venta-documentos` porque cruza con la
venta), el conteo de la franja del cajero (dentro de `GET /dte/estado-emision`) y el panel de
soporte (`GET /admin/dte/boletas-con-problemas`, superadmin, en `dte`).

**Tech Stack:** NestJS + SQL crudo vía `Db` (TypeORM solo para entities y migraciones),
`xmllint-wasm` 5.3.0, Jest (unitarios y e2e con supertest contra Postgres), Nuxt 4 + Nuxt UI
(Vitest `*.nuxt.spec.ts`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-boletas-con-problemas-design.md`. Investigación de la que
sale: `docs/agent/investigaciones/2026-10-15-boleta-rechazada-o-atrasada.md`.

## Global Constraints

- Todo sobre `main`, sin ramas ni PRs. **El implementador NO commitea**: stagea por ruta explícita
  (`git add <ruta>`, nunca `-A` ni `.`, nunca `.claude/settings.local.json`) y reporta; el
  controlador corre la revisión independiente, escribe el recibo y commitea.
- Nunca `--no-verify`. El repo es público: ningún secreto, y nunca el literal de una cabecera PEM
  de llave privada en un archivo.
- `tenant_id` sale siempre del token (`req.user.tenantId`). La ruta de soporte no recibe tenant de
  ningún lado.
- Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`, salvo excepción escrita en la consulta.
- Sin N+1: cada lectura es un número fijo de consultas, nunca una por fila.
- Dinero como string (Decimal), nunca `number`.
- Cambio de entity → `npm run migration:generate -- <Nombre>`, **leer** la migración, y actualizar
  `startup-pos.sql` en la misma tarea.
- **No tocar un `.ts` del backend con un e2e corriendo** (el watcher re-siembra). Antes de cada
  `test:e2e`: `./scripts/reset-db.sh`. Después: `./scripts/reset-db.sh --verificar`.
- Los e2e se corren **en primer plano**, nunca en background.
- `xmllint-wasm` va con la versión fija **5.3.0**, en `dependencies` (no `devDependencies`).
- Textos al local en español de Chile, con tuteo: "escribe", "avisa", "revisa".
- La franja usa el sufijo existente `: avisa al encargado`.
- Frontend: `useApiFetch`, tokens semánticos de Nuxt UI (sin colores Tailwind hardcodeados), sin
  lógica de negocio en páginas.
- Antes de escribir código de frontend, cargar la skill `nuxt-ui`; de backend, `nestjs-best-practices`.

## Review Focus

1. **El esquema no viaja al build de producción.** `Dockerfile.prod` copia solo `dist/`, y
   `nest-cli.json` no tiene `assets`: sin el `assets` de la Task 2, el job de producción revienta
   al leer el XSD. La Task 2 lo verifica con `npm run build` y un `ls`.
2. **`npm ci --omit=dev` en producción**: si `xmllint-wasm` queda en `devDependencies`, el `import`
   del job falla al arrancar. La Task 2 lo mueve y lo verifica en el lockfile.
3. **Una boleta con un `DOK` explícito y otra entrada que no entendemos en el mismo sobre**: el `DOK`
   es una aceptación explícita de ESA boleta, no silencio; debe quedar `aceptado`. Las boletas sin
   entrada propia siguen sin aceptarse. Test en la Task 1.
4. **El sobre que falla por la carátula** (ninguna boleta falla sola): no puede volver a la cola
   (repetiría para siempre). Test en la Task 3.
5. **El cajero con la emisión apagada**: `estado-emision` sigue siendo UNA consulta y devuelve
   `conProblemas: 0`. Test en la Task 5.

---

## File Structure

| Archivo | Qué hace | Task |
|---|---|---|
| `backend/src/modules/dte/resultado-sii.ts` | Reparto del resultado del SII: suma `DOK` y `RLV` | 1 |
| `backend/src/modules/dte/esquema-sii.ts` (nuevo) | Validar contra el XSD y aislar los `<DTE>` inválidos de un sobre | 2 |
| `backend/src/modules/dte/__fixtures__/xsd.ts` (se borra) | Su función pasa a `esquema-sii.ts` | 2 |
| `backend/package.json`, `package-lock.json`, `nest-cli.json` | `xmllint-wasm` a producción; los XSD al `dist` | 2 |
| `backend/src/modules/dte/jobs/enviar-boletas.job.ts` | Validar antes de enviar; rechazar la mala, devolver las buenas | 3 |
| `backend/src/modules/dte/problemas-sii.ts` (nuevo) | Condiciones SQL de cada grupo y el motivo en palabras del local | 4 |
| `backend/src/modules/dte/entities/dte-documento.entity.ts`, `venta-documentos/entities/venta-documento.entity.ts`, migración nueva, `startup-pos.sql` | Dos índices parciales | 4 |
| `backend/src/modules/venta-documentos/emision-boleta.service.ts` y `.controller.ts` | Lista del admin y `conProblemas` del cajero | 5 |
| `backend/src/modules/dte/cola-dte.service.ts`, `soporte-dte.controller.ts` (nuevo), `dte.module.ts` | Panel de soporte | 6 |
| `frontend/app/pages/configuracion/boleta-electronica.vue`, `components/ventas/FranjaEmision.vue` | Tarjeta del admin y aviso del cajero | 7 |
| `frontend/app/pages/admin.vue` | Panel de soporte | 8 |
| Docs | `emision-electronica.md`, `ESTADO.md`, `desarrollo-nuevo.md` | 9 |

---

### Task 1: Leer `DOK` y `RLV` por boleta

**Files:**
- Modify: `backend/src/modules/dte/resultado-sii.ts` (`cambioDe`, `observar`, el docblock de `repartirResultado`)
- Test: `backend/src/modules/dte/resultado-sii.spec.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `repartirResultado(estado, boletas)` con la misma firma; ahora `DOK` → `aceptado` y
  `RLV` → `reparos`.

El OpenAPI de boletas (v1.0.5, `ResultadoEnvioDataRespuesta_detalle_rep_rech.estado`) define
`DOK` (aceptado), `RPR` (reparos), `RLV` (reparos leves) y `RCH` (rechazado). **Regla:** por boleta
manda la peor entrada, `RCH` > `RPR`/`RLV` > `DOK`. Un `DOK` propio acepta la boleta **aunque haya
observaciones en otras entradas** (es una aceptación explícita, no silencio). Sin entrada propia
y con observaciones, sigue sin cambio (regla del owner del 2026-10-14, intacta).

- [ ] **Step 1: tests que fallan.** Agregar a `resultado-sii.spec.ts`, dentro de
  `describe('EPR y RPR: cada boleta según detalle_rep_rech')`, usando las constantes del archivo:

```ts
it('RLV deja la boleta con reparos y su entrada en detalleSii', () => {
  const leve = { tipo: 39, folio: 2053, estado: 'RLV', descripcion: 'Dte Aceptado con reparos leves', error: [error(650, 'Fecha atrasada')] };
  const r = repartirResultado({ estado: 'EPR', detalle_rep_rech: [leve] }, [B2041, B2053]);
  expect(r.observaciones).toEqual([]);
  expect(r.cambios).toEqual([
    { documentoId: 'doc-2041', estado: 'aceptado', detalleSii: null },
    { documentoId: 'doc-2053', estado: 'reparos', detalleSii: leve },
  ]);
});

it('DOK deja la boleta aceptada, sin detalle, y no es una observación', () => {
  const ok = { tipo: 39, folio: 2041, estado: 'DOK', descripcion: 'Dte Aceptado' };
  const r = repartirResultado({ estado: 'EPR', detalle_rep_rech: [ok] }, [B2041, B2053]);
  expect(r.observaciones).toEqual([]);
  expect(r.cambios).toEqual([
    { documentoId: 'doc-2041', estado: 'aceptado', detalleSii: null },
    { documentoId: 'doc-2053', estado: 'aceptado', detalleSii: null },
  ]);
});

it('con varias entradas manda la peor: RCH sobre RLV, RLV sobre DOK', () => {
  const r = repartirResultado({ estado: 'EPR', detalle_rep_rech: [
    { tipo: 39, folio: 2041, estado: 'DOK' },
    { tipo: 39, folio: 2041, estado: 'RLV' },
    { tipo: 39, folio: 2053, estado: 'RLV' },
    { tipo: 39, folio: 2053, estado: 'RCH' },
  ] }, [B2041, B2053]);
  expect(r.cambios.map((c) => [c.documentoId, c.estado])).toEqual([
    ['doc-2041', 'reparos'],
    ['doc-2053', 'rechazado'],
  ]);
});

it('un DOK propio acepta aunque otra entrada traiga un código desconocido; la boleta sin entrada no', () => {
  const r = repartirResultado({ estado: 'EPR', detalle_rep_rech: [
    { tipo: 39, folio: 2041, estado: 'DOK' },
    { tipo: 39, folio: 2053, estado: 'XYZ' },
  ] }, [B2041, B2053, B2077]);
  expect(r.cambios).toEqual([
    { documentoId: 'doc-2041', estado: 'aceptado', detalleSii: null },
  ]);
  expect(r.observaciones).toHaveLength(1);
  expect(r.observaciones[0]).toContain('XYZ');
});
```

- [ ] **Step 2: correr y ver que fallan.**
  Run: `cd backend && npx jest src/modules/dte/resultado-sii.spec.ts`
  Expected: FAIL en los cuatro nuevos (hoy `RLV`/`DOK` salen como observación y la boleta queda sin cambio).

- [ ] **Step 3: implementar.** En `resultado-sii.ts`:

```ts
/** Los estados por boleta del OpenAPI de boletas (v1.0.5, `detalle_rep_rech.estado`). */
const ESTADOS_POR_BOLETA: readonly string[] = ['DOK', 'RPR', 'RLV', 'RCH'];
```

  En `observar`, reemplazar `if (e.estado !== 'RCH' && e.estado !== 'RPR')` por
  `if (!ESTADOS_POR_BOLETA.includes(String(e.estado)))`. En `cambioDe`:

```ts
const rechazo = suyas.find((e) => e.estado === 'RCH');
const reparo = suyas.find((e) => e.estado === 'RPR' || e.estado === 'RLV');
const entrada = rechazo ?? reparo;
if (entrada)
  return { documentoId: boleta.documentoId, estado: rechazo ? 'rechazado' : 'reparos', detalleSii: entrada };
// Un `DOK` propio es el SII aceptándola por su nombre: no es silencio, y vale aunque otra entrada
// del sobre no se haya entendido.
if (suyas.some((e) => e.estado === 'DOK'))
  return { documentoId: boleta.documentoId, estado: 'aceptado', detalleSii: null };
if (suyas.length > 0 || hayObservaciones) return null;
return { documentoId: boleta.documentoId, estado: 'aceptado', detalleSii: null };
```

  Actualizar el docblock de `repartirResultado`, el de `ResultadoReparto.observaciones` y el
  comentario de `cambioDe` para que nombren los cuatro estados (hoy dicen "`RCH` ni `RPR`").

- [ ] **Step 4: correr.** `cd backend && npx jest src/modules/dte/resultado-sii.spec.ts` → PASS (todos,
  los viejos también). Después `npm run lint:check && npm run typecheck`.

- [ ] **Step 5: stagear** `backend/src/modules/dte/resultado-sii.ts` y su spec. No commitear.

---

### Task 2: El validador del esquema, en producción

**Files:**
- Create: `backend/src/modules/dte/esquema-sii.ts`, `backend/src/modules/dte/esquema-sii.spec.ts`
- Delete: `backend/src/modules/dte/__fixtures__/xsd.ts`
- Modify: los cuatro specs que lo importan (`firma-sii.spec.ts`, `ted.spec.ts`,
  `envio-boleta.spec.ts`, `boleta-documento.spec.ts`): `import { validarContraXsd } from './esquema-sii'`
- Modify: `backend/package.json` + `backend/package-lock.json`, `backend/nest-cli.json`

**Interfaces:**
- Produces:

```ts
export async function validarContraXsd(xml: string, xsdPrincipal: string, xsdDependencias: string[]): Promise<{ valido: boolean; errores: string[] }>;
export interface DteInvalido { tipo: number; folio: number; errores: string[] }
export type RevisionSobre = { valido: true } | { valido: false; errores: string[]; invalidos: DteInvalido[] };
/** Valida un `EnvioBOLETA` contra `EnvioBOLETA_v11_formato42.xsd`; si falla, valida cada `<DTE>` solo. */
export async function revisarSobreBoleta(sobre: string): Promise<RevisionSobre>;
```

- [ ] **Step 1: mover la función.** Crear `esquema-sii.ts` con el contenido de `__fixtures__/xsd.ts`
  (`comoUtf8`, `leer`, `validarContraXsd`, con sus comentarios), con dos cambios: `DIR =
  join(__dirname, 'esquemas')`, y el docblock deja de decir "Solo para pruebas". `leer` memoiza cada
  XSD leído en un `Map<string, {fileName, contents}>` (se lee del disco una vez por proceso). Borrar
  el fixture y cambiar los cuatro imports. Correr
  `cd backend && npx jest src/modules/dte` → PASS (nada cambió de conducta).

- [ ] **Step 2: tests que fallan de `revisarSobreBoleta`** en `esquema-sii.spec.ts`. Armar un sobre real
  como lo hace `envio-boleta.spec.ts` (copiar su forma de llamar a `emitirBoleta` y
  `armarEnvioBoleta` con `cafDePrueba`/`certificadoDePrueba` de `__fixtures__/credenciales-prueba`,
  dos boletas 39 con folios 101 y 102):

```ts
it('un sobre que cumple el esquema pasa sin mirar cada boleta', async () => {
  expect(await revisarSobreBoleta(sobre)).toEqual({ valido: true });
});

it('una boleta con un elemento que el esquema no conoce: falla el sobre y se aísla esa sola', async () => {
  const roto = sobre.replace('<Folio>102</Folio>', '<Folio>102</Folio><Basura>1</Basura>');
  const r = await revisarSobreBoleta(roto);
  expect(r.valido).toBe(false);
  if (r.valido) return;
  expect(r.invalidos.map((d) => [d.tipo, d.folio])).toEqual([[39, 102]]);
  expect(r.invalidos[0].errores.join(' ')).toContain('Basura');
});

it('un error en la carátula: falla el sobre y ninguna boleta falla sola', async () => {
  const roto = sobre.replace('<RutEnvia>', '<Basura>1</Basura><RutEnvia>');
  const r = await revisarSobreBoleta(roto);
  expect(r).toMatchObject({ valido: false, invalidos: [] });
  if (!r.valido) expect(r.errores.length).toBeGreaterThan(0);
});

it('recorta los errores: a lo más 5 por boleta, de a lo más 300 caracteres', async () => {
  const roto = sobre.replace('<Folio>102</Folio>', '<Folio>102</Folio>' + '<B/>'.repeat(10));
  const r = await revisarSobreBoleta(roto);
  if (r.valido) throw new Error('debía fallar');
  expect(r.invalidos[0].errores.length).toBeLessThanOrEqual(5);
  expect(r.invalidos[0].errores.every((e) => e.length <= 300)).toBe(true);
});
```

  Si `<Folio>102</Folio>` no aparece literal en el sobre (por ejemplo, otro espaciado), buscar el
  texto real con un `console.log` temporal y ajustar el reemplazo: el test debe romper **una** boleta
  dejando el XML bien formado.

- [ ] **Step 3: correr y ver que fallan** (`revisarSobreBoleta` no existe).
  Run: `cd backend && npx jest src/modules/dte/esquema-sii.spec.ts`

- [ ] **Step 4: implementar** en `esquema-sii.ts`:

```ts
const XSD_SOBRE = 'EnvioBOLETA_v11_formato42.xsd';
const XSD_DEPENDENCIAS = ['xmldsignature_v10.xsd'];
const MAX_ERRORES = 5;
const MAX_LARGO_ERROR = 300;

const recortar = (errores: string[]) =>
  errores.slice(0, MAX_ERRORES).map((e) => e.slice(0, MAX_LARGO_ERROR));

/**
 * El sobre real se valida una vez. Si falla, cada `<DTE>` se valida envuelto en el mismo sobre
 * (su carátula y su firma: el XSD mira la forma de la firma, no la verifica) para saber cuál es el
 * malo. Si ninguno falla solo, el error es del sobre mismo (`invalidos` vacío).
 */
export async function revisarSobreBoleta(sobre: string): Promise<RevisionSobre> {
  const todo = await validarContraXsd(sobre, XSD_SOBRE, XSD_DEPENDENCIAS);
  if (todo.valido) return { valido: true };
  const bloques = [...sobre.matchAll(/<DTE\b[\s\S]*?<\/DTE>/g)];
  const invalidos: DteInvalido[] = [];
  if (bloques.length > 0) {
    const primero = bloques[0];
    const ultimo = bloques[bloques.length - 1];
    const antes = sobre.slice(0, primero.index);
    const despues = sobre.slice(ultimo.index + ultimo[0].length);
    for (const b of bloques) {
      const solo = await validarContraXsd(antes + b[0] + despues, XSD_SOBRE, XSD_DEPENDENCIAS);
      if (solo.valido) continue;
      invalidos.push({
        tipo: Number(/<TipoDTE>(\d+)<\/TipoDTE>/.exec(b[0])?.[1]),
        folio: Number(/<Folio>(\d+)<\/Folio>/.exec(b[0])?.[1]),
        errores: recortar(solo.errores),
      });
    }
  }
  return { valido: false, errores: recortar(todo.errores), invalidos };
}
```

- [ ] **Step 5: correr.** `cd backend && npx jest src/modules/dte` → PASS.

- [ ] **Step 6: dependencia y build.**
  - `cd backend && npm uninstall xmllint-wasm && npm install --save-exact xmllint-wasm@5.3.0`. Leer el
    diff: `package.json` debe tener `"xmllint-wasm": "5.3.0"` en `dependencies` y no en
    `devDependencies`; en `package-lock.json` solo debe desaparecer el `"dev": true` de ese paquete
    (y nada más). Si el lock cambia otras cosas, revertir y reportar `BLOCKED`.
  - `nest-cli.json`, dentro de `compilerOptions`:
    `"assets": [{ "include": "modules/dte/esquemas/*.xsd", "watchAssets": false }]`.
  - Verificar: `cd backend && npm run build && ls dist/modules/dte/esquemas/` → los seis `.xsd`.
    Y `node -e "require('./dist/modules/dte/esquema-sii').validarContraXsd('<a/>','EnvioBOLETA_v11_formato42.xsd',['xmldsignature_v10.xsd']).then(r=>console.log(r.valido))"`
    → imprime `false` (compiló el esquema desde `dist`, sin excepción).

- [ ] **Step 7:** `npm run lint:check && npm run typecheck && npm test` (entero). Stagear por ruta los
  archivos de la tarea (incluido el borrado del fixture: `git add backend/src/modules/dte/__fixtures__/xsd.ts`).

---

### Task 3: El job valida antes de enviar

**Files:**
- Modify: `backend/src/modules/dte/jobs/enviar-boletas.job.ts`
- Test: `backend/src/modules/dte/jobs/enviar-boletas.job.spec.ts`, `backend/test/dte-cola.e2e-spec.ts`

**Interfaces:**
- Consumes: `revisarSobreBoleta(sobre)` y `RevisionSobre` de `../esquema-sii` (Task 2).
- Produces: nada que otra tarea use.

**Conducta** (spec § 4), en `procesar`, **después** del `try` que arma el sobre y **antes** de
`cliente.enviar`:

1. `const revision = await revisarSobreBoleta(sobre)`. Si `revision.valido`, sigue como hoy.
2. Si no: las filas cuyo `(tipo, folio)` está en `revision.invalidos` pasan a `rechazado` con
   `detalle_sii = { origen: 'esquema', errores }` (los de esa boleta) y `envio_id = NULL`; las demás
   vuelven a `pendiente` con `envio_id = NULL`, `proximo_intento_el = now()`, **sin** sumar
   `intentos` ni tocar `ultimo_error`; el envío se da de baja con `DAR_DE_BAJA_ENVIO` y el mensaje
   `'Una boleta no cumple el esquema del SII; el sobre no se envió'`. Todo en **una** transacción.
3. Si `revision.invalidos` está vacío (falla el sobre, ninguna sola): **todas** pasan a `rechazado`
   con `detalle_sii = { origen: 'esquema', errores: revision.errores }`, mismo mensaje en el envío.
4. El cliente del SII **no** se llama. `resumen.rechazados += <rechazadas>`, `resumen.devueltos += <devueltas>`.
5. `ultimo_error` de cada rechazada: `'La boleta no cumple el esquema del SII; no se envió'`.

SQL nuevo (junto a los otros, con comentario de por qué `envio_id = NULL`: el sobre no existió para
el SII y se da de baja):

```ts
const RECHAZAR_POR_ESQUEMA = `
  UPDATE dte_documentos d
     SET estado = 'rechazado', envio_id = NULL, detalle_sii = x.detalle, ultimo_error = $3,
         actualizado_el = now()
    FROM unnest($2::uuid[], $4::jsonb[]) AS x(id, detalle)
   WHERE d.documento_id = x.id AND d.envio_id = $1 AND d.eliminado_el IS NULL`;

const DEVOLVER_SIN_ESPERA = `
  UPDATE dte_documentos
     SET estado = 'pendiente', envio_id = NULL, proximo_intento_el = now(), actualizado_el = now()
   WHERE documento_id = ANY($2) AND envio_id = $1 AND eliminado_el IS NULL`;
```

Orden dentro de la transacción: `RECHAZAR_POR_ESQUEMA`, `DEVOLVER_SIN_ESPERA`, `DAR_DE_BAJA_ENVIO`
(los dos primeros necesitan `envio_id = $1` todavía). Un error de `revisarSobreBoleta` que no sea
un resultado (el wasm se cae) **se propaga**: es de programación, el runner lo anota y la reserva
vence sola, como cualquier otro.

- [ ] **Step 1: tests unitarios que fallan.** En `enviar-boletas.job.spec.ts`, agregar al principio:

```ts
const revisar = jest.fn();
jest.mock('../esquema-sii', () => ({ revisarSobreBoleta: (...a: unknown[]) => revisar(...a) }));
```

  y en el `beforeEach`: `revisar.mockResolvedValue({ valido: true })` (todos los tests existentes
  siguen igual). Tests nuevos:

```ts
it('una boleta que no cumple el esquema queda rechazada sola; las otras vuelven sin espera y el SII no se llama', async () => {
  revisar.mockResolvedValue({ valido: false, errores: ['sobre'], invalidos: [{ tipo: 39, folio: 4002, errores: ['Basura'] }] });
  await job.enviarLotes();
  expect(enviar).not.toHaveBeenCalled();
  const [rech] = con('unnest($2::uuid[], $4::jsonb[])');
  expect(rech.params[1]).toEqual(['doc-2']);
  expect((rech.params[3] as string[]).map((j) => JSON.parse(j))).toEqual([{ origen: 'esquema', errores: ['Basura'] }]);
  const [dev] = con("proximo_intento_el = now(), actualizado_el");
  expect(dev.params[1]).toEqual(['doc-1', 'doc-3']);
  expect(con('eliminado_el = now(), actualizado_el')).toHaveLength(1); // el envío, dado de baja
});

it('si ninguna boleta falla sola, el error es del sobre: todas rechazadas y nada vuelve a la cola', async () => {
  revisar.mockResolvedValue({ valido: false, errores: ['carátula'], invalidos: [] });
  await job.enviarLotes();
  expect(enviar).not.toHaveBeenCalled();
  const [rech] = con('unnest($2::uuid[], $4::jsonb[])');
  expect(rech.params[1]).toEqual(['doc-1', 'doc-2', 'doc-3']);
  expect(con("proximo_intento_el = now(), actualizado_el")).toEqual([]);
});

it('un fallo del validador (no un resultado) se propaga y no envía', async () => {
  revisar.mockRejectedValue(new Error('wasm'));
  await expect(job.enviarLotes()).rejects.toThrow('wasm');
  expect(enviar).not.toHaveBeenCalled();
});
```

  (Ajustar las claves de `con(...)` a un fragmento que sea único de cada SQL si estos no lo son: el
  test tiene que distinguir cada sentencia.)

- [ ] **Step 2: correr y ver que fallan.** `cd backend && npx jest src/modules/dte/jobs/enviar-boletas.job.spec.ts`

- [ ] **Step 3: implementar** según la conducta de arriba: un método privado
  `descartarPorEsquema(envioId, filas, revision): Promise<{ rechazadas: number; devueltas: number }>`
  que hace la transacción, llamado desde `procesar`.

- [ ] **Step 4: correr** el unitario → PASS, y `npm test` entero.

- [ ] **Step 5: e2e.** En `test/dte-cola.e2e-spec.ts`, dentro de `describe('envío al SII (EnviarBoletasJob)')`,
  con los helpers del archivo (`reiniciar`, `vender`, `envejecer`, `documentos`, `sobres`,
  `foliosEnviados`, `falso`):

```ts
it('una boleta que no cumple el esquema queda rechazada sola y las buenas salen en el sobre siguiente', async () => {
  await reiniciar();
  await vender(3);
  await envejecer();
  // Rompe la forma de UNA boleta dejando el XML bien formado (la firma ya no vale, pero el XSD no la verifica).
  await ds.query(
    `UPDATE dte_documentos SET xml = replace(xml, '<Folio>4008</Folio>', '<Folio>4008</Folio><Basura>1</Basura>')
      WHERE razon_social_id = $1 AND folio = 4008 AND eliminado_el IS NULL`,
    [razonSocialId],
  );

  await job.enviarLotes();

  expect(sobres()).toHaveLength(0); // el SII no recibió nada
  const tras1 = await documentos();
  expect(tras1.map((d) => [d.folio, d.estado, d.intentos, d.envio_id])).toEqual([
    [4007, 'pendiente', 0, null],
    [4008, 'rechazado', 0, null],
    [4009, 'pendiente', 0, null],
  ]);
  expect(tras1[1].detalle_sii).toMatchObject({ origen: 'esquema' });

  await job.enviarLotes();

  expect(sobres()).toHaveLength(1);
  expect(foliosEnviados()).toEqual([4007, 4009]);
});
```

  Si el `<Folio>` del XML guardado no se escribe así, ajustar el `replace` a lo que tenga la fila
  (mirarla con un `SELECT` temporal). Si el segundo `enviarLotes` no arma sobre porque el grupo
  todavía no está "listo", llamar `envejecer()` antes, y decirlo en el reporte.

- [ ] **Step 6: correr el e2e.** `./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json test/dte-cola.e2e-spec.ts`
  (primer plano) → PASS entero; después `./scripts/reset-db.sh --verificar`.

- [ ] **Step 7:** lint, typecheck; stagear el job, su spec y el e2e.

---

### Task 4: Los grupos, el motivo y los índices

**Files:**
- Create: `backend/src/modules/dte/problemas-sii.ts`, `backend/src/modules/dte/problemas-sii.spec.ts`
- Modify: `backend/src/modules/dte/entities/dte-documento.entity.ts`,
  `backend/src/modules/venta-documentos/entities/venta-documento.entity.ts`, `startup-pos.sql`
- Create: la migración que genere `npm run migration:generate -- BoletasConProblemas`

**Interfaces:**
- Produces (las Tasks 5 y 6 los usan tal cual):

```ts
export type GrupoProblema = 'atrasada' | 'rechazada' | 'con_reparos';
/** Condiciones sobre `dte_documentos` con alias `d`. No incluyen `d.eliminado_el IS NULL`: cada consulta lo pone. */
export const COND_ATRASADA = `d.estado IN ('pendiente','enviado') AND d.emitido_el < now() - interval '1 hour'`;
export const COND_RECHAZADA = `d.estado = 'rechazado'`;
export const COND_CON_REPAROS = `d.estado = 'reparos' AND d.emitido_el >= now() - interval '30 days'`;
/** Atrasada o rechazada: lo que avisa la franja y lo que ve soporte. */
export const COND_CON_PROBLEMAS = `((${COND_ATRASADA}) OR (${COND_RECHAZADA}))`;
/** El motivo en palabras del local (spec § 6), o null si no hay nada que decir. */
export function motivoDe(grupo: GrupoProblema, detalleSii: unknown, ultimoError: string | null): string | null;
```

**`motivoDe`:**
- `atrasada` → `ultimoError` (o `null`).
- `detalleSii` con `origen` `'esquema'`, `'sobre'` o `'envio'` → `'Error del sistema al enviarla al SII.'`
- entrada con `estado: 'RCH'` → `` `El SII la rechazó: ${d}.` `` donde `d` es la `descripcion` del
  primer elemento de `error[]` que sea string, o si no la `descripcion` de la entrada; sin ninguna →
  `'El SII la rechazó.'`
- entrada con `estado` `'RPR'` o `'RLV'` → `` `El SII avisa: ${d}.` `` (misma regla); sin ninguna →
  `'El SII la aceptó con reparos.'`
- cualquier otra forma → `null`. Nunca lanza: `detalleSii` viene del SII sin validar. Un punto final
  que ya trae la descripción no se duplica.

- [ ] **Step 1: tests que fallan** en `problemas-sii.spec.ts`, una fila por caso de la lista de
  arriba (incluir: `detalleSii` null, un string, un `error` que no es lista, una descripción que ya
  termina en punto, y `atrasada` con y sin `ultimoError`).
- [ ] **Step 2:** correr → FAIL. **Step 3:** implementar. **Step 4:** correr → PASS.
- [ ] **Step 5: índices.** En `DteDocumento`:

```ts
// La franja del cajero cuenta las atrasadas y rechazadas del tenant después de cada cobro.
@Index('idx_dte_documentos_problemas', ['tenantId', 'emitidoEl'], {
  where: `"estado" IN ('pendiente','enviado','rechazado') AND "eliminado_el" IS NULL`,
})
```

  En `VentaDocumento`:

```ts
// El cruce de una boleta del SII con su documento de venta (la lista de boletas con problemas).
@Index('idx_venta_documentos_dte', ['dteDocumentoId'], { where: `"dte_documento_id" IS NOT NULL` })
```

  `cd backend && npm run migration:generate -- BoletasConProblemas`. **Leer** la migración: deben ser
  exactamente dos `CREATE INDEX` (y sus `DROP INDEX` en `down`), sin nada más. Si trae otra cosa,
  parar y reportar. Agregar los dos índices a `startup-pos.sql`, junto a los de cada tabla.
  `npm run migration:check` → exit 0.
- [ ] **Step 6:** lint, typecheck, `npm test`. Stagear todo por ruta.

---

### Task 5: La lista del admin y el conteo del cajero

**Files:**
- Modify: `backend/src/modules/venta-documentos/emision-boleta.service.ts`,
  `backend/src/modules/venta-documentos/emision-boleta.controller.ts`
- Test: `backend/src/modules/venta-documentos/emision-boleta.service.spec.ts`,
  `backend/test/boleta-desde-la-venta.e2e-spec.ts`

**Interfaces:**
- Consumes: `COND_ATRASADA`, `COND_RECHAZADA`, `COND_CON_REPAROS`, `COND_CON_PROBLEMAS`, `motivoDe`,
  `GrupoProblema` de `../dte/problemas-sii` (Task 4).
- Produces (la Task 7 consume la forma JSON):

```ts
export interface BoletaConProblema {
  documentoId: string;
  ventaId: string | null;
  tipo: 39 | 41;
  folio: number;
  emitidaEl: Date;
  monto: string | null;
  motivo: string | null;
}
export interface BoletasConProblemas {
  atrasadas: BoletaConProblema[];
  rechazadas: BoletaConProblema[];
  conReparos: BoletaConProblema[];
}
// EstadoEmision suma:  conProblemas: number;
// EmisionBoletaService: async boletasConProblemas(tenantId: string): Promise<BoletasConProblemas>
// GET /dte/boletas-con-problemas  (JwtAuthGuard, TenantGuard, TenantAdminGuard)
```

**La consulta** (una por grupo, tres en total, la misma plantilla):

```ts
const LIMITE_PROBLEMAS = 200;
const leerProblemas = (condicion: string, orden: 'ASC' | 'DESC') => `
  SELECT d.documento_id, v.venta_id, d.tipo, d.folio, d.emitido_el, vd.monto, d.detalle_sii, d.ultimo_error
    FROM dte_documentos d
    LEFT JOIN venta_documentos vd ON vd.dte_documento_id = d.documento_id AND vd.tenant_id = d.tenant_id
                                 AND vd.eliminado_el IS NULL
    LEFT JOIN ventas v ON v.venta_id = vd.venta_id AND v.tenant_id = d.tenant_id AND v.eliminado_el IS NULL
   WHERE d.tenant_id = $1 AND d.eliminado_el IS NULL AND (${condicion})
   ORDER BY d.emitido_el ${orden}, d.folio
   LIMIT ${LIMITE_PROBLEMAS.toString()}`;
```

  Atrasadas y rechazadas `ASC`; con reparos `DESC`. `motivo` = `motivoDe(grupo, detalle_sii, ultimo_error)`.
  El `LEFT JOIN` es a propósito: una boleta del SII sin su documento de venta (no debería pasar)
  igual se muestra, con `ventaId` y `monto` en null; escribirlo en un comentario.

**El conteo del cajero:** en `estadoEmision`, cuando la emisión está prendida, reemplazar el
`contarSinEmitir` por **una** consulta que traiga los dos números (`contarSinEmitir` sigue
existiendo para `emitirPendientes`):

```ts
const CONTAR_PARA_EL_CAJERO = `
  SELECT (SELECT count(*)::int ${SIN_EMITIR_DEL_TENANT}) AS sin_emitir,
         (SELECT count(*)::int FROM dte_documentos d
           WHERE d.tenant_id = $1 AND d.eliminado_el IS NULL AND ${COND_CON_PROBLEMAS}) AS con_problemas`;
```

  Apagada: `{ activa: false, avisos: [], sinEmitir: 0, conProblemas: 0 }`, sin consultas nuevas.

- [ ] **Step 1: unitarios que fallan** en `emision-boleta.service.spec.ts` (con el mock de `Db` del
  archivo): apagada no hace más que la consulta del interruptor y trae `conProblemas: 0`; prendida
  lee `sin_emitir` y `con_problemas` de una sola llamada; `boletasConProblemas` hace exactamente tres
  consultas y arma `motivo` con `motivoDe` (una fila rechazada con `{ origen: 'sobre' }` → "Error del
  sistema al enviarla al SII.").
- [ ] **Step 2:** correr → FAIL. **Step 3:** implementar service y ruta (con el docblock de la ruta
  diciendo por qué es `TenantAdminGuard`). **Step 4:** correr → PASS; `npm test` entero.
- [ ] **Step 5: e2e** — un `describe('boletas con problemas')` nuevo en
  `test/boleta-desde-la-venta.e2e-spec.ts`, con los helpers del archivo (`reiniciar`, `venderOk`,
  `getCon`, `loginParis`, `colaDte`). Vender 6 boletas con la emisión prendida y dejar por SQL
  (`UPDATE dte_documentos ... WHERE documento_id = $1`, con comentario: el SII de verdad no existe
  en el e2e; el camino real del job lo cubre `dte-cola.e2e-spec.ts`):
  - A: `pendiente`, `emitido_el = now() - 61 min` → atrasada;
  - B: `rechazado`, `detalle_sii = {"origen":"sobre","estado":"RSC"}`;
  - C: `reparos`, `detalle_sii` = una entrada `RLV` con `error: [{ "descripcion": "Fecha atrasada" }]`, `emitido_el = now() - 2 days`;
  - D: `reparos`, `emitido_el = now() - 31 days` → no aparece;
  - E: `rechazado` con `eliminado_el = now()` → no aparece;
  - F: `pendiente` de hace 10 minutos → no aparece.
  Afirmar: `GET /dte/boletas-con-problemas` → 200, `atrasadas` = [A], `rechazadas` = [B] con
  `motivo` "Error del sistema al enviarla al SII." y su `ventaId` y `monto` (el `monto` del documento
  de venta), `conReparos` = [C] con "El SII avisa: Fecha atrasada.". `GET /dte/estado-emision` →
  `conProblemas: 2`. Con la emisión apagada → `conProblemas: 0`. El mismo `GET` con el token de
  `admin@sistema.com` en Falabella (agregar un parámetro de tenant a `loginComo`) → las tres listas
  vacías. Un usuario sin rol de admin → 403 (reusar el patrón de los 403 del final del archivo).
  Al terminar, dejar las 6 filas como no molesten a otros tests (por SQL a `aceptado`, como el
  archivo ya hace con `descartarSinEmitir`).
- [ ] **Step 6:** `./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json test/boleta-desde-la-venta.e2e-spec.ts`
  → PASS entero; `--verificar`. Stagear.

---

### Task 6: El panel de soporte (backend)

**Files:**
- Create: `backend/src/modules/dte/soporte-dte.controller.ts`
- Modify: `backend/src/modules/dte/cola-dte.service.ts`, `backend/src/modules/dte/dte.module.ts`
- Test: `backend/src/modules/dte/cola-dte.service.spec.ts`, `backend/test/boleta-desde-la-venta.e2e-spec.ts`

**Interfaces:**
- Consumes: `COND_ATRASADA`, `COND_RECHAZADA`, `COND_CON_PROBLEMAS` (Task 4).
- Produces (la Task 8 consume la forma JSON):

```ts
export interface BoletaConProblemaSoporte {
  documentoId: string;
  tenantId: string;
  tenant: string;              // tenants.nombre
  razonSocial: string | null;  // razones_sociales.nombre
  ambiente: string;
  tipo: 39 | 41;
  folio: number;
  emitidaEl: Date;
  grupo: 'atrasada' | 'rechazada';
  intentos: number;
  ultimoError: string | null;
  detalleSii: unknown;
}
// ColaDteService: async problemasDeTodos(): Promise<BoletaConProblemaSoporte[]>
// GET /admin/dte/boletas-con-problemas  (JwtAuthGuard, SuperadminGuard; sin TenantGuard)
```

```ts
const PROBLEMAS_DE_TODOS = `
  SELECT d.documento_id, d.tenant_id, t.nombre AS tenant, rs.nombre AS razon_social, d.ambiente,
         d.tipo, d.folio, d.emitido_el,
         CASE WHEN ${COND_RECHAZADA} THEN 'rechazada' ELSE 'atrasada' END AS grupo,
         d.intentos, d.ultimo_error, d.detalle_sii
    FROM dte_documentos d
    JOIN tenants t ON t.tenant_id = d.tenant_id AND t.eliminado_el IS NULL
    LEFT JOIN razones_sociales rs ON rs.razon_social_id = d.razon_social_id AND rs.eliminado_el IS NULL
   WHERE d.eliminado_el IS NULL AND ${COND_CON_PROBLEMAS}
   ORDER BY d.emitido_el, d.folio
   LIMIT 200`;
```

  Comentario en la consulta: cruza tenants a propósito (es el eje superadmin, como `/admin/tenants`);
  el `LEFT JOIN` a la razón social deja ver la boleta aunque la razón social se haya dado de baja.
  Comentario en el controller: mismo par de guards que `TenantsController` de `/admin/tenants`.

- [ ] **Step 1:** unitario en `cola-dte.service.spec.ts`: `problemasDeTodos` hace una consulta y mapea
  snake → camel. FAIL → implementar → PASS.
- [ ] **Step 2:** registrar `SoporteDteController` en `dte.module.ts`.
- [ ] **Step 3: e2e**, en el mismo `describe('boletas con problemas')` de la Task 5 (reusa sus filas A
  y B): con `admin@sistema.com` en el tenant **Falabella**, `GET /admin/dte/boletas-con-problemas` →
  200 e incluye A y B (de Paris) con `tenant` = el nombre del tenant Paris y `grupo` correcto, y no
  incluye C, D, E ni F; con `admin.paris@paris.cl` (no superadmin) → 403. Correr como en la Task 5.
- [ ] **Step 4:** lint, typecheck, `npm test`. Stagear.

---

### Task 7: La tarjeta del admin y la franja del cajero (frontend)

**Files:**
- Modify: `frontend/app/pages/configuracion/boleta-electronica.vue`,
  `frontend/app/components/ventas/FranjaEmision.vue`
- Test: `frontend/app/pages/configuracion/boleta-electronica.nuxt.spec.ts`,
  `frontend/app/components/ventas/FranjaEmision.nuxt.spec.ts` (nuevo),
  `frontend/e2e/configuracion/boletas-con-problemas.spec.ts` (nuevo),
  `frontend/e2e/ventas/boleta-electronica-pos.spec.ts`

**Interfaces:**
- Consumes: la forma JSON de `GET /dte/boletas-con-problemas` y `conProblemas` de
  `GET /dte/estado-emision` (Task 5; fechas como string ISO).

**La tarjeta** (`data-qa="boletas-con-problemas"`), debajo de la de "Boletas sin emitir", con el mismo
`UCard`/`UTable`/`formatoFecha`/`formatMonto`/`rutaVenta` que esa tarjeta. Se carga junto con la lista
de sin emitir y se recarga cuando ella. Título *"Boletas con observaciones del SII"*. Un bloque por
grupo con datos (`data-qa` `grupo-atrasadas`, `grupo-rechazadas`, `grupo-con-reparos`), cada uno con
su subtítulo, su texto fijo y su tabla (Fecha, Folio, Tipo, Monto, Motivo, enlace "Ver venta" si hay
`ventaId`):

| Grupo | Subtítulo | Texto fijo |
|---|---|---|
| atrasadas | Atrasadas | El sistema la sigue enviando; no tienes que hacer nada. Si pasa de un día, escribe a soporte con el folio. |
| rechazadas | Rechazadas | No la vuelvas a emitir: escribe a soporte con el folio. |
| conReparos | Con reparos (últimos 30 días) | Es válida. Revisa el aviso del SII para corregirlo en las próximas boletas. |

Tipo: `39` → "Afecta", `41` → "Exenta". Con los tres grupos vacíos:
*"No hay boletas con observaciones."* (`data-qa="sin-observaciones"`). Si la lectura falla: un toast
de error con `apiErrorMsg`, como la de sin emitir.

**La franja:** `EstadoEmision` suma `conProblemas: number`; después del aviso de sin emitir:

```ts
const p = estado.value.conProblemas ?? 0
if (p > 0) {
  lista.push({
    clave: 'CON_PROBLEMAS',
    mensaje: `${p === 1 ? 'Hay 1 boleta con problemas en el SII' : `Hay ${p} boletas con problemas en el SII`}${AVISA_AL_ENCARGADO}`,
  })
}
```

  (`?? 0` porque un backend viejo durante el deploy no lo manda.) Actualizar el comentario de cabecera.

- [ ] **Step 1: unitarios que fallan.** En `boleta-electronica.nuxt.spec.ts` (con el mock de
  `useApiFetch` que ya usa): los tres grupos con una fila cada uno muestran su texto fijo y su motivo;
  todo vacío muestra "No hay boletas con observaciones."; una fila sin `ventaId` no muestra el enlace.
  `FranjaEmision.nuxt.spec.ts` (montar con `mountSuspended`, mock de `useApiFetch` como en
  `pos.nuxt.spec.ts`): `conProblemas: 1` → "Hay 1 boleta con problemas en el SII: avisa al encargado";
  `conProblemas: 3` → plural; `conProblemas: 0` y `activa: false` → no pinta el aviso; sin el campo →
  no pinta y no rompe.
- [ ] **Step 2:** `cd frontend && npx vitest run <los dos specs>` → FAIL. **Step 3:** implementar.
  **Step 4:** → PASS.
- [ ] **Step 5: Playwright** (no correrlo: lo corre el controlador al final).
  `e2e/configuracion/boletas-con-problemas.spec.ts`, como `admin.paris@paris.cl` (igual que
  `emision-boletas.spec.ts`: `test.use({ storageState: ... })` + `entrarComo`), con
  `page.route('**/api/dte/boletas-con-problemas', r => r.fulfill({ json: {...} }))` y una fila por
  grupo: la tarjeta muestra los tres subtítulos, los tres textos fijos y los motivos. En
  `e2e/ventas/boleta-electronica-pos.spec.ts`, un test más que con `page.route` sobre
  `**/api/dte/estado-emision` (`{ activa: true, avisos: [], sinEmitir: 0, conProblemas: 2 }`) ve en
  el POS el aviso "Hay 2 boletas con problemas en el SII: avisa al encargado". Un comentario en cada
  uno: Playwright no llega a la base; el contrato real lo fija el e2e de API.
- [ ] **Step 6:** `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`. Stagear.

---

### Task 8: El panel de soporte (frontend)

**Files:**
- Modify: `frontend/app/pages/admin.vue`
- Test: `frontend/app/pages/admin.nuxt.spec.ts` (nuevo), `frontend/e2e/tenants/soporte-boletas.spec.ts` (nuevo)

**Interfaces:**
- Consumes: la forma JSON de `GET /admin/dte/boletas-con-problemas` (Task 6).

`admin.vue` conserva su `definePageMeta` **tal cual** (lo fija `admin.spec.ts`) y su `AppNavbar`; el
cuerpo pasa a una tarjeta *"Boletas con problemas en el SII"* (`data-qa="soporte-boletas"`) con una
`UTable` (Local, Razón social, Ambiente, Tipo, Folio, Emitida, Estado —"Atrasada"/"Rechazada" con
`UBadge` warning/error—, Intentos) y una fila desplegable (`expanded` de `UTable`) con `ultimoError` y
`detalleSii` en un `<pre>` con `JSON.stringify(…, null, 2)`. Vacía: *"Ningún local tiene boletas con
problemas."* (`data-qa="soporte-sin-problemas"`). Error de lectura: toast con `apiErrorMsg`.

- [ ] **Step 1:** `admin.nuxt.spec.ts` que falla: una fila de cada grupo muestra el local, el folio y el
  estado; desplegar una muestra el `detalleSii`; vacío muestra el texto. → FAIL → implementar → PASS.
  `admin.spec.ts` debe seguir pasando sin cambios.
- [ ] **Step 2: Playwright** (no correrlo): `e2e/tenants/soporte-boletas.spec.ts` con el usuario por
  defecto de la suite (superadmin) y `page.route('**/api/admin/dte/boletas-con-problemas', …)` con dos
  filas de dos locales: la tabla las muestra; desplegar una muestra su detalle.
- [ ] **Step 3:** build, `npm test`, `typecheck:ratchet`, `design:check`. Stagear.

---

### Task 9: Documentación

**Files:** `docs/features/emision-electronica.md`, `docs/ESTADO.md`, `docs/agent/desarrollo-nuevo.md`

- [ ] `emision-electronica.md`:
  - status del encabezado (el frente 3 hecho; reemitir pendiente);
  - § Envío al SII: la tabla del job de consulta con los cuatro estados por boleta (`DOK`, `RPR`,
    `RLV`, `RCH`, con la fuente: el OpenAPI v1.0.5) y la regla del `DOK` explícito; una subsección
    "Antes de enviar: el esquema" (el flujo de la Task 3, el costo medido de ~33 ms por validación,
    el riesgo de la copia v4.2, `xmllint-wasm` en producción y el `assets` de `nest-cli.json`);
    sacar "reemitir… pantalla de atrasadas" de su "No incluido";
  - una sección nueva "Boletas con problemas" (los tres grupos, las dos rutas, la franja, el panel de
    soporte, los índices, las pruebas y los mutantes), con el link a la spec borrada como en las
    otras secciones;
  - "Lo que queda abierto": lo de la spec § 11, y borrar las entradas que este frente cierra.
- [ ] `ESTADO.md`: la fila de emisión electrónica.
- [ ] `desarrollo-nuevo.md`: el frente 3 ✅ con la fecha y su último commit de código; "reemitir una
  rechazada" queda abierto, con las preguntas 1 y 2 de la investigación como lo que lo destraba.
- [ ] Stagear. (El controlador borra la spec y el plan al cerrar, en un commit aparte.)

---

## Al cerrar (controlador)

1. Revisión de rama entera (domain-reviewer; api-security-reviewer sobre los dos controllers).
2. Playwright de lo relacionado, una vez, con el stack por turno de la orquestadora:
   `e2e/configuracion/boletas-con-problemas.spec.ts`, `e2e/configuracion/emision-boletas.spec.ts`,
   `e2e/ventas/boleta-electronica-pos.spec.ts`, `e2e/tenants/soporte-boletas.spec.ts`, más los de
   salones que montan la franja.
3. Mutantes de la spec § 9 (revertidos con `cp` y `cmp`): `RLV` como desconocido, sin la ventana de
   30 días, el conteo del cajero sumando reparos, sin `SuperadminGuard`, la validación saltada en el
   job. Cada uno debe hacer caer al menos un test.
4. Borrar spec y plan, avisar a la orquestadora, push, CI por SHA, Railway, smoke.
