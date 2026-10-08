# Plan: el token del retorno de Webpay y la configuración de la pasarela del tenant

**Status**: Done
**Date**: 2026-10-08
**Owner**: orquestadora (encargo y decisiones técnicas A/B/C del 2026-10-08)

## Context

Dos entradas de `docs/agent/pendientes.md` § 2, las dos leídas y no medidas. Medido por HTTP
contra el backend del worktree:

- **Retorno**: un `token_ws`/`TBK_TOKEN`/`TBK_ORDEN_COMPRA` que llega como objeto o como array
  (por POST form, por POST JSON o, en el caso del array, por GET) sí llega al `WHERE`, pero `pg`
  lo serializa a texto (`'{"a":1}'`, `'{"x","y"}'`) y no matchea ninguna orden. Contesta el
  mismo 404 que un token desconocido y no escribe nada. Lo que falta es validar en el borde, no
  hay un hueco.
- **Configuración**: es peor que lo que decía la entrada. `CredencialesService.resolver` arma la
  credencial de MALL como `{ baseUrl, ...plataforma, ...tenant }`. Con `baseUrl` en la config,
  el cobro le mandó a un host local el `Tbk-Api-Key-Id` y el `Tbk-Api-Key-Secret` de la
  plataforma. Los no-string se guardan y viajan a Transbank tal cual. Un secreto de 90 kB y un
  `{}` dan 500 al cobrar.

## Tareas

- [x] E2E `pasarela-retorno.e2e-spec.ts`. Cubre los desenlaces reales (aprobado, abortado,
  abortado con `token_ws`, timeout, doble retorno) por GET, POST form y POST JSON, más la
  inscripción aprobada. Agrega la basura (objeto o array) → 400 sin escribir y sin llamar al
  proveedor. La basura debe dar rojo sin el pipe.
- [x] Pipe de parámetro en `pasarela-retorno.controller.ts`: no-string → 400, tope de 255. No
  usa `@Body() dto`, porque Transbank manda campos que no controlamos (lo fija
  `validacion-global.e2e-spec.ts`).
- [x] `ConfiguracionPasarelaDto` anidado (decisión A): `commerceCodeHijo`, `mallCommerceCode` y
  `apiKeySecret`, cada uno `@ValidateIf(v !== undefined) @IsString @Matches(/\S/) @MaxLength(255)`
  (`@IsOptional` dejaba pasar `null`; lo mostró el e2e). Lo hereda el PATCH. Las puertas que escriben `tenant_pasarela.configuracion` son `TenantPasarelaService.crear`
  y `.actualizar` (POST y PATCH de admin) y el seed; no hay ruta de superadmin. E2E de
  escritura: no-string, vacío, enorme y clave de más → 400 sin cambiar el blob; lo que manda la
  pantalla → 2xx.
- [x] `CredencialesService.resolver` (decisión B): en MALL, del tenant solo pasa
  `commerceCodeHijo`. En los dos modos, `baseUrl` sale del ambiente. Unitario que fija la
  credencial de hoy con datos válidos, más el ataque. E2E con un `baseUrl` ya guardado (blob
  escrito directo): el cobro sigue yendo al host de la plataforma.
- [x] Mutantes: sin pipe, sin DTO, sin resolver. Cada uno revierte al código anterior.
- [x] Docs: `pasarela-pagos.md` (Seguridad, retornos y pantalla), `resueltos.md`, `pendientes.md`
  (pregunta del owner en § 4 sobre el `commerceCodeHijo` declarado por el tenant),
  `backend.md` § 3.
- [x] Pantalla (pedido de la orquestadora): mensajes del DTO en español con `@Matches(/\S/)`,
  y en `pasarelas.vue` el gemelo del `/\S/` (`.trim()`) en MALL e INDIVIDUAL, con su spec. El tope de 255 no tiene gemelo: lo dice el 400.
- [x] Gate completo, `verify-feature` con recibo y `api-security-reviewer` (LIMPIO; dejó dos entradas preexistentes en `pendientes.md` § 2).
