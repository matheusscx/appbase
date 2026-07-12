# Diseño: Inscripción Oneclick en "Mis medios de pago"

**Status**: Approved
**Date**: 2026-07-11
**Owner**: Cesar Matheus

## Contexto

La página `/tienda/medios-pago` existe pero es mock puro: `useTarjetas` guarda
marca + últimos 4 en `localStorage`, nada llega al backend. El backend ya tiene
el flujo Oneclick real completo (`InscripcionesService`: iniciar → redirect a
Webpay → confirmar retorno → tarjeta en `pasarela_medio_pago`), pero solo
expuesto por la API m2m con API key (`/pasarela/api/inscripciones`), pensada
para integradores externos. No hay endpoints JWT para el usuario logueado.

Este trabajo expone la inscripción al usuario interno y reemplaza el mock del
frontend por el flujo real.

## Decisiones (brainstorming 2026-07-11)

1. **Alcance**: solo gestión de tarjetas (inscribir por Webpay, listar,
   eliminar, marcar preferida). Los flujos de cobro (tienda, suscripciones)
   quedan como están; conectarlos es una fase posterior.
2. **Pagador**: `pagadorRef = usuarioId` del token. Cada usuario ve y gestiona
   solo SUS tarjetas dentro del tenant activo.
3. **Sin Oneclick configurado**: se elimina el mock por completo. La página
   muestra un aviso y el botón de agregar deshabilitado. Sin tarjetas fantasma
   en localStorage.
4. **Preferida**: se mantiene, con soporte real en BD (columna + endpoint +
   prioridad en `resolverParaCobro`).
5. **Enfoque**: fachada en el módulo `online` (`/online/medios-pago/*`). La
   pasarela no conoce a la tienda; el mapeo "pagador = usuario logueado" es una
   regla de la tienda. Respeta el borde documentado en `pasarela.module.ts`
   ("los módulos de negocio que quieran cobrar importan PasarelaModule").
   Descartado: controller JWT dentro de pasarela (rompe la neutralidad del
   módulo) y frontend contra la API m2m (API key en el browser, inviable).

## Alcance

- Columna `preferida` en `pasarela_inscripcion` + lógica en
  `InscripcionesService`.
- Ownership por pagador en `eliminar` / `marcarPreferida` (param opcional).
- Fachada `/online/medios-pago` en `OnlineController` + `OnlineService`.
- Reescritura de `useTarjetas` contra la API y de `medios-pago.vue` sin
  formulario de tarjeta.

## Fuera de alcance

- Cobrar contra la tarjeta inscrita desde tienda/suscripciones.
- Pantalla admin de inscripciones del tenant (todas las de todos los usuarios).
- Limpieza/expiración de inscripciones `pendiente` abandonadas.
- Cambios en la API m2m existente (`/pasarela/api/inscripciones`).

## Diseño

### 1. Backend — módulo `pasarela` (dominio de la inscripción)

**Columna `preferida`:**

- `pasarela_inscripcion.preferida boolean NOT NULL DEFAULT false` — entity
  (`@Column({ default: false })`) + DDL en `startup-pos.sql`.

**`InscripcionesService`:**

- `marcarPreferida(tenantId, inscripcionId, pagadorRef?)`: en transacción,
  desmarca las demás inscripciones del mismo `tenant + pagadorRef` y marca
  esta. Solo sobre inscripciones `estado = 'activa'`; `NotFoundException` si no
  existe, no está activa o no es del pagador (cuando `pagadorRef` viene).
- `eliminar(tenantId, inscripcionId, pagadorRef?)`: el `pagadorRef` opcional se
  suma al `where`. La API m2m sigue llamando sin él (comportamiento intacto);
  la fachada interna lo pasa siempre — un usuario no puede tocar tarjetas de
  otro adivinando el UUID.
- `resolverParaCobro` (rama por `pagadorRef` sin id explícito): orden
  `preferida DESC, creadoEl DESC`. La preferida gana; sin marcada, cae a la más
  reciente (comportamiento actual). Único consumidor real del flag desde el
  día uno.
- `toPublico` expone `preferida`.

### 2. Backend — módulo `online` (fachada `/online/medios-pago`)

Rutas nuevas en `OnlineController`, mismos guards que el resto de `/online/*`
(`JwtAuthGuard, TenantGuard, PermisosGuard`), lógica en `OnlineService`
delegando en `InscripcionesService` con `pagadorRef = usuarioId` del token.
Sin permisos RBAC nuevos: gestionar tarjetas propias usa los permisos
`Tienda Online` existentes.

| Ruta | Permiso | Comportamiento |
|---|---|---|
| `GET /online/medios-pago` | `Tienda Online: Leer` | `{ oneclickDisponible, medios }`. `medios` = inscripciones `activa` del usuario (via `listarPorPagador`, filtradas) con su tarjeta (tipo, marca, últimos 4) y `preferida`. `oneclickDisponible` = `resolverConfiguracionActiva(tenantId, 'oneclick')` en try/catch → boolean. |
| `POST /online/medios-pago` | `Tienda Online: Crear` | `iniciar()` con `email` del token (`JwtUser.email`) y `urlRetorno = FRONTEND_URL + '/tienda/medios-pago'` (env ya existente, mismo patrón que el checkout Webpay). Devuelve `{ inscripcionId, urlWebpay }` con el token ya embebido: `urlWebpay?TBK_TOKEN=<token>` — mismo patrón GET que Webpay Plus (`?token_ws=`). |
| `DELETE /online/medios-pago/:id` | `Tienda Online: Crear` | `eliminar()` con `pagadorRef = usuarioId`. |
| `PATCH /online/medios-pago/:id/preferida` | `Tienda Online: Crear` | `marcarPreferida()` con `pagadorRef = usuarioId`. |

**Retorno de Webpay** — no se toca: `/pasarela/retorno/inscripcion` ya confirma
contra el proveedor (claim atómico anti doble-POST) y redirige a la
`urlRetorno` con `?inscripcionId=<id>&estado=activa|fallida`.

### 3. Frontend

**`useTarjetas` (reescritura completa):**

- Estado desde `GET /online/medios-pago` (muere el localStorage y
  `detectarMarca` — marca y últimos 4 vienen de Transbank).
- `agregar()` → `POST` → `window.location.href = urlWebpay` (sale de la SPA,
  igual que el checkout Webpay).
- `eliminar(id)` → `DELETE`; `marcarPreferida(id)` → `PATCH`; ambas refrescan
  la lista con un refetch (lista chica, sin update optimista).
- Expone `oneclickDisponible` para la página.

**`medios-pago.vue`:**

- Desaparece el formulario número/titular/vencimiento y el drawer — nunca un
  PAN en nuestra app. "Agregar tarjeta" → POST + redirect a Webpay.
- Al montar, si la URL trae `inscripcionId` + `estado`: toast de éxito
  (`estado=activa`) o fallo (`estado=fallida`), limpiar la query
  (`router.replace`), refrescar la lista.
- Si `!oneclickDisponible`: botón deshabilitado + aviso "El tenant no tiene
  una pasarela con tokenización configurada".
- La estrella de preferida se mantiene, ahora persistida.
- Tokens semánticos del design system, como el resto de la tienda.

### 4. Manejo de errores

- `POST` sin Oneclick activo → 400 del resolver (el botón ya estaría
  deshabilitado; el toast cubre la carrera).
- `DELETE` con `ProviderComunicacionError` (Transbank caído) → el error se
  propaga, la tarjeta NO se borra localmente, toast de error. Regla existente:
  nunca asumir éxito ante un fallo de comunicación.
- Inscripciones `pendiente` abandonadas (usuario cerró Webpay sin completar):
  no se listan (solo `activa`); quedan inertes en BD (limpieza fuera de
  alcance).
- Usuario vuelve con `estado=fallida`: toast de rechazo; la lista no cambia.

### 5. Testing

- `inscripciones.service.spec.ts` (ampliar):
  - `marcarPreferida` desmarca las hermanas del mismo pagador y marca la
    pedida; con `pagadorRef` ajeno → `NotFoundException`; sobre inscripción no
    activa → `NotFoundException`.
  - `eliminar` con `pagadorRef` ajeno → `NotFoundException` (y no llama al
    proveedor).
  - `resolverParaCobro` sin id explícito: prefiere `preferida = true` sobre la
    más reciente; sin preferida cae a la más reciente.
- `online.service.spec.ts` (ampliar o spec nuevo):
  - `GET`: `oneclickDisponible = false` cuando el resolver lanza; filtra solo
    `activa`.
  - `POST`: pasa `pagadorRef = usuarioId`, `email` del token, y devuelve
    `urlWebpay` con `?TBK_TOKEN=`.
- Manual: flujo completo contra el ambiente de integración de Transbank
  (inscribir con tarjeta de prueba, ver la tarjeta listada, marcar preferida,
  eliminar).

## Documentación a actualizar

- Feature doc de pasarela/tienda (o `docs/features/` nuevo si aplica).
- Tabla "Estado actual" de `CLAUDE.md`.
- `startup-pos.sql` (columna `preferida`).

## Decisiones abiertas

Ninguna.
