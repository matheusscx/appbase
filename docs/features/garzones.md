# Feature: Gestión de Garzones (PIN operativo)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-17 (tipo garzón/cocina/barra para liquidación)

---

## Overview

### ¿Qué es?

Registro de **garzones** por tenant, cada uno con un **PIN secreto de 6 dígitos**.
En un restaurante, uno o más dispositivos (tablet/tótem) son compartidos por todos
los garzones. En vez de iniciar/cerrar sesión con usuario+contraseña en cada cambio
de turno, el dispositivo permanece con la **sesión del restaurante** ya autenticada y
el sistema pide **elegir el garzón de una lista y después su PIN** al abrir o cerrar
una cuenta.

### Por qué se elige antes de teclear (2026-08-08)

Antes se tecleaba el PIN a secas y el backend lo comparaba contra **todos** los
garzones activos, porque el hash está salteado y no se puede buscar por índice.
Medido: bcrypt a coste 10 tarda 62,5 ms por comparación, así que 20 garzones eran
1,3 s de CPU **por intento**, y 5 intentos concurrentes daban 6,3 s con hasta 309 ms
de lag del event loop — que en un solo proceso Node lo pagan **todos los tenants**.
Con el garzón ya elegido, la verificación es **un** bcrypt.

El selector ofrece **dos listas complementarias**, y la partición no es cosmética:

| flujo | lista | por qué |
|---|---|---|
| Entrar a turno | los que **no** están en turno | quien ya tiene sesión abierta no puede abrir otra |
| Salir de turno, abrir, cobrar, tomar y transferir cuenta | los que **sí** están en turno | los cinco exigen sesión abierta río abajo |

Así **la lista codifica la regla**: el 400 *"El garzón ya tiene una sesión abierta"*
deja de **ofrecerse**.
⚠️ No deja de existir: la lista se pide al abrir el modal, y entre esa carga y el submit el
mismo garzón puede entrar a turno **en otro tótem** —que es el despliegue normal de esta
feature—. El guard del backend sigue siendo el que manda; la lista solo evita el camino
previsible.

⚠️ **La cuenta con la que se loguea el tótem es un usuario común del tenant** — no
existe ningún concepto de "dispositivo" en el sistema. Debería tener un **rol
mínimo**, solo lo que la operación del salón necesita: si se loguea con la cuenta del
admin, queda un dispositivo compartido y desatendido con permisos de administración.
Regla operativa, no enforcement: ningún garzón abre su cuenta en un tótem, y ningún
garzón tiene el usuario y la contraseña del tótem.

### ¿Por qué existe?

- Evitar el login/logout continuo en dispositivos compartidos.
- Identificar al garzón por PIN en dispositivos compartidos (apertura, cierre,
  claim de cuenta).
- Incorporar personal temporal **sin crear usuarios del sistema**.
- Trazabilidad de **quién abrió y quién cerró** cada cuenta (auditoría).

Un garzón **no es un usuario del sistema**: no tiene login ni JWT. El PIN es un
**identificador operativo** dentro de la sesión del tenant ya autenticada — no toca
el sistema de tokens.

### Los dos modos del dispositivo (2026-08-09)

Lo de arriba sigue siendo el caso base, pero **no es el único**. El owner separó
dos flujos que antes se trataban igual, y la diferencia no es de comodidad:

| | **Tótem compartido** | **Tablet personal** |
|---|---|---|
| Quién lo usa | muchos garzones, un dispositivo | una persona, su propio login |
| Identidad | **no se puede presumir**: nada asegura que quien está frente a la pantalla sea el mismo de hace cinco minutos | el JWT ya dice quién es |
| Cómo se identifica | lista de garzones + PIN, en los 6 puntos | sin PIN: sale del token |

El modo es **explícito, no inferido**: `usuarios_tenants.es_totem` marca la
cuenta como tótem, y `garzones.usuario_id` (nullable) la vincula a un garzón.
El marcador **gana siempre**: una cuenta marcada tótem pide PIN aunque alguien
le vincule un garzón por error.

Que el vínculo sea **opcional** es lo que preserva el objetivo original: sin él
nada cambia, y se puede seguir sumando personal temporal sin crearle una cuenta.
Un garzón vinculado **conserva su PIN** y sigue apareciendo en el selector del
tótem, así que puede operar por cualquiera de los dos caminos.

⚠️ **La cuenta del tótem es un usuario común del tenant** — no existe ningún
concepto de "dispositivo" en el sistema. Debe tener un **rol mínimo**, solo lo
que la operación del salón necesita: si se la loguea con la cuenta del admin,
queda un dispositivo compartido y desatendido con permisos de administración. El
seed trae un rol `Salón` (`Salones:Leer` + `Salones:Operar`) como ejemplo
ejercitable. Nada en el sistema lo impide todavía: es recomendación operativa.

**Una cuenta = un garzón vivo por tenant** (`uq_garzones_usuario_tenant`, parcial sobre
filas vivas). Si no, resolver el actuante por JWT elegiría uno al azar. El índice es la
garantía, pero los dos caminos que pueden chocar con él devuelven un mensaje propio, no un
500: vincular una cuenta tomada dice **de quién** desvincularla, y restaurar un garzón de la
papelera cuya cuenta ya tomó otro dice eso —y no el mensaje del placeholder "Mostrador", que
es la otra unique parcial de la misma tabla—.

⚠️ El `usuario_id` **sobrevive al soft delete**, así que borrar un garzón libera su cuenta
para otro, y restaurarlo después puede fallar. Es correcto que falle; lo que importa es que
lo diga bien.

La resolución vive en **un solo lugar** —`GarzonesService.resolverGarzonActuante`,
una consulta— que reemplazó las 6 llamadas directas a `verificarPin`. Como
`garzonId` y `pin` pasaron a ser **opcionales** en el DTO (en modo personal no se
mandan), esa función es la que sostiene el PIN: sin su corte, un body vacío
operaría como cualquier garzón en los 6 puntos a la vez.

### Scope

- **Incluido**: CRUD de garzones, regeneración de PIN, selector + verificación de PIN, y
  captura de auditoría al **abrir** (`garzon_apertura_id`) y **cerrar**
  (`garzon_cierre_id`) una cuenta. Al abrir también se setea el responsable
  vigente inicial (`garzon_responsable_id`); ese campo cambia con transferencias
  (ver [salones-mesas.md](./salones-mesas.md)). Campo `tipo` (`garzon` | `cocina`
  | `barra`) para agrupar en liquidación de propinas (E1).
- **NO incluido (futuro)**: mover cuentas entre mesas con PIN, log por cada
  acción individual (agregar línea, fusionar).

Turnos y sesiones de trabajo (entrada/salida con PIN, sesión obligatoria para
operar cuentas): ver [turnos-garzones.md](./turnos-garzones.md).
Responsable vigente, transferencia por PIN/admin e historial:
[salones-mesas.md](./salones-mesas.md).

---

## Decisiones de diseño

- **Identificación solo por PIN**: el garzón teclea su PIN y el sistema lo identifica
  (flujo POS clásico). Requiere **PIN único por tenant**.
- **PIN autogenerado, mostrado una sola vez**: nadie elige el PIN. El backend genera
  uno aleatorio de 6 dígitos (con `crypto.randomInt`), garantizado único en el tenant
  (reintenta ante colisión), y lo devuelve **una sola vez** al crear o regenerar.
  Así se evita que dos garzones "piensen" el mismo PIN y que el admin conozca los PINs.
- **PIN hasheado** con bcrypt (cost 10, igual que las contraseñas). El admin nunca lo
  ve; si se pierde, se **regenera** (se muestra el nuevo una vez; el anterior deja de
  funcionar de inmediato). La API jamás devuelve `pin_hash`.
- **RBAC**: reutiliza el módulo contratado `Salones` (sin nuevo `tenant_modulos`). El
  CRUD usa `Leer/Crear/Actualizar/Eliminar`; la identificación por PIN usa `Operar`.

---

## API Endpoints

Todos bajo `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`; `tenant_id` del JWT.

| Método | Ruta | Permiso (`Salones`) | Descripción |
|---|---|---|---|
| GET | `/garzones` | `Leer` | Lista garzones del tenant (sin `pin_hash`) |
| POST | `/garzones` | `Crear` | Crea `{ nombre, activo?, tipo? }` → devuelve el garzón + `pin` generado (una vez) |
| PATCH | `/garzones/:id` | `Actualizar` | Actualiza `{ nombre?, activo?, tipo? }` |
| PATCH | `/garzones/:id/pin` | `Actualizar` | Regenera el PIN (sin body) → devuelve el garzón + nuevo `pin` (una vez) |
| DELETE | `/garzones/:id` | `Eliminar` | Soft delete |
| GET | `/garzones/para-selector?enTurno=` | `Operar` | Las dos listas del selector → `{ garzonId, nombre }[]`. `enTurno` **obligatorio** |
| POST | `/garzones/verificar-pin` | `Operar` | `{ garzonId, pin }` → `{ garzonId, nombre }` (o 400), **sin ejecutar nada** |

Al **abrir** cuenta (`POST /mesas/:id/cuentas`) y **cerrar** cuenta
(`POST /cuentas/:id/cerrar`) el body incluye `garzonId` **y** `pin` (6 dígitos). El backend
resuelve el garzón y persiste `garzon_apertura_id` / `garzon_cierre_id`
(auditoría). Al abrir también setea `garzon_responsable_id` al mismo garzón
(responsable vigente inicial). La transferencia de responsable vigente (claim por
PIN o admin) vive en Salones — no en este módulo.

---

## Backend

- **Módulo**: `src/modules/garzones/garzones.module.ts` (exporta `GarzonesService`,
  consumido por `SalonesModule`).
- **Controller**: `src/modules/garzones/garzones.controller.ts`
- **Service**: `src/modules/garzones/garzones.service.ts`
- **Entidad**: `Garzon` → tabla `garzones`

### Tabla `garzones`

| Columna | Tipo | Notas |
|---|---|---|
| `garzon_id` | UUID PK | |
| `tenant_id` | UUID | FK tenants |
| `nombre` | VARCHAR(100) | |
| `pin_hash` | TEXT | bcrypt; nunca expuesto |
| `activo` | BOOLEAN | default `true` |
| `tipo` | TEXT | default `'garzon'`; CHECK `garzon` \| `cocina` \| `barra` |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | soft delete |

`cuentas` tiene tres FKs a `garzones`: `garzon_apertura_id` y `garzon_cierre_id`
(auditoría de quién abrió/cerró) y `garzon_responsable_id` (vigente; cambia con
transferencias — ver Salones).

### Métodos clave del service

- `crear` / `regenerarPin` — generan un PIN **único** por tenant vía `generarPinUnico`
  (aleatorio con `crypto.randomInt`, comparado con bcrypt contra los existentes y
  reintentado ante colisión), lo hashean y devuelven el PIN en claro **una sola vez**.
- `verificarPin(tenantId, garzonId, pin)` — **una** fila (`id + tenant + activo`) y
  **un** `bcrypt.compare`; devuelve el garzón o lanza `400 PIN inválido`. Es un `400`
  (no `401`) a propósito: un PIN incorrecto es un error operativo, no un fallo de
  autenticación de la sesión del dispositivo — un `401` haría que el frontend
  (`useApiFetch`) intente refrescar el token y cierre la sesión del restaurante.
  El mensaje **no distingue** garzón inexistente de PIN incorrecto.
  Reemplazó a `resolverGarzonPorPin(tenantId, pin)` (2026-08-08), que iteraba todos los
  activos porque no había a quién comparar — ver arriba la medición del costo.
- `listarParaSelector(tenantId, enTurno)` — las dos listas complementarias, en **una**
  query con `EXISTS`/`NOT EXISTS`, devolviendo solo id y nombre. Excluye al placeholder
  `Mostrador`.
- `obtenerActivoPorId(tenantId, id)` — valida pertenencia al tenant + `activo`, o lanza
  `400 Garzón no encontrado o inactivo`. **Todo `garzonId` que llegue desde el body pasa
  por acá antes de persistirse.** Lo usa `VentasService` para `propinaCierreMesa`: sin esa
  validación la propina se acredita a un garzón de otro tenant y este la cobra en su
  liquidación. (`propinaDirecta` no lo necesita: `asegurarMostrador` ya es tenant-scoped.)
  El seed incluye un garzón de Falabella (`…440332`) cuya única razón de existir es que el
  e2e pueda ejercer ese cruce con un garzón activo y válido.

---

## Frontend

- **Composable**: `app/composables/useGarzones.ts` (`listar/crear/actualizar/
  regenerarPin/eliminar/paraSelector/verificarPin`).
- **Modal de identificación**: `components/salones/GarzonPinModal.vue` — dos pasos
  (elegir garzón, después teclado), con "Cambiar de garzón" para volver sin cerrar el
  modal ni perder la acción que lo abrió. Verifica **antes** de emitir (vía
  `verificar-pin`), así un PIN equivocado se corrige en línea. Lo reutilizan los 6
  flujos de `pages/salones/index.vue` —entrar y salir de turno, abrir, cobrar, tomar y
  transferir cuenta—, que muestra el responsable vigente (independiente de quién
  abrió/cerró).
- **Página admin**: `pages/configuracion/garzones.vue` — tabla con crear/editar,
  regenerar PIN y eliminar. Al crear o regenerar, el PIN generado se muestra en un
  **modal una sola vez** (con aviso de que no se volverá a mostrar).
  Entrada de nav bajo Configuración (gated `Salones/Crear`).

---

## Testing

### Unit (backend)

```bash
cd backend && npx jest garzones salones
```

Cubre: generación y unicidad del PIN (con reintento ante colisión),
`verificarPin` (una consulta / match / 400), la forma de las dos listas del selector
(`EXISTS`/`NOT EXISTS`, con el query builder **mockeado**), regeneración de PIN, y que
abrir/cerrar cuenta persisten `garzon_apertura_id`/`garzon_cierre_id` (auditoría) y al
abrir también `garzon_responsable_id`.

### E2E (backend, Postgres real)

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

⚠️ `test/garzones-selector.e2e-spec.ts` **no lo corre el comando unit de arriba** (config
aparte), y es el único que ejercita cosas que el mock no puede ver: que el SQL del selector
**compile**, y que la lista **no filtre garzones de otro tenant** — medido: borrar el
`where` de tenant deja el gate unit entero en verde.

### Manual (frontend)

1. `docker-compose up` (el seeder crea garzones demo con PINs conocidos: Ana=111111,
   Bruno=222222, Carla=333333 en el tenant Paris; los nuevos garzones creados por la
   UI reciben un PIN autogenerado).
2. Configuración → Garzones: crear (el PIN se muestra una vez), regenerar PIN.
3. Salones → abrir cuenta: PIN correcto abre la cuenta (apertura + responsable vigente
   inicial visibles); PIN incorrecto muestra "PIN inválido" (sin cerrar sesión).
4. Cerrar y cobrar: pide el PIN del garzón que cierra (auditoría; puede diferir del
   responsable vigente).

---

## Related Features

- [Turnos y Sesiones de Garzón](./turnos-garzones.md)
- [Salones y Mesas](./salones-mesas.md)
- [Ventas](./ventas.md)
