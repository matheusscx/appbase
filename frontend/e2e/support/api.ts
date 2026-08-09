import type { APIRequestContext } from '@playwright/test'

/**
 * Precondiciones por API para los flujos de navegador.
 *
 * ⚠️ **Por qué no se clickean.** Abrir caja, crear un garzón o sembrar un ítem
 * son flujos propios, cada uno con su pantalla; si cada spec los recorriera, un
 * cambio en cualquiera de ellos rompería tests que no tienen nada que ver, y
 * cada corrida tardaría varias veces más. Lo que se ejercita por UI es el flujo
 * bajo prueba y nada más.
 */

export const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api'

/** Tenants del seed. `admin@sistema.com` es miembro de los dos. */
export const TENANTS = {
  restaurante: '550e8400-e29b-41d4-a716-446655440007',
  bodega: '550e8400-e29b-41d4-a716-446655440040',
} as const

export const CLP = '550e8400-e29b-41d4-a716-446655440003'
export const EFECTIVO = '550e8400-e29b-41d4-a716-446655440105'

export const CREDENCIALES = {
  email: process.env.E2E_EMAIL ?? 'admin@sistema.com',
  password: process.env.E2E_PASSWORD ?? 'admin',
}

export async function api<T>(
  request: APIRequestContext,
  metodo: 'get' | 'post' | 'patch',
  ruta: string,
  opts: { token?: string; data?: unknown } = {},
): Promise<T> {
  const res = await request[metodo](`${API}${ruta}`, {
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
    ...(opts.data ? { data: opts.data } : {}),
  })
  if (!res.ok()) {
    throw new Error(
      `${metodo.toUpperCase()} ${ruta} → ${res.status()}: ${await res.text()}`,
    )
  }
  return (await res.json()) as T
}

/** Token con `tenant_id` adentro: login + switch, que es lo que hace la app. */
export async function tokenDe(
  request: APIRequestContext,
  tenantId: string,
): Promise<string> {
  const inicial = await api<{ access_token: string }>(
    request,
    'post',
    '/auth/login',
    { data: CREDENCIALES },
  )
  const sesion = await api<{ access_token: string }>(
    request,
    'post',
    '/auth/switch-tenant',
    { token: inicial.access_token, data: { tenantId } },
  )
  return sesion.access_token
}

/** Producto vendible con stock, para no depender del catálogo del seed. */
export async function crearProducto(
  request: APIRequestContext,
  token: string,
  datos: {
    nombre: string
    precioBase: string
    /** Omitir = afecto (el default del tenant). `exento` para el otro caso. */
    clasificacionTributaria?: string
    stock?: string
  },
): Promise<{ id: string }> {
  return api<{ id: string }>(request, 'post', '/items', {
    token,
    data: {
      tipo: 'producto',
      monedaId: CLP,
      unidadMedida: 'unidad',
      stock: datos.stock ?? '10',
      costo: '400',
      ...datos,
    },
  })
}

/**
 * Abre caja para el usuario del token y devuelve un cierre que **asevera**.
 *
 * El cierre va en dos fases: `conteo` congela el arqueo y auto-cierra si cuadra;
 * si descuadra pasa a `en_conciliacion` y hay que resolver con un motivo. Sin
 * eso el cajón queda ocupado y la corrida siguiente no puede abrir — y el tenant
 * del seed tiene un solo cajón.
 */
export async function abrirCaja(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const disponibles = await api<{ cajonId: string }[]>(
    request,
    'get',
    '/caja/cajones-disponibles',
    { token },
  )
  if (!disponibles[0]) {
    throw new Error(
      'No hay cajones disponibles: probablemente quedó una caja abierta de una corrida anterior',
    )
  }
  const caja = await api<{ id: string }>(request, 'post', '/caja/abrir', {
    token,
    data: {
      cajonId: disponibles[0].cajonId,
      saldoInicial: '0.0000',
      comentario: 'Apertura E2E navegador',
    },
  })
  return caja.id
}

/**
 * Cierra la caja contando `montoContado` en efectivo y devuelve el estado.
 *
 * `'cerrada'` significa que el conteo cuadró con lo que el servidor calculó —o
 * sea que es una **verificación server-side de lo cobrado**, no un chequeo de
 * limpieza—. Los flujos que cobran la usan como aserción final.
 */
export async function cerrarCaja(
  request: APIRequestContext,
  token: string,
  cajaId: string,
  montoContado: string,
): Promise<string | undefined> {
  const auth = { Authorization: `Bearer ${token}` }
  const conteo = await request.post(`${API}/caja/${cajaId}/conteo`, {
    headers: auth,
    data: { lineas: [{ metodoPagoId: null, montoContado }] },
  })
  if (!conteo.ok()) return undefined
  const estado = ((await conteo.json()) as { estado?: string }).estado
  if (estado === 'en_conciliacion') {
    const motivos = await request.get(
      `${API}/motivos-diferencia?soloActivas=true`,
      { headers: auth },
    )
    const motivoId = ((await motivos.json()) as { id: string }[])[0]?.id
    await request.post(`${API}/caja/${cajaId}/cerrar`, {
      headers: auth,
      data: {
        lineas: [
          {
            metodoPagoId: null,
            motivoDiferenciaId: motivoId,
            comentarioDiferencia: 'Cierre del e2e de navegador',
          },
        ],
      },
    })
  }
  return estado
}
