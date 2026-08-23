import net from 'node:net'
import { test, expect } from '@playwright/test'

// @smoke — el proxy de `/api` (ADR-022) visto como proxy, no como navegador.
// El otro smoke (`mismo-origen`) prueba que el navegador no se va a otro
// origen; éste prueba que lo que el proxy transporta **llega igual**. Los dos
// casos de abajo se midieron ROTOS contra este mismo servidor antes de
// cerrarlos, y los dos los encontró la revisión independiente, no la suite.

test.describe('el proxy de /api transporta, no interpreta', () => {
  test('@smoke una redirección del backend llega al navegador, no la sigue el proxy', async ({ request }) => {
    // El login con Google es una navegación de nivel superior a
    // `/api/auth/google`, y el backend contesta 302 hacia `accounts.google.com`.
    // `proxyRequest` usa el `fetch` de Node, que por defecto SIGUE los 3xx: sin
    // `redirect: 'manual'` este servidor consumía la redirección y le devolvía
    // al usuario un 200 con lo que resultara de haber ido él. Medido: la ruta
    // pasaba de 302 a 200 y el usuario nunca veía la pantalla de Google.
    //
    // Anda sin credenciales de Google: la ruta arma la URL igual y el
    // `client_id` sale sin configurar. Lo que se afirma es el TRANSPORTE.
    const res = await request.get('/api/auth/google', { maxRedirects: 0 })

    expect(res.status()).toBe(302)
    expect(res.headers()['location']).toContain('accounts.google.com')
  })

  test('@smoke una ruta que se sale de `/api` la corta el proxy, no el backend', async ({ baseURL }) => {
    // `event.path` llega sin normalizar, así que `/api/../algo` se convertía en
    // `/algo` recién al construir la URL de salida: el backend lo recibía fuera
    // de su prefijo. Hoy no hay nada montado ahí y contestaba 404 igual, pero
    // por una propiedad del backend, no por una barrera. Esto afirma la barrera.
    //
    // Va por socket crudo a propósito: todo cliente HTTP normal —`fetch`, el
    // `request` de Playwright, `curl` sin `--path-as-is`— normaliza el `..`
    // antes de mandarlo, así que por ahí el caso no es ni expresable.
    const { hostname, port } = new URL(baseURL!)
    const respuesta = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(Number(port), hostname, () => {
        socket.write(`GET /api/../algo-fuera HTTP/1.1\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n\r\n`)
      })
      let datos = ''
      socket.on('data', (chunk) => { datos += chunk.toString() })
      socket.on('end', () => resolve(datos))
      socket.on('error', reject)
    })

    expect(respuesta.split('\r\n')[0]).toContain('404')
    // Y que el 404 sea del PROXY: el del backend nombra la ruta que recibió.
    expect(respuesta).not.toContain('Cannot GET /algo-fuera')
  })
})
