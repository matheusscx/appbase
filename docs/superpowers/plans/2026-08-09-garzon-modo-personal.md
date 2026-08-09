# Modo personal del garzón — Fase 2

**Status**: Implementado
**Date**: 2026-08-09
**Owner**: Cesar Matheus
**Viene de**: [`2026-08-08-elegir-garzon-antes-del-pin.md`](./2026-08-08-elegir-garzon-antes-del-pin.md) (Fase 1, tótem, hecha)

---

## Context

La Fase 1 dejó el tótem resuelto: lista de garzones + PIN, 1 bcrypt por intento en vez de N.
Falta el otro flujo que el owner separó: **el garzón con su propia tablet**. Ahí el JWT ya
dice quién es, y pedirle un PIN es re-probar lo ya probado.

Estaba bloqueada porque no había forma de crear usuarios del tenant. Se destrabó con
`POST /tenants/usuarios` (commit `1a36b7ed`).

⚠️ Esto **suma un modo que el diseño original descartó**: `docs/features/garzones.md` dice
que el garzón *"NO es un usuario del sistema — no tiene login ni JWT"*, para poder incorporar
personal temporal sin crear cuentas. Por eso el vínculo es **opcional**: sin él, todo
funciona exactamente como hoy.

## Decisiones ya tomadas (owner, 2026-08-08 — no reabrir)

- **El modo es EXPLÍCITO, no inferido.** `usuarios_tenants.es_totem`, no en `usuarios`: ser
  tótem es propiedad de cómo se usa esa cuenta **en ese tenant**, no de la persona.
- **Vínculo opcional** `garzones.usuario_id`, único por tenant sobre filas vivas.
- **El PIN se sigue generando y manteniendo para los vinculados.** Un garzón vinculado
  aparece igual en el selector del tótem y entra por PIN ahí. El tótem **no cambia en nada**.
- **Descartado `tipo = 'totem'` en `garzones`**: `tipo_garzon` es la clave de agrupación del
  reparto de propinas, con CHECK en 5 tablas. Un cuarto valor crea un grupo de reparto.
- **Sin configuración de "modo estricto"**.

## Decisiones que tomo yo acá (mecánicas — corregir si no coincidís)

- **Dónde se marca el tótem**: en la pantalla de configuración de usuarios, junto a los roles.
  Es administración del tenant → `TenantAdminGuard`, igual que el resto de esa pantalla.
- **Dónde se vincula el garzón**: en el form del garzón, un selector opcional de miembros del
  tenant. Es donde alguien que administra garzones lo va a buscar.

---

## La regla de resolución (el corazón de la fase)

Un único `resolverGarzonActuante(tenantId, usuarioId, credencial?)` que **reemplaza las 6
llamadas directas a `verificarPin`**, en **una sola consulta**:

1. La cuenta está marcada `es_totem` → **siempre** exige `garzonId` + PIN. Es un override
   duro: aunque alguien vincule un garzón a esa cuenta por error, no se vuelve personal.
2. Hay un garzón vivo y activo con `usuario_id` = el del JWT → **ese es el actuante**, sin
   PIN y sin bcrypt.
3. Ninguna de las dos → exige `garzonId` + PIN, como hoy.

⚠️ **El riesgo de la fase está en el paso 3.** Los 4 DTOs pasan a tener `garzonId`/`pin`
opcionales, así que en modo tótem alguien puede **omitirlos**. Si el resolver no corta ahí,
el PIN se vuelve salteable en los 6 lugares a la vez. Va con test que mate el mutante.

## Backend

- [x] Esquema: `usuarios_tenants.es_totem` (boolean, NOT NULL, default false) y
      `garzones.usuario_id` (uuid, nullable, FK a `usuarios`). Índice único parcial
      `(tenant_id, usuario_id)` sobre `usuario_id IS NOT NULL AND eliminado_el IS NULL`.
      En `startup-pos.sql` y en las dos entidades.
- [x] `resolverGarzonActuante` en `GarzonesService`, una sola consulta, las tres ramas.
- [x] Los 4 DTOs que extienden `CredencialGarzonDto`: `garzonId`/`pin` opcionales.
- [x] Los **6** call sites pasan por el resolver: `salones.service` ×2 (abrir y cerrar
      cuenta), `sesiones-garzon.service` ×3 (iniciar, cerrar, consultar sesión) y
      `cuenta-asignaciones.service` ×1 (traspaso).
      ⚠️ Eran 6, no 5: el del traspaso no aparecía en el grep inicial —está en otro
      service— y salió siguiendo el controller. Con 5, el traspaso habría seguido pidiendo
      PIN en tablet personal.
- [x] Vincular/desvincular desde el PATCH del garzón. Valida **tres** condiciones en una
      consulta: que el usuario **sea miembro vivo** del tenant, que **no esté marcado tótem**
      y que **no sea ya otro garzón vivo**. La tercera la garantiza el índice único, pero
      sola devolvía un 500 crudo desde una opción que el selector ofrecía.
- [x] Marcar/desmarcar tótem. Valida que esa cuenta **no tenga garzón vinculado**.
- [x] Endpoint para que el front sepa en qué modo está: `GET /garzones/mi-vinculo` →
      `{ garzonId, nombre } | null`, bajo el permiso de operar salones.
- [x] Seed: un garzón vinculado a un usuario y una cuenta tótem, para que el e2e ejercite
      los tres caminos.

## Frontend

- [x] Form de garzón: selector opcional de miembro del tenant.
- [x] Configuración de usuarios: marca de tótem.
- [x] `salones/index.vue`: con vínculo, los 6 puntos dejan de pedir PIN.

## Verification

- [x] Los tres caminos del resolver, con test cada uno.
- [x] **Sin vínculo y sin credencial → 400.** El mutante que borra esa rama tiene que poner
      algo rojo.
- [x] Una cuenta `es_totem` con garzón vinculado **igual pide PIN**.
- [x] El tótem sigue funcionando idéntico (no hay regresión en los 6 puntos).
- [x] `tenant_id` del token en todo el camino.
- [x] Gate completo por exit code + revisión independiente (`domain-reviewer`). **Cuatro
      rondas, cuatro bloqueantes**, todos con el gate en verde: el `pin: ''` que dejaba el
      modo personal sin poder entrar a turno; el 500 al vincular una cuenta ya tomada; el
      mensaje de "Mostrador" en `restaurar()` ante el índice nuevo; y un test que
      sobreescribía el vínculo del seed sin repararlo (7/14 en la segunda corrida).
