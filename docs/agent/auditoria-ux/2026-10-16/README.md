# Auditoría UX de Venka · 2026-10-16

Se aplicó la identidad de Venka y se auditaron nueve grupos de pantallas, más un documento de hallazgos transversales, con la skill `revisando-ux`. La app estaba corriendo y cada grupo se revisó con el rol real de quien usa la pantalla.

**Las 57 preguntas ya tienen respuesta del owner (2026-10-16): ver [decisiones.md](decisiones.md).** Las dos fiscales (02.10 y 07.14) van en su propia sesión.

Cómo usar esto: marca ☐ → ☑ lo que entra, o dime los números (por ejemplo "entran 02.1, 01.2 y el lote 3"). Parte por "Lo primero" y por "Preguntas para ti". Cada hallazgo vive en su documento, enlazado por el número.

Las capturas citadas están en `frontend/e2e-auditoria/capturas/` (local, fuera de git). Ningún documento de los grupos se modificó.

## Resumen

| Grupo | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| [00 · Transversal](00-transversal.md) | 0 | 2 | 5 | 5 | 12 |
| [01 · POS y ventas](01-pos-y-ventas.md) | 0 | 2 | 17 | 12 | 31 |
| [02 · Salones y mesas](02-salones-y-mesas.md) | 1 | 4 | 21 | 9 | 35 |
| [03 · Caja](03-caja.md) | 0 | 3 | 15 | 11 | 29 |
| [04 · Inicio y reportes](04-inicio-y-reportes.md) | 0 | 4 | 13 | 9 | 26 |
| [05 · Inventario](05-inventario.md) | 0 | 2 | 18 | 5 | 25 |
| [06 · Compras y terceros](06-compras-y-terceros.md) | 0 | 5 | 18 | 8 | 31 |
| [07 · Configuración](07-configuracion.md) | 0 | 2 | 21 | 13 | 36 |
| [08 · Ingreso y cuenta](08-ingreso-y-cuenta.md) | 0 | 1 | 11 | 14 | 26 |
| [09 · Tienda y suscripciones](09-tienda-y-suscripciones.md) | 0 | 2 | 15 | 7 | 24 |
| **Total** | **1** | **27** | **154** | **93** | **275** |

Severidad: **P0** plata o datos en riesgo · **P1** frena la tarea principal · **P2** la hace lenta o confusa · **P3** pulido.

Decide: **agente** es algo que arreglo sin preguntarte; **owner** es decisión tuya. Si dice las dos, la parte tuya va entre paréntesis o después del punto y coma.

Cuando dos grupos reportan lo mismo, el hallazgo está listado una vez en su sitio y lleva el otro número en cursiva (por ejemplo "es 00.10").

## Lo primero: P0 y P1

Hay un P0 y 27 P1. Los P0 van arriba. "Conf." es cómo se supo: **medido** con la app corriendo, **código** si salió de leer el código.

| ¿Entra? | # | Sev | Título | Conf. | Decide |
|---|---|---|---|---|---|
| ☑ | [02.1](02-salones-y-mesas.md) | P0 | Liquidar propinas paga el período del formulario, no el de la vista previa — **hecho 2026-10-16** | código | agente |
| ☑ | [00.10](00-transversal.md) | P1 | Una línea incompleta se descarta al guardar y el aviso dice que guardó todo *(ver 05.2, 06.1)* — **hecho 2026-10-16** | medido | agente |
| ☑ | [00.11](00-transversal.md) | P1 | Los errores del servidor salen en inglés, con nombres internos, sin marcar el campo *(ver 06.2, 07.2, 08.2)* — **hecho 2026-10-16** (`apiErrorMsg` traduce el texto del validador en todas las pantallas; el campo marcado va en las de este lote) | medido | agente |
| ☐ | [01.1](01-pos-y-ventas.md) | P1 | Tras cobrar, el carrito vendido sigue en pantalla 5 a 10 s y borra lo que agregas | medido | agente |
| ☐ | [01.2](01-pos-y-ventas.md) | P1 | El cobro trae la propina de 10% ya sumada, y el carrito no la muestra | medido | owner |
| ☐ | [02.2](02-salones-y-mesas.md) | P1 | Garzón y encargado no pueden cobrar mesas y el aviso pide abrir caja | medido | owner |
| ☐ | [02.3](02-salones-y-mesas.md) | P1 | En tablet, los botones de la cuenta son chicos y quitan productos sin querer — **parcial 2026-10-16** ("+"/"−" de cantidad a 44 px y el basurero apartado, "Entrar/Salir de turno", "Nueva cuenta", "Tomar cuenta" y "Ver historial"; quedan fuera los botones del pie de la cuenta (cobrar, frente de plata) y el interruptor "Incluir") | medido | agente |
| ☐ | [02.4](02-salones-y-mesas.md) | P1 | La cuenta no muestra qué líneas salieron a cocina y cuáles no | medido | agente |
| ☐ | [02.5](02-salones-y-mesas.md) | P1 | Si la comanda no se imprime, la línea queda "enviada" y no se reimprime | medido en parte | owner |
| ☑ | [03.1](03-caja.md) | P1 | En la tablet, "Ver cierre" y "Marcar visto" de Pendientes quedan fuera de vista — **hecho 2026-10-16** (la forma cambió; a 768 no se pudo medir: la base sembrada no tiene cierres pendientes) | medido | agente |
| ☑ | [03.2](03-caja.md) | P1 | En el historial de cajas a 768, la columna "Diferencia" queda fuera de vista — **hecho 2026-10-16** (la forma cambió; a 768 no se pudo medir: la base sembrada no tiene historial) | medido | agente |
| ☐ | [03.3](03-caja.md) | P1 | "Enviar conteo" congela el conteo sin pedir confirmar el número tecleado | medido | agente + owner |
| ☑ | [04.1](04-inicio-y-reportes.md) | P1 | Inicio llama "Efectivo", en verde, a la suma de diferencias de cierre — **hecho 2026-10-16** | medido | agente + owner |
| ☑ | [04.2](04-inicio-y-reportes.md) | P1 | En Inicio, "Vendido" queda pegado al borde y lo demás bajo el pliegue — **hecho 2026-10-16** (medido en navegador: las cifras de Vendido, Cobrado y Por cobrar terminan en 774/774/676 px de 800 a 1280×800 y en 961/961/862 de 1024 a 768×1024; el resto de la tarjeta de Ventas queda bajo el pliegue) | medido | agente + owner |
| ☑ | [04.3](04-inicio-y-reportes.md) | P1 | "Hoy" no dice de qué hora son sus números y se queda viejo — **hecho 2026-10-16** | medido | agente + owner |
| ☑ | [04.4](04-inicio-y-reportes.md) | P1 | "Costos desfasados" abre todo marcado y aplica a todas las recetas de un toque — **hecho 2026-10-16** | medido | owner |
| ☑ | [05.1](05-inventario.md) | P1 | El aprobador de un recuento sin causas puede apretar "Aplicar" y queda sin salida — **hecho 2026-10-16** (Aplicar apagado en la cabecera, con el aviso que nombra los productos y quién la pone; contar y aprobar siguen separados) | medido | agente + owner |
| ☑ | [05.2](05-inventario.md) | P1 | Un traslado con una línea incompleta guarda solo las otras y avisa "Traslado registrado" *(es 00.10)* — **hecho 2026-10-16** | medido | agente |
| ☑ | [06.1](06-compras-y-terceros.md) | P1 | Guardar o confirmar una compra descarta en silencio las líneas sin cantidad *(es 00.10)* — **hecho 2026-10-16** | medido | agente |
| ☐ | [06.2](06-compras-y-terceros.md) | P1 | La cantidad de una compra acepta texto, cero y negativos, y falla en inglés *(parte en 00.11)* — *parcial 2026-10-16: mensaje y campo marcado tras el rechazo; cero, texto y negativos bloquean Guardar y Confirmar con su motivo junto al campo (lote 1); la coma decimal se avisa pero NO se normaliza a punto: aceptarla cambiaría qué se guarda y espera decisión del owner* | medido | agente |
| ☑ | [06.3](06-compras-y-terceros.md) | P1 | "Confirmar recepción" no mira el total del documento y avisa recién después de confirmar — **hecho 2026-10-16** (el rechazo se marca en el campo Total, y lote 1: Confirmar no abre el modal sin el total obligatorio y marca el campo) | medido | agente |
| ☐ | [06.4](06-compras-y-terceros.md) | P1 | Al recargar "Nueva compra", el medio de pago sale vacío y el botón apagado | medido | agente |
| ☐ | [06.6](06-compras-y-terceros.md) | P1 | Un pago hecho no se puede anular desde la pantalla, salvo que sobre plata | medido | owner |
| ☑ | [07.1](07-configuracion.md) | P1 | En Configuración, la columna de acciones queda fuera de la tarjeta en 15 pantallas *(causa en 00.9)* — **hecho 2026-10-16** | medido | agente |
| ☐ | [07.2](07-configuracion.md) | P1 | Los formularios de Configuración rechazan con avisos en inglés, sin marcar el campo *(es 00.11)* — *parcial 2026-10-16: traducción global y campos en Ítems, Impresoras, Descuentos, Recargos; faltan Salones/mesa e Impuestos (fiscal, frente aparte)* | medido | agente |
| ☑ | [08.1](08-ingreso-y-cuenta.md) | P1 | Equivocarse en la "contraseña actual" cierra la sesión y manda al login — **hecho 2026-10-16** (el servidor contesta 400 y no 401 a una contraseña actual equivocada; el token no se tocó) | medido | agente |
| ☐ | [09.1](09-tienda-y-suscripciones.md) | P1 | Al volver de Webpay, "Agregar tarjeta" cobra el primer período sin confirmar | código | owner |
| ☐ | [09.2](09-tienda-y-suscripciones.md) | P1 | Al volver de Webpay el carrito se vacía, aunque el aviso dice lo contrario | medido + código | agente |

Dos de estos pueden subir a P0 si los miras como plata en riesgo: 04.4 (aplicar costos a todas las recetas de un toque) y 09.1 (cobro sin clic al volver de Webpay). Están en "Preguntas para ti".

## Preguntas para ti

Son 57 hallazgos donde el campo "Decide" incluye al owner, de cualquier severidad. La opción recomendada va primero y dice "(recomendada)". Donde la auditoría no recomienda una, lo dice. Con un número me alcanza ("01.2: la primera").

### Propinas

01.2, 02.9 y 01.19 tocan el mismo modal de cobro. Conviene contestarlas juntas.

**01.2 · ¿La propina del mostrador parte en $0 o sugerida?** (P1, [ver](01-pos-y-ventas.md))

La cajera le dice al cliente "son $8.211". Al tocar Cobrar, el modal ya sumó 10% de propina y dice "Total a pagar $9.032". Si confirma sin leer, le cobra $821 de más.

- (recomendada) Parte en $0. La cajera la agrega si el cliente la ofrece. Costo: cambio chico en el modal de cobro.
- Sigue sugerida, pero aparte: una fila "Agregar propina 10% ($821)" que se suma con un toque y no cambia el "Total a pagar" hasta tocarla. Costo: una fila más en el modal.

**02.9 · En el cobro de una mesa, ¿la propina viene sumada o se ofrece aparte?** (P2, [ver](02-salones-y-mesas.md))

Al cobrar una mesa la propina ya viene calculada con 10% y sumada. Con dos toques ("Cobrar" y "Confirmar venta") se cobra el 10% sin que el cliente lo haya aceptado en voz alta. Es el mismo modal que usa el punto de venta (01.2).

- (recomendada) Mostrar el porcentaje ("Propina sugerida 10 %") y tres atajos grandes: "Sin propina", "10 %", "15 %" y "Otro monto". No cambia el 10% que hoy es la sugerencia. Costo: cambio del modal compartido con el POS.
- Que la propina no entre precargada en el total y se ofrezca aparte. Es la misma decisión de 01.2. La auditoría la deja como tuya.

**01.19 · Si falla leer la propina sugerida, ¿la propina queda activa o apagada?** (P2, [ver](01-pos-y-ventas.md))

Un local que apagó la propina la vería activa con 10% en el modal solo porque falló la lectura.

- (recomendada) Con error, propina apagada (la opción segura) y un aviso discreto. Costo: cambio chico.
- Dejar como está: con error, la propina queda activa con 10%.

**02.7 · ¿Qué propina sugerida muestra la precuenta en pantalla?** (P2, [ver](02-salones-y-mesas.md))

Hoy la precuenta solo existe en papel y la propina sugerida solo sale impresa. Si la impresora no responde, el garzón no tiene qué mostrarle al cliente que pidió la cuenta.

- (recomendada) Una vista previa de la precuenta en pantalla (total, IVA, propina sugerida) y "Imprimir" como acción de ese panel; el error sin jerga ("No se pudo imprimir. Revisa que la impresora esté encendida"). Costo: panel nuevo en la tablet.
- La auditoría no dice qué propina sugerida va en esa vista. Eso lo decides tú.

**02.16 · ¿Qué turno aparece elegido al entrar a turno?** (P2, [ver](02-salones-y-mesas.md))

Una garzona que entra a las 20:00 y toca "Continuar" como siempre queda en el turno Mañana (08:00–15:00), que es el que después se usa para liquidar propinas por turno.

- (recomendada) Preseleccionar el turno cuya hora contiene la hora actual. Costo: chico, pero es regla de turnos y de propinas.
- Dejar el primero de la lista, como hoy.

### Contraste de colores y letras

00.8 es la decisión de fondo. Las otras tres se resuelven con su respuesta; las dejo aparte porque cada una tiene un matiz.

**00.8 · ¿Oscurecemos el verde, el ámbar y el rojo de los estados?** (P2, [ver](00-transversal.md))

La insignia "Pagada", "Caja abierta", el botón "Confirmar recepción" y las cifras positivas y negativas usan los tonos por defecto de Nuxt UI. Sobre blanco miden verde 2,22:1, ámbar 1,91:1 y rojo 3,81:1, y el mínimo para texto es 4,5:1. Salió en siete grupos.

- (recomendada) Darle a verde, ámbar y rojo escalas propias más oscuras (como ya tiene el petróleo) y medir cada combinación. Se arregla una vez y cierra los hallazgos citados en 00.8. Los colores financieros de Caja siguen siendo excepción aprobada, pero su contraste no lo es. Costo: cambia el color de los estados en toda la app.
- No tocar la paleta. Queda texto de estado difícil de leer, sobre todo en tablet.

**01.17 · En el POS: ¿oscurecemos el texto de las insignias de estado?** (P2, [ver](01-pos-y-ventas.md))

"Pagada" mide 2,02:1 con letra de 10 px, "Caja abierta" 2,02:1 y "Saldo pendiente" 1,78:1. Es el texto más repetido del historial.

- (recomendada) Texto más oscuro del mismo tono para las insignias y letra de 12 px. Va con lo que decidas en 00.8. Costo: chico una vez resuelto 00.8.
- Dejarlo hasta que decidas 00.8.

**03.9 · En Caja: ¿los botones principales van en petróleo o en color de estado?** (P2, [ver](03-caja.md))

"Enviar conteo" y "Confirmar cierre" (rojo) llegan a 3,81:1 con letra blanca, "Registrar entrada" (verde) a 2,22:1 y "Continuar conciliación" (ámbar) a 1,91:1. El petróleo mide 9,47:1.

- (recomendada) Pasar esos botones a petróleo. El verde y el rojo quedan en el selector Entrada/Salida. Costo: cambio chico por botón. No toca los colores financieros.
- Conservar el color de estado en los botones. Entonces depende de la paleta que elijas en 00.8.

**05.17 · En Inventario: ¿oscurecemos las cantidades y los badges de color?** (P2, [ver](05-inventario.md))

La cantidad de cada movimiento del kardex y de mermas va en verde, ámbar o rojo (2,22:1, 1,91:1 y 3,81:1), y los badges de tipo y estado tienen letra de 10 px.

- (recomendada) Usar el tono más oscuro de cada color para texto y 12 px como mínimo en los badges. No es un cambio de paleta. Costo: chico, en seis pantallas.
- Dejarlo hasta que decidas 00.8.

**00.2 · ¿Los links van en petróleo o se quedan negros?** (P3, [ver](00-transversal.md))

Hoy los links se ven negros con peso medio. La guía de diseño dice que van en color de marca y la maqueta del ingreso los muestra en petróleo.

- Petróleo, como la maqueta. Costo: poner el color en los links y corregir la guía. Se resuelve junto con 08.18.
- Negro, como hoy. Costo: corregir la guía. La auditoría no recomienda una de las dos.

**08.18 · En el ingreso: ¿títulos y links en petróleo oscuro, como la maqueta?** (P3, [ver](08-ingreso-y-cuenta.md))

Los títulos y los links del ingreso van en el gris casi negro de Nuxt UI, no en el petróleo oscuro de la maqueta aprobada. La tarjeta mide 384 px y la de la maqueta unos 420.

- Decidirlo junto con 00.2 (el color) y con 08.8 (el tamaño de los controles), como propone la auditoría. No recomienda un color por separado.

**08.13 · ¿Qué colores llevan los avatares de la lista de locales?** (P3, [ver](08-ingreso-y-cuenta.md))

Cada local toma uno de seis colores según su primera letra, y entre ellos están el rojo de error y el amarillo de advertencia: el local "Ln" sale rojo y parece una alerta. Ninguno es de la paleta de Venka.

- (recomendada) Avatares en tonos de la escala petróleo (o un solo tono). Y si la lista viene vacía, mandar a la pantalla "sin empresa". Costo: chico.
- Dejar los seis colores.

**00.7 · ¿Cómo arreglamos las cifras que no se alinean?** (P2, [ver](00-transversal.md))

DM Sans no trae cifras de igual ancho (el "1" mide 342 unidades y el "0", 656). En una columna de montos las cifras no quedan una bajo otra, y un total que se actualiza "baila". Antes de la identidad la app usaba la letra del sistema, que sí las trae.

- (recomendada) (a) Derivar de la misma DM Sans una versión con los diez dígitos del mismo ancho. La licencia lo permite. Costo: tarea del agente, con su propia medición. La letra de marca no cambia.
- (b) Poner las cifras en Bricolage, que sí las trae. Costo: cambia la cara de los números.
- (c) Otra letra solo para cifras. Costo: es una decisión de identidad.

### Cobro y venta en el mostrador

**01.3 · ¿Agregamos billetes rápidos y "Exacto"? ¿Se puede confirmar con saldo pendiente?** (P2, [ver](01-pos-y-ventas.md))

La cajera teclea $1.785 (el total del carrito) y el modal muestra "Restante $179" en gris, sin aviso, con "Confirmar venta" habilitado. Tampoco hay billetes rápidos ni botón de monto exacto: el vuelto se calcula tecleando.

- (recomendada) Solo el aviso: si queda saldo, "Falta $179" en ámbar y el botón dice "Confirmar con saldo pendiente". Eso lo hace el agente. Costo: chico.
- Billetes rápidos y botón "Exacto". Es función nueva; la auditoría los propone para que decidas, sin recomendar. Costo: botones nuevos en el modal.

**01.25 · ¿El lector de código de barras agrega el ítem con Enter?** (P3, [ver](01-pos-y-ventas.md))

El lector escribe el código y manda Enter, pero la cajera queda con una lista y no con el ítem en el carrito.

- (recomendada) Autofocus en escritorio y botón de borrar (esto lo hace el agente). Costo: chico.
- Agregar con Enter lo que lee el lector. Es regla de negocio y la auditoría no recomienda una respuesta: la decides tú.

**01.28 · ¿El historial de ventas parte en "Hoy" y busca por folio?** (P3, [ver](01-pos-y-ventas.md))

Las tres tarjetas del historial son históricas. La cajera que quiere "lo de hoy" cuenta filas a mano. Órdenes sí tiene filtro de fechas.

- (recomendada) Filtro "Hoy" por defecto y búsqueda por folio. Costo: filtros nuevos en la pantalla.
- Dejarlo sin filtros.

### Salones, mesas y cocina

**02.2 · ¿Quién cobra una cuenta de mesa?** (P1, [ver](02-salones-y-mesas.md))

Ana arma la cuenta de la Mesa 1: tres líneas, $14.161. Abajo dice "Sin caja abierta" y "Cerrar y cobrar" está apagado, aunque haya caja. Su rol no puede ver las cajas ni abrir una. El encargado de salón ve lo mismo. Con los roles del seed, solo el administrador y el cajero terminan el flujo.

- La auditoría no recomienda una respuesta: primero tienes que decir quién cobra (el garzón con una caja suya, el cajero desde el POS, o el encargado).
- Mientras tanto, para quien no puede cobrar: cambiar el aviso por "Esta cuenta la cobra caja. Pide la cuenta con Imprimir precuenta" y esconder "Cerrar y cobrar". Costo: chico.

**02.5 · ¿Dejamos reimprimir la comanda de cocina desde la pantalla?** (P1, [ver](02-salones-y-mesas.md))

La hamburguesa quedó "enviada", pero la impresora de cocina no respondía. Al reintentar, la pantalla dijo "No hay productos nuevos para enviar" y cocina nunca recibió el pedido. Hoy se prioriza no imprimir doble en cocina, y por eso no hay cómo reimprimir.

- (recomendada) Un botón "Reimprimir comanda" por estación o por cuenta, con confirmación ("Ya salió a las 21:14. ¿Imprimirla de nuevo?"). Solo reimprime lo ya despachado. No es reintento automático: lo pide la persona. Costo: frente propio de comanda.
- Dejarlo como está. Cocina puede quedarse sin el pedido y nadie se entera.

**02.10 · ¿Cómo mostramos el IVA en la cuenta de la mesa?** (P2, [ver](02-salones-y-mesas.md))

La lista suma Papas fritas $3.000 + Producto demo $5.000 + Hamburguesa $3.900 = $11.900, pero el Total dice $14.161. La diferencia es el IVA y no aparece en ninguna parte. El garzón no puede explicarle al cliente por qué el total no es la suma.

- (recomendada) Mostrar "Neto $11.900 · IVA $2.261" sobre el Total. Costo: chico, pero es presentación de un dato fiscal: va solo y contigo.
- Dejar el subtotal de cada línea con IVA. Mismo costo y misma condición.

### Caja

**03.3 · ¿Pedimos confirmar el número antes de "Enviar conteo"?** (P1, [ver](03-caja.md))

"Enviar conteo" congela lo contado sin pedir confirmación. Un cero de más (450.000 en vez de 45.000) queda como diferencia permanente y, si pasa el límite, aparece en la bandeja del encargado como cierre sospechoso.

- (recomendada) Un paso dentro del mismo panel con el monto en grande: "Contaste $45.000 en efectivo. Después de enviarlo no se puede cambiar", con "Corregir" y "Enviar conteo". Costo: frente propio, toca el cierre de caja.
- Además permitir recontar después de enviar. Cambia la regla del cierre; la auditoría no lo propone.

**03.28 · ¿Queremos un fondo sugerido por caja y atajos de concepto?** (P3, [ver](03-caja.md))

La cajera repite cada turno dos cosas: el saldo inicial arranca vacío y el concepto del movimiento es texto libre. El local suele dejar un fondo fijo y mover las mismas cosas ("Compra de insumos", "Retiro de efectivo").

- Es una idea para ti; la auditoría no la diseña ni la recomienda. Si dices que sí, hay que definir las reglas primero.

### Inicio y reportes

**04.1 · En Inicio, ¿el sobrante de efectivo va en alerta o neutro?** (P1, [ver](04-inicio-y-reportes.md))

El dueño ve "Cierres 2 · Con descuadre 1 · Efectivo $1.234" en verde y lee "se juntó $1.234 en efectivo". Esa cifra es la suma con signo de las diferencias de los cierres. Un sobrante en verde junto a "Con descuadre 1" dice "todo bien" cuando un cierre no cuadró.

- (recomendada) Rotular "Diferencia de efectivo", escribir el signo ("sobran $1.234", "faltan $2.300") y pintarlo en color de estado, no en verde de éxito: un sobrante también es descuadre. Costo: chico.
- Dejar el sobrante en neutro. Mejor que verde, pero no avisa.

**04.2 · ¿Cómo hacemos que "Vendido" se vea sin bajar la pantalla?** (P1, [ver](04-inicio-y-reportes.md))

A 1280×800 las cinco tarjetas de "Ahora" ocupan 433 px y "Vendido" queda en y=745 de 800. Lo que el dueño más quiere ver, cómo va el día, exige scroll.

- (recomendada) Compactar "Ahora" (un solo "Actualizado hh:mm" y sin separadores) para que Vendido, Cobrado y Por cobrar entren sin scroll. Costo: chico, sin cambiar la forma de las tarjetas.
- Si no alcanza, subir "Hoy" arriba de "Ahora". Cambia el orden de la pantalla: es tuyo.

**04.3 · ¿"Hoy" se actualiza solo?** (P1, [ver](04-inicio-y-reportes.md))

"Ahora" se refresca cada 60 segundos y dice la hora. "Hoy" se carga una vez y no dice de qué hora es: en una prueba pasó de $16.259 a $21.614 sin recargar. El dueño que deja la pestaña abierta toda la tarde ve el número de las 12:42 como si fuera el de ahora.

- (recomendada) Mostrar "Actualizado hh:mm" junto al botón Actualizar de "Hoy" y marcar los números como atrasados si la última carga falló. Costo: chico.
- Además, refresco automático de "Hoy". La spec dice "carga una vez"; la auditoría no recomienda cambiarlo.

**04.4 · ¿"Costos desfasados" abre con todo marcado?** (P1, [ver](04-inicio-y-reportes.md))

Al abrir la bandeja todas las filas vienen seleccionadas. Un toque en "Aplicar seleccionadas" cambia el costo de todas las recetas y combos, sin confirmar ni decir cuántas. El costo alimenta margen y precio sugerido. Si lo consideras dato de plata, esto sube a P0.

- (recomendada) Que la bandeja abra sin selección y el dueño elija. Costo: chico.
- Que abra con selección, pero con una confirmación que diga "Vas a aplicar el nuevo costo a 12 recetas y combos" y botones que digan cuántas ("Aplicar 12 seleccionadas"). Costo: un modal.

**04.10 · ¿Las tarjetas de Inicio llevan a la lista ya filtrada?** (P2, [ver](04-inicio-y-reportes.md))

El dueño toca "Por cobrar: 4 ventas · $86.500" y llega a todas las ventas, sin filtrar. "Cierres del día, con descuadre 1" lleva a las cajas y no a la bandeja donde está el cierre que no cuadró.

- (recomendada) Llevar al destino filtrado (ventas pendientes o parciales, cierres por revisar). Costo: filtros por dirección en las pantallas de Ventas y Caja, que son de otros grupos.
- Dejar los enlaces como están.

**04.11 · ¿Agrandamos la cifra principal de las tarjetas de Inicio?** (P2, [ver](04-inicio-y-reportes.md))

Vendido, Cobrado y las frases de mesas y por cobrar pesan igual (18 px). En la maqueta el número es el protagonista, de unos 36 px, con el rótulo chico arriba.

- (recomendada) Cifra de 30 a 36 px y rótulo en letra chica, sin cambiar la forma de la tarjeta (lo hace el agente). Costo: chico.
- Cambiar la forma de las tarjetas como la maqueta. La forma es tuya.

**04.20 · ¿Con qué palabras se rotulan las columnas de Varianza?** (P3, [ver](04-inicio-y-reportes.md))

La tabla dice "Teórico", "Ventana", "Sin explicación", "$ sin explicación" y "Otros". Son palabras de sistema. A 768 las dos columnas que más importan quedan fuera de vista.

- (recomendada) "Lo que se vendió", "Entre conteos" y "Faltante sin explicar", y fijar la primera columna. Los nombres son del dominio: tú confirmas. Costo: chico.
- Dejar los nombres y arreglar solo el scroll.

**04.25 · ¿Cómo saludamos en Inicio?** (P3, [ver](04-inicio-y-reportes.md))

Dice "Bienvenido, Admin" en masculino para todos, con un ícono de check que no significa nada. La maqueta dice "Bienvenida, Lucía".

- (recomendada) "Hola, Admin", sin ícono. Costo: ninguno.
- Saludar según el género del usuario, si existe ese dato.

**04.26 · ¿Las tarjetas de Pérdidas y Ventas miden lo suyo?** (P3, [ver](04-inicio-y-reportes.md))

Con datos, Pérdidas parte "No se llegó a hacer" y "1.0000 platos" en dos renglones, y Ventas queda con un hueco grande porque las tarjetas de la fila se igualan en alto.

- Dejar que cada tarjeta mida lo suyo. Costo: chico.
- Ajustar la grilla. La forma de las tarjetas es tuya y la auditoría no elige entre las dos.

### Inventario

**05.1 · ¿Quién pone la causa de una diferencia al aplicar un recuento?** (P1, [ver](05-inventario.md))

El contador cuenta el pan (-2) y no pone causa. El aprobador aprieta "Aplicar" y el servidor rechaza porque falta la causa. El aprobador no puede ponerla (exige un permiso que no tiene) y la pantalla no dice quién debe hacerlo.

- (recomendada) Que la ponga quien contó. El modal deshabilita "Aplicar" y dice "Falta la causa en Pan de hamburguesa. La pone quien contó, y después vuelves a aplicar". Costo: chico.
- Que el aprobador también pueda poner la causa. Es regla de permisos y hoy el seed separa a propósito contar de aplicar.

**05.5 · ¿Agregamos "contar todo lo de esta ubicación"?** (P2, [ver](05-inventario.md))

Para contar toda la bodega hay que marcar producto por producto. Con 80 productos son 160 toques. No hay "todos los de esta ubicación".

- (recomendada) Agregar "Todos los productos con stock en esta ubicación". El servidor ya tiene el saldo por ubicación. Costo: función nueva.
- Dejarlo producto por producto.

**05.11 · ¿Ponemos resumen previo y, más adelante, anular traslados y mermas?** (P2, [ver](05-inventario.md))

Un traslado de 100 en vez de 10 queda en el kardex y no hay pantalla para anularlo: se compensa con otro movimiento. El único cierre es un toast que se va. Esto escribe en movimientos de inventario.

- (recomendada) Una línea de resumen sobre el botón ("Vas a mover 1 Pan de hamburguesa de Bodega Subsuelo a Local"). Costo: chico.
- Poder anular un traslado o una merma. Es regla de negocio; la auditoría no propone cómo.

**05.12 · ¿Qué columnas del kardex importan más?** (P2, [ver](05-inventario.md))

El kardex tiene 10 columnas en una tabla de 1284 px dentro de 992: a 1280 quedan fuera "Resultante", "Costo de la baja" y "Usuario" sin pista de que hay scroll. En 1280×800 se ven 7 movimientos.

- (recomendada) Unir "Costo" y "Costo de la baja" en una columna que aparece solo si hay valor, y acortar la fila. Costo: chico.
- Si lo que más se busca es el saldo, poner "Resultante" pegada a "Cantidad". Qué columnas se muestran lo decides tú.

**05.14 · ¿Cómo se llama la pantalla de movimientos y dónde se ve el saldo?** (P2, [ver](05-inventario.md))

El menú dice "Stock", pero la pantalla es una lista de entradas y salidas. Quien quiere saber "¿cuánto pan hay?" no lo encuentra ahí: el saldo por ubicación solo se ve en Stock mínimo y en Configuración > Items.

- (recomendada) Renombrar el menú y el título a "Movimientos" (o "Kardex"). Costo: ninguno.
- Una pantalla nueva con el saldo por producto y ubicación (o reutilizar Stock mínimo con otro nombre). Función nueva; la auditoría no la recomienda ni la descarta.

### Compras y proveedores

**06.6 · ¿Se puede anular cualquier pago a proveedor?** (P1, [ver](06-compras-y-terceros.md))

Pagaste $1.000 por transferencia y el panel dijo "Sin pagos registrados" mientras el detalle mostraba ese pago como vigente, sin botón Anular. Hoy solo se puede anular un pago que dejó saldo a favor. Si hubieras pagado $10.000 por un cero de más, no hay cómo corregirlo desde la pantalla.

- (recomendada) Dejar anular cualquier pago vigente, desde la fila del pago en el detalle de la compra y en Por pagar. Es regla de la spec (§ 8) y toca plata: frente propio.
- Dejarlo como está: solo se anula si sobró plata.

**06.11 · ¿Quien carga compras puede crear un proveedor?** (P2, [ver](06-compras-y-terceros.md))

El encargado de compras no tiene el módulo Terceros. Si el proveedor no existe, no puede crearlo: el modal del XML le dice que se lo pida a alguien. Además, sin el permiso la pantalla dice "No hay terceros registrados", que es falso.

- (recomendada) Mostrar una pantalla de "sin permiso" en vez del vacío falso (lo hace el agente). Costo: chico.
- Darle permiso para crear proveedores. La auditoría pide revisar la regla, pero no recomienda una respuesta.

**06.25 · ¿"Compras" o "Recepciones"?** (P3, [ver](06-compras-y-terceros.md))

El menú dice Compras > "Recepciones" y la pantalla se llama "Compras". Quien busca "Recepciones" abre una pantalla con otro nombre.

- Un solo nombre en el menú y en el título. La auditoría no elige cuál: lo eliges tú.

**06.29 · ¿Les decimos "proveedor" o "tercero"?** (P3, [ver](06-compras-y-terceros.md))

La pantalla dice "Terceros", "Nuevo tercero" y "Tercero creado". El local los llama proveedores. Además una ayuda cita la especificación ("Vacío = 30 días (spec compras-deuda-proveedor § 2)").

- (recomendada) Quitar ya la cita a la spec ("Vacío = 30 días"). Costo: ninguno.
- El nombre del módulo es decisión de producto. La auditoría no elige.

### Configuración

**00.1 · ¿Qué hacemos con el archivo de estilos de la raíz que no se carga?** (P2, [ver](00-transversal.md))

Hace tiempo que los rellenos de tarjetas y modales de ese archivo no se aplican. La app se ve con los valores por defecto de Nuxt UI y la guía dice otra cosa. Quien edite ese archivo no ve ningún cambio.

- (recomendada) (b) Borrarlo y dejar los valores por defecto, y corregir la guía. Hoy la app ya se ve así y nadie lo notó. Costo: bajo.
- (a) Moverlo a la carpeta que Nuxt sí lee y revisar las pantallas una por una. Cambia el relleno de todas las tarjetas y modales. Decídelo antes de arreglar el espaciado de cualquier pantalla.

**07.9 · Al eliminar un rol, ¿avisamos cuántas personas lo tienen?** (P2, [ver](07-configuracion.md))

Eliminar un rol abre el diálogo del navegador ("¿Eliminar el rol Vendedor?"), distinto de los modales del resto, sin decir cuántas personas lo tienen. Esas personas pierden sus permisos.

- (recomendada) Un modal con el conteo: "Eliminar Vendedor: 3 personas lo tienen y perderán sus permisos". Y una explicación en el basurero apagado de los roles fijos. Costo: el conteo puede pedir un dato al backend; hay que ver si ya existe.
- Si el backend aún no entrega el conteo: el mismo modal sin la cifra. Costo: chico, pero no dice el alcance.

**07.11 · ¿Qué hacemos si guardar los permisos de un rol queda a medias?** (P2, [ver](07-configuracion.md))

Un rol tiene 16 módulos y guardarlo manda hasta 16 guardados seguidos. Si el décimo falla, los nueve primeros ya quedaron aplicados y el aviso dice solo "Error al guardar rol". En un permiso de caja, ese estado a medias es el peor.

- (recomendada) Mostrar lo que quedó ("Se guardaron 9 de 16 módulos") y recargar los permisos del rol tras un fallo. Costo: chico.
- Que el backend acepte todos los módulos en una sola llamada. Cambia el endpoint: decisión de backend.

**07.12 · ¿Pedimos confirmación al apagar un método de pago?** (P2, [ver](07-configuracion.md))

Los interruptores guardan al instante. Apagar "Habilitado" en Efectivo saca el efectivo de todas las cajas del local con un toque, y el único aviso es un toast que se va.

- (recomendada) Confirmar solo el apagado de un método de pago, de un descuento o de un impuesto ("Los cajeros dejarán de poder cobrar con Efectivo. ¿Deshabilitarlo?"). El resto (categoría, impresora) queda con toast y "Deshacer". Costo: un modal en tres pantallas.
- Dejarlo como está.

**07.14 · ¿Pedimos el impuesto como "19 %" en vez de "0.19"?** (P2, [ver](07-configuracion.md))

Para registrar un IVA de 19% hay que escribir 0.19, y la lista lo muestra como "0.1900". Si el dueño escribe 19, el servidor lo rechaza. En Distribución de propinas conviven dos formas en la misma pantalla. Nadie pierde plata, pero es el campo donde más se equivocan.

- (recomendada) Pedir y mostrar el porcentaje como se dice ("19 %") y convertir al guardar. Se sigue guardando en decimal. Impuestos es materia fiscal: va solo y con su propia sesión.
- Dejarlo en decimal.

**07.17 · ¿Agregamos "Imprimir prueba" a las impresoras?** (P2, [ver](07-configuracion.md))

Una impresora se da de alta con host y puerto y no hay forma de probarla. El host no se valida (se escribió "abc" y pasó). El dueño se entera de que la IP estaba mal cuando la cocina no recibe la primera comanda, en pleno servicio.

- (recomendada) Botón "Imprimir prueba" en el panel y en la fila, validar el formato de la IP y renombrar "Rol" a "Para qué se usa". Costo: función nueva.
- Dejarlo sin prueba.

**07.19 · ¿Pedimos confirmación al marcar una cuenta como tótem compartido?** (P2, [ver](07-configuracion.md))

El ícono del monitor, al lado del lápiz de cada usuario, convierte la cuenta en tótem compartido (en el salón siempre pedirá PIN) con un toque, sin confirmar ni explicar qué es un tótem. Está a 4 px del lápiz de editar roles.

- (recomendada) Confirmar ("Esta cuenta pasará a ser un dispositivo compartido: siempre pedirá PIN en el salón. ¿Continuar?"), separar el monitor del lápiz y mostrar la palabra "Tótem" cuando esté activo. Costo: chico.
- Dejarlo con un toque.

**07.20 · ¿Se puede quitar a una persona del local desde Usuarios?** (P2, [ver](07-configuracion.md))

El sistema ya sabe dar de baja a una persona del local, con su PIN de garzón, pero la pantalla solo edita roles. Para sacar a alguien que dejó de trabajar hay que desmarcar todos sus roles, y la persona sigue siendo miembro.

- (recomendada) Una acción "Quitar del local" con confirmación y el aviso de qué pasa con el PIN de garzón. Costo: botón y modal nuevos.
- Dejarlo como está.

**07.30 · ¿Con qué nombres se muestra el catálogo y las pantallas de Configuración?** (P3, [ver](07-configuracion.md))

El menú y los títulos no coinciden ("Preferencias" y "Preferencias financieras"). Hay dos entradas llamadas "Motivos de diferencia" (Caja e Inventario). Y "Items" no es la palabra del local: ahí lo que se vende son "Productos".

- (recomendada) Alinear menú y título, y renombrar la segunda entrada a "Motivos de diferencia (inventario)". Lo hace el agente. Costo: chico.
- Elegir "Productos" o "Ítems" para el catálogo. Es de producto; la auditoría no elige.

**07.31 · ¿Pedimos confirmación al cambiar "Fin del día"?** (P3, [ver](07-configuracion.md))

En Empresa, "Fin del día" avisa en su ayuda que los reportes pasados se recalculan con el corte nuevo, pero se guarda con el mismo botón, sin confirmar.

- (recomendada) Pedir confirmación solo si cambió "Fin del día", y marcar Nombre y Correo como requeridos. Costo: chico.
- Dejarlo sin confirmar.

**07.33 · ¿Items filtra por categoría y ordena por precio o stock?** (P3, [ver](07-configuracion.md))

Con 100 productos no se puede filtrar por categoría ni ordenar por nombre, precio o stock. Hoy la demo tiene 10 y no se nota.

- (recomendada) Filtro por categoría y orden por columna. Costo: función nueva.
- Dejarlo hasta que el catálogo crezca.

**07.34 · ¿Dónde cae el dueño al entrar a Configuración?** (P3, [ver](07-configuracion.md))

Cae en Perfil (datos personales, tema, contraseña, PIN), no en lo que viene a configurar. Perfil además no lleva el título que llevan las otras 27 pantallas.

- (recomendada) Un índice por grupo con una frase por pantalla, y darle a Perfil el mismo título que el resto. Costo: pantalla nueva.
- Que caiga en Empresa. Costo: chico.

### Ingreso y cuenta

**08.7 · "Mantener sesión iniciada": ¿lo quitamos o lo hacemos funcionar?** (P2, [ver](08-ingreso-y-cuenta.md))

La casilla no hace nada: la sesión dura siempre 1 hora. Quien la marca en un computador compartido cree que va a quedar adentro.

- (recomendada) Quitar la casilla. Costo: ninguno.
- Definir qué significa y hacerla funcionar. Cambia la duración de la sesión, así que toca el sistema de tokens: lo decides tú.

**08.16 · ¿Cuántos caracteres mínimo tiene la contraseña?** (P3, [ver](08-ingreso-y-cuenta.md))

El registro pide mínimo 6 y no repite la contraseña. Elegirla por link y cambiarla en Mi cuenta piden 8. Una contraseña válida al registrarse puede ser rechazada si después se "recupera" con la misma.

- (recomendada) Un solo mínimo para las tres entradas. La auditoría no dice cuál; las otras dos ya piden 8. Costo: chico. Es regla de negocio.

**08.25 · ¿Está activo "Continuar con Google" en producción?** (P3, [ver](08-ingreso-y-cuenta.md))

En desarrollo el botón lleva a Google con un cliente sin configurar. No se pudo ver si producción lo tiene configurado. Si no, es un callejón de un toque hacia una página de error, en las dos pantallas de ingreso.

- (recomendada) Confirmar si Google está activo en producción y, si no lo está, esconder el botón. Costo: chico.
- Dejarlo.

### Tienda online y suscripciones

**09.1 · Al volver de Webpay, ¿cobramos solos el primer período?** (P1, [ver](09-tienda-y-suscripciones.md))

El dueño elige el plan ($35.700) y, como no tiene tarjeta, toca "Agregar tarjeta". La inscribe en Webpay y, al volver, la página cobra el primer período sola: no muestra el total ni pide confirmar. El botón que apretó no decía que iba a cobrar. La doc lo describe como decisión ("cobro sin clic extra"). Si consideras cualquier cobro sin clic como plata en riesgo, esto sube a P0.

- (recomendada) Al volver de Webpay, reabrir el panel con el plan, el día y la tarjeta nueva ya elegidos y el total vigente; el cobro solo con "Suscribirme y pagar $35.700". Costo: toca el cobro de suscripciones; conviene que vaya como frente propio.
- Mantener el cobro automático, pero con el botón "Agregar tarjeta y suscribirme" y el aviso "Te cobraremos $35.700 al volver". Costo: chico.

**09.8 · Al pausar o reanudar una suscripción, ¿qué pasa con el cobro?** (P2, [ver](09-tienda-y-suscripciones.md))

"Pausar" y "Reanudar" actúan al instante, sin confirmar. El dueño pausa la suscripción de un cliente y no sabe si el próximo cobro se salta o se corre. Al reanudar, no sabe si cobra de inmediato.

- (recomendada) Una línea o un modal corto con la regla ("Mientras esté pausada no se cobra. Al reanudar, el próximo cobro es el …"). La regla de cobro al reanudar es de negocio: la defines tú. Costo: chico.
- Dejarlo sin explicación.

**09.19 · ¿Cómo se llaman las pantallas del menú de Tienda Online?** (P3, [ver](09-tienda-y-suscripciones.md))

Dentro de "Tienda Online", "Mis suscripciones" y "Medios de pago" se cortan, y al lado hay una "Suscripciones" que es otra pantalla (la del local). Además "Tienda Online" es una pantalla de compra, no una vitrina del local.

- (recomendada) Renombrar la del dueño a "Suscripciones de clientes" y acortar las hijas ("Mis planes", "Tarjetas"). Costo: ninguno.
- Decidir si "Tienda Online" pasa a llamarse "Comprar". La auditoría no elige.

## El resto, por grupo

Los P2 y P3 de cada grupo. P2 primero. Lo que ya está en "Lo primero" no se repite.

### 00 · Transversal

5 P2 y 5 P3. Documento: [00-transversal.md](00-transversal.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☑ | [00.1](00-transversal.md) | P2 | El archivo de estilos de tarjetas y modales de la raíz no se carga — **hecho 2026-10-16** | owner |
| ☑ | [00.7](00-transversal.md) | P2 | Las cifras de DM Sans no miden lo mismo: los montos no se alinean — **hecho 2026-10-16** (948e06e4) | owner |
| ☑ | [00.8](00-transversal.md) | P2 | Verde, ámbar y rojo de los estados no tienen contraste suficiente sobre blanco — **hecho 2026-10-16** (tokens; los citados quedan por revisar uno por uno) *(ver 01.17, 02.17, 03.9, 03.10, 04.5, 04.6, 04.21, 05.17, 06.27, 07.16)* | agente + owner |
| ☑ | [00.9](00-transversal.md) | P2 | En las tablas de lista, una columna puede no dibujarse y acciones queda fuera *(ver 06.26, 07.1)* — **hecho 2026-10-16** | agente |
| ☑ | [00.12](00-transversal.md) | P2 | Pantallas que no se ven de Venka: tarjetas verdes y ámbar, montos en letra de terminal, MAYÚSCULAS — **hecho 2026-10-16** | agente |
| ☑ | [00.2](00-transversal.md) | P3 | Los links se ven negros y no petróleo, y la guía dice otra cosa — **hecho 2026-10-16** | owner |
| ☑ | [00.3](00-transversal.md) | P3 | Hay textos con voseo mezclados con tuteo en 49 archivos *(ver 01.21, 02.27, 03.19, 04.23, 05.21, 06.24, 07.28, 08.17, 09.18)* — **hecho 2026-10-16** (en pantalla; el backend todavía devuelve unos 90 mensajes en voseo —cobros, ventas, salones y el motor de precios— que la pantalla muestra tal cual) | agente |
| ☑ | [00.4](00-transversal.md) | P3 | Swagger y una variable todavía dicen "Prueba Técnica" — **hecho 2026-10-16** | agente |
| ☑ | [00.5](00-transversal.md) | P3 | En el menú lateral, padre e hija se resaltan juntos y un nombre se corta — **hecho 2026-10-16** | agente |
| ☑ | [00.6](00-transversal.md) | P3 | Los íconos del menú no mostrarían un contador si alguien lo agrega — **hecho 2026-10-16** | agente |

### 01 · POS y ventas

17 P2 y 12 P3. Documento: [01-pos-y-ventas.md](01-pos-y-ventas.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☐ | [01.3](01-pos-y-ventas.md) | P2 | Pagar menos del total no avisa que queda saldo y no hay billetes rápidos | agente + owner |
| ☐ | [01.4](01-pos-y-ventas.md) | P2 | Cambiar la propina pisa el efectivo que la cajera ya había tecleado | agente |
| ☐ | [01.5](01-pos-y-ventas.md) | P2 | Tras cobrar no queda en pantalla el vuelto ni el total | agente |
| ☐ | [01.6](01-pos-y-ventas.md) | P2 | "Total a pagar" y "Vuelto" se ven del mismo tamaño que el resto | agente |
| ☐ | [01.7](01-pos-y-ventas.md) | P2 | Los botones del cobro miden menos de 44 px y cuestan con el dedo | agente |
| ☑ | [01.8](01-pos-y-ventas.md) | P2 | Botones de solo ícono y selectores no tienen nombre para el lector de pantalla — **hecho 2026-10-16** | agente |
| ☑ | [01.9](01-pos-y-ventas.md) | P2 | Las tarjetas del catálogo no se pueden usar con teclado — **hecho 2026-10-16** | agente |
| ☑ | [01.10](01-pos-y-ventas.md) | P2 | Si el catálogo no carga, el aviso es jerga y el panel dice "no hay ítems" — **hecho 2026-10-16** | agente |
| ☑ | [01.11](01-pos-y-ventas.md) | P2 | Una búsqueda sin resultados dice lo mismo que un catálogo vacío — **hecho 2026-10-16** | agente |
| ☐ | [01.12](01-pos-y-ventas.md) | P2 | Si el cálculo falla, el carrito deja el total viejo como si fuera bueno | agente |
| ☐ | [01.13](01-pos-y-ventas.md) | P2 | El carrito es angosto: nombres y precios se cortan o se solapan | agente |
| ☑ | [01.14](01-pos-y-ventas.md) | P2 | A 768 el detalle de venta corta las líneas y pega etiquetas con valores — **hecho 2026-10-16** (la forma cambió; es un drawer, no se midió a 768) | agente |
| ☐ | [01.15](01-pos-y-ventas.md) | P2 | Sin impresora o sin QZ la boleta no sale y casi no se avisa | agente |
| ☑ | [01.16](01-pos-y-ventas.md) | P2 | Entrar a Órdenes sin permiso muestra una lista vacía en vez de "sin permiso" — **hecho 2026-10-16** | agente |
| ☑ | [01.17](01-pos-y-ventas.md) | P2 | La insignia "Pagada" y las cifras de estado no tienen contraste suficiente — **hecho 2026-10-16** *(ver 00.8)* | agente + owner |
| ☑ | [01.18](01-pos-y-ventas.md) | P2 | Abrir caja sin datos avisa con un toast y no marca el campo — **hecho 2026-10-16** | agente |
| ☐ | [01.19](01-pos-y-ventas.md) | P2 | Si falla leer la propina sugerida, el cobro la deja activa con 10% | owner |
| ☑ | [01.20](01-pos-y-ventas.md) | P3 | El aviso de boleta no impresa usa voseo y jerga ("QZ Tray", "timeout") — **hecho 2026-10-16** | agente |
| ☑ | [01.21](01-pos-y-ventas.md) | P3 | Diez textos del POS con voseo *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☑ | [01.22](01-pos-y-ventas.md) | P3 | Jerga en pantalla: "Tercero registrado", título repetido y "1.0000 unidad" — **hecho 2026-10-16** | agente |
| ☐ | [01.23](01-pos-y-ventas.md) | P3 | Quitar una línea del carrito es inmediato, sin confirmar ni deshacer | agente |
| ☐ | [01.24](01-pos-y-ventas.md) | P3 | Las filas "Descuentos -$0" y "Recargos +$0" salen siempre | agente |
| ☐ | [01.25](01-pos-y-ventas.md) | P3 | El buscador del POS no toma foco, no se borra y no agrega con Enter | agente + owner |
| ☐ | [01.26](01-pos-y-ventas.md) | P3 | "Disponible" y "Disponibles" se mezclan y una tarjeta sin stock no dice por qué | agente |
| ☐ | [01.27](01-pos-y-ventas.md) | P3 | El detalle de venta dice "Fisico" sin tilde y "Garzón: Mostrador" | agente |
| ☐ | [01.28](01-pos-y-ventas.md) | P3 | El historial de ventas no tiene filtro de fecha ni búsqueda por folio | owner |
| ☐ | [01.29](01-pos-y-ventas.md) | P3 | "Total cobrado" y "cobrado" muestran dos cifras con el mismo nombre | agente |
| ☑ | [01.30](01-pos-y-ventas.md) | P3 | Un error 500 del cobro se muestra en inglés ("Internal server error") — **hecho 2026-10-16** | agente |
| ☐ | [01.31](01-pos-y-ventas.md) | P3 | Seis textos con tres puntos en vez de "…" y un placeholder poco legible | agente |

### 02 · Salones y mesas

21 P2 y 9 P3. Documento: [02-salones-y-mesas.md](02-salones-y-mesas.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☐ | [02.6](02-salones-y-mesas.md) | P2 | Quitar una línea de la cuenta es inmediato, sin confirmar ni deshacer | agente |
| ☐ | [02.7](02-salones-y-mesas.md) | P2 | La precuenta solo existe en papel; si la impresora falla, no se ve el total | owner |
| ☐ | [02.8](02-salones-y-mesas.md) | P2 | En el cobro de una mesa, el vuelto va en la letra más chica | agente |
| ☐ | [02.9](02-salones-y-mesas.md) | P2 | La propina del 10% viene sumada al cobrar y no hay atajos para sacarla | owner |
| ☐ | [02.10](02-salones-y-mesas.md) | P2 | La cuenta suma sin IVA, el total lleva IVA y nadie explica la diferencia | owner |
| ☑ | [02.11](02-salones-y-mesas.md) | P2 | Las mesas no se pueden elegir con teclado ni lector de pantalla — **hecho 2026-10-16** | agente |
| ☐ | [02.12](02-salones-y-mesas.md) | P2 | Una mesa ocupada no muestra monto, hora ni garzón | agente |
| ☐ | [02.13](02-salones-y-mesas.md) | P2 | El panel de la mesa no tiene botón de cerrar | agente |
| ☐ | [02.14](02-salones-y-mesas.md) | P2 | A 768 la cuenta queda abajo y caben solo 4 líneas | agente |
| ☐ | [02.15](02-salones-y-mesas.md) | P2 | "Entrar a turno" no muestra quién está y "Salir de turno" cierra sin confirmar | agente |
| ☐ | [02.16](02-salones-y-mesas.md) | P2 | El modal de turno preselecciona el primero de la lista, no el de la hora | owner |
| ☐ | [02.17](02-salones-y-mesas.md) | P2 | Al entrar al salón sale siempre una alerta de PIN ámbar de contraste bajo *(ver 00.8)* | agente |
| ☐ | [02.18](02-salones-y-mesas.md) | P2 | Los avisos ámbar y el "Cancelar cuenta" rojo no tienen contraste suficiente | agente |
| ☑ | [02.19](02-salones-y-mesas.md) | P2 | En "Cancelar cuenta", los botones "Cancelar" y "Cancelar cuenta" se confunden — **hecho 2026-10-16** | agente |
| ☑ | [02.20](02-salones-y-mesas.md) | P2 | Las pantallas de gestión de salones abren sin permiso y muestran ceros y avisos — **hecho 2026-10-16** | agente |
| ☐ | [02.21](02-salones-y-mesas.md) | P2 | El filtro de garzones de Anulaciones se achica al elegir uno | agente |
| ☐ | [02.22](02-salones-y-mesas.md) | P2 | Sesiones de garzón no se actualiza y "Forzar cierre" no dice cuántas mesas hay abiertas | agente |
| ☐ | [02.23](02-salones-y-mesas.md) | P2 | Propinas: "Ver reparto" sin fechas no hace nada y un garzón puede salir como código | agente |
| ☐ | [02.24](02-salones-y-mesas.md) | P2 | El plano de salones no se refresca: dos tablets pueden abrir la misma mesa | agente |
| ☐ | [02.25](02-salones-y-mesas.md) | P2 | El catálogo de la cuenta no tiene categorías ni favoritos | agente |
| ☐ | [02.26](02-salones-y-mesas.md) | P2 | Al cobrar una mesa no queda total, vuelto ni folio, y espera la impresión | agente |
| ☑ | [02.27](02-salones-y-mesas.md) | P3 | Voseo en la pantalla del garzón *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☑ | [02.28](02-salones-y-mesas.md) | P3 | Jerga y números sin formato en las pantallas del garzón — **hecho 2026-10-16** | agente |
| ☐ | [02.29](02-salones-y-mesas.md) | P3 | "Tomar cuenta" está activo sobre una cuenta que ya es del garzón | agente |
| ☐ | [02.30](02-salones-y-mesas.md) | P3 | "Nueva cuenta" sin turno obliga a tocarla otra vez tras entrar a turno | agente |
| ☐ | [02.31](02-salones-y-mesas.md) | P3 | "Cantidad a anular" arranca vacía aunque solo se puede anular una unidad | agente |
| ☐ | [02.32](02-salones-y-mesas.md) | P3 | Anulaciones: "Personal" y "Comida del personal" nombran lo mismo; tarjetas en cero repetidas | agente |
| ☐ | [02.33](02-salones-y-mesas.md) | P3 | "¿Te pidieron firmar un cierre?" pesa igual que acciones de uso diario | agente |
| ☑ | [02.34](02-salones-y-mesas.md) | P3 | La tecla borrar del PIN no tiene nombre para el lector de pantalla — **hecho 2026-10-16** | agente |
| ☐ | [02.35](02-salones-y-mesas.md) | P3 | Si falla cargar garzones y turnos, los filtros quedan vacíos sin aviso | agente |

### 03 · Caja

15 P2 y 11 P3. Documento: [03-caja.md](03-caja.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☐ | [03.4](03-caja.md) | P2 | Al cerrar la caja el resultado queda solo en un aviso de 5 segundos | agente |
| ☐ | [03.5](03-caja.md) | P2 | En una caja ajena se muestra el saldo esperado y se dice "a ciegas" | agente |
| ☐ | [03.6](03-caja.md) | P2 | "Cerrar por el cajero" queda bajo el pliegue, después de las tablas | agente |
| ☐ | [03.7](03-caja.md) | P2 | Los botones principales de caja miden 28 a 32 px en la tablet | agente |
| ☑ | [03.8](03-caja.md) | P2 | Las cifras de plata en verde y rojo no tienen contraste suficiente — **hecho 2026-10-16** | agente |
| ☑ | [03.9](03-caja.md) | P2 | Los botones sólidos verde, rojo y ámbar de caja no tienen contraste con letra blanca — **hecho 2026-10-16** *(ver 00.8)* | agente + owner |
| ☐ | [03.10](03-caja.md) | P2 | El texto ámbar de caja ("Sin justificar", avisos) no tiene contraste suficiente *(ver 00.8)* | agente |
| ☑ | [03.11](03-caja.md) | P2 | Las tarjetas de cajón no se pueden usar con teclado — **hecho 2026-10-16** | agente |
| ☑ | [03.12](03-caja.md) | P2 | Los dos campos de fecha de la tendencia no dicen "Desde" ni "Hasta" — **hecho 2026-10-16** | agente |
| ☑ | [03.13](03-caja.md) | P2 | Los datos que faltan en caja se avisan con un toast, no junto al campo — **hecho 2026-10-16** | agente |
| ☑ | [03.14](03-caja.md) | P2 | "Enviar conteo" y "Confirmar cierre" quedan apagados sin decir qué falta — **hecho 2026-10-16** | agente |
| ☐ | [03.15](03-caja.md) | P2 | El estado de caja sale crudo: "EN_CONCILIACION", "cerrada" a 10 px | agente |
| ☐ | [03.16](03-caja.md) | P2 | El historial del encargado no tiene columna de cajero ni dice por quién se filtró | agente |
| ☐ | [03.17](03-caja.md) | P2 | "Pendientes de revisar" no dice cuántos hay | agente |
| ☐ | [03.18](03-caja.md) | P2 | Revisar un descuadre exige ir y volver: el detalle no muestra la explicación | agente |
| ☑ | [03.19](03-caja.md) | P3 | Voseo en los textos de caja *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☐ | [03.20](03-caja.md) | P3 | Palabras de sistema en caja: "tenant", y Caja, Cajón y caja para lo mismo | agente |
| ☐ | [03.21](03-caja.md) | P3 | Las cifras de las tablas de caja usan otra letra (monoespaciada) que el resto | agente |
| ☐ | [03.22](03-caja.md) | P3 | Sin movimientos el resumen pinta "+ $0" en verde y "- $0" en rojo | agente |
| ☐ | [03.23](03-caja.md) | P3 | Una frase de caja termina con doble punto después de la fecha | agente |
| ☐ | [03.24](03-caja.md) | P3 | El panel de apertura de caja mide 40% y corta el campo "Comentario" | agente |
| ☑ | [03.25](03-caja.md) | P3 | El selector Entrada/Salida no anuncia cuál está elegido — **hecho 2026-10-16** | agente |
| ☐ | [03.26](03-caja.md) | P3 | "Marcar visto" actúa al primer toque y no se puede deshacer | agente |
| ☑ | [03.27](03-caja.md) | P3 | Entrar a "Mi caja" sin permiso lleva a Ventas con tres avisos, uno en voseo — **hecho 2026-10-16** | agente |
| ☐ | [03.28](03-caja.md) | P3 | Idea: fondo sugerido por caja y atajos para los conceptos de movimiento | owner |
| ☐ | [03.29](03-caja.md) | P3 | La tabla de movimientos parpadea y pierde el punto de lectura al paginar | agente |

### 04 · Inicio y reportes

13 P2 y 9 P3. Documento: [04-inicio-y-reportes.md](04-inicio-y-reportes.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☑ | [04.5](04-inicio-y-reportes.md) | P2 | La cifra de efectivo en Inicio es verde claro, con poco contraste y otra letra — **hecho 2026-10-16** *(ver 00.8)* | agente |
| ☑ | [04.6](04-inicio-y-reportes.md) | P2 | Las alertas de Inicio (stock bajo, pagos sin venta) usan colores sin contraste suficiente — **resuelto por el lote 0 (00.8, tokens de estado)** *(ver 00.8)* | agente |
| ☑ | [04.7](04-inicio-y-reportes.md) | P2 | Si Inicio falla, las tarjetas dicen "Cargando" y "Sin conexión" a la vez — **hecho 2026-10-16** | agente |
| ☑ | [04.8](04-inicio-y-reportes.md) | P2 | Un usuario sin permisos ve Inicio con "Bienvenido", "Ahora" y nada más — **hecho 2026-10-16** | agente |
| ☑ | [04.9](04-inicio-y-reportes.md) | P2 | Inicio muestra cantidades crudas ("2.0000") y plurales mal ("1 mermas") — **hecho 2026-10-16** | agente |
| ☐ | [04.10](04-inicio-y-reportes.md) | P2 | Las tarjetas de Inicio llevan a listas completas, no a lo que prometen — **parcial 2026-10-16** (Cierres con descuadre va a `/cajas/pendientes-revision`; falta Por cobrar → ventas pendientes y parciales: `/ventas` filtra por un solo estado y necesita un filtro múltiple en esa pantalla, de otro grupo) | agente + owner |
| ☑ | [04.11](04-inicio-y-reportes.md) | P2 | En Inicio todas las cifras pesan igual: Vendido y Cobrado no destacan — **hecho 2026-10-16** | agente + owner |
| ☑ | [04.12](04-inicio-y-reportes.md) | P2 | "Actualizado" repetido cinco veces empuja "Hoy" bajo el pliegue — **hecho 2026-10-16** *(ver 00.1)* | agente |
| ☑ | [04.13](04-inicio-y-reportes.md) | P2 | La tarjeta de cierres no muestra cuántos descuadres graves siguen sin revisar — **hecho 2026-10-16** | agente |
| ☑ | [04.17](04-inicio-y-reportes.md) | P2 | En /desfases el botón "Después" no hace nada — **hecho 2026-10-16** | agente |
| ☑ | [04.18](04-inicio-y-reportes.md) | P2 | Si /desfases falla, la tabla dice "Sin costos desfasados", como si todo estuviera al día — **hecho 2026-10-16** | agente |
| ☑ | [04.19](04-inicio-y-reportes.md) | P2 | Si Varianza falla salen tres avisos iguales y la tabla dice "ningún producto" — **hecho 2026-10-16** | agente |
| ☐ | [04.21](04-inicio-y-reportes.md) | P2 | La gráfica de Varianza distingue series solo por color y el ámbar no se lee — **parcial 2026-10-16** (el ámbar ya contrasta por el lote 0 y la gráfica trae una tabla para lector de pantalla; falta el valor visible en la barra para tablet) *(ver 00.8)* | agente |
| ☑ | [04.14](04-inicio-y-reportes.md) | P3 | La tarjeta Cajas no dice cuántas hay abiertas ni desde qué hora — **hecho 2026-10-16** | agente |
| ☑ | [04.15](04-inicio-y-reportes.md) | P3 | Ctrl/Cmd+clic en una tarjeta de Inicio no abre pestaña nueva — **hecho 2026-10-16** | agente |
| ☐ | [04.16](04-inicio-y-reportes.md) | P3 | En la tablet, "Actualizar" y los enlaces de Pérdidas miden 16 a 24 px — **parcial 2026-10-16** ("Actualizar" y los enlaces de Pérdidas a 44 px, casillas de Desfases con área de 44 px e interruptor de Varianza; quedan el ícono de calendario de `AppDateInput` y el "i" de `DiaNegocioNota`, componentes compartidos por toda la app) | agente |
| ☑ | [04.20](04-inicio-y-reportes.md) | P3 | Jerga en la tabla de Varianza y columnas clave fuera de vista a 768 — **hecho 2026-10-16** | agente + owner |
| ☑ | [04.22](04-inicio-y-reportes.md) | P3 | "Costos desfasados" repite el mismo texto dos veces y escribe "items" sin tilde — **hecho 2026-10-16** | agente |
| ☑ | [04.23](04-inicio-y-reportes.md) | P3 | Voseo en Inicio y Reportes *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☑ | [04.24](04-inicio-y-reportes.md) | P3 | Cuatro líneas seguidas dicen "vs. viernes pasado: —" — **hecho 2026-10-16** | agente |
| ☑ | [04.25](04-inicio-y-reportes.md) | P3 | "Bienvenido, Admin" va en masculino y el ícono de check no significa nada — **hecho 2026-10-16** | owner |
| ☑ | [04.26](04-inicio-y-reportes.md) | P3 | Con datos, Pérdidas parte los textos en dos renglones y Ventas deja un hueco — **hecho 2026-10-16** (cada tarjeta mide lo suyo; las cantidades ya salían sin decimales por el lote 6) | owner |

### 05 · Inventario

18 P2 y 5 P3. Documento: [05-inventario.md](05-inventario.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☑ | [05.3](05-inventario.md) | P2 | Al contar con teclado, Tab pierde el foco cuando el campo se guarda — **hecho 2026-10-16** (el campo no se apaga al guardar y Enter pasa al siguiente) | agente |
| ☑ | [05.4](05-inventario.md) | P2 | Los conteos salen con cuatro decimales ("49.0000") mientras el stock dice "51" — **hecho 2026-10-16** (conteo, diferencia y la lista con «Con diferencia» en vez de la suma neta; el campo del mínimo en Stock sigue sin la unidad al lado) | agente |
| ☑ | [05.5](05-inventario.md) | P2 | Para contar toda la bodega hay que marcar producto por producto — **hecho 2026-10-16** (casilla «Todos los productos con stock en esta ubicación»; endpoint de lectura `GET /recuentos/productos-con-stock`) | owner |
| ☑ | [05.6](05-inventario.md) | P2 | En "Cancelar recuento", los botones "Cancelar" y "Cancelar recuento" se confunden — **hecho 2026-10-16** | agente |
| ☑ | [05.7](05-inventario.md) | P2 | Un recuento aplicado se ve igual que uno abierto y no dice quién lo aplicó — **hecho 2026-10-16** | agente |
| ☑ | [05.8](05-inventario.md) | P2 | El traslado deja escribir más que el stock disponible; recién el servidor lo rechaza — **hecho 2026-10-16** (marca, no bloqueo: en traslados avisa «Pasa de lo que hay»; en mermas dice cuánto hay en la ubicación) | agente |
| ☑ | [05.9](05-inventario.md) | P2 | Una merma incompleta avisa siempre "Completa producto, cantidad y motivo", sin marcar cuál — **hecho 2026-10-16** | agente |
| ☑ | [05.10](05-inventario.md) | P2 | "Confirmar traslado" queda apagado sin decir qué falta — **hecho 2026-10-16** | agente |
| ☑ | [05.11](05-inventario.md) | P2 | Un traslado o merma mal tipeado no tiene resumen previo ni deshacer — **hecho 2026-10-16** (resumen en traslados y mermas; anular no entra, decidido) | agente + owner |
| ☑ | [05.12](05-inventario.md) | P2 | El kardex tiene 10 columnas y deja Resultante, Costo y Usuario fuera de vista — **hecho 2026-10-16** (una sola columna de costo; a 768 el kardex sigue con scroll interno: 1077 de 672 px, antes 1221) | agente + owner |
| ☑ | [05.13](05-inventario.md) | P2 | A 768 faltan columnas en traslados y mermas y el selector de causa se corta — **hecho 2026-10-16** (medido a 768: traslados y mermas entran, 672 de 672 px) | agente |
| ☑ | [05.14](05-inventario.md) | P2 | El menú dice "Stock" pero la pantalla es una lista de movimientos, no el saldo — **hecho 2026-10-16** (Stock = saldo por producto y ubicación, reutiliza el listado de Stock mínimo; `/inventario/stock-minimo` redirige) | agente + owner |
| ☑ | [05.15](05-inventario.md) | P2 | Un stock mínimo inválido muestra un aviso técnico a medias en inglés — **hecho 2026-10-16** | agente |
| ☑ | [05.16](05-inventario.md) | P2 | Los dos campos de fecha de Mermas no dicen "Desde" ni "Hasta" — **hecho 2026-10-16** | agente |
| ☑ | [05.17](05-inventario.md) | P2 | En el kardex y Mermas, cantidades e insignias verde, ámbar y rojo se leen mal — **hecho 2026-10-16** (colores e insignias; el placeholder no) *(ver 00.8)* | owner |
| ☑ | [05.18](05-inventario.md) | P2 | Los botones de Inventario miden 20 a 28 px en la tablet — **hecho 2026-10-16** | agente |
| ☑ | [05.19](05-inventario.md) | P2 | Los selectores de Inventario se anuncian "Show popup" y el tacho no tiene nombre — **hecho 2026-10-16** (la casilla de cada serie va atada a su texto y mide 44 px) | agente |
| ☑ | [05.20](05-inventario.md) | P2 | Si falla cargar una lista de inventario, la tabla dice "no hay nada" — **hecho 2026-10-16** | agente |
| ☑ | [05.21](05-inventario.md) | P3 | Voseo en Inventario *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☑ | [05.22](05-inventario.md) | P3 | Jerga y códigos internos en pantalla: "tenant", "kardex" y el id de cada movimiento — **hecho 2026-10-16** | agente |
| ☑ | [05.23](05-inventario.md) | P3 | Un filtro sin resultados dice "No hay movimientos registrados" como si no hubiera nada — **hecho 2026-10-16** | agente |
| ☑ | [05.24](05-inventario.md) | P3 | Sin permiso o sin bodegas, el botón falta o se apaga sin explicar — **hecho 2026-10-16** (traslados y mermas) | agente |
| ☑ | [05.25](05-inventario.md) | P3 | El formulario de merma tiene campos de anchos distintos y un aviso tapa el título — **hecho 2026-10-16** (anchos; el toast que tapaba el título del drawer no se tocó) | agente |

### 06 · Compras y terceros

18 P2 y 8 P3. Documento: [06-compras-y-terceros.md](06-compras-y-terceros.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☑ | [06.5](06-compras-y-terceros.md) | P2 | En la cabecera de la compra, lo que falta apaga "Guardar borrador" sin decir qué — **hecho 2026-10-16** | agente |
| ☐ | [06.7](06-compras-y-terceros.md) | P2 | "Pagos" de Por pagar dice "Sin pagos registrados" aunque se acabe de pagar | agente |
| ☐ | [06.8](06-compras-y-terceros.md) | P2 | Los botones de la línea de compra no tienen nombre y quitar no se deshace — **parcial 2026-10-16** (papelera, lápiz y selectores con nombre y a 44 px; queda el "Deshacer" del toast al quitar una línea) | agente |
| ☐ | [06.9](06-compras-y-terceros.md) | P2 | La fecha de una compra sale en tres formatos distintos | agente |
| ☑ | [06.10](06-compras-y-terceros.md) | P2 | Sin permiso, Nueva compra y el detalle de compra quedan en blanco — **hecho 2026-10-16** | agente |
| ☐ | [06.11](06-compras-y-terceros.md) | P2 | Sin permiso de Terceros, la pantalla dice "No hay terceros registrados" — **parcial 2026-10-16** (hecha la mitad de pantalla: sin permiso dice "Sin acceso a los terceros", no el vacío falso; falta que quien carga compras pueda crear el proveedor, que es el frente de permisos del backend) | agente + owner |
| ☐ | [06.12](06-compras-y-terceros.md) | P2 | Pagar en efectivo sin caja abierta falla con un aviso lejos del botón | agente |
| ☐ | [06.13](06-compras-y-terceros.md) | P2 | "Pagar todo lo que debo" no tiene atajo y "Pagar" se apaga sin explicar | agente |
| ☑ | [06.14](06-compras-y-terceros.md) | P2 | En la tablet, la columna "Pago" de la lista de compras queda fuera de vista — **hecho 2026-10-16** (medido a 768: la lista entra, 672 de 672 px) | agente |
| ☑ | [06.15](06-compras-y-terceros.md) | P2 | Un XML con RUT mal formado da un mensaje técnico y no deja elegir otro — **hecho 2026-10-16** | agente |
| ☐ | [06.16](06-compras-y-terceros.md) | P2 | El formulario de Terceros no valida nada y los errores llegan por toast — *parcial 2026-10-16: Nombre y correo junto al campo; el formato de RUT no, porque el servidor no lo valida hoy* | agente |
| ☑ | [06.17](06-compras-y-terceros.md) | P2 | Un filtro de compras sin resultados dice "No hay compras registradas" — **hecho 2026-10-16** | agente |
| ☐ | [06.18](06-compras-y-terceros.md) | P2 | Tras pagar, el aviso no dice monto ni medio y "Pagar" sigue activo sin deuda | agente |
| ☐ | [06.19](06-compras-y-terceros.md) | P2 | El documento se lee "FacturaAUDIT-001", sin espacio entre tipo y folio | agente |
| ☐ | [06.20](06-compras-y-terceros.md) | P2 | Los botones de uso frecuente de Compras miden 16 a 32 px en la tablet — **parcial 2026-10-16** ("Corregir", "Corregir total o vencimiento", "Cargar descuento", "Agregar línea", la papelera y el radio "Sí, la pagué" a 44 px; queda el interruptor de Terceros) | agente |
| ☐ | [06.22](06-compras-y-terceros.md) | P2 | En Por pagar, "Pagar" no se ve hasta tocar una fila de proveedor | agente |
| ☐ | [06.23](06-compras-y-terceros.md) | P2 | El modal "¿Confirmar la recepción?" no muestra qué productos entran ni a qué costo | agente |
| ☑ | [06.26](06-compras-y-terceros.md) | P2 | La columna "Pago" de la lista de compras sale vacía al recargar *(causa en 00.9)* — **hecho 2026-10-16** | agente |
| ☑ | [06.21](06-compras-y-terceros.md) | P3 | Las filas de Compras no son enlaces: no abren en otra pestaña — **hecho 2026-10-16** | agente |
| ☑ | [06.24](06-compras-y-terceros.md) | P3 | Voseo en Compras y Terceros *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☑ | [06.25](06-compras-y-terceros.md) | P3 | El menú dice "Recepciones" y la pantalla dice "Compras" — **hecho 2026-10-16** | owner |
| ☐ | [06.27](06-compras-y-terceros.md) | P3 | La insignia verde, "Confirmar recepción" y el placeholder de Compras se leen mal *(ver 00.8)* | agente |
| ☑ | [06.28](06-compras-y-terceros.md) | P3 | El interruptor "Activo" de Terceros no tiene nombre y la lista no tiene buscador — **hecho 2026-10-16** | agente |
| ☑ | [06.29](06-compras-y-terceros.md) | P3 | "Tercero" en pantalla (el local dice proveedor) y una ayuda que cita la especificación — **hecho 2026-10-16** | agente + owner |
| ☐ | [06.30](06-compras-y-terceros.md) | P3 | Salir de "Nueva compra" con datos tipeados no avisa que se pierden | agente |
| ☐ | [06.31](06-compras-y-terceros.md) | P3 | En la compra confirmada, "Total del documento" y "Total" repiten el mismo monto | agente |

### 07 · Configuración

21 P2 y 13 P3. Documento: [07-configuracion.md](07-configuracion.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☑ | [07.3](07-configuracion.md) | P2 | Mientras carga o si falla, Configuración dice "No hay X registrados" — **hecho 2026-10-16** | agente |
| ☑ | [07.4](07-configuracion.md) | P2 | El menú de Configuración tiene 28 entradas y casi la mitad queda bajo el pliegue — **hecho 2026-10-16** | agente |
| ☑ | [07.5](07-configuracion.md) | P2 | La zona de trabajo es angosta y "Nuevo X" y "Ver eliminados" se parten — **hecho 2026-10-16** | agente |
| ☑ | [07.6](07-configuracion.md) | P2 | A 768 el panel lateral de Items trunca valores y parte las etiquetas — **hecho 2026-10-16** | agente |
| ☑ | [07.7](07-configuracion.md) | P2 | Los campos de texto de Configuración miden 167 px aunque haya espacio libre — **hecho 2026-10-16** | agente |
| ☑ | [07.8](07-configuracion.md) | P2 | 69 interruptores y 35 botones de ícono en Configuración no tienen nombre accesible — **hecho 2026-10-16** | agente |
| ☑ | [07.9](07-configuracion.md) | P2 | Eliminar un rol usa el diálogo del navegador y no dice cuántos lo tienen — **hecho 2026-10-16** | agente + owner |
| ☑ | [07.10](07-configuracion.md) | P2 | "Crear" un rol con el nombre vacío no hace nada ni avisa — **hecho 2026-10-16** | agente |
| ☑ | [07.11](07-configuracion.md) | P2 | Guardar permisos de un rol manda hasta 16 guardados seguidos y puede quedar a medias — **hecho 2026-10-16** | owner |
| ☑ | [07.12](07-configuracion.md) | P2 | Apagar "Efectivo" en Métodos de pago se hace con un toque, sin confirmar — **hecho 2026-10-16** (método de pago, descuento y recargo piden confirmación al apagar; impuestos va en el frente fiscal; el resto guarda con "Deshacer") | owner |
| ☑ | [07.13](07-configuracion.md) | P2 | Escape o un clic al lado cierra el panel de Items y se pierde lo escrito — **hecho 2026-10-16** | agente |
| ☐ | [07.14](07-configuracion.md) | P2 | Para crear un IVA de 19% hay que escribir 0.19 | owner |
| ☑ | [07.15](07-configuracion.md) | P2 | La lista de descuentos redondea 2,5% a "3%" y muestra montos fijos como "5000.0000" — **hecho 2026-10-16** | agente |
| ☑ | [07.16](07-configuracion.md) | P2 | Los chips y avisos verde y ámbar de Configuración no tienen contraste suficiente *(ver 00.8)* — **hecho 2026-10-16** (resuelto por el lote 00.8: los tonos de estado pasan 4,5:1) | agente |
| ☑ | [07.17](07-configuracion.md) | P2 | Una impresora se da de alta sin poder probarla ni validar el host — **hecho 2026-10-16** | owner |
| ☑ | [07.18](07-configuracion.md) | P2 | Editar o eliminar una mesa solo se puede con doble clic en el plano — **hecho 2026-10-16** | agente |
| ☑ | [07.19](07-configuracion.md) | P2 | El ícono "tótem" de Usuarios cambia cómo entra la persona al salón, con un toque — **hecho 2026-10-16** | agente + owner |
| ☑ | [07.20](07-configuracion.md) | P2 | Usuarios no permite quitar a alguien del local, aunque el sistema sabe hacerlo — **hecho 2026-10-16** | owner |
| ☑ | [07.21](07-configuracion.md) | P2 | "Crear" usuario queda gris sin decir qué falta y un correo malo no se marca — **hecho 2026-10-16** | agente |
| ☑ | [07.22](07-configuracion.md) | P2 | Quien no es administrador y abre una pantalla de admin vuelve a Perfil sin aviso — **hecho 2026-10-16** | agente |
| ☐ | [07.23](07-configuracion.md) | P2 | En desarrollo, el menú de Configuración muestra el ícono de otra entrada — *2026-10-16: no reproducible sin navegador; el `npm run build` pasa y los íconos son `i-lucide-*` correctos. Queda por mirar a ojo en el dev server* | agente |
| ☑ | [07.24](07-configuracion.md) | P3 | El panel de un rol fijo no muestra los permisos que da — **hecho 2026-10-16** | agente |
| ☑ | [07.25](07-configuracion.md) | P3 | Las insignias de Configuración miden 8 a 10 px de texto — **hecho 2026-10-16** (resuelto por los lotes 01.17 y 05.17: ninguna insignia baja de 12 px) | agente |
| ☑ | [07.26](07-configuracion.md) | P3 | Los botones de fila de Configuración miden 28 a 32 px y están pegados — **hecho 2026-10-16** | agente |
| ☑ | [07.27](07-configuracion.md) | P3 | "Tenant" aparece en diez textos de Configuración — **hecho 2026-10-16** | agente |
| ☑ | [07.28](07-configuracion.md) | P3 | Voseo en 41 líneas de Configuración *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☑ | [07.29](07-configuracion.md) | P3 | "Nuevo recargo" usa una frase de descuentos ("se descuenta línea por línea") — **hecho 2026-10-16** | agente |
| ☑ | [07.30](07-configuracion.md) | P3 | El menú y los títulos de Configuración usan nombres distintos para lo mismo — **hecho 2026-10-16** | agente + owner |
| ☑ | [07.31](07-configuracion.md) | P3 | Empresa: Nombre y Correo no se marcan como requeridos y "Fin del día" no confirma — **hecho 2026-10-16** | owner |
| ☑ | [07.32](07-configuracion.md) | P3 | En Items el stock sale con cuatro decimales y los costos con otra letra — **hecho 2026-10-16** | agente |
| ☑ | [07.33](07-configuracion.md) | P3 | Items no filtra por categoría ni ordena por precio o stock — **hecho 2026-10-16** | owner |
| ☑ | [07.34](07-configuracion.md) | P3 | Entrar a Configuración cae en Perfil, no en lo que el dueño viene a configurar — **hecho 2026-10-16** | owner |
| ☑ | [07.35](07-configuracion.md) | P3 | Los vacíos de Configuración dicen "No hay X" sin decir cómo empezar — **hecho 2026-10-16** | agente |
| ☑ | [07.36](07-configuracion.md) | P3 | El pie de los modales dibuja una doble línea sobre los botones *(ver 00.1)* — **hecho 2026-10-16** | agente |

### 08 · Ingreso y cuenta

11 P2 y 14 P3. Documento: [08-ingreso-y-cuenta.md](08-ingreso-y-cuenta.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☑ | [08.2](08-ingreso-y-cuenta.md) | P2 | Los errores de registro y de Mi cuenta salen en inglés y con nombres internos *(parte en 00.11)* — **hecho 2026-10-16** (mensajes en español en los DTO de registro, perfil y cambio de contraseña; el barrido de los demás DTO de la app queda fuera de este grupo) | agente |
| ☐ | [08.3](08-ingreso-y-cuenta.md) | P2 | "Guardar y entrar" manda al login y hay que escribir la contraseña de nuevo | agente — *parcial 2026-10-16: el botón dice "Guardar contraseña" y el aviso "Contraseña guardada"; volver a escribir la contraseña sigue, porque entrar solo exige emitir tokens (invariante 4), pendiente del owner* |
| ☑ | [08.4](08-ingreso-y-cuenta.md) | P2 | Un link vencido no deja pedir otro desde ahí y está en voseo — **hecho 2026-10-16** | agente |
| ☑ | [08.5](08-ingreso-y-cuenta.md) | P2 | Tras registrarse, la pantalla dice "Si ese correo no tenía cuenta…" sin nombrar el correo — **hecho 2026-10-16** | agente |
| ☑ | [08.6](08-ingreso-y-cuenta.md) | P2 | La invitación no dice a qué empresa te están sumando — **hecho 2026-10-16** (la consulta de la invitación devuelve la empresa) | agente |
| ☐ | [08.7](08-ingreso-y-cuenta.md) | P2 | "Mantener sesión iniciada" no hace nada | owner |
| ☑ | [08.8](08-ingreso-y-cuenta.md) | P2 | Los controles del ingreso miden 32 px y los enlaces 16 px — **hecho 2026-10-16** | agente |
| ☑ | [08.9](08-ingreso-y-cuenta.md) | P2 | El ojo de mostrar contraseña no se alcanza con Tab ni tiene nombre — **hecho 2026-10-16** | agente |
| ☑ | [08.10](08-ingreso-y-cuenta.md) | P2 | Los avisos de error del ingreso tienen poco contraste y no se anuncian al lector — **hecho 2026-10-16** (el contraste lo resolvió 00.8; `role="alert"` en los tres avisos) | agente |
| ☑ | [08.11](08-ingreso-y-cuenta.md) | P2 | Si falla elegir el local, "Reintentar" recarga la lista y hay que elegir otra vez — **hecho 2026-10-16** | agente |
| ☑ | [08.12](08-ingreso-y-cuenta.md) | P2 | En "Elegir local" los nombres largos se cortan y dos locales parecidos se ven iguales — **hecho 2026-10-16** | agente |
| ☑ | [08.13](08-ingreso-y-cuenta.md) | P3 | Los avatares de locales usan rojo y amarillo de alerta; la lista vacía queda en blanco — **hecho 2026-10-16** | owner |
| ☑ | [08.14](08-ingreso-y-cuenta.md) | P3 | Mayúscula en cada palabra del menú de usuario y tres palabras para "local" — **hecho 2026-10-16** | agente |
| ☑ | [08.15](08-ingreso-y-cuenta.md) | P3 | "Mi Cuenta" lleva a una pantalla que se llama "Configuración" — **hecho 2026-10-16** | agente |
| ☑ | [08.16](08-ingreso-y-cuenta.md) | P3 | El registro pide contraseña de 6 caracteres y el resto de 8 — **hecho 2026-10-16** (8 en la pantalla y en el servidor) | owner |
| ☑ | [08.17](08-ingreso-y-cuenta.md) | P3 | Voseo en el ingreso, incluidos mensajes que llegan desde el servidor *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☑ | [08.18](08-ingreso-y-cuenta.md) | P3 | El ingreso difiere de la maqueta aprobada en títulos, links y ancho de tarjeta *(ver 00.2)* — **hecho 2026-10-16** (tarjeta de 420 px; títulos y links, antes) | agente + owner |
| ☑ | [08.19](08-ingreso-y-cuenta.md) | P3 | Los placeholders del ingreso tienen poco contraste y el de contraseña parece escrito — **hecho 2026-10-16** (global en `app.config.ts`: `placeholder:text-muted`) | agente |
| ☑ | [08.20](08-ingreso-y-cuenta.md) | P3 | El correo de recuperación no ofrece autocompletado y los correos tienen corrector ortográfico — **hecho 2026-10-16** | agente |
| ☑ | [08.21](08-ingreso-y-cuenta.md) | P3 | Con sesión abierta, /login muestra el formulario y /no-tenant abre sin sesión — **hecho 2026-10-16** (middleware `invitado`; `/no-tenant` pide sesión) | agente |
| ☑ | [08.22](08-ingreso-y-cuenta.md) | P3 | Los estados de "cargando" del ingreso se ven distintos entre pantallas — **hecho 2026-10-16** (`AppMarco` con `cargando`) | agente |
| ☑ | [08.23](08-ingreso-y-cuenta.md) | P3 | En link inválido, título y párrafo dicen la misma frase seguida — **hecho 2026-10-16** | agente |
| ☑ | [08.24](08-ingreso-y-cuenta.md) | P3 | En Mi cuenta los campos miden 167 px y uno se corta a 768 — **hecho 2026-10-16** | agente |
| ☐ | [08.25](08-ingreso-y-cuenta.md) | P3 | "Continuar con Google" puede llevar a una página de error si no está configurado | owner |
| ☑ | [08.26](08-ingreso-y-cuenta.md) | P3 | "Las contraseñas no coinciden" aparece desde la primera letra de la repetición — **hecho 2026-10-16** | agente |

### 09 · Tienda y suscripciones

15 P2 y 7 P3. Documento: [09-tienda-y-suscripciones.md](09-tienda-y-suscripciones.md).

| ¿Entra? | # | Sev | Título | Decide |
|---|---|---|---|---|
| ☑ | [09.3](09-tienda-y-suscripciones.md) | P2 | Recargar Suscripciones manda a Inicio sin decir nada — **hecho 2026-10-16** | agente |
| ☑ | [09.4](09-tienda-y-suscripciones.md) | P2 | Si una lectura falla, la tienda muestra "no hay nada" o una alerta falsa — **hecho 2026-10-16** | agente |
| ☐ | [09.5](09-tienda-y-suscripciones.md) | P2 | La pantalla de pago aprobado no muestra monto ni número de venta | agente |
| ☐ | [09.6](09-tienda-y-suscripciones.md) | P2 | La pantalla de resultado del pago deja callejones sin salida, sin reintento ni enlace | agente |
| ☐ | [09.7](09-tienda-y-suscripciones.md) | P2 | Al cancelar una suscripción, dos botones dicen "Cancelar" en el mismo modal | agente |
| ☐ | [09.8](09-tienda-y-suscripciones.md) | P2 | "Pausar" y "Reanudar" actúan al instante sin decir qué pasa con el cobro | owner |
| ☐ | [09.9](09-tienda-y-suscripciones.md) | P2 | El selector muestra el neto ($30.000) y el total a cobrar es otro ($35.700) | agente |
| ☐ | [09.10](09-tienda-y-suscripciones.md) | P2 | Los controles del carrito online miden 24 a 28 px y quitar es inmediato — **parcial 2026-10-16** (basurero y ± a 44 px y el basurero apartado; queda "Pagar" (36 px, botón de cobrar) y el "Deshacer") | agente |
| ☑ | [09.11](09-tienda-y-suscripciones.md) | P2 | Botones de ícono de la tienda sin nombre; la estrella solo cambia de color — **hecho 2026-10-16** | agente |
| ☑ | [09.12](09-tienda-y-suscripciones.md) | P2 | Las tarjetas del catálogo de la tienda no se pueden usar con teclado — **hecho 2026-10-16** | agente |
| ☑ | [09.13](09-tienda-y-suscripciones.md) | P2 | El catálogo de la tienda dice lo mismo vacío que sin resultados — **hecho 2026-10-16** | agente |
| ☐ | [09.14](09-tienda-y-suscripciones.md) | P2 | Sin permiso, la tienda deja armar un carrito entero y falla recién al pagar | agente |
| ☑ | [09.15](09-tienda-y-suscripciones.md) | P2 | Jerga en tienda y suscripciones: "tenant", "pasarela con tokenización (Oneclick)" — **hecho 2026-10-16** | agente |
| ☐ | [09.16](09-tienda-y-suscripciones.md) | P2 | A 768 el carrito de la tienda queda bajo el catálogo, lejos de "Pagar" | agente |
| ☐ | [09.22](09-tienda-y-suscripciones.md) | P2 | La suscripción a medias queda guardada en el navegador sin caducidad ni usuario | agente |
| ☐ | [09.17](09-tienda-y-suscripciones.md) | P3 | El carrito online muestra "Descuentos -$0" y el total no destaca | agente |
| ☑ | [09.18](09-tienda-y-suscripciones.md) | P3 | Voseo en tienda y suscripciones *(lote 00.3)* — **hecho 2026-10-16** | agente |
| ☑ | [09.19](09-tienda-y-suscripciones.md) | P3 | El menú de Tienda Online corta los nombres y tiene dos "Suscripciones" casi iguales — **hecho 2026-10-16** | owner |
| ☐ | [09.20](09-tienda-y-suscripciones.md) | P3 | La pasarela simulada redirige a /tienda sin decir por qué si la referencia es inválida | agente |
| ☐ | [09.21](09-tienda-y-suscripciones.md) | P3 | Los vacíos de tarjetas y suscripciones no dicen qué hacer | agente |
| ☑ | [09.23](09-tienda-y-suscripciones.md) | P3 | Suscripciones no busca por cliente y un filtro vacío dice "no hay suscripciones" — **hecho 2026-10-16** | agente |
| ☐ | [09.24](09-tienda-y-suscripciones.md) | P3 | La pantalla del superadmin no muestra "cargando", ni reintento, ni menú de usuario | agente |

## Lotes sugeridos

Hallazgos que se arreglan juntos, por componente o por causa común. Cada lote dice si toca pantallas de plata: esos van como frente propio, solos y con su verificación (regla del proyecto), no de arrastre.

### Lote 1 · Líneas incompletas que se descartan en silencio

**Qué cierra:**

- 00.10, 05.2, 06.1. Mismo patrón en traslados y compras: una línea con producto pero sin cantidad se filtra antes de enviar y el aviso dice que todo quedó guardado.

**¿Toca plata?** Sí. Compras (costo y stock) y traslados (escriben en movimientos de inventario). Va como frente propio, y el cambio de regla es una sola: una línea empezada e incompleta bloquea el envío y se marca junto al campo.

### Lote 2 · Mensajes de error y validación al enviar

**Qué cierra:**

- 00.11, 06.2, 07.2, 08.2. Un arreglo en el mensaje del servidor (que nunca muestre el texto crudo del validador) cubre unas 22 pantallas de Configuración, Compras y el ingreso. Se suma la validación junto al campo.
- También se cierran con la misma idea: 01.18, 01.30, 03.13, 03.14, 05.9, 05.10, 05.15, 06.3, 06.5, 06.15, 06.16, 07.10, 07.21, 08.26.

**¿Toca plata?** Solo en el tramo de Compras (06.2, 06.3), que se hace con el lote 1. El resto no toca plata.

### Lote 3 · Contraste de verde, ámbar y rojo

**Qué cierra:**

- 00.8 cierra 01.17, 02.17, 02.18, 03.8, 03.9, 03.10, 04.5, 04.6, 04.21, 05.17, 06.27, 07.16 y 08.10. Los placeholders grises de 08.19 (2,63:1) son otro color (neutral) y van aparte.
- Antes hay que contestar la pregunta 00.8 (tonos).

**¿Toca plata?** No es una pantalla de plata, pero cambia el color de cifras de plata en Caja (03.8, 03.9). Los colores financieros de Caja son excepción aprobada: se miden aparte, combinación por combinación.

### Lote 4 · La tabla de las listas (CrudTable)

**Qué cierra:**

- 00.9 cierra 06.26 (columna "Pago" vacía al recargar) y 07.1 (acciones fuera de la tarjeta en 15 pantallas). Mismo síntoma, otras tablas: 03.1, 03.2, 05.12, 05.13, 06.14, 04.20, 01.14 (columnas fuera de vista a 768).

**¿Toca plata?** No toca plata, pero 00.9 afecta 41 pantallas: pide un spec que las recorra. Las de Caja (03.1, 03.2) van con el frente de caja.

### Lote 5 · Botones chicos, sin nombre y sin teclado

**Qué cierra:**

- Tamaño bajo 44 px: 01.7, 02.3, 03.7, 04.16, 05.18, 06.20, 07.26, 08.8, 09.10.
- Sin nombre para el lector de pantalla: 01.8, 02.34, 03.12, 03.25, 05.16, 05.19, 06.8, 06.28, 07.8, 08.9, 09.11.
- Tarjetas o filas que no se alcanzan con teclado: 01.9, 02.11, 03.11, 04.15, 06.21, 07.18, 09.12.

**¿Toca plata?** Sí en 01.7 (cobro), 02.3 (cuenta de la mesa) y 03.7 (caja): son los botones de cobrar y cerrar, y van con el lote 8. El resto no.

### Lote 6 · Palabras: voseo, jerga y nombres

**Qué cierra:**

- Voseo: 00.3 cierra 01.21, 02.27, 03.19, 04.23, 05.21, 06.24, 07.28, 08.17 y 09.18; también 01.20. Un solo lote mecánico, y hay que actualizar los e2e que buscan esos textos. Junto con 00.4 ("Prueba Técnica").
- Jerga ("tenant", "QZ Tray", "kardex", "Oneclick"): 01.22, 02.28, 03.20, 05.22, 07.27, 09.15.
- Cantidades con cuatro decimales ("2.0000"): 01.22, 02.28, 04.9, 05.4, 07.32.
- Nombres del menú que no calzan con la pantalla: 05.14, 06.25, 06.29, 07.30, 08.14, 08.15, 09.19.
- Botón "Cancelar" que se parece a "Cancelar cuenta": 02.19, 05.6, 09.7.

**¿Toca plata?** No. Los nombres de módulo (06.25, 06.29, 07.30, 09.19) esperan tu respuesta.

**Hecho 2026-10-16 (rama `lote6-palabras`).** Quedaron **parciales**, sin ☑: 03.20 (el encabezado «Cajón» de la bandeja de pendientes es una columna del Lote 4), 04.26 (las cantidades van sin ceros; igualar o no el alto de las tarjetas no se tocó), 05.4 (formato hecho; «Diferencia neta» sigue porque «N líneas con diferencia» pide un dato nuevo del backend), 05.14 (solo el nombre «Movimientos»; la pantalla «Stock» con el saldo es una feature), 07.30 (menú y títulos alineados; faltan los íconos repetidos), 07.32 (stock formateado; falta ocultar el «$0» del ingrediente y cambiar `font-mono`) y 09.7 (el botón que sale dice «Volver»; falta separar el destructivo de la fila). El voseo del **backend** (≈90 mensajes; los de 08.17 y 06.24 sí se cambiaron) sigue pendiente y toca el motor de precios: va aparte.

### Lote 7 · Un fallo o la falta de permiso se ve como "no hay nada"

**Qué cierra:**

- Causa común en el componente de listas (05.20) y en el vacío de la tabla (07.3). Cierra: 01.10, 01.16, 02.20, 03.27, 04.7, 04.8, 04.18, 04.19, 06.10, 06.11, 07.22, 09.3, 09.4.
- Vacíos que no distinguen "no hay" de "tu filtro no encontró": 01.11, 05.23, 06.17, 09.13, 09.23.

**¿Toca plata?** No.

### Lote 9 · Que todas las pantallas se vean de Venka

**Qué cierra:** 00.12 (tarjetas de resumen de color, `font-mono` en 32 archivos, rótulos en mayúsculas) y, de paso, lo visual de 04.5.

**Orden:** primero **00.7** (cifras de ancho fijo en DM Sans) y **00.8** (tonos de verde, ámbar y rojo); recién después se saca `font-mono`, porque sin 00.7 las columnas de montos se desalinean. Conviene hacerlo por grupo de pantallas, empezando por las que salen en un video: POS, historial de ventas, caja e inicio.

**¿Toca plata?** No cambia ningún cálculo; solo cómo se ven los montos.

### Lote 8 · Cobro, propinas y cierre de caja (plata: cada frente va solo)

**Qué cierra:**

- Después de cobrar: 01.1, 01.5, 02.26.
- Modal de cobro: 01.2, 01.3, 01.4, 01.6, 01.19, 02.8, 02.9 (esperan tus respuestas de propinas).
- Cierre de caja: 03.3, 03.4.
- Propinas, frente aparte: 02.1 (el único P0), 02.16, 02.23.
- Impresión: 01.15, 02.5, 02.7.
- Otros que mueven plata y también van solos: 04.4 (costos), 06.6 (anular un pago), 07.12 (apagar Efectivo), 09.1 y 09.8 (suscripciones), y los fiscales 02.10 y 07.14 (impuestos), que van en su propia sesión.

**¿Toca plata?** Sí, todos. 02.1 conviene hacerlo primero: liquida plata de los garzones con una vista previa que no es la del período.

## Lo que la auditoría no pudo medir

Lo que cada grupo declaró que no alcanzó a ver. Los hallazgos de esas zonas son de código o simulados; lo demás se midió con la app.

- **Impresora real.** Nadie tuvo QZ Tray ni una impresora conectada: boleta, precuenta y comanda se midieron con respuestas falsas o con el programa apagado (01, 02, 05). No sabemos cómo se ven los tickets ni cuánto tardan de verdad.
- **Roles que el seed no tiene.** Ningún usuario de la auditoría tiene `Propinas:Liquidar` ni puede cobrar una mesa (02), nadie hace contar y aplicar un recuento (05), nadie tiene Terceros (06). El cajero no tiene Anular ni Nota de crédito (01). Los administradores (07, 09) tapan los 403: lo "sin permiso" de esos grupos va por código.
- **Estados simulados en el navegador.** Caja sin `MiCaja` (03), Inicio con error, sin permisos o con día negativo (04), Configuración cargando o vacía (07), lista de locales con dos o seis opciones (08), catálogo caído y cobro con error 500 (01). Se vio la pantalla, no el servidor: no prueba reglas de saldo, umbrales ni mensajes reales.
- **Plata de verdad.** No se pagó nada con Webpay ni se configuró una pasarela (09), no se pagó en efectivo con éxito (06, falta caja física), no se cobró una mesa de punta a punta (02) y no se hizo un cierre forzado de principio a fin (03).
- **Lector de pantalla, foco y modo oscuro.** Solo se midió el nombre accesible y el orden de Tab. No se probó con un lector real, ni el foco visible de cada control (03, 04, 05). El modo oscuro y el móvil quedaron fuera.
- **Datos que la base de desarrollo no produce.** Un menú de 80 productos (el seed tiene 4 vendibles, 02), compras vencidas o con saldo a favor persistente (06), cajas todas cerradas o stock bajo real (04), un catálogo de 100 ítems (07.33 es una proyección).
- **Correos y links reales.** Los estados de éxito de invitación, confirmación y recuperación, y la lista real de locales, van por código (08). No se sabe si Google está activo en producción (08.25).
- **Variantes de inventario y superadmin.** Traslado y merma de productos con serie o por lote, y el caso de un local sin bodegas (05); la pantalla del superadmin (`admin.vue`, 09); el teclado de PIN del tótem y la fusión de cuentas (02).

## Datos de prueba que quedaron en la base de desarrollo

Lo que los auditores crearon al probar. Las pantallas se vieron en la base de desarrollo, no en producción. `./scripts/reset-db.sh` borra todo esto y vuelve al seed.

| Grupo | Qué quedó |
|---|---|
| 01 · POS y ventas | Caja Mostrador abierta con `vendedor@paris.cl`, con saldo inicial de $20.000 (03 vio una caja abierta de "Vendedor Paris" con saldo esperado de $20.000, casi seguro esta). Tres ventas de prueba de 1 Papas fritas ($1.785, propina $179, pagadas con $5.000). |
| 02 · Salones y mesas | Una sesión de Ana en el turno Mañana (cerrada) y una cuenta en la Mesa 1 con tres líneas (cancelada por el encargado). Un ítem se envió a cocina y consumió 1 unidad de stock del seed. |
| 03 · Caja | Nada nuevo en la base. Todo lo marcado "sim." se simuló en el navegador. Quedó el arnés en `frontend/e2e-auditoria/`. |
| 04 · Inicio y reportes | Nada: no se creó ninguna venta ni caja. |
| 05 · Inventario | Una merma (1 Papas fritas), un traslado (1 Pan de hamburguesa de bodega a local) y recuentos de prueba (uno sin diferencias, que no movió stock). El stock mínimo que se cargó para ver el estado "bajo el mínimo" se dejó vacío otra vez. |
| 06 · Compras y terceros | La compra `Factura AUDIT-001` (10 Pan de hamburguesa a $500, total del documento $5.950), confirmada y pagada: entró stock y costo, con pagos hechos y anulados en el camino. `AUDIT-002` se armó en pantalla y no se guardó. El documento no dice si el borrador de 06.1 quedó guardado. |
| 07 · Configuración | Nada: siete envíos con datos inválidos fueron rechazados. |
| 08 · Ingreso y cuenta | Tres intentos de login fallidos con `audit+nadie@example.com`; un usuario `audit+ux-registro@example.com` (queda sin verificar); un "olvidé mi contraseña" con `audit+olvido@example.com` (no existe); un guardado del perfil de `supervisor@paris.cl` con los mismos valores, y un cambio de contraseña con la actual equivocada (falló, no cambió nada). |
| 09 · Tienda y suscripciones | Nada: no se pagó, no se inscribió ninguna tarjeta ni se activó una suscripción. |

Los auditores también dejaron archivos de prueba en `frontend/e2e-auditoria/` (specs y capturas). Esos no están en la base, y las capturas no entran a git.
