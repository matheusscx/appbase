# Diseño: Configuración de propina sugerida

**Status**: Approved  
**Owner**: Cesar Matheus  
**Date**: 2026-07-17

---

## Contexto

Al cerrar una cuenta de mesa, el front sugiere propina con un **10% hardcodeado**
(`PROPINA_PORCENTAJE = '0.10'` en Salones; default de `sugerirPropina`). El %
usado ya se congela en `venta_propina.porcentaje_sugerido`, pero el tenant no
puede cambiar la sugerencia sin deploy.

Ya existe `propina_configuracion` (raíz de la distribución de liquidaciones). Es
el lugar natural para el % sugerido operativo.

## Alcance

Incluido:

- Columna `porcentaje_sugerido` en `propina_configuracion` (decimal, default
  `0.10`).
- Exponer y editar el valor en **Config → Propinas** (misma página que
  distribución).
- Salones (y `CobroModal` si usa sugerencia) leen el % del backend al abrir
  cobro; fallback `0.10` si la lectura falla.
- Permisos: configurar con `Propinas:Configurar`; lectura operativa para cobro
  con `Salones:Operar`.

Fuera de alcance:

- Varias opciones de tip (10/15/20 %) — un solo % sugerido.
- Cambiar tips históricos o liquidaciones ya confirmadas.
- Propina sugerida en POS genérico / tienda online.
- Estrategia de asignación tip (`NO_VUELTO` sigue hardcode).

## Modelo de datos

### `propina_configuracion` (extensión)

| Columna | Tipo | Notas |
|---|---|---|
| `porcentaje_sugerido` | `NUMERIC(10,6) NOT NULL DEFAULT 0.10` | Decimal: `0.10` = 10%. CHECK `>= 0` y `<= 1`. |

- Default al crear tenant / `asegurarDefault`: `0.10`.
- **No** incrementa `version` por sí solo (la `version` sigue siendo el snapshot
  de grupos de distribución para liquidaciones). Si el PUT de distribución
  actualiza el % junto con grupos, el bump de `version` existente se mantiene
  por el reemplazo de grupos, no por el tip.

## API

### Extender `GET /propinas/distribucion` (`Propinas:Leer`)

Respuesta incluye:

```json
{
  "id": "...",
  "version": 2,
  "porcentajeSugerido": "0.10",
  "grupos": [ ... ]
}
```

### Extender `PUT /propinas/distribucion` (`Propinas:Configurar`)

Body añade `porcentajeSugerido` (string decimal, obligatorio en el DTO de
update o con default si se omite → no tocar la columna).

Validación: `0 ≤ valor ≤ 1` (Decimal.js); mensaje claro si viene como `10` en
lugar de `0.10`.

Al guardar: actualizar `propina_configuracion.porcentaje_sugerido` en la misma
transacción que el reemplazo de grupos.

### Nuevo `GET /propinas/porcentaje-sugerido` (`Salones:Operar`)

Respuesta mínima para el flujo de cobro (garzón/cajero sin permiso Propinas):

```json
{ "porcentajeSugerido": "0.10" }
```

Asegura default del tenant si no hay fila (mismo `asegurarDefault`).

Fallback backend en cierre: si el client no manda
`propinaPorcentajeSugerido`, el servicio de cierre sigue usando `'0.10'` como
hoy (sin romper contratos).

## Frontend

### Config → Propinas (`propinas-distribucion.vue`)

- Campo “Propina sugerida (%)” arriba del listado de grupos.
- UI muestra entero/decimal de cara al usuario (`10` o `10.5`); al persistir se
  convierte a decimal (`0.10` / `0.105`) con Decimal.js — mismo criterio que
  descuentos/recargos (“porcentajes siempre en decimal”).
- Se guarda con el mismo botón Guardar de la distribución (incluido en el PUT).

### Salones / cobro

- Al montar (o al abrir cobro): `GET /propinas/porcentaje-sugerido`.
- Reemplazar `PROPINA_PORCENTAJE = '0.10'` por el valor cargado (ref).
- `sugerirPropina(total, porcentaje)` sin cambio de firma.
- Si falla la carga: toast opcional suave + fallback `'0.10'`.

### `CobroModal`

Si hoy llama `sugerirPropina` sin % explícito, alinearlo al mismo origen
(prop del padre o fetch propio). Preferir que Salones pase el % ya cargado.

## Decisiones

| Tema | Decisión |
|---|---|
| Dónde vive | `propina_configuracion`, no `tenants` ni tabla nueva |
| Un % vs varios | Un solo % sugerido (opción A) |
| Versionado liquidación | No: tip sugerido no entra al snapshot de liquidación |
| Permiso lectura cobro | Endpoint liviano con `Salones:Operar` |
| Formato | Decimal en API/BD (`0.10`); UI en % humano |

## Testing

- Entity/service: default `0.10`; update válido; rechazo `> 1` o `< 0`.
- GET porcentaje-sugerido asegura default y responde string decimal.
- Front: conversión UI↔API; Salones usa % cargado en sugerencia y en
  `propinaPorcentajeSugerido` al cerrar.

## Manual

1. Config → Propinas: cambiar a 15%, guardar.
2. Salones: cerrar cuenta → input de propina = 15% del total.
3. Confirmar → detalle de venta muestra `porcentajeSugerido` 0.15.
4. Sin permiso Propinas, un usuario con Salones:Operar sigue pudiendo cobrar con
   la sugerencia correcta.
