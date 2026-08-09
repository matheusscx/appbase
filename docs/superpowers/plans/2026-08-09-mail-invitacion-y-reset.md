# Servicio de mail: invitación por link y reset de contraseña

**Status**: Implementado
**Date**: 2026-08-09
**Owner**: Cesar Matheus

---

## Context

No hay forma de mandar un mail —cero rastros de nodemailer, SMTP o cualquier proveedor— y
eso bloquea tres cosas a la vez. Esta tanda resuelve dos: **invitación** y **reset**. La
verificación de correo del auto-registro público queda fuera (decisión del owner).

Lo que hoy existe y esta tanda **reemplaza**: el alta genera una contraseña temporal que el
admin dicta, con cambio obligatorio. Todo ese andamiaje existe **solo porque un tercero
conoce una credencial ajena**. Con invitación, la persona elige su contraseña y nadie más la
conoce nunca.

## Decisiones ya tomadas (owner — no reabrir)

- **`nodemailer` contra el SMTP propio del owner.** Es el cliente, no el proveedor: el
  proveedor real entra por `.env` el día del deploy sin tocar código.
- **NO sumar `@nestjs-modules/mailer`**: motor de plantillas y config propia para dos mails.
- **Link de invitación, NO la contraseña por mail.** La contraseña mandada por correo queda
  en la casilla en texto plano para siempre y es reenviable; el link se quema al usarse. Y
  con invitación **nadie más que la persona conoce jamás una credencial suya**.
- **Con invitación desaparecen** `contrasenaTemporal`, `debe_cambiar_contrasena`, el 403 de
  `switchTenant` y `/cambiar-contrasena`. No se suavizan: se borran.
- **No se construye "reposición por el admin"**: con reset self-service el mail llega
  siempre a la persona, así que el admin no necesita conocer ninguna credencial ajena.

## Decisiones que tomo yo acá (corregir si no coincidís)

- **Una sola tabla de tokens** con campo `tipo` (`invitacion` | `reset`). Las dos son "token
  de un solo uso, con vencimiento, que termina en elegí-tu-contraseña"; separarlas duplica la
  lógica de expiración y de quemado.
- **Se guarda el HASH del token, no el token.** Mismo criterio que el PIN y la contraseña: si
  la base se filtra, los tokens vivos no pueden usarse. Va en claro **solo** en el link.
- **Vencimientos**: invitación **7 días**, reset **1 hora**. El reset es más corto porque lo
  dispara cualquiera que sepa un correo; la invitación la dispara un admin y la persona puede
  tardar en ver el mail.
- **`POST /auth/recuperar` responde IGUAL exista o no el correo.** Si no, es un oráculo de
  enumeración de cuentas.

---

## Sin credenciales: cómo se prueba

⚠️ **Restricción de diseño, no comodidad.** El envío va detrás de una interfaz que, con
`SMTP_HOST` vacío, **loguea el mail en vez de mandarlo**. Se corren 358 e2e por cierre y en
CI: mandando de verdad, cada corrida dispara mails reales, come el tope diario de Gmail y CI
necesitaría credenciales del owner. El fallback **también es el loop de desarrollo**: el link
aparece en el log del backend.

Lo que **no** se puede verificar hasta que haya credenciales: que Gmail acepte el envío, que
no caiga en spam, y cómo se ve el remitente reescrito.

⚠️ **`node_modules` es un volumen anónimo del contenedor**, así que sumar la dependencia
necesita `docker-compose up --build` (o instalar dentro del contenedor). No alcanza con
`npm install` en el host.

---

## Backend

- [x] Dependencia `nodemailer` + tipos. Claves `SMTP_*` **vacías** en `.env.example`, mismo
      patrón que `GOOGLE_CLIENT_SECRET`.
- [x] `MailService`: una interfaz, dos implementaciones de transporte. Con `SMTP_HOST` vacío
      **loguea y no manda**. Nunca lanza hacia arriba: un mail que no sale no puede tumbar la
      transacción que lo originó.
- [x] Tabla de tokens: `token_hash`, `tipo`, `usuario_id`, `expira_el`, `usado_el`. Índice
      único sobre `token_hash`. Entidad registrada **también** en el array `entities` de
      `app.module.ts` (no hay `autoLoadEntities`).
- [x] `POST /tenants/usuarios`: deja de generar temporal. Crea la cuenta **sin contraseña**
      (`contrasena` ya es nullable en la base real), emite invitación y manda el mail. La
      respuesta deja de traer `contrasenaTemporal`.
- [x] `GET /auth/invitacion/:token` (público): dice si el token sirve, sin quemarlo. Es lo que
      permite mostrar "este link venció" en vez de un formulario que va a fallar.
- [x] `POST /auth/invitacion/:token` (público): fija la contraseña y **quema** el token.
- [x] `POST /auth/recuperar` (público): emite reset y manda el mail. **Misma respuesta exista
      o no el correo.**
- [x] `GET`/`POST /auth/recuperar/:token` (público): verifica y fija la contraseña, quemando
      el token. Quedó como `recuperar/:token` y no `restablecer/:token` para que el par
      verificar/fijar comparta prefijo con el pedido, igual que la invitación.
- [x] **Borrar** `debe_cambiar_contrasena` (columna, entidad, el 403 de `switchTenant`, el
      seed de `temporal@paris.cl` y sus tests). Sin datos productivos: se cambia el esquema y
      se resiembra.

## Frontend

- [x] Pantalla pública **una sola** para elegir contraseña, compartida por invitación y reset:
      cambia el texto, no el flujo.
- [x] "Olvidé mi contraseña" en el login, con la misma respuesta exista o no la cuenta.
- [x] **Borrar** `/cambiar-contrasena` y el modal de contraseña temporal del alta.

## Verification

- [x] Un token **quemado no sirve dos veces**, y uno **vencido** tampoco. Con test cada uno.
- [x] `POST /auth/recuperar` responde **idéntico** para un correo que existe y uno que no —
      medido comparando status y body, no leído.
- [x] En la base solo queda el **hash**: el token en claro no aparece en ninguna tabla.
- [x] Los tests **no mandan mail** (transporte de log), y hay algo que lo fija.
- [x] `tenant_id` del token donde corresponda; los endpoints públicos no lo necesitan.
- [x] Gate completo por exit code + revisión independiente (`domain-reviewer`). **Dos
      rondas.** La primera bloqueó por una **toma de cuenta**: el link de invitación vive 7
      días y sobrevivía al reset, así que quien tuviera ese primer mail podía volver a fijar
      la contraseña y entrar. Se cerró invalidando **todos** los links vivos al fijar una
      contraseña. También salió de ahí que mi test de concurrencia **no probaba
      concurrencia**: los dos POST no se solapan, el segundo falla antes y con otro mensaje,
      así que pasaba con la guarda borrada.

## Out of scope

- **Verificación de correo del auto-registro** — diferida por el owner.
- **Rate limiting** de los endpoints públicos nuevos. `/auth/recuperar` es disparable por
  cualquiera y manda un mail por request. Tiene entrada propia en `pendientes.md` junto con
  la de `/garzones/verificar-pin`; hay que **cruzarlas** al encararlo.
