# Cierre forzado de caja ajena, con testigo que da fe — Design Spec

**Fecha:** 2026-08-11
**Estado:** 📐 Aprobado por el owner — listo para plan de implementación
**Investigación:** [`docs/agent/investigaciones/2026-07-23-gestion-caja.md`](../../agent/investigaciones/2026-07-23-gestion-caja.md) — §6 (mecanismo, 2026-07-23) y **§10** (responsabilidad, testigo y sellado, 2026-08-11)
**Feature relacionada:** [`docs/features/gestion-cajas.md`](../../features/gestion-cajas.md)
**Diferenciador:** [`docs/DIFERENCIADORES.md`](../../DIFERENCIADORES.md) — ningún POS relevado tiene campo de testigo

---

## Contexto

Hoy `cerrar` es **owner-only**: solo el dueño de una caja puede cerrarla. Un cajero que se va
a mitad de turno deja su caja abierta para siempre, y como
`ux_cajas_activa_por_usuario` impide tener dos cajas activas por `(tenant, usuario)`, **esa
persona no puede volver a abrir caja nunca más** hasta que aquella se cierre. No hay salida.

Habilitar el cierre forzado abre una pregunta que el permiso no responde: **si el encargado
cuenta solo, ¿qué dice el registro sobre una plata que su dueño nunca vio contar?** Hoy
`cajas.usuario_id` conflaciona *de quién es el turno* con *quién respondió por el efectivo*,
así que cualquier diferencia se leería para siempre como el faltante del ausente.

La investigación (§10) reencuadró la pregunta. El estándar de manejo de efectivo no elige a
quién imputar: **condiciona** la imputación a dos requisitos acumulativos — acceso exclusivo
**y** oportunidad de estar presente en el conteo. Contar sin el dueño rompe el segundo, así
que la imputación **se cae**. No se traslada: *"la diferencia es de quien contó"* no existe
como doctrina.

🇨🇱 Y en Chile el peso está en la norma laboral, no en la competencia: sin **asignación de
pérdida de caja** pactada, un faltante **no se le puede descontar** al trabajador
(DT, ORD. N°4229). La atribución vale como **prueba, no como cobro** — lo que hay que
asegurar es la trazabilidad, no acertarle al culpable.

⚠️ **La lectura legal está sin validar por un abogado.** Es doctrina de la DT leída por un
agente. El diseño no depende de ella —funciona igual si la interpretación cambia—, pero la
justificación escrita sí, y no debe usarse en comunicación externa hasta validarla.

---

## Decisiones del owner (2026-08-11)

| # | Decisión |
|---|---|
| 1 | El encargado **puede** cerrar la caja de otro, y se registra **quién contó** |
| 2 | La diferencia de un cierre forzado queda como **incidente**, no como faltante del cajero |
| 3 | El testigo **da fe del conteo**, no aprueba la diferencia |
| 4 | El testigo es **opcional**, y queda grabado que lo fue |
| 5 | Cerrar forzado **sin** testigo exige **comentario obligatorio** |
| 6 | Solo **garzones** pueden dar fe, por ahora |
| 7 | La solicitud llega **a la pantalla del garzón**; el encargado **no puede firmar por él** |
| 8 | El aviso es **pasivo**: aparece cuando el garzón entra a su pantalla. Sin tiempo real |

**Criterio que resolvió los empates, del owner:** *"lo más transparente y auditable posible"*
→ **guardar el hecho crudo y derivar lo demás**, en vez de guardar conclusiones.

---

## Modelo de datos

### `cajas` — tres columnas nuevas

| Columna | Tipo | Por qué |
|---|---|---|
| `cerrada_por` | `UUID REFERENCES usuarios` | Quién ejecutó el cierre. **Se guarda siempre**, también en el cierre normal. |
| `testigos_disponibles` | `SMALLINT` | Cuántos garzones tenían sesión abierta al **congelar el conteo** (paso 3). |
| `comentario_cierre` | `TEXT` | Obligatorio cuando el cierre es forzado y sin testigo firmado. |

⚠️ **`comentario_cierre` es una columna nueva y NO se reusa `cajas.comentario`**, aunque
exista y tiente. Ese campo es el comentario **de la apertura** (`abrir()` lo escribe desde
`dto.comentario`). Son dos hechos, en dos momentos, de dos personas distintas: pisarlo
borraría lo que el cajero escribió al abrir su turno, justo en el registro que esta feature
existe para hacer confiable.

**`cerrada_por` se guarda siempre y "forzado" se deriva** (`cerrada_por <> usuario_id`), en
vez de un flag `es_forzado`. Un flag puede terminar contradiciendo a los datos; una
derivación no puede. Aplicación de la regla del owner.

**`testigos_disponibles` es lo que convierte el silencio en información.** Sin él, *"cerró
solo porque no había nadie"* y *"cerró solo habiendo tres garzones en turno"* se ven
idénticos. Se congela junto con el conteo: consultarlo después daría otro número.

### `caja_testigo` — tabla nueva

Una fila por solicitud. Cero, una o varias por caja.

| Columna | Tipo | Notas |
|---|---|---|
| `caja_testigo_id` | `UUID` PK | |
| `tenant_id` | `UUID NOT NULL` → `tenants` | Convención del proyecto |
| `caja_id` | `UUID NOT NULL` → `cajas` | |
| `garzon_id` | `UUID NOT NULL` → `garzones` | Quién da fe |
| `sesion_garzon_id` | `UUID NOT NULL` → `sesiones_garzon` | **La prueba de que estaba en turno.** El garzón dice quién es; la sesión dice que estaba trabajando |
| `solicitada_por` | `UUID NOT NULL` → `usuarios` | Quién pidió la firma |
| `estado` | `TEXT NOT NULL DEFAULT 'pendiente'` | `pendiente` \| `firmada` \| `rechazada` \| `cancelada` \| `caducada` |
| `comentario_garzon` | `TEXT` | Lo que el garzón quiera decir al rechazar |
| `solicitada_el` | `TIMESTAMPTZ NOT NULL` | |
| `resuelta_el` | `TIMESTAMPTZ` | Cuándo firmó o rechazó |
| `creado_el` / `actualizado_el` / `eliminado_el` | | Convención |

**Índice único:** `(caja_id, garzon_id) WHERE eliminado_el IS NULL` — un garzón no firma dos
veces la misma caja.

**`sesion_garzon_id` y no solo `garzon_id`:** un `garzon_id` suelto dice quién es, no que
estuviera ahí. La sesión ata la firma al turno concreto, que es lo que la hace prueba.

**`resuelta_el` separada de `solicitada_el`:** un conteo dura veinte minutos. Firmar al
principio y firmar al final no son el mismo hecho.

**Las firmas no se editan ni se borran.** El soft delete existe por convención del repo, pero
ninguna operación de esta feature lo usa: son hechos con hora, no estados.

**No puede dar fe** un garzón con `es_placeholder = true` (el "Mostrador", que no es una
persona sino el marcador de propinas sin atribuir) ni uno sin sesión abierta.

---

## Flujo

### 1 · El encargado abre el cierre forzado

Desde **Cajas** (la vista de supervisión), sobre una caja abierta ajena. Requiere
`Cajas:Actualizar` — el permiso **existe** (`Actualizar` es una de las acciones estándar y
`Cajas` es un módulo), pero verificado el 2026-08-11 **hoy no lo usa ninguna ruta de caja**:
`caja.controller.ts` solo pide `Cajas:Leer`. Esta es la primera ruta que lo va a exigir.

La pantalla muestra **de quién es la caja y desde cuándo**, y **los garzones con sesión
abierta ahora** — o avisa que no hay ninguno.

### 2 · Cuenta a ciegas

Sin ver lo esperado, igual que el cierre ciego que ya existe.

### 3 · Se congela el conteo — **antes** de pedir la firma

⚠️ **El orden importa y es lo único que hace que la firma valga.** Si el garzón firmara
antes, el encargado podría editar los montos después y la firma quedaría atestiguando otra
cosa. El conteo se congela primero; la solicitud se emite contra números que ya no cambian.

Esto reusa la **fase 1 del cierre en dos fases** que ya existe
(`POST /caja/:id/conteo`), que ya congela el arqueo. Acá se guarda además `cerrada_por` y
`testigos_disponibles`.

🔧 **Único retoque al flujo existente:** hoy, si la caja **cuadra clavada**, la fase 1 cierra
directo a `cerrada`. Un cierre forzado tiene que pasar igual por la ventana intermedia
aunque cuadre — si no, no hay dónde poner la firma.

### 4 · Solicita la firma (opcional)

El encargado elige uno o varios garzones de la lista. Cada uno genera una fila `pendiente`.

### 5 · El garzón resuelve, desde su pantalla

En `/salones` —la pantalla que ya usa— le aparece la solicitud pendiente. **Aviso pasivo:**
la ve cuando entra, no le suena nada. En un local están a diez metros; el encargado le avisa
de viva voz.

Ve **lo que se contó** —los montos del arqueo congelado— y **nunca lo esperado**: eso
mantiene intacto el cierre ciego. Sin ver lo que atestigua, la firma no valdría nada, que es
el modo típico en que este control se vuelve un trámite vacío.

Entonces **firma con su PIN** o **rechaza**, con comentario opcional.

🔒 **El encargado no puede completarla**, sepa el PIN o no: la acción vive en la pantalla del
garzón y contra su sesión abierta. Es la corrección explícita del owner y **es el punto
central de la feature** — sin eso, el encargado carga un testigo que ni se entera.

### 6 · Se cierra

El encargado no queda bloqueado esperando: puede cerrar sin esperar, y las solicitudes
pendientes pasan a `cancelada`. Si no hay ninguna firma, **el comentario es obligatorio**.

De ahí sigue el camino existente: si alguna línea descuadra, la caja va a `en_conciliacion` y
las diferencias se justifican con su motivo en la fase 2.

### Ciclo de vida de una solicitud

```
                    ┌──→ firmada     (el garzón dio fe)
                    │
pendiente ──────────┼──→ rechazada   (el garzón vio el conteo y no está de acuerdo)
                    │
                    ├──→ cancelada   (el encargado cerró sin esperar)
                    │
                    └──→ caducada    (el garzón cerró su turno con la solicitud abierta)
```

Los cuatro finales son informativos. **`rechazada` es el más valioso** y hoy no existiría en
ninguna parte del sistema.

**Quién dispara cada transición:** `firmada` y `rechazada`, el garzón desde su pantalla;
`cancelada`, el encargado al cerrar sin esperar; `caducada`, el cierre de la sesión del
garzón (`sesiones-garzon`), que tiene que resolver las solicitudes pendientes que dependan de
ella — una solicitud viva contra una sesión cerrada sería un estado imposible de honrar,
porque la firma se valida contra esa sesión.

---

## Qué se ve después

Una caja cerrada por otro cuenta su historia sola, sin que nadie tenga que reconstruirla:

> Caja de **Juan Pérez**, turno del 11/08.
> Contada por **María González** el 11/08 a las 23:40 — **el dueño no estuvo presente**.
> Había **3 garzones en turno**. Dio fe: **Ana Ruiz**, 23:42.
> Diferencia: **−$8.000** — *registrada como incidente, no como faltante de Juan Pérez*.

Y sin testigo, dice **por qué**:

> Había **0 garzones en turno**. Sin testigo.
> Comentario: *"Juan se fue 21:30 por urgencia familiar. Conté solo, local ya cerrado."*

**"Incidente" es una lectura, no una columna nueva.** Se deriva de `cerrada_por <> usuario_id`
donde hoy se muestra la diferencia. Coherente con la regla de derivar en vez de guardar
conclusiones.

---

## Qué NO entra

- **El cierre normal no se toca.** El cajero que cierra su propia caja sigue igual.
- **El umbral de aprobación por diferencia** es la decisión de al lado
  ([`pendientes.md`](../../agent/pendientes.md)), no esta.
- **Sellar y contar después** — sin decidir. Anotado como hallazgo.
- **Usuarios como testigos** — solo garzones (decisión 6).
- **Notificación en tiempo real** — requeriría una dependencia nueva; `CLAUDE.md` obliga a
  detenerse antes de eso.
- **Testigo genérico para otros actos** (anular una venta grande, una merma alta) — el patrón
  se reusará copiándolo; construir la tabla genérica ahora sería infraestructura
  especulativa, y además una tabla `tipo + id` pierde las llaves foráneas reales, que es
  justo lo que hace confiable un registro de auditoría.

---

## Cruce con las otras decisiones de caja

**El testigo destraba el cruce que había quedado abierto.** Si el encargado cierra la caja de
otro y la diferencia supera el umbral, ¿quién aprueba? Como el testigo **da fe del conteo** y
no aprueba la diferencia, la aprobación sigue siendo del encargado, **incluso sobre sí
mismo** — y eso deja de ser un agujero porque esa autoaprobación ya no viaja sola: lleva
quién contó, quién dio fe, cuánta gente había y el comentario obligatorio.

🔶 **Sigue sin decidir** la pieza que aportó §10.6: sobre el umbral, el precedente bancario
**avisa al dueño de la plata**. Encaja con que la diferencia sea un incidente, pero es
decisión aparte.

---

## Riesgos y límites conocidos

1. **El testigo opcional puede no usarse nunca.** El owner lo eligió sabiéndolo. Mitigación:
   `testigos_disponibles` deja el dato para decidir con hechos si endurecerlo, en vez de
   suponerlo.
2. **Un local sin garzones no puede tener testigo.** Un minimarket cierra siempre sin firma y
   con comentario. Aceptado hoy; el disparador para reabrir es que un tenant así lo pida.
3. **El aviso pasivo depende de que el garzón mire.** Se resuelve de viva voz. Lo que **sí**
   queda garantizado es el acto deliberado, no la inmediatez.
4. **La firma se pide después de contar.** Si el garzón se fue en el medio, no hay testigo
   aunque al empezar hubiera. `testigos_disponibles` queda congelado en el paso 3, así que
   puede quedar en 3 y no haber ninguna firma — **es a propósito**: registra las condiciones
   del conteo, no la lista final de firmantes.
5. **La justificación legal chilena está sin validar.** Ver la advertencia del contexto.

---

## Testing

- **Unit (`caja.service.spec.ts`):** `cerrada_por` se guarda también en cierre normal; el
  comentario es obligatorio sin firma y no lo es con firma; `testigos_disponibles` cuenta
  sesiones abiertas y excluye placeholders; un cierre forzado que cuadra **no** salta la
  ventana intermedia.
- **Unit (testigos):** las cuatro transiciones de estado; que un garzón no pueda firmar dos
  veces; que un garzón sin sesión abierta no pueda firmar.
- **E2E:** el camino completo con garzón propio (⚠️ **no reusar a Ana del seed**: la sesión es
  única por garzón y varias specs la comparten); y el que **más importa** —
  **el encargado NO puede firmar por el garzón**, ni conociendo el PIN.
- **Mutante que tiene que morir:** emitir la solicitud **antes** de congelar el conteo. Es el
  error que anula la feature entera y el test tiene que cazarlo.
