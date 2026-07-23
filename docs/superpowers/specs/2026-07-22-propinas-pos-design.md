# Diseño: Propinas en el POS

**Fecha**: 2026-07-22
**Owner**: Cesar Matheus
**Estado**: Diseño aprobado — pendiente de plan de implementación

---

## Objetivo

Habilitar el cobro de **propina en el Punto de Venta** (venta directa, canal
`fisico`), hoy disponible solo en el cierre de cuenta de salones. La propina del
POS debe entrar al mismo pool de propinas y repartirse con la **configuración de
distribución vigente del tenant**, sin quedar huérfana.

## No incluido (out of scope)

- Distribución **por origen** (que las propinas de POS se repartan distinto a las
  de mesa). Se evaluó y se descartó: rompería "un solo lugar de verdad".
- Cualquier cambio al **motor de liquidación** o a su snapshot.
- Propina en canal `online` (la tienda ya no la contempla y no se pidió).

---

## Contexto del modelo actual (lo que ya existe)

- Toda propina es una fila `venta_propina` **atribuida a un `garzon_id`
  obligatorio** (FK NOT NULL), con `tipo_garzon` / `sesion_garzon_id` /
  `turno_id` opcionales pero **todos-null o todos-set**
  (`venta-propina.service.ts` lo valida explícitamente).
- El cierre de cuenta (`salones.service.ts → cerrarCuenta`) arma la propina vía
  `CreateVentaDto.propinaCierreMesa` (garzón responsable + sesión + turno + tipo).
- El **motor de liquidación** (`liquidacion-propinas.service.ts`):
  - **Pool** (`buscarTipsElegibles`): suma `monto_pagado` de *todas* las propinas
    del período. **No filtra por `tipo_garzon`.**
  - **Participantes/receptores** (`garzonesGrupo`): unión de (garzones que
    generaron propinas *con `tipo_garzon` = el del grupo*) ∪ (garzones con
    *sesión* de ese tipo). El pool se reparte por % de grupo y, dentro, por el
    criterio del grupo (`PARTES_IGUALES`, `HORAS_TRABAJADAS`, `VENTAS_NETAS`,
    `CANTIDAD_CUENTAS`, `MANUAL`).
  - Filtro por turno: `cardinality($turnos)=0 OR vp.turno_id = ANY($turnos)`.

## Investigación de mercado (insumo, no verdad — ver `docs/agent/investigacion-mercado.md`)

- Los POS maduros atribuyen la propina de POS a **(a)** el staff logueado, **(b)**
  un servidor elegido, o **(c)** un **pool general**
  ([ROLLER](https://mysupport.roller.software/docs/add-and-assign-tips-at-pos),
  [Clover](https://blog.clover.com/tip-pooling-tip-splitting-guide-for-restaurant-owners/)).
- Quick-service/mostrador reparte casi siempre **pooled**, proporcional a horas
  ([Toast](https://support.toasttab.com/en/article/Common-Tip-Policies),
  [7shifts](https://www.7shifts.com/blog/restaurant-tipping-out-guide/)).
- **Patrón "servidor placeholder"**: Toast atribuye las propinas *sin mozo*
  (pedidos online) a un *"online server"* placeholder para que entren a la
  distribución igual que las de mesa
  ([Toast](https://support.toasttab.com/en/article/How-Toast-Handles-and-Distributes-Tips)).

**Qué sobrevive al cruce con nuestro código:** el patrón placeholder encaja
nativo porque nuestro pool ya se redistribuye por config. El "pool sin garzón"
(garzón nullable) se descartó: choca con el schema y no lo exige ni Toast.

---

## Decisión de diseño

### Modelo: garzón placeholder "Mostrador" con atribución neutra

La propina de POS = un `venta_propina` atribuido a un **garzón placeholder
"Mostrador"** (sembrado por tenant), con **`tipoGarzon` / `sesionGarzonId` /
`turnoId` = null**.

**Por qué reparte bien sin tocar el motor** (verificado en `garzonesGrupo`):
- `poolTotal` **incluye** la propina (el pool no filtra por `tipo_garzon`).
- Con `tipo_garzon = null`, la propina **no matchea ningún grupo** y el placeholder
  **no aparece como participante** → no recibe nada.
- Resultado: la plata de POS suma al pool y se reparte por la **config vigente**
  entre los participantes reales (partes iguales si el grupo está en
  `PARTES_IGUALES`, por horas si `HORAS_TRABAJADAS`, etc.). El placeholder nunca
  acapara. **Cero cambios de schema ni de motor.**

### Reparto: hereda la config del tenant (opción A)

La propina de POS no elige criterio al cobrar; se reparte con la única
configuración de distribución del tenant (`/configuracion/propinas-distribucion`),
igual que las de mesa.

### Edge del turno: nivel período (sin cambio de motor)

Una propina de POS no tiene turno (`turno_id = null`). Se liquida en la
liquidación de **período completo** (sin filtro de turno), donde ya se reparte por
la config. Operativamente: para liquidar las de POS, se corre una liquidación del
período sin filtrar turno. **Se documenta; no se cambia el motor.**

### Edges heredados (documentar, no resolver aquí)

- Si en el período no hay ningún participante con sesión (ni propinas de mesa), el
  pool no tiene a quién repartirse — limitación del modelo actual, vale para
  cualquier propina, no solo POS.
- Bajo `VENTAS_NETAS`, la venta del POS no suma "ventas" a ningún mozo (no tiene
  mozo); su plata igual se reparte proporcional a las ventas de los demás.

---

## Cambios

### Backend

1. **Seed del placeholder** (`seeder.service.ts` + alta de tenant): sembrar un
   garzón "Mostrador" por tenant, `activo: false` y `pin_hash` inutilizable (hash
   que ningún PIN de 6 dígitos produce), para que **nunca** se identifique por PIN
   ni aparezca en la operación de salones. Id fijo, patrón `550e8400-…`, próximo
   número libre del seeder. El alta de tenant (`tenants.service`, junto con rol
   admin / fórmula / caja virtual) también lo crea.
2. **DTO**: nuevo campo opcional en `CreateVentaDto`:
   `propinaDirecta?: { montoPagado: string; montoSugerido?: string; porcentajeSugerido?: string }`
   (sin `garzonId` — el front no conoce el placeholder). Excluyente con
   `propinaCierreMesa`.
3. **`ventas.service.crearEnTransaccion`**: si llega `propinaDirecta`, resolver el
   garzón "Mostrador" del tenant y armar el `venta_propina` con
   `tipoGarzon/sesionGarzonId/turnoId = null` y `estrategia = NO_VUELTO`. Reusa el
   paso 7g/pagos existente (generalizar el armado del input de propina para que
   acepte cualquiera de las dos fuentes).
4. **Permiso del sugerido**: `GET /propinas/porcentaje-sugerido` hoy exige
   `Salones:Operar`. Un cajero de POS puede no tenerlo → **ampliar el guard** para
   que también lo permita quien tiene `Ventas:Crear` (o exponer el sugerido por una
   ruta accesible al POS). A resolver en el plan.

### Frontend

5. **`pos.vue`**: activar `modoPropina` en el `CobroModal` (ya soportado por el
   componente compartido), cargar el porcentaje sugerido, y enviar `propinaDirecta`
   en el payload de `POST /ventas`. Mismo look & feel que el cobro de salones.

### Docs

6. Actualizar `docs/features/pagos.md` (o el doc de propinas correspondiente) con
   el comportamiento de propina en POS y el edge del turno. Fila en `docs/ESTADO.md`.

---

## Testing

- **e2e backend**: venta POS con `propinaDirecta` → crea `venta_propina` atribuido
  al garzón "Mostrador" con `tipoGarzon/sesionGarzonId/turnoId = null` y el monto
  en el pool; el placeholder no queda como participante.
- **e2e backend**: liquidación de período (sin filtro de turno) con la config por
  defecto → el pool incluye la propina de POS y se reparte entre participantes
  reales, sin que el placeholder reciba.
- **smoke navegador**: el POS muestra el campo de propina, calcula el sugerido y
  cierra la venta con el total + propina.
