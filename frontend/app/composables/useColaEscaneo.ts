/**
 * Cola de escaneos: la pistola dispara más rápido que la red, así que cada Enter entra acá y se
 * envía de a uno, en el orden en que llegó. Un escaneo que falla no frena a los que siguen: quien
 * llama a `enviar` ya mostró ese error. Sin reintento automático: lo que falló lo repite quien
 * escanea.
 *
 * Cada elemento viaja con todo lo que se decidió al escanearlo (repartidor, fecha, cobro en
 * destino): si el contexto cambia mientras la cola drena, lo ya escaneado no se re-dirige.
 */
export function useColaEscaneo<T extends { codigo: string }>(enviar: (escaneo: T) => Promise<void>) {
  const cola: T[] = []
  const pendientes = ref(0)
  const procesando = ref(false)

  async function drenar() {
    if (procesando.value) return
    procesando.value = true
    try {
      while (cola.length) {
        const escaneo = cola.shift()!
        pendientes.value = cola.length
        try {
          await enviar(escaneo)
        }
        catch {
          // El que falló ya mostró su error en `enviar`; la pistola sigue.
        }
      }
    }
    finally {
      procesando.value = false
      pendientes.value = 0
    }
  }

  function encolar(escaneo: T) {
    if (!escaneo.codigo.trim()) return
    cola.push(escaneo)
    pendientes.value = cola.length
    void drenar()
  }

  return { encolar, pendientes, procesando }
}
