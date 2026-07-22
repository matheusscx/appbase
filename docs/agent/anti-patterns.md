# Anti-patrones conocidos en este proyecto

Errores que **ya se cometieron aquí**. Es el único documento del setup que contiene
conocimiento que no se puede derivar leyendo el código correcto.

## Reglas de este archivo

1. **Solo entra lo que ya pasó.** Un anti-patrón especulativo es consejo de estilo
   disfrazado y no aporta nada que el modelo no sepa ya. Cada entrada nace de un bug
   real, un commit de corrección o una revisión que lo detectó.
2. **Cada entrada sale cuando se automatiza.** Si el patrón pasa a ser regla de ESLint
   o test, se borra de aquí y queda la referencia a la regla. Este archivo no crece
   indefinidamente.
3. **Tope: 20 entradas.** Si se llena, la más antigua sin reincidencia se elimina.
4. Formato fijo: qué pasó → ❌ mal → ✅ bien → una línea de porqué.

---

## Backend

### ❌ Columna UUID sin `type: 'uuid'` explícito

```ts
// MAL — TypeORM infiere varchar
@Column()
tenant_id: string;

// BIEN
@Column({ type: 'uuid' })
tenant_id: string;
```

Sin el tipo explícito los JOINs en SQL raw fallan silenciosamente por comparación
`varchar` vs `uuid`. Ver [ADR-004](../adr/004-uuid-column-types.md).
→ *Candidato a test de esquema: recorrer entidades y fallar si una columna `*_id`
no declara `type: 'uuid'`.*

### ❌ `tenant_id` tomado del request

```ts
// MAL
const { tenant_id } = dto;

// BIEN — el payload JWT es camelCase (`tenantId`), no la columna DB (`tenant_id`)
const { tenantId } = req.user as { tenantId: string };
// o vía decorador: @CurrentUser() user: JwtUser  →  user.tenantId
```

Cualquier cliente puede enviar otro `tenant_id` en el body y leer o escribir datos
de otro tenant. Es una fuga multi-tenant, no un descuido de estilo. Ojo con el casing:
`req.user.tenant_id` es `undefined` — el campo decodificado es `tenantId`.

### ❌ `number` nativo para dinero o porcentajes

```ts
// MAL
const total = precio * 1.19;

// BIEN
const total = new Decimal(precio).mul(new Decimal(1).plus(tasa));
```

Y las tasas se guardan en decimal: `0.19`, nunca `19`. Un `19` interpretado como tasa
multiplica el impuesto por cien.
→ *Candidato a regla de lint sobre operadores aritméticos en campos de monto.*

### ❌ Borrado físico de filas

El proyecto es mayormente SQL raw, así que el fallo real es una query nueva sin el
filtro, o un `DELETE` físico crudo:

```sql
-- MAL — borra la fila
DELETE FROM ventas WHERE venta_id = $1;
-- MAL — lectura nueva sin filtrar borrados
SELECT * FROM ventas WHERE tenant_id = $1;

-- BIEN — marcar
UPDATE ventas SET eliminado_el = NOW() WHERE venta_id = $1 AND tenant_id = $2;
-- BIEN — toda lectura filtra
SELECT * FROM ventas WHERE tenant_id = $1 AND eliminado_el IS NULL;
```

En los pocos caminos por repositorio de TypeORM, el equivalente es `repo.softDelete(id)`
en vez de `repo.delete(id)`. Omitir el filtro en una query nueva hace reaparecer
registros borrados en listados y reportes.

---

## Frontend

### ❌ Mutar y luego recargar la lista completa

```ts
// MAL
await $fetch('/ventas', { method: 'POST', body })
await cargar()

// BIEN
const creada = await $fetch('/ventas', { method: 'POST', body })
ventas.value.unshift(creada)
```

El backend devuelve la entidad o un patch mergeable. Recargar duplica el round-trip,
parpadea la UI y pierde el estado local (scroll, filtros, selección).
Detalle: `docs/patterns/frontend.md`.

### ❌ Tailwind hardcoded en vez de tokens semánticos

```vue
<!-- MAL -->
<p class="text-gray-500 bg-white dark:bg-gray-900">

<!-- BIEN -->
<p class="text-muted bg-default">
```

Rompe el modo oscuro y el theming por tenant. Excepción única: colores financieros
(verde/rojo/azul) en el módulo Caja.
→ *Candidato a regla de lint: prohibir clases `text-gray-*`, `bg-white`, `dark:bg-*`
fuera de `app/components/caja/`.*

### ❌ Función de formato definida dentro de un `.vue`

```ts
// MAL — dentro del componente
const formatMonto = (v: number) => `$${v.toLocaleString()}`

// BIEN
const { formatMonto } = useFormatters()
```

Cada copia local diverge en separadores, decimales y moneda. El formato de monto
depende de la moneda oficial del tenant, así que una copia local es un bug de datos,
no de estilo.

---

## Pruebas E2E de navegador

*(Sección a poblar cuando exista la suite. Entradas previstas según el diseño acordado:
esperas fijas en lugar de aserciones web-first, tests que dependen del estado dejado
por otro test, y aserciones de montos copiadas de la salida del código en vez de
derivadas de `docs/features/`. No se documentan aquí hasta que ocurran de verdad.)*
