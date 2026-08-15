## Lente: Tests que no prueban nada, sobre el control de acceso
## Veredicto: 2 hallazgos

### Qué revisé para poder afirmarlo

Leí completos: `backend/src/modules/auth/auth.service.spec.ts`,
`backend/src/modules/auth/tokens-acceso.service.spec.ts`,
`backend/src/modules/tenants/tenants.service.spec.ts` (579 líneas),
`backend/test/alta-usuarios-tenant.e2e-spec.ts` (365),
`backend/test/invitacion-y-reset.e2e-spec.ts` (324),
`backend/test/tenants-members.e2e-spec.ts` (162),
`backend/test/cajones.e2e-spec.ts` (246),
`backend/test/uso-reglas.e2e-spec.ts` (313),
`backend/test/unicidad-nombre.e2e-spec.ts` (281),
`frontend/app/middleware/auth.spec.ts`, `admin.spec.ts`, `permiso.nuxt.spec.ts`,
`frontend/app/composables/usePermisosCrud.nuxt.spec.ts`.

Leí en detalle las secciones de aislamiento/permiso de `garzon-pin.e2e-spec.ts`
(líneas 250-329), `caja-testigo.e2e-spec.ts` (640-800) y `recuentos.e2e-spec.ts`
(490-589), y grepeé `403|tenant|permiso|Forbidden` sobre los 32
`*.e2e-spec.ts` para localizar todos los tests de guard/aislamiento del
repositorio y decidir cuáles ameritaban lectura completa.

Confirmé por código fuente (`cajones.service.ts`, `tenants.service.ts`,
`tenants.controller.ts`) el comportamiento real detrás de cada hallazgo antes
de reportarlo, y confirmé con `grep` que no existe ningún `*.e2e-spec.ts` que
ejercite `razon-social` (cero resultados) — el único test de H2 es el unit
que reporto.

No leí completos (solo grep de contexto, sin encontrar patrones de esta
lente): `papelera.e2e-spec.ts` (2478 líneas — solo las primeras 130),
`caja.e2e-spec.ts`, `motivos-diferencia.e2e-spec.ts`, `reglas-valor.e2e-spec.ts`,
`ventas.e2e-spec.ts`, `pasarela-oneclick.e2e-spec.ts`, `salones-*.e2e-spec.ts`,
`combos.e2e-spec.ts`, `items-pausados.e2e-spec.ts`. Es la superficie que
queda sin cobertura de esta pasada — no la doy por limpia.

Confirmado (no re-reportado, ya sabido): `roles/` y `rbac/` sin specs;
`users/` y `me/` tampoco tienen ningún `*.spec.ts` (no está en la lista de
"ya conocido" del brief, pero es ausencia de test, no un test que miente —
fuera de esta lente).

---

### H1. El allow-list de un cajón: el test de "usuario ajeno al tenant" nunca usa un usuario ajeno

- **Severidad:** alta
- **Ubicación:** `backend/test/cajones.e2e-spec.ts:221-227` (test), lógica real
  en `backend/src/modules/cajones/cajones.service.ts:193-201`
- **Qué está mal:** El test se llama *"un usuarioId ajeno al tenant devuelve
  400"* pero manda `'00000000-0000-4000-8000-000000000000'` — un UUID que no
  existe en ningún tenant, no un usuario real de OTRO tenant. La validación en
  `setUsuarios()` es:
  ```ts
  const miembros = await this.usuarioTenantRepo.count({
    where: { tenantId, usuarioId: In(ids) },
  });
  if (miembros !== ids.length) { throw new BadRequestException(...) }
  ```
  Un UUID inexistente y un UUID de otro tenant dan el mismo resultado hoy
  (count 0) — el test no distingue "no scopea por tenant" de "no existe en
  absoluto".
- **Escenario:** El admin de Paris (`tokenAdmin`) hace `PUT
  /cajones/:id/usuarios` con un `usuarioId` real de Falabella (existe en
  `usuarios_tenants` con `tenant_id = FALABELLA`). Si mañana alguien reescribe
  el `where` como `{ usuarioId: In(ids) }` —sin `tenantId`— ese request pasa
  la validación (count = 1 = ids.length) y el usuario de Falabella queda en el
  allow-list de un cajón de Paris: alguien de otro tenant obtiene acceso a un
  recurso operativo que no le corresponde.
- **Por qué ningún test lo caza:** Con el `tenantId` sacado del `where`, el
  test actual (UUID `00000000-...`) sigue en 400 igual —ese UUID no existe en
  NINGÚN tenant, así que el count sigue en 0 sin importar el scoping—. El
  mutante que sobrevive es borrar `tenantId` de la línea 195
  (`this.usuarioTenantRepo.count({ where: { tenantId, usuarioId: In(ids) } })`
  → `where: { usuarioId: In(ids) } }`): la suite queda entera en verde. El
  test correcto ya existe como patrón en el mismo repo —
  `recuentos.e2e-spec.ts:564-587` arma exactamente este caso con un
  `motivoDiferenciaId` REAL de Falabella, con el comentario explícito *"no un
  uuid inventado"*— así que el gap es una inconsistencia contra el propio
  estándar del proyecto, no una laguna de criterio.
- **Confianza:** alta — verificado abriendo el service, el test, y el
  contraejemplo positivo (`recuentos.e2e-spec.ts`) que muestra que el equipo
  sabe construir este caso correctamente en otro lado.

### H2. `RazonSocial`: el único test de aislamiento por tenant es ciego a los argumentos del mock

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/tenants/tenants.service.spec.ts:231-236`
  (`updateRazonSocial`) y `:250-255` (`removeRazonSocial`); mismo patrón en
  `:283-296` (`setPreferida`). Servicio real en
  `backend/src/modules/tenants/tenants.service.ts:688-691`,
  `:701-705`, `:711-714`.
- **Qué está mal:** Los tres tests se llaman *"lanza NotFoundException si no
  pertenece al tenant"* / *"si la razón social no existe en el tenant"*, pero
  el mock del repositorio no distingue por argumentos:
  ```ts
  razonSocialRepo.findOne.mockResolvedValue(null);
  await expect(service.updateRazonSocial('tenant-uuid', 'rs-uuid', {...}))
    .rejects.toThrow(NotFoundException);
  ```
  `findOne` está mockeado para devolver `null` sin importar qué `where` reciba
  — el test nunca inspecciona `razonSocialRepo.findOne.mock.calls` para
  confirmar que el `tenantId` viajó en la consulta. Prueba solamente "si el
  repo dice que no existe, el service tira 404", no que el service pida al
  repo el filtro correcto.
- **Escenario:** El admin del tenant Paris hace `PATCH
  /tenants/razones-sociales/:id` (o `DELETE`) contra el UUID de una razón
  social real de Falabella (RUT, dirección, banderas `habilitado`/`preferida`
  de esa empresa). Hoy el `where: { id, tenantId }` en
  `tenants.service.ts:689` lo bloquea con 404. Si ese `tenantId` se cae de la
  consulta —typo, refactor, copy-paste— el admin de Paris pasa a poder leer el
  registro completo, editarlo o borrarlo (soft delete) sin que ningún test lo
  note: cross-tenant write sobre datos fiscales de otra empresa.
- **Por qué ningún test lo caza:** Mutante: en `tenants.service.ts:689` (y
  `:703`, `:712`) cambiar `where: { id, tenantId }` por `where: { id }`. Los
  tres tests de "unit" siguen en verde porque el mock de `findOne` ignora sus
  argumentos y sigue devolviendo `null`/la fila mockeada según el test.
  Tampoco lo agarra el gate de e2e: **no existe ningún
  `*.e2e-spec.ts` que ejercite `razon-social`/`RazonSocial`** (grep sobre los
  32 archivos, cero resultados) — el único test que dice cubrir este
  aislamiento es exactamente el que no lo prueba.
- **Confianza:** alta — confirmado el guard (`TenantAdminGuard`, cualquier
  admin de cualquier tenant lo pasa por diseño — el admin es un rol fijo y
  automático de cada tenant), el `where` real con `tenantId`, y la ausencia
  total de e2e para este recurso.

---

Ambos hallazgos son de la misma familia: el proyecto **sabe** construir el
test correcto (`recuentos.e2e-spec.ts`, `uso-reglas.e2e-spec.ts`,
`tenants-members.e2e-spec.ts` lo hacen bien, con contrapesos explícitos y
usuarios/recursos reales de otro tenant) — los dos casos reportados son los
puntos donde ese estándar no se aplicó, no una falla sistemática de la suite.
