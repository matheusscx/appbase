# Decisiones del owner sobre la auditoría UX

Las tomó el owner el 2026-10-16, contestando por AskUserQuestion las preguntas de
[README.md](README.md) § Preguntas para ti, con la escena y las opciones de cada hallazgo a la
vista. "Recomendada" es la opción que la auditoría o el agente pusieron primero.

| # | Decisión | Cómo se decidió |
|---|---|---|
| 00.7 | **DM Sans con los diez dígitos del mismo ancho.** Se deriva de la misma fuente y la letra de marca no cambia. Se hizo en `80d62c89` y se revirtió en `82e4adb9`: en el Chromium de Linux del CI los dígitos seguían midiendo distinto, porque los puntos fantasma de `gvar` conservaban los anchos viejos. **Se rehízo corrigiendo esos puntos y se verificó en Linux, con la imagen de Playwright del CI, y en macOS.** | Eligió la recomendada |
| 00.8 | **Tonos de estado propios: verde petróleo `#00786F`, ámbar `#C53C00` y rojo `#C10007`.** Es la opción B de la lámina. Los tres pasan 4,5:1 sobre blanco y sobre el fondo teñido de una insignia. Se asignan como escalas propias en `app/app.config.ts` (`ui.colors`), igual que `primary`, y se mide cada combinación. Los colores financieros fijos de Caja van aparte (03.8 / 00.12). | Eligió viendo la lámina `frontend/e2e-auditoria/capturas/lamina/lamina-colores.png` (pantallas reales con tres tonos) |
| 01.2 y 02.9 | **Propina con atajos, sin sumarla.** El modal de cobro, el mismo para mostrador y mesa, muestra "Propina sugerida 10 %" y los botones "Sin propina · 10 % · Otro monto". El total no cambia hasta que la cajera toca uno. | Eligió la recomendada |
| 01.19 | **Si falla leer la configuración de propina, la propina parte apagada** y se muestra un aviso discreto. | Eligió la recomendada |
| 02.16 | **Al entrar a turno se preselecciona el turno de la hora actual.** La garzona puede cambiarlo. | Eligió la recomendada |
| 02.7 | **Precuenta en pantalla con la propina sugerida de 10 % y su monto**, como en el papel. Muestra el total con propina y sin ella. | Eligió la recomendada |
| 02.2 | **El garzón cobra la mesa con la caja abierta del local**, la del POS que abrió el cajero. En el local el garzón va a buscar la máquina y cobra en la mesa. Que hoy no pueda hacerlo es un error. **Hay que analizarlo bien antes de construirlo:** qué caja usa si hay varias abiertas, qué permiso lleva el rol, y cómo cuadra el cajero lo que cobró otro. Va como frente propio, con su análisis primero. | Respuesta libre del owner: *"1 local con 1 caja y 2 garzones, el cajero abre la caja, el garzón debería poder cobrar, sería a la caja del POS"* |
| 02.5 | **Botón "Reimprimir comanda"** por cuenta, con confirmación ("Ya salió a las 21:14. ¿Imprimirla de nuevo?"). Solo reimprime lo ya enviado y lo pide la persona. Va como frente propio. | Eligió la recomendada |
| 01.3 | **Aviso de saldo y billetes rápidos.** Muestra "Falta $179" en ámbar y el botón pasa a decir "Confirmar con saldo pendiente". Para el efectivo, botones "Exacto", $5.000, $10.000 y $20.000. | Eligió la recomendada |
| 01.25 | **Con el lector, Enter agrega el producto si el código coincide con uno solo.** Si coincide con varios, deja la lista. El foco va solo al buscador. | Eligió la recomendada |
| 01.28 | **El historial de ventas parte en "Hoy"** (el rango se puede cambiar) **y busca por folio** de boleta. | Eligió la recomendada |
| 03.3 | **Paso de confirmación antes de "Enviar conteo"**, con el monto en grande: "Contaste $45.000 en efectivo. Después de enviarlo no se puede cambiar", y los botones "Corregir" y "Enviar conteo". El conteo sigue siendo definitivo. Va como frente propio. | Eligió la recomendada |
| 03.28 | **Fondo sugerido por caja y conceptos rápidos.** Cada caja guarda un fondo sugerido que aparece precargado al abrirla (se puede editar), y los movimientos ofrecen los conceptos frecuentes del local. Las reglas se definen en su frente. | Eligió la recomendada |
| 04.1 | **En Inicio, la cifra de cierres es un descuadre con signo.** Se rotula "Diferencia de efectivo", dice "sobran $1.234" o "faltan $2.300" y va en color de alerta, porque un sobrante también es descuadre. | Eligió la recomendada |
| 04.2 | **Compactar "Ahora" en Inicio**: un solo "Actualizado hh:mm" y menos separadores, para que Vendido, Cobrado y Por cobrar entren sin bajar. La forma de las tarjetas no cambia. | Eligió la recomendada |
| 04.3 | **"Hoy" muestra su hora y se refresca solo**, igual que "Ahora". Lleva "Actualizado hh:mm" junto a Actualizar y una marca de atraso si falló la última carga. Cambia lo que decía la spec del Inicio ("carga una vez"). | Eligió la recomendada |
| 04.4 | **"Costos desfasados" abre sin nada seleccionado** y el dueño elige qué aplicar. | Eligió la recomendada |
| 04.10 | **Cada tarjeta del Inicio lleva a su lista ya filtrada**: Por cobrar va a las ventas pendientes, y Cierres con descuadre va a la bandeja de cierres por revisar. | Eligió la recomendada |
| 04.11 | **En Inicio, cifra grande** (30 a 36 px) con el rótulo chico arriba, sin cambiar la forma de las tarjetas. | Eligió la recomendada |
| 04.20 | **Varianza en palabras del local**: "Lo que se vendió", "Entre conteos" y "Faltante sin explicar". La primera columna queda fija para que a 768 no se pierda el producto. | Eligió la recomendada |
| 04.25 | **El saludo es "Hola, \<nombre\>", sin ícono.** El test que busca "Bienvenido" se actualiza. | Eligió la recomendada |
| 04.26 | **Cada tarjeta del Inicio mide lo suyo**, sin igualar los altos de la fila, y las cantidades van sin los cuatro decimales ("1 plato"). | Eligió la recomendada |
| 05.1 | **La causa de una diferencia la pone quien contó.** "Aplicar" queda apagado y explica qué falta y quién lo hace: "Falta la causa en Pan de hamburguesa. La pone quien contó, y después vuelves a aplicar". Contar y aprobar siguen separados. | Eligió la recomendada |
| 05.5 | **En un recuento se puede marcar "Todos los productos con stock en esta ubicación".** | Eligió la recomendada |
| 05.11 | **Antes de confirmar un traslado o una merma, una línea de resumen** sobre el botón: "Vas a mover 1 Pan de hamburguesa de Bodega Subsuelo a Local". Anular un traslado o una merma **no** entra por ahora. | Eligió la recomendada |
| 05.12 | **El kardex une "Costo" y "Costo de la baja"** en una sola columna, que aparece solo si hay valor, y acorta la fila para que entre todo. | Eligió la recomendada |
| 05.14 | **Inventario separa los movimientos del saldo.** La pantalla de entradas y salidas se renombra "Movimientos", y "Stock" pasa a ser una pantalla con el saldo por producto y ubicación, que reutiliza lo de Stock mínimo. | Eligió la recomendada |
| 06.6 | **Se puede anular cualquier pago a proveedor vigente**, desde la fila del pago (en el detalle de la compra y en Por pagar), con motivo y confirmación. Toca plata: va como frente propio y cambia la § 8 de su spec. | Eligió la recomendada |
| 06.11 | **Quien carga compras puede crear el proveedor desde la misma carga**, pero no editar ni borrar otros. Sin permiso, la pantalla dice "Sin permiso" en vez de un "No hay terceros" falso. Es una regla de permisos: el guard del backend tiene que aceptarlo, no solo la pantalla. | Eligió la recomendada |
| 06.25 y 06.29 | **En pantalla se usan "Compras" y "Proveedores"** (menú y títulos). En el código y en la base sigue siendo `tercero`. | Eligió la recomendada |
| 00.1 | **Se borra el `frontend/app.config.ts` de la raíz**, que Nuxt 4 no carga. La app se sigue viendo como hoy, con los valores de Nuxt UI, y se corrige la guía (`DESIGN-SYSTEM.md` § Espaciado). | Eligió la recomendada |
| 07.9 | **Eliminar un rol abre un modal de la app con el conteo de personas**: "Eliminar Vendedor: 3 personas lo tienen y perderán sus permisos". Si el backend no entrega el conteo, se agrega. | Eligió la recomendada |
| 07.11 | **Guardar un rol es todo o nada.** El backend acepta todos los módulos del rol en una sola llamada (una transacción), y si algo falla no queda nada guardado a medias. Cambia el endpoint. | Eligió la recomendada |
| 07.12 | **Se pide confirmación al apagar lo que toca cobros**: un método de pago, un descuento o un impuesto ("Los cajeros dejarán de poder cobrar con Efectivo"). Lo demás guarda con un toast que trae "Deshacer". La pantalla de impuestos se hace en el frente fiscal. | Eligió la recomendada |
| 07.17 | **Las impresoras traen "Imprimir prueba"**, en el panel y en la fila. Además se valida el formato de la IP y "Rol" pasa a llamarse "Para qué se usa". | Eligió la recomendada |
| 07.19 | **Marcar una cuenta como tótem pide confirmación**, con una línea que explica qué es un tótem. El ícono se separa del lápiz y la cuenta muestra "Tótem" cuando lo es. | Eligió la recomendada |
| 07.20 | **"Quitar del local" en Usuarios**, con confirmación y aviso de qué pasa con el PIN de garzón. Es reversible: se puede volver a invitar a la persona. | Eligió la recomendada |
| 07.30 | **El catálogo se llama "Productos"** en el menú y el título, aunque incluya servicios y suscripciones. Además se alinean menú y títulos, y la segunda entrada pasa a "Motivos de diferencia (inventario)". | Eligió la recomendada |
| 07.31 | **En Empresa, cambiar "Fin del día" pide confirmación** ("Los reportes pasados se recalcularán con el corte de las 05:00"). Nombre y Correo se marcan como requeridos. | Eligió la recomendada |
| 07.33 | **Productos se puede filtrar por categoría y ordenar por columna.** | Eligió la recomendada |
| 07.34 | **Configuración abre en un índice por grupo**, con una frase por pantalla. Perfil lleva el mismo título que el resto. | Eligió la recomendada |
| 08.7 | **"Mantener sesión iniciada" se hará funcionar, pero queda pendiente.** Toca el sistema de tokens, que es una invariante de `CLAUDE.md` ("no modificar el sistema de tokens JWT"): antes hay que diseñarlo y que el owner levante la invariante para ese frente. Mientras tanto la casilla se queda como está. | Respuesta libre del owner: *"hacerla funcionar, dejar como pendiente"* |
| 08.16 | **La contraseña lleva un mínimo de 8 caracteres en todas las entradas.** El registro sube de 6 a 8, en la pantalla y en el servidor. | Eligió la recomendada |
| 08.25 | **"Continuar con Google" queda pendiente.** Producción todavía no tiene el cliente de Google configurado ("falta el token, aún no lo gestiono"). El agente sugiere esconder el botón mientras tanto, porque hoy lleva a una página de error; el owner no lo decidió. | Respuesta libre del owner |
| 09.1 | **Al volver de Webpay, la suscripción se confirma antes de cobrar.** Se reabre el panel con el plan, el día y la tarjeta ya elegidos y el total vigente, y se cobra solo al tocar "Suscribirme y pagar $35.700". Toca cobro: va como frente propio y cambia la decisión documentada de "cobro sin clic extra". | Eligió la recomendada |
| 09.8 | **Una suscripción pausada no se cobra, y al reanudarla el próximo cobro es en la siguiente fecha del ciclo**, no al reanudar. Una línea lo explica al pausar y al reanudar. Hay que comprobar qué hace hoy el backend: si cobra al reanudar, la regla cambia y va en su frente. | Eligió la recomendada |
| 09.19 | **Se renombra el menú de Tienda**: la "Suscripciones" del local pasa a "Suscripciones de clientes", y las hijas de Tienda Online a "Mis planes" y "Tarjetas". "Tienda Online" se queda como está. | Eligió la recomendada |
| 00.2 y 08.18 | **Los links van en petróleo en toda la app** (9,47:1), y los títulos del ingreso en tinta petróleo oscura, como la maqueta. Se corrige la guía. | Eligió la recomendada |
| 08.13 | **Los avatares de "elegir local" van en tonos de petróleo y menta**, sin rojo ni amarillo. Si la lista viene vacía, se pasa a la pantalla "sin empresa". | Eligió la recomendada |
| 03.9 | **En Caja, los botones principales van en petróleo** ("Enviar conteo", "Confirmar cierre", "Registrar entrada", "Continuar conciliación"). El verde y el rojo quedan en el selector Entrada/Salida y en las cifras. | Eligió la recomendada |
| 01.17 y 05.17 | **Las insignias de estado y las cantidades de color llevan letra de 12 px como mínimo**, con los tonos de 00.8. | Eligió la recomendada |

## Fuera de estas tandas

Dos preguntas son fiscales y van en una sesión propia (`CLAUDE.md` § Lo fiscal va solo):

- 02.10: la cuenta de la mesa con "Neto · IVA" sobre el total.
- 07.14: el impuesto ingresado como "19 %" en vez de "0.19".
