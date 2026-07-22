export interface JwtPayload {
  sub: string
  email: string
  tenant_id: string | null
  es_superadmin: boolean
  iat: number
  exp: number
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64)) as JwtPayload
  } catch {
    return null
  }
}
