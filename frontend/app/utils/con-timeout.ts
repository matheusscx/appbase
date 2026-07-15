/**
 * Envuelve una promesa con un techo de tiempo. Si supera `ms`, rechaza con
 * `mensaje` (útil para impresoras de red apagadas: el TCP de QZ puede colgarse
 * muchos segundos más que el OS allowlist del UI).
 */
export function conTimeout<T>(
  promise: Promise<T>,
  ms: number,
  mensaje: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(mensaje)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
