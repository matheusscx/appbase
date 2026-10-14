# ADR-032: Límites de intentos — por persona, por destino y por garzón; la IP solo donde no hay nadie

**Status**: Accepted

**Date**: 2026-10-13

## Context

Hasta acá la API no tenía ningún límite de requests, y eso bloqueaba la salida a producción
(owner, 2026-08-09). Tres riesgos concretos: `POST /auth/recuperar` manda un correo a la casilla que
elija quien llama, así que un loop bombardea una casilla ajena y quema al remitente; `login` se
puede probar por fuerza bruta; y el PIN de 6 dígitos de un garzón se puede adivinar en ~17 h contra
un garzón concreto.

La solución de manual es "un límite por IP con `trust proxy`". **Acá no sirve, y se midió**:

- Desde ADR-022 el navegador no llega al backend, llega el proxy del frontend. En Railway el
  backend ve **una sola IP para todos los usuarios**, la salida del frontend (`152.55.176.109`,
  2026-10-13). Además, `X-Forwarded-For` y `X-Real-IP` falsificados no cambian esa IP, así que
  sale del par TCP. Un límite por `req.ip` sería un balde compartido por todo el SaaS, y abrir un POS
  ya son 15 requests.
- El proxy de h3 reenvía `X-Forwarded-For` **tal cual lo mandó el cliente** (leído en el código de
  h3 1.15.11). Una clave sacada de ahí se saltea poniendo un valor distinto en cada request.
- Lo que el borde de Railway le entrega a la app: medido el 2026-10-13 (hora de Chile) con un log temporal en
  `/api/health` (`14b7922c`, sacado en `b0183b5d`), con requests limpios y con las dos cabeceras
  falsificadas. **El borde pisa `X-Real-IP` con el cliente TCP real** y reescribe
  `X-Forwarded-For` como `<cliente>, <borde>`. Los valores falsos no llegan a la app. Por el
  proxy, el "cliente" que recibe el backend es la salida del frontend, y esa IP cambió entre dos
  deploys (`.109` → `.152`).
  Tampoco un `Connection: X-Real-IP` del cliente le hace sacar la cabecera al borde (medido igual).

Lo que pide un uso real, medido con Playwright el 2026-10-13:

| Uso | Requests |
|---|---|
| Venta de 3 líneas en el POS | ~8, más 15 al abrir la pantalla |
| Mesa de 3 líneas | ~22 (4 por línea) |
| Dashboard abierto | 5 por minuto |
| Peor caso de una persona | 55-70 por minuto |
| Peor caso de un local | 150-200 por minuto |

## Decision

**`@nestjs/throttler` como guard global, con claves que identifican a alguien sin depender de la
IP salvo cuando no hay nadie más a quien contar.** Ocho throttlers en
`backend/src/common/limites/limites.config.ts`, más el contador del PIN:

| Límite | Cuánto | Clave | Decidió |
|---|---|---|---|
| Global autenticado | 100/min | el usuario del access token **verificado** | owner (P1) |
| Global anónimo | 30/min | IP del cliente | orquestadora |
| Login | 10 cada 15 min | correo (normalizado, leído como lo lee passport: body y si no, query) | owner (P3) |
| Login | 30 cada 15 min | IP del cliente | owner (P3) |
| Refresh | 20/min | IP del cliente | orquestadora |
| Recuperar y registro | 3 por hora | correo de destino | orquestadora |
| Recuperar y registro | 10 por hora | IP del cliente | orquestadora |
| Links con token | 10/min | IP del cliente | orquestadora |
| PIN de garzón | 5 fallos seguidos → 5 min de espera | (tenant, garzón) | owner (P2) |

Las decisiones del owner salieron el 2026-10-13, por AskUserQuestion de la orquestadora, con la
escena y el costo de cada opción. Las descartadas fueron: P1, "100 por local"; P2, "3 fallos y
desbloqueo del admin" y "sin límite"; P3, "espera que crece".

- **La clave del global es la persona.** El guard global corre antes que `JwtAuthGuard`, así que el
  tracker **verifica** el JWT él mismo. Leer el `sub` sin firma le regalaría el límite a cualquiera:
  cambia el `sub` y estrena balde. Un token vencido pero bien firmado sigue contando a su dueño:
  es el request que dispara el refresh, y por IP iría al balde anónimo.
- **La clave por defecto de la librería incluye la ruta**, y "100 por persona" habría sido "100
  por persona en cada endpoint". La reemplaza `generateKey`: solo el límite y a quién se le cuenta.
- **El PIN no es un throttler: es un contador de fallos en `GarzonesService.verificarPin`**
  (`intentos-pin.ts`). El PIN tiene nueve caminos, no uno: `verificar-pin`, todo lo que pasa por
  `resolverGarzonActuante` y el testigo de caja, que llama a `verificarPin` directo. Un límite de ruta
  dejaba los demás abiertos. Cuenta fallos, no requests, y
  bloqueado no deja pasar ni el PIN correcto. **El intento se reserva antes del `bcrypt.compare`**:
  si se contara recién al fallar, N requests en paralelo pasarían todas el chequeo antes de que falle
  la primera, y el tope real sería el global por persona. Lo encontró la revisión independiente, y
  lo fija un e2e con diez intentos en paralelo. La clave es el `garzon.id` de la base, no el id que
  mandó el cliente: el DTO acepta un UUID en mayúsculas y Postgres lo encuentra igual, y cada
  combinación de mayúsculas habría sido un cupo nuevo. Un acierto legítimo del garzón en el medio
  de una ráfaga devuelve el cupo, porque los fallos son "seguidos": le da al atacante como mucho
  cuatro intentos extra, y no lo puede provocar.
- **La IP del cliente**, cuando hace falta, sale de `ipDelCliente`, en este orden:
  1. `x-cliente-ip`, solo si viene con `x-proxy-secreto` igual a `PROXY_SECRETO`. La pone el proxy
     del frontend (`server/utils/cabeceras-del-cliente.ts`), que además borra las que mande el
     navegador con esos nombres.
  2. `IP_CABECERA_BORDE`, solo si está configurada y trae una sola IP. Es lo que llega directo al
     backend, como el retorno de Webpay. En Railway vale `X-Real-IP`, que según lo medido arriba
     el cliente no puede escribir. El proxy del frontend saca de la misma cabecera la IP que
     firma: en su entrada, el borde es el mismo.
  3. El par TCP. Es la falla segura: limita de más, no deja pasar.

  No se usa `trust proxy`.
- **Mensajes en español por límite, con `Retry-After`.** La librería los da en inglés y le pone
  sufijo a la cabecera (`Retry-After-<nombre>`). Lo corrige `LimitesGuard`. La app no reintenta
  sola.
- **Los conteos salen del entorno** (`LIMITE_*`). Las ventanas son fijas. `LIMITES_ESCALA`
  multiplica todos los conteos, y existe para el e2e, Playwright y el compose de desarrollo, que
  entran cientos de veces con el mismo admin. En producción no se define. El arranque loguea los
  valores efectivos (`[Limites] usuario=100 anonimo=30 …`).

## Alternatives considered

- **`trust proxy` + `X-Forwarded-For`**: se descartó porque la cabecera la escribe el cliente y el
  proxy la reenvía sin tocarla. Se mide en el e2e: rotar `x-cliente-ip` sin el secreto no da
  baldes nuevos.
- **100 por minuto por local**: lo descartó el owner. Con dos garzones cargando pedidos a la vez se
  corta en hora punta.
- **El PIN como throttler de `verificar-pin`**: se descartó porque deja ocho caminos abiertos y
  porque cuenta aciertos.
- **Redis desde el día uno**: no hace falta con una réplica. Es una dependencia y un servicio pago
  (ver Consequences).

## Consequences

- **El contador vive en la memoria del proceso. Alcanza mientras el backend sea una réplica en
  una región** (Railway: `numReplicas: 1` en `sfo`, medido el 2026-10-13). **Deja de alcanzar el
  día que haya más de una réplica o más de una región**: cada copia cuenta por su lado y el límite
  real es N veces el configurado. Ahí hace falta un store compartido (`@nest-lab/throttler-storage-redis`
  + `ioredis` + un Redis en Railway). Es pago y lo decide el owner.
- Un deploy vacía todos los contadores, el del PIN incluido. Es aceptable: un atacante gana una
  ventana por deploy.
- **Sin `PROXY_SECRETO` en los dos servicios, todo lo anónimo que pasa por el proxy comparte un
  balde**: login, registro y recuperar de todo el SaaS en 30 por minuto. Las variables se cargan en
  Railway antes del deploy. El log de arranque dice si el secreto está configurado (`proxy con
  secreto: sí`).
- Hoy recargar la página con el límite agotado lleva al login: el middleware de auth trata
  cualquier error de `/auth/me`, y de `/auth/refresh` en `tryRefresh`, como sesión inválida. Dentro de la app no pasa: `useApiFetch`
  no cierra la sesión ante un 429. Anotado en `pendientes.md`.
- **Cada límite por destinatario es también un modo de molestar a ese destinatario**, y es el
  costo aceptado al elegir la clave. Con 3 pedidos cualquiera deja una casilla sin recuperar ni
  registro durante una hora. Con 10 fallos deja a una persona sin login por correo durante 15
  minutos, aunque recuperar la contraseña la destraba. Y quien tiene `Salones:Operar` en el mismo
  tenant, o está frente a un tótem desatendido, deja a un garzón sin PIN 5 minutos. Ninguno es un
  bloqueo permanente; la alternativa (contar solo por IP) no frena a quien rota IPs.
- **`pasarela/api/*` comparte el global anónimo, y se aceptó así** (orquestadora, 2026-10-13). Es
  de servidor a servidor, con API key y sin JWT: 30 por minuto por IP del integrador, tomada de
  `X-Real-IP` porque llega directo al backend. Un comercio que integra cobros y reembolsos desde su
  sistema y pasa de 30 llamadas por minuto recibe 429. No se conoce ningún integrador activo. El
  paso siguiente, anotado en `pendientes.md` para quien prenda la pasarela, es un throttler propio
  para esas rutas que reemplace al anónimo (por ejemplo 120/min por IP). Contar por API key se
  descartó: obliga a ir a la base desde el guard o a confiar en una cabecera sin verificar.
- **Los límites por correo no mandan `X-RateLimit-*`**: el `Remaining` le contaría a cualquiera
  cuánta actividad tuvo una casilla ajena. `Retry-After` sale igual. Un correo con caracteres fuera
  de ASCII cuenta en un balde común, porque `LOWER()` de Postgres los minusculiza distinto que
  JavaScript y cada variante encontraría la misma cuenta en un balde nuevo. **El costo es cruzado**: 10
  logins a cualquier correo no ASCII cada 15 minutos dejan sin login por correo a todos los usuarios
  con un correo así, y 3 pedidos por hora les cierran también recuperar y registro, porque comparten
  el balde de destino. Tampoco es hermético: algunas letras no ASCII (`K` Kelvin, `İ`) sí
  coinciden con una cuenta ASCII en `LOWER()`, así que un atacante suma el balde común al de la
  cuenta. Queda acotado a 10 más cada 15 minutos, no a 2^n. Se aceptó porque hoy no hay ninguno (ni en el seed ni en los tests, y Gmail y
  la mayoría de los proveedores no los permiten). Si aparece uno, la salida es plegar mayúsculas con
  la misma semántica que `LOWER()` de Postgres en vez del balde único. Dentro de la misma
  ventana, el límite por IP se evalúa antes que el de correo, y el primero que bloquea corta: una IP
  ya bloqueada no crea una clave por cada correo que invente. Las tres cosas las pidió la revisión
  de seguridad.
- **Una ruta pública nueva queda en el global anónimo (30/min por IP) sin hacer nada.** Si manda
  algo afuera o valida una credencial, necesita su propio `@Limite(...)`, y si toma un PIN, pasar
  por `verificarPin`.
