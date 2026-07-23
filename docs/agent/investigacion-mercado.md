# Investigación de mercado — plantilla reutilizable

> ⛔ **Lo que trae la investigación NO es lo que hay que hacer.** Es una foto de cómo lo
> resolvieron otros — **insumo para cruzar, analizar y adaptar a nuestra realidad**,
> nunca una verdad única a copiar. Tomarla como decisión ya cerrada es un error
> recurrente. El hallazgo se contrasta contra el código, los docs y la decisión de
> negocio del owner **antes** de que se convierta en diseño. Si el mercado dice A y
> nuestro modelo (o el owner) dice B, **gana B** — y se documenta por qué.

**Cuándo se usa:** el diseño depende de una **regla de negocio que no está en
`docs/`** y que el mercado ya resolvió (grupos modificadores, combos, promociones,
impuestos, propinas, fidelización…), y el owner **no es experto del dominio**. Antes de
proponer diseño, se hace una pasada de investigación con fuentes.

Dos formas de correrla, mismo template:

- **El owner la corre por fuera** (ChatGPT/Perplexity/Claude) para **entender el dominio
  él mismo** — preferido cuando la decisión de negocio es suya.
- **El agente la corre inline** (WebSearch/WebFetch) cuando se necesita el resultado
  rápido para no frenar el diseño.

En ambos casos vale la misma regla: **la investigación informa, no decide.** Trae
patrones + fuentes para verificar, no la verdad. La decisión de negocio sigue siendo del
owner, y todo lo que traiga se **cruza contra el código existente** antes de diseñar
(varias veces el mercado dice una cosa y el modelo ya resuelve otra).

---

## La plantilla

Reemplazar lo que está `{entre llaves}`. Borrar las preguntas que no apliquen.

> 🇨🇱 **Regla fija:** toda investigación incluye ejemplos del **mercado chileno** (POS
> locales + reglas del país: SII/boleta, redondeo en efectivo, propina, medios de pago),
> no solo POS internacionales. Es donde opera el producto; lo internacional da el patrón,
> Chile da la realidad que se aplica. La pregunta 6 de la plantilla es obligatoria.

> Soy fundador de un POS multi-tenant (restaurantes, minimarkets, retail). Estoy
> diseñando **{FEATURE}**. No soy experto en el dominio. Explicame, con ejemplos
> concretos de POS reales —internacionales (Toast, Square, Lightspeed, Clover) **y del
> mercado chileno** (Bsale, Toteat, Defontana, Nubox, GestioPolis/Rocket)—, cómo
> funciona:
>
> 1. **Modelo de datos / conceptos**: ¿cuáles son las entidades y cómo se relacionan?
>    ¿Qué nombre estándar de la industria tiene cada una?
> 2. **Reglas**: {las reglas que te importan — obligatoriedad, mínimos/máximos,
>    estados, vigencia, prioridad…}.
> 3. **Precio / dinero**: ¿cómo impacta en el total? ¿Qué variantes existen y un
>    ejemplo de cada una?
> 4. **Casos que cruzan otros módulos**: {inventario, impuestos, caja, multi-moneda…}
>    — ¿cómo lo resuelven?
> 5. **Casos borde** que se suelen olvidar al diseñar esto desde 0.
> 6. **Realidad chilena** (obligatorio): ¿cómo lo resuelven los POS locales y qué
>    imponen las reglas del país —SII/boleta electrónica, redondeo en efectivo, propina
>    sugerida 10%, Transbank/medios de pago— que un POS internacional no contempla?
>
> Contexto de lo que ya tengo resuelto (para que no me expliques lo básico):
> {LO QUE YA EXISTE EN EL PROYECTO}.
>
> No me des código. Dame los **conceptos, los nombres estándar de la industria y las
> decisiones de diseño con sus trade-offs**, citando cómo lo hace cada POS cuando
> difieren.

---

## Cómo se cierra el loop

1. El owner trae los hallazgos (o el agente los resume con **fuentes linkeadas**).
2. El agente los **contrasta contra el código y los docs** — qué ya existe, qué es
   especulativo para nuestro modelo, qué dimensión no tenemos (ej: no hay sucursales
   ni fidelización).
3. Recién ahí se propone diseño. Si algo del mercado choca con una invariante o una
   regla no documentada → **detenerse y preguntar** (no auto-resolver).
4. Lo que sobrevive al cruce se registra **con las fuentes**, para que sea auditable y no
   haya que reinvestigar. **Dónde:**
   - **Investigación aún sin diseño** (apenas estamos explorando el dominio) →
     `docs/agent/investigaciones/YYYY-MM-DD-<tema>.md`. **No es una spec** — no va en
     `docs/superpowers/specs/` (ahí solo diseño `-design.md`).
   - **Investigación que ya alimenta un diseño concreto** → sección "Investigación de
     mercado" dentro del `-analisis.md`/spec de ese tema.

**Ejemplos:** investigación pura → `docs/agent/investigaciones/2026-07-23-gestion-caja.md`
(gestión de caja: el mercado y Chile endurecieron que la caja es solo efectivo, pero la
decisión sigue abierta). Investigación embebida en diseño →
`docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md` (promociones: el mercado
aportó BOGO, pero "conviven descuentos y promos" y "fiscal diferido" fueron del owner).
