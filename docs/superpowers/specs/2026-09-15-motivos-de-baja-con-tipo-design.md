# Motivos de baja: el catálogo de mermas pasa a tener tipo

**Fecha:** 2026-09-15 · **Tipo:** spec de diseño
**Frente:** *"Anular o reducir una línea ya enviada a cocina"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3.
**Decisiones del owner:** las seis del 2026-09-03 (tabla en esa entrada) y las del 2026-09-15, en la
conversación que abrió este frente.

---

## 1. Dónde encaja

Anular un plato ya enviado a cocina se construye en tres partes, cada una con su spec:

| Parte | Qué | Spec |
|---|---|---|
| **0 + 1** | Renombrar el catálogo de mermas a *Motivos de baja* y darle un tipo a cada motivo | esta |
| 2 | Anular en el salón: el registro de cada anulación, el permiso, la pantalla del encargado y la precuenta | se diseña después |
| 3 | El reporte de anulaciones que no descuentan stock | se diseña después |

Esta spec no toca stock, cuentas, ventas ni permisos. Deja el catálogo listo para que la parte 2 lo use.

## 2. Las decisiones que la sostienen

| Fecha | Decisión | Por qué importa acá |
|---|---|---|
| 2026-09-03 | **Un catálogo único con tipo**, renombrando el actual a algo neutro | Dos catálogos serían dos pantallas casi iguales; reusar `causas_merma` tal cual deja un nombre que miente |
| 2026-09-03 | **La cortesía descuenta stock** y se reporta aparte de la merma | La cortesía es un tipo propio, no una causa de merma más |
| 2026-09-15 | **El motivo trae fijo si descuenta stock.** Ni el garzón ni el encargado eligen "descuenta sí / no" caso por caso | Esa elección suelta es la palanca de un arreglo entre sala y cocina: marcar "no se hizo" algo que sí salió |
| 2026-09-15 | **Un tercer tipo: "no se llegó a hacer"**, que no descuenta. Amplía la fila del 03-09, que decía "merma o cortesía" | El plato anulado a los 5 minutos de una espera de 30 no es merma ni cortesía |
| 2026-09-15 | **Renombre entero, en un commit aparte**: tabla, código y pantallas | Mismo motivo que la decisión del 03-09 |

Las decisiones de la parte 2 que ya existen —un permiso propio que nace en el rol de encargado y el admin
reparte, ejercido desde la propia sesión; un registro aparte por anulación— están en la entrada de
`pendientes.md` y no se repiten acá.

## 3. Paso 0 — el renombre, sin cambiar conducta

Un commit mecánico **antes** de la parte 1. Nombres nuevos, siguiendo a los otros tres catálogos de
motivos (`motivo_traslado`, `motivo_diferencia_caja`, `motivo_diferencia_inventario`):

| Hoy | Pasa a |
|---|---|
| tabla `causas_merma`, PK `causa_merma_id` | `motivo_baja`, `motivo_baja_id` |
| `movimientos_inventario.causa_merma_id` | `movimientos_inventario.motivo_baja_id` |
| índice único `uq_causas_merma_tenant_nombre` (`tenant_id, lower(nombre)`, parcial sobre vivos) | `uq_motivo_baja_tenant_nombre`, misma definición |
| `CausaMerma`, `CausasMermaService`, `CAUSAS_MERMA_FIJAS` | `MotivoBaja`, `MotivosBajaService`, `MOTIVOS_BAJA_FIJOS` |
| ruta `/api/causas-merma` | `/api/motivos-baja` |
| pantalla `/configuracion/causas-merma`, menú *"Causas de merma"* | `/configuracion/motivos-baja`, *"Motivos de baja"* |
| campo `causaMermaId` de `POST /api/mermas` y filtro de `GET /api/mermas` | `motivoBajaId` |
| campo de respuesta `causaNombre` / `causa_nombre` (mermas e inventario, backend y frontend) | `motivoBajaNombre` / `motivo_baja_nombre`. No `motivoNombre`: en la fila del kardex ya existe `motivo` (el tipo de movimiento), y al lado se leería como su nombre |
| `assertCausaActiva` | `assertMotivoActivo` |
| archivos en singular (`causa-merma.entity.ts`, `create-causa-merma.dto.ts`, `update-causa-merma.dto.ts`) | `motivo-baja.entity.ts`, `create-motivo-baja.dto.ts`, `update-motivo-baja.dto.ts` |
| constante de e2e `CAUSA_VENCIMIENTO_ID` | `MOTIVO_VENCIMIENTO_ID` |
| textos de error y de pantalla con *causa* (*"Causa de merma no válida o inactiva"*, *"Todas las causas"*, la columna *Causa* de Mermas, entre otros) | los mismos con *motivo de baja*, **concordados**: *"una causa de merma activa"* pasa a *"un motivo de baja activo"*. `errorDeColisionNombreSQL` recibe la frase ya concordada |

**El catálogo sale del módulo `mermas` a un módulo propio `motivos-baja/`**, como los otros tres. La
parte 2 lo va a usar desde `salones`, y no tiene que depender del módulo de mermas para eso.

**Qué se busca y qué no se toca.** El punto de partida es:

```bash
git grep -i -n "causa"
```

y **cada resultado se clasifica a mano**: la palabra *causa* también aparece con otros sentidos en el
repo. Un grep más angosto —solo `causas_merma`, `causa_merma_id`, `causas-merma`— **no alcanza**: deja
afuera el campo `causaNombre`, `assertCausaActiva`, los archivos en singular y los textos de pantalla
(medido en la revisión de esta spec). La tabla de arriba es lo que se sabe; no se da por completa.

Varios de esos mensajes los **comparan literalmente** specs unitarios de backend
(`mermas.service.spec.ts`, `causas-merma.service.spec.ts`) y de frontend
(`configuracion/causas-merma.nuxt.spec.ts`): se renombran junto con el mensaje, y que cambie su texto es
parte del renombre, no una aserción nueva.

Entra todo `backend/src`, `backend/test`, `frontend/app`, `scripts/` (`scripts/qa/norefetch-devtools.sh`
usa la ruta) y la documentación viva (`docs/features/`, `docs/PRODUCTO.md`, `docs/ESTADO.md`,
`docs/patterns/`, `startup-pos.sql`). **No** se tocan `docs/agent/resueltos.md`,
`docs/agent/investigaciones/` ni specs o planes viejos: registran lo que había cuando se escribieron.

Hay archivos de otros catálogos que nombran `causas_merma` solo como referencia de su propio patrón; se
actualiza el nombre citado, nada más.

**Sin migración.** No hay datos productivos: se cambia la entidad, se actualiza el seeder y se resetea
la base.

**Cómo se verifica:** que no cambió conducta, con el gate completo en verde y los tests renombrados sin
ninguna aserción nueva; que el renombre quedó entero, con el `git grep -i -n "causa"` sobre las carpetas
que entran, donde cada resultado que quede tiene que ser de otro sentido de la palabra.

## 4. Parte 1 — cada motivo tiene tipo

### 4.1 El tipo

Columna `tipo` en `motivo_baja`, obligatoria, con enum de TypeORM (`enumName`), el mismo patrón que
`ModoRegla` en `descuentos`/`recargos`:

| Valor | En pantalla | Stock (lo usa la parte 2) | Se puede elegir en |
|---|---|---|---|
| `merma` | Merma | descuenta | pantalla de Mermas; anular plato |
| `cortesia` | Cortesía | descuenta | anular plato |
| `no_elaborado` | No se llegó a hacer | no descuenta | anular plato |

**El stock sale del tipo, no de otra columna.** Un flag aparte permitiría una merma que no descuenta,
que no significa nada.

### 4.2 Los fijos

- Los cinco que existen —Vencimiento, Deterioro, Robo, Error operativo, Otro— quedan con tipo `merma`.
- Se suman dos: **"Cortesía de la casa"** (`cortesia`) y **"No se llegó a hacer"** (`no_elaborado`).
- `MOTIVOS_BAJA_FIJOS` pasa a ser una lista de `{ nombre, tipo }`. Lo leen los dos lugares que hoy
  siembran las causas: el seeder de desarrollo y el alta de tenant en `tenants.service.ts`.
- **IDs del seed:** hoy el seeder numera las causas con un contador que arranca en `…266` y recorre dos
  tenants. Los dos fijos nuevos por dos tenants son **cuatro IDs que quedan fuera de ese contador**: si
  lo siguieran, correrían los cinco del segundo tenant y usarían `…277` a `…279`, que ya son turnos. Se toman de
  números libres (`CLAUDE.md`, *Seed*), y los cinco de hoy conservan su ID.
- Los fijos siguen sin poder editarse ni borrarse.

### 4.3 Los motivos propios

- Al crear uno, el admin elige el tipo; el DTO lo exige.
- **El tipo se puede cambiar solo mientras el motivo no se usó.** Hoy "usado" es lo mismo que ya bloquea
  el borrado: algún movimiento de inventario con ese motivo. La parte 2 le suma las anulaciones.
  Cambiarlo después reescribiría la historia: un *"Se quemó"* pasado a `no_elaborado` haría que un plato
  que salió de la cocina figure como que nunca gastó stock.
- Nombre, activo, borrado y papelera: sin cambios de regla. El nombre sigue siendo único por tenant sin
  distinguir mayúsculas, **entre todos los tipos**.

### 4.4 La pantalla de Mermas y su endpoint

- `GET /api/motivos-baja` acepta `tipo` como filtro, además del `soloActivas` de hoy.
- La pantalla de Mermas pide solo `tipo=merma`: *Cortesía de la casa* no aparece en su selector.
- `POST /api/mermas` **rechaza con 400** un motivo que no sea de tipo `merma`. El filtro de la pantalla
  no alcanza: el servidor es el que manda.
- El listado de mermas no cambia: solo puede tener movimientos de tipo `merma`.

### 4.5 La pantalla de configuración

*Motivos de baja* suma la columna **Tipo** y el campo en el formulario. En un motivo ya usado, el campo
se muestra deshabilitado, con el motivo; el 400 del servidor sigue siendo la regla.

Para eso el listado de `GET /api/motivos-baja` devuelve `enUso` por motivo. Sale de la misma consulta
del listado —un `EXISTS` o una agregación sobre `movimientos_inventario`—, nunca de una consulta por
motivo.

## 5. Fuera de alcance

- Registrar stock por una cortesía o un "no se llegó a hacer", anular líneas, el permiso, la precuenta y
  cualquier reporte: partes 2 y 3.
- Qué muestra la boleta de una cuenta con algo anulado: es fiscal y abre su propio frente
  (`CLAUDE.md`, ADR-010).

## 6. Cómo se prueba

- **Paso 0:** el gate completo, y cada resultado que quede del `git grep -i -n "causa"` es de otro sentido de la palabra (§ 3).
- **Unit** del service: crear con tipo; cambiar el tipo de un motivo sin uso (pasa) y de uno con
  movimientos (400); los fijos siguen sin editarse.
- **DTO:** `tipo` obligatorio al crear y restringido a los tres valores.
- **E2E:**
  - un tenant recién creado trae los siete fijos con su tipo;
  - `GET /api/motivos-baja?tipo=merma` no devuelve los otros dos tipos;
  - `POST /api/mermas` con *Cortesía de la casa* da 400, y con *Deterioro* da 201;
  - cambiar el tipo de un motivo propio después de usarlo en una merma da 400.
- **Frontend:** la pantalla de configuración muestra y edita el tipo, y lo deshabilita con `enUso`; el
  selector de Mermas pide `tipo=merma`.
- **Unit** del listado: `enUso` en una sola consulta, sin una por motivo.

## 7. Documentación

- `docs/features/mermas-valorizadas.md`: el catálogo renombrado, el tipo y la regla de Mermas.
- `docs/PRODUCTO.md` y `docs/ESTADO.md`: *Motivos de baja* con tipo.
- `docs/agent/pendientes.md`: la entrada del frente anota que la parte 1 quedó construida.
