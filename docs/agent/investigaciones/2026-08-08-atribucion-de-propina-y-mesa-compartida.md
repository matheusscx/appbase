# Investigación — atribución de propina cuando varios garzones atienden la misma mesa

**Fecha**: 2026-08-08 · **Corrida por**: el agente, inline (WebSearch/WebFetch)
**Estado**: investigación pura, **sin diseño**. No decide nada.

> ⛔ Regla de la casa: esto es **insumo para cruzar y adaptar**, no verdad a copiar. Si el
> mercado dice A y nuestro modelo o el owner dicen B, **gana B** — y se documenta por qué.

## La pregunta que la motivó

El owner, desde su experiencia como cliente: *"no siempre te termina de atender el mismo
garzón; a veces el que empezó está ocupado abriendo otra mesa y pasa otro y le podés pedir"*.
Hoy, en nuestro código, la propina va **entera** a `cuenta.garzonResponsableId`
(`salones.service.ts:1106`), que es quien abrió la mesa salvo transferencia. El trabajo del
segundo garzón es invisible.

---

## Hallazgos

### 1. El mercado tiene exactamente la misma limitación que nosotros

Toast —líder del segmento— **no permite dos meseros en una mesa a la vez**, y atribuye por
quien **abre la orden**, no por quien atiende:

> *"Toast POS does not support assigning two servers to the same table at the same time.
> Only one server can be assigned per table."*
> *"Server assignment affects only orders that the assigned server opens on the table. If a
> different server opens a check on a table assigned to another server, the check is
> attributed to the server who opened it."*
> — [Toast, Manage Tables](https://support.toasttab.com/en/article/New-POS-Managing-Tables)

**Nadie resuelve esto con atribución por línea.** Es el hallazgo más importante para
nuestra decisión, porque era una de las tres opciones sobre la mesa.

### 2. Lo resuelven por otros dos caminos, y ninguno es "registrar quién carga cada línea"

- **Split check** — dividir la cuenta entre los meseros que atendieron. Es la recomendación
  explícita de Toast para mesas grandes con varios meseros.
- **Empleado genérico** (*generic employee*) — un empleado ficticio, sin nómina, que **posee
  las órdenes compartidas**. Cada mesero registra lo suyo con su código; lo compartido va al
  genérico, y el pozo redistribuye. Sirve para banquetes y áreas compartidas.
  — [Toast, Common Tip Policies](https://support.toasttab.com/en/article/Common-Tip-Policies)

### 3. Los modelos de reparto son tres, y ya los tenemos

| Toast | Nuestro `CriterioDistribucion` |
|---|---|
| Por horas trabajadas | `HORAS_TRABAJADAS` |
| Por rol (puntos o porcentajes fijos) | `MANUAL` (`PESOS`/`MONTOS`) + `porcentaje` por grupo |
| Por ventas | `VENTAS_NETAS` |
| — | `PARTES_IGUALES`, `CANTIDAD_CUENTAS` (**nosotros tenemos dos más**) |

### 4. Chile — la práctica del reparto valida nuestro modelo de grupos

El reparto que la industria local reporta como mediana es **50 servicio / 25 barra /
20 cocina / 5 apoyo** (n=122 trabajadores), con tres familias: mixto (~45%), servicio
dominante ≥60% (~41%) e igualitario 25/25/25/25 (~14%).
— [Revista Clásica](https://revistaclasica.cl/reparto-de-propinas-en-chile/)

Eso es **exactamente** la forma de nuestros grupos por `tipo_garzon`
(`garzon` | `cocina` | `barra`) con `porcentaje` configurable. No hace falta inventar nada.
⚠️ La fuente **no** dice cómo se calcula el peso de cada persona dentro del grupo, ni toca el
problema de varios garzones en una mesa. No estirarla más allá de eso.

### 5. Chile — restricción LEGAL, no de producto: el empleador no puede repartir

Verificado contra la fuente primaria (no contra el resumen del buscador, que sobreafirmaba):

> *"el garzón titular de este derecho"* · *"facultad que sólo recae en los trabajadores que
> las reciben del cliente"* · el empleador *"no podrá distribuir las propinas"* y debe
> *"entregarlas íntegramente a los trabajadores"*.
> — [DT, ORD. N°4922](https://www.dt.gob.cl/legislacion/1624/w3-article-110335.html)

Los trabajadores **sí** pueden acordar extender el reparto a otros roles (cocina, barra),
que es lo que habilita el 50/25/20/5. La obligación del empleador es **sugerir** al menos
10% en la cuenta (Art. 64 del Código del Trabajo, Ley 20.729), y la propina sigue siendo
**voluntaria** para el cliente:

> *"el empleador debe sugerir, en cada cuenta de consumo, el monto correspondiente a una
> propina de a lo menos el 10%"*
> — [DT, consulta 109452](https://www.dt.gob.cl/portal/1628/w3-article-109452.html)

⚠️ **Consecuencia de diseño, y es la más fuerte de toda la investigación:** nuestra config de
distribución **no es una política del restaurante, es el registro de un acuerdo entre
trabajadores**. El admin del tenant que edita porcentajes está transcribiendo lo acordado,
no decidiendo. Eso cambia qué hay que poder auditar y quién debería poder tocarlo.

### 6. El modelo de dispositivo de Toast contradice una decisión ya tomada

Toast: login **a nivel dispositivo** (uno autentica la app para todo el aparato) y después
cada empleado entra con su **POS access code** de 6–8 dígitos. El dispositivo **recuerda**
al empleado, y lo que decide cuánto es un **timeout de inactividad configurable**: el
restaurante elige si vuelve a la pantalla de código enseguida o más tarde. El mismo modelo
aplica a los *handhelds* (Toast Go), no hay un "modo personal" sin código.
— [Toast, Log in to a Toast Product or Device](https://support.toasttab.com/en/article/Log-in-to-a-Toast-Product-or-Device)

El owner decidió el 2026-08-08 que **el tótem no recuerda al garzón** (nada asegura que sea
la misma persona). El mercado dice que sí recuerda, con timeout. **Se anota el choque, no se
resuelve acá.**

---

## Cruce contra nuestro código — qué ya existe y qué no

| Mecanismo del mercado | ¿Lo tenemos? |
|---|---|
| Atribución por quien abre la cuenta | **Sí**, idéntico (`garzonResponsableId`) |
| Grupos por rol con % configurable | **Sí** (`tipo_garzon` + `porcentaje`) |
| Reparto por horas / ventas / rol | **Sí**, y dos criterios más |
| Versionado del acuerdo de reparto | **Sí** (`configuracion_version`, snapshot por liquidación) |
| Transferencia de mesa entre garzones | **Sí** (`transferirPorPin`) |
| **Split check entre meseros** | **No** |
| **Empleado genérico para lo compartido** | **Casi**: existe el placeholder `Mostrador` (uno por tenant, `uq_garzones_mostrador_tenant`), hoy usado para propina directa. Es la misma idea con otro propósito |
| Atribución por línea | **No**, y el mercado tampoco |

**Lo que el cruce deja claro:** no estamos atrasados. Nos faltan exactamente los **dos**
mecanismos con los que el mercado tapa este agujero —split check y empleado genérico—, y el
segundo ya tiene un pariente cercano en el repo.

---

## Lo que NO trae la investigación

- Cómo se calcula el peso **dentro** de un grupo en Chile: ninguna fuente local lo dice.
- Si Toteat, Bsale o Defontana atribuyen distinto: **no hay documentación pública** de su
  motor. Coincide con lo que ya advertía la plantilla — en Chile la señal está en la norma,
  no en la competencia.
- Ningún dato sobre cuánta fricción tolera un garzón por turno. La objeción del owner
  ("no puede ser lenta") sigue sin contraste externo.

## Fuentes

- [Toast — Manage Tables](https://support.toasttab.com/en/article/New-POS-Managing-Tables)
- [Toast — Plan Your Tip Pooling Policy](https://support.toasttab.com/en/article/Common-Tip-Policies)
- [Toast — Log in to a Toast Product or Device](https://support.toasttab.com/en/article/Log-in-to-a-Toast-Product-or-Device)
- [DT — ORD. N°4922 (propiedad y reparto de la propina)](https://www.dt.gob.cl/legislacion/1624/w3-article-110335.html)
- [DT — consulta 109452 (obligación de sugerir 10%)](https://www.dt.gob.cl/portal/1628/w3-article-109452.html)
- [Revista Clásica — reparto 50/25/20/5 en Chile](https://revistaclasica.cl/reparto-de-propinas-en-chile/)
