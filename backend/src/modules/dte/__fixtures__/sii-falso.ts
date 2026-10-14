import { createServer, type IncomingHttpHeaders, type Server } from 'http';
import type { AddressInfo } from 'net';

/**
 * Un SII de mentira para las pruebas: un `http.createServer` con las rutas y las formas del
 * OpenAPI 1.0.5 de la boleta electrónica. No valida firmas ni sobres; registra cada pedido
 * para que el test mire qué llegó.
 *
 * Las rutas se reconocen por su final, así que cada test puede colgar el servidor de un
 * prefijo distinto (`/cert-api`, `/prod-envio`…) y comprobar a cuál le pegó el cliente.
 */
export type Recurso = 'semilla' | 'token' | 'envio' | 'consulta';

export interface PedidoRecibido {
  recurso: Recurso | null;
  metodo: string;
  /** Ruta completa con el prefijo, tal como llegó. */
  ruta: string;
  headers: IncomingHttpHeaders;
  cuerpo: Buffer;
}

export interface RespuestaFalsa {
  status?: number;
  headers?: Record<string, string>;
  cuerpo?: string;
  /** Espera antes de contestar; para probar el timeout. */
  demoraMs?: number;
  /** Sin `Content-Length` (transferencia por trozos), para probar el tope de lo leído. */
  fragmentado?: boolean;
}

const RESP = (cuerpo: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY>${cuerpo}</SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`;

export const SEMILLA_FALSA = '030530912644';
export const TOKEN_FALSO = 'P7VQKYLDNHJGP';

/** Una respuesta XML de semilla o token con la forma del SII, con `ESTADO` a elección. */
export const respuestaXml = (
  cuerpo: string,
  estado = '00',
  glosa = '',
): RespuestaFalsa => ({
  headers: { 'content-type': 'application/xml' },
  cuerpo: RESP(cuerpo).replace(
    '<ESTADO>00</ESTADO>',
    `<ESTADO>${estado}</ESTADO>${glosa ? `<GLOSA>${glosa}</GLOSA>` : ''}`,
  ),
});

const json = (datos: unknown): RespuestaFalsa => ({
  headers: { 'content-type': 'application/json' },
  cuerpo: JSON.stringify(datos),
});

const POR_DEFECTO: Record<Recurso, RespuestaFalsa> = {
  semilla: respuestaXml(`<SEMILLA>${SEMILLA_FALSA}</SEMILLA>`),
  token: respuestaXml(`<TOKEN>${TOKEN_FALSO}</TOKEN>`),
  envio: json({
    rut_emisor: '76543210-3',
    rut_envia: '11111111-1',
    trackid: 1014,
    fecha_recepcion: '2026-10-14 10:00:00',
    estado: 'REC',
    file: 'envio.xml',
  }),
  consulta: json({
    rut_emisor: '76543210-3',
    rut_envia: '11111111-1',
    trackid: 1014,
    fecha_recepcion: '2026-10-14 10:00:00',
    estado: 'EPR',
    estadistica: [{ tipo: 39, informados: 1, aceptados: 1, rechazados: 0 }],
  }),
};

function recursoDe(metodo: string, ruta: string): Recurso | null {
  const camino = ruta.split('?')[0];
  if (metodo === 'GET' && /\/boleta\.electronica\.semilla$/.test(camino))
    return 'semilla';
  if (metodo === 'POST' && /\/boleta\.electronica\.token$/.test(camino))
    return 'token';
  if (metodo === 'POST' && /\/boleta\.electronica\.envio$/.test(camino))
    return 'envio';
  if (metodo === 'GET' && /\/boleta\.electronica\.envio\/[^/]+$/.test(camino))
    return 'consulta';
  return null;
}

export class SiiFalso {
  readonly pedidos: PedidoRecibido[] = [];
  private readonly guion: Record<Recurso, RespuestaFalsa[]> = {
    semilla: [],
    token: [],
    envio: [],
    consulta: [],
  };

  private constructor(private readonly servidor: Server) {}

  /** `http://127.0.0.1:<puerto>`, sin barra final. */
  get url(): string {
    const { port } = this.servidor.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  static async iniciar(): Promise<SiiFalso> {
    const servidor = createServer();
    const falso = new SiiFalso(servidor);
    servidor.on('request', (req, res) => {
      const trozos: Buffer[] = [];
      req.on('data', (t: Buffer) => trozos.push(t));
      req.on('end', () => {
        const ruta = req.url ?? '';
        const metodo = req.method ?? '';
        const recurso = recursoDe(metodo, ruta);
        falso.pedidos.push({
          recurso,
          metodo,
          ruta,
          headers: req.headers,
          cuerpo: Buffer.concat(trozos),
        });
        if (!recurso) {
          res.writeHead(404).end();
          return;
        }
        const r = falso.guion[recurso].shift() ?? POR_DEFECTO[recurso];
        const contestar = () => {
          res.writeHead(r.status ?? 200, r.headers);
          if (r.fragmentado) res.write(r.cuerpo ?? '');
          res.end(r.fragmentado ? undefined : (r.cuerpo ?? ''));
        };
        if (r.demoraMs) {
          const espera = setTimeout(contestar, r.demoraMs);
          res.on('close', () => clearTimeout(espera));
        } else contestar();
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    return falso;
  }

  /** Encola respuestas de un solo uso para `recurso`; agotadas, vuelve la respuesta por defecto. */
  responder(recurso: Recurso, ...respuestas: RespuestaFalsa[]): void {
    this.guion[recurso].push(...respuestas);
  }

  /** Vacía los pedidos registrados y el guion; deja el servidor como recién iniciado. */
  reiniciar(): void {
    this.pedidos.length = 0;
    for (const r of Object.keys(this.guion) as Recurso[])
      this.guion[r].length = 0;
  }

  pedidosDe(recurso: Recurso): PedidoRecibido[] {
    return this.pedidos.filter((p) => p.recurso === recurso);
  }

  async cerrar(): Promise<void> {
    this.servidor.closeAllConnections();
    await new Promise<void>((ok) => this.servidor.close(() => ok()));
  }
}

/**
 * Las partes de un `multipart/form-data`, por nombre de campo. Los bytes se conservan tal
 * cual llegaron (se parte en latin1, que es 1 byte = 1 carácter).
 */
export function partesMultipart(
  pedido: PedidoRecibido,
): Record<string, { nombreArchivo?: string; contenido: Buffer }> {
  const tipo = String(pedido.headers['content-type'] ?? '');
  const borde = /boundary=(?:"([^"]+)"|([^;]+))/.exec(tipo);
  if (!borde) throw new Error(`No es multipart: ${tipo}`);
  const delimitador = `--${borde[1] ?? borde[2]}`;
  const todo = pedido.cuerpo.toString('latin1');
  const partes: Record<string, { nombreArchivo?: string; contenido: Buffer }> =
    {};
  for (const trozo of todo.split(delimitador).slice(1)) {
    if (trozo.startsWith('--')) break;
    const corte = trozo.indexOf('\r\n\r\n');
    const cabecera = trozo.slice(0, corte);
    const nombre = /name="([^"]*)"/.exec(cabecera)?.[1];
    if (!nombre) continue;
    // El cuerpo termina en CRLF antes del siguiente delimitador.
    const cuerpo = trozo.slice(corte + 4, trozo.length - 2);
    partes[nombre] = {
      nombreArchivo: /filename="([^"]*)"/.exec(cabecera)?.[1],
      contenido: Buffer.from(cuerpo, 'latin1'),
    };
  }
  return partes;
}
