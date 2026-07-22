# Setup de agente — contexto y decisiones

Por qué `CLAUDE.md`, `docs/agent/anti-patterns.md` y la skill `verify-feature` están
escritos como están. Leer antes de proponer cambios a cualquiera de los tres: varias
ideas que parecen obvias ya se evaluaron y se descartaron con motivo.

## Problema de partida

El `CLAUDE.md` era denso y específico del proyecto — el punto de partida era bueno.
El problema **no era el tamaño**: era estructural.

1. Reglas críticas (aislamiento multi-tenant, Decimal.js) mezcladas al mismo nivel
   que información sin acción (roadmap, fases futuras) — el agente negociaba con
   ambas por igual.
2. Sin definición de terminado: la tabla de documentación viva existía, pero nada
   verificaba el código. El proyecto commitea directo a `main` sin PR, así que no
   había ningún punto de control.
3. Cada bloque de dominio se resumía inline **y** apuntaba a su `docs/features/*.md`:
   dos copias de la misma regla, condenadas a divergir.

**El archivo resultante no es más corto, y no debía serlo.** Comprimir las reglas de
dominio ahorró espacio, pero se agregaron cuatro secciones que no existían
(invariantes, disparadores de consulta, alcance de refactor, checklist). La métrica
no es el número de líneas: es que **cada línea cambie el comportamiento del agente**.
Una línea que el modelo ya sabe, o que un linter puede verificar, sobra aunque el
archivo sea corto.

## Criterio de filtrado

Se evaluaron dos tandas de recomendaciones genéricas (~19 propuestas) más el
`CLAUDE.md` existente. Reglas aplicadas:

- **Si el modelo ya lo sabe, no se escribe.** KISS, YAGNI, DRY, "funciones pequeñas",
  "nombres descriptivos" no cambian el comportamiento; solo gastan contexto.
- **Si el linter o un test puede verificarlo, ahí va — no al `.md`.** Toda regla
  mecánica en un documento es una regla que nadie hace cumplir.
- **Si no es falsable, se corta.** "Claridad sobre cleverness", "diseño evolutivo":
  ningún output puede contradecirlas, así que no restringen nada.
- **Si un archivo no lo carga la herramienta ni hay una condición explícita que
  ordene leerlo, no existe.** Los documentos sin condición de lectura se ignoran o se
  cargan siempre; ambos casos son costo puro.
- **Lo que sobrevive es lo no inferible**: terminología del dominio, invariantes,
  errores ya cometidos.

De ~19 propuestas se adoptaron 6.

## Decisiones adoptadas

| Decisión | Motivo |
|---|---|
| Invariantes separadas del resto, con acción definida (**detenerse y reportar**, no auto-corregir) | Sin jerarquía de severidad el agente trata una fuga multi-tenant como una sugerencia de estilo. "Fail" sin acción hace que el agente lo "arregle" solo, que es peor |
| Disparadores de consulta objetivos (motor de precios, impuestos, `movimientos_inventario`, regla no documentada) | "Si no estás seguro" no funciona: el agente casi nunca se declara inseguro |
| Alcance de refactor limitado a 4 casos | Con motor de precios configurable por tenant y 3 modos de inventario, un refactor oportunista rompe reglas de negocio en silencio |
| Orden de búsqueda con salida a preguntar en el paso 5 | Evita exploración aleatoria; el paso de escape evita que invente el patrón faltante |
| Reglas de dominio comprimidas a discriminador + condición de lectura | Elimina la doble fuente de verdad. Lo que queda inline es lo mínimo para decidir *si hay que leer más* |
| Checklist con comandos reales | Un checklist que el agente no puede ejecutar solo lo lleva a afirmar que lo cumplió |

## Decisiones rechazadas

No reabrir sin argumento nuevo.

- **Agentes constructores partidos por capa técnica (backend / frontend).** El motivo
  no es "sobredimensionado": es que **el eje de corte está mal**. Escribir código es lo
  único que no se puede rebanar — cada edit depende de los demás — y un agente backend
  + uno frontend cortan justo por la costura que más importa vigilar: el contrato DTO
  que el back emite y el front consume. Arrancan con vista parcial, toman decisiones
  implícitas en conflicto y exigen un paso extra para reconciliarlas. No compran
  conocimiento (el modelo es el mismo Opus: un "agente backend" no sabe más NestJS que
  la sesión principal); solo agregan handoffs que pierden contexto y multiplican tokens
  (3–10×). Es el consenso de 2026 (Cognition "Don't Build Multi-Agents" para coding +
  Anthropic, que reserva el multi-agente para trabajo read-heavy / research).
  **El eje correcto es lectura-vs-escritura, no capa técnica:** un sub-agente aporta
  valor cuando aísla *revisión* o *búsqueda* (su ceguera de contexto es el punto) y deja
  la *construcción* entera en la sesión principal. Por eso los agentes que sí existen
  son read-only e invocados por riesgo: `domain-reviewer` y `api-security-reviewer` en
  el paso 7 de `verify-feature` (ver más abajo). Si alguna vez hace falta más, que sea
  `domain-pos` (consultor read-only de reglas de negocio), nunca un constructor por capa.
- **Handoffs por contrato YAML/JSON escrito a mano.** El diagnóstico (degradación de
  contexto entre agentes) es correcto, la solución no: un plan estructurado por feature
  queda desincronizado a la segunda iteración, y un portón que exige artefacto previo
  se falsifica — el agente genera el YAML él mismo para desbloquearse. El único
  contrato válido es el que emite la toolchain: el OpenAPI/DTO que ya genera NestJS.
- **Capa de memoria short-term (`active-task.md`, `current-diff.patch`).**
  `active-task.md` duplica el manejo de plan que Claude Code ya hace en sesión, y un
  archivo que el agente debe *acordarse* de actualizar queda viejo — inyectando estado
  falso con apariencia de verdad. `current-diff.patch` es `git diff`.
- **Renombrar `docs/superpowers/` a `.ai/` o `docs/skills/`.** Cosmético. La convención
  ya está establecida y es consistente; el costo del cambio no compra nada.
- **Reglas de estilo de código en el `.md`** (early return, evitar `else`, sin código
  muerto). Corresponden a ESLint.
- **Sección de filosofía del proyecto.** No falsable.

## Estructura resultante

| Elemento | Responde | Se carga |
|---|---|---|
| `CLAUDE.md` | Cómo se trabaja en este proyecto | Siempre |
| `docs/patterns/`, `docs/features/`, ADRs | Cómo está resuelto esto | Bajo condición explícita |
| `docs/agent/anti-patterns.md` | Qué salió mal antes aquí | Antes de implementar |
| `.claude/skills/verify-feature/` | Cómo se cierra una tarea | Al cerrar |
| `.claude/agents/domain-reviewer.md` | Revisión independiente del diff (invariantes, N+1, alcance) | Paso 7 de `verify-feature` |
| `.claude/agents/api-security-reviewer.md` | Guards, validación, exposición de datos, SQLi | Paso 7, solo si el diff toca capa HTTP |

`.claude/skills/` es la ruta que Claude Code descubre automáticamente. `plans/` y
`specs/` siguen en `docs/superpowers/`.

## Reglas de mantenimiento

- **La regla vive en `CLAUDE.md`, el ejemplo vive en `anti-patterns.md`.** Nunca las
  dos completas en ambos lados. Si una convención necesita un ❌/✅ para entenderse,
  en `CLAUDE.md` queda solo el enunciado y el puntero.
- **`anti-patterns.md` solo recibe errores que ya ocurrieron.** Una entrada
  especulativa es consejo de estilo disfrazado. Tope 20 entradas.
- **Toda regla automatizada sale del `.md`.** Si un anti-patrón pasa a ser regla de
  lint o test, se borra el texto y queda la referencia. Es el mecanismo que evita que
  estos archivos crezcan sin límite.
- **Las invariantes son un backlog de automatización**, no un sustituto permanente.
  - [x] tipo `uuid` explícito → test `src/common/invariants/uuid-columns.invariant.spec.ts`.
  - [x] Tailwind hardcoded fuera de Caja → `frontend/scripts/check-design-tokens.mjs`
    (`npm run design:check` en el gate + `--staged` en el pre-commit).
  - [~] `number` en campos de monto → **deliberadamente NO automatizada.** Estáticamente
    no se sabe qué valor es dinero: el monto se tipa como `string` (columna `numeric`) y
    `precio * tasa` es indistinguible de `ms = 2 * 60 * 1000`. Un lint daría una avalancha
    de falsos positivos sobre tiempo/índices/cantidades → se desactivaría. Se queda como
    regla en `anti-patterns.md` + la revisión independiente de `verify-feature` (paso 7),
    que sí razona el contexto. No es laguna: es la herramienta correcta.

## Pendiente

- **Suite E2E de navegador (Playwright).** [x] **Fundación lista** (`frontend/playwright.config.ts`,
  `e2e/auth.setup.ts` con login vía `storageState`, `e2e/smoke/*.smoke.spec.ts`, scripts
  `e2e`/`e2e:smoke`). Corre contra el stack real (`docker-compose up`). El `test:e2e` del
  backend es Jest + supertest, no navegador — no confundir. [ ] **Flujos por escribir**
  (ver `docs/agent/pendientes.md`): venta completa hasta documento, pago mixto, nota de
  crédito, apertura/cierre de caja, descuento de stock, y cambio de tenant sin fuga de
  datos (este último no lo detecta ninguna prueba unitaria). Restricciones: reloj
  congelado (cierres de caja dependen de zona horaria por tenant), sin llamadas reales al
  SII, cero esperas fijas (usar aserciones web-first, no `waitForTimeout`), etiqueta
  `@smoke` para el subconjunto que corre en cada tarea.
  Riesgo a cubrir: un agente al que se le pide "escribe tests" escribe tests que
  describen lo que el código hace hoy. Las aserciones de montos, impuestos y stock se
  derivan de `docs/features/`, nunca de ejecutar el código y copiar el resultado.
- [ ] **E2E en CI** — el workflow actual no levanta el stack completo para navegador.
  Integrar `@smoke` cuando la suite tenga masa crítica.
- [ ] **Sección E2E de `anti-patterns.md`**, a poblar cuando aparezcan errores reales
  (candidato ya visto: tipear antes de la hidratación de Nuxt deja el `v-model` sin
  capturar → el fix es esperar la condición, `networkidle` + `toBeEnabled`, no un sleep).
