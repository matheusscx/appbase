#!/usr/bin/env node
// transbank-saldo-sandbox.mjs — mide contra el ambiente de INTEGRACIÓN de Transbank lo que
// lee el aclarado de un reembolso sin confirmar (ADR-029, `veredictoPorSaldo` en
// backend/src/modules/pasarela/services/cobros.service.ts): `details[0].balance` y
// `details[0].status` del GET de estado, antes y después de anulaciones parciales y totales,
// en Webpay Plus Mall y en Oneclick Mall; y con qué buy_order responde el GET de Oneclick Mall
// (el del padre o el del hijo).
//
// Opt-in: no corre en el gate ni en CI. Pega solo a webpay3gint.transbank.cl (fijo, no se
// puede apuntar a producción). Las credenciales van por variables de entorno y son las de
// integración que publica Transbank (las mismas que siembra el seed):
//
//   RUN_TRANSBANK_SANDBOX=1 \
//   TBK_API_KEY_SECRET=<secreto de integración> \
//   TBK_WEBPAY_MALL=597055555535 TBK_WEBPAY_HIJO=597055555536 \
//   TBK_ONECLICK_MALL=597055555541 TBK_ONECLICK_HIJO=597055555542 \
//   node scripts/qa/transbank-saldo-sandbox.mjs [--puerto 4599] [--solo webpay|oneclick]
//
// Imprime dos URLs locales: una paga con Webpay Plus Mall y otra inscribe una tarjeta en
// Oneclick. Las dos piden pasar por el formulario de Webpay con la tarjeta de prueba de
// Transbank (VISA 4051 8856 0044 6623, CVV 123, RUT 11.111.111-1, clave 123). El script
// confirma el pago y la inscripción apenas vuelve el navegador, corre la secuencia y deja
// cada respuesta en stdout como JSON.
//
//   node scripts/qa/transbank-saldo-sandbox.mjs --reconsultar <token Webpay>
//
// solo repite el GET de estado de un pago Webpay viejo: la ventana de consulta (la
// documentación dice 7 días, la referencia "en cualquier momento").
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const BASE = 'https://webpay3gint.transbank.cl/rswebpaytransaction/api';
const WEBPAY = `${BASE}/webpay/v1.2`;
const ONECLICK = `${BASE}/oneclick/v1.2`;

if (process.env.RUN_TRANSBANK_SANDBOX !== '1') {
  console.error('Opt-in: definí RUN_TRANSBANK_SANDBOX=1 (pega al sandbox de Transbank).');
  process.exit(2);
}
const env = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Falta ${k} (ver el encabezado del script).`);
    process.exit(2);
  }
  return v;
};
const SECRETO = env('TBK_API_KEY_SECRET');

const args = process.argv.slice(2);
const arg = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};

function registrar(paso, datos) {
  console.log(JSON.stringify({ paso, ...datos }, null, 2));
}

async function tbk(comercio, metodo, url, body) {
  const res = await fetch(url, {
    method: metodo,
    headers: {
      'Tbk-Api-Key-Id': comercio,
      'Tbk-Api-Key-Secret': SECRETO,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  let json;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { _texto: texto };
  }
  return { status: res.status, json };
}

// Un buy_order único y corto (Transbank acepta hasta 26 caracteres).
const orden = (prefijo) =>
  `${prefijo}${Date.now().toString(36)}${randomBytes(2).toString('hex')}`.toUpperCase();

if (arg('--reconsultar')) {
  const mall = env('TBK_WEBPAY_MALL');
  const token = arg('--reconsultar');
  registrar('webpay.reconsulta', await tbk(mall, 'GET', `${WEBPAY}/transactions/${token}`));
  process.exit(0);
}

const WEBPAY_MALL = env('TBK_WEBPAY_MALL');
const WEBPAY_HIJO = env('TBK_WEBPAY_HIJO');
const ONECLICK_MALL = env('TBK_ONECLICK_MALL');
const ONECLICK_HIJO = env('TBK_ONECLICK_HIJO');
const PUERTO = Number(arg('--puerto') ?? 4599);
const LOCAL = `http://localhost:${PUERTO}`;

/** Anula `monto` y consulta el estado: lo que el aclarado lee después de un REFUND. */
async function anularYConsultar(etiqueta, anular, consultar, monto) {
  registrar(`${etiqueta}.refund(${monto})`, await anular(monto));
  registrar(`${etiqueta}.estado`, await consultar());
}

async function medirWebpay(token, boPadre) {
  const boHijo = `${boPadre}-1`;
  const consultar = () => tbk(WEBPAY_MALL, 'GET', `${WEBPAY}/transactions/${token}`);
  const anular = (amount) =>
    tbk(WEBPAY_MALL, 'POST', `${WEBPAY}/transactions/${token}/refunds`, {
      commerce_code: WEBPAY_HIJO,
      buy_order: boHijo,
      amount,
    });
  registrar('webpay.estado.sin_anulaciones', await consultar());
  await anularYConsultar('webpay', anular, consultar, 1000);
  await anularYConsultar('webpay', anular, consultar, 2000);
  await anularYConsultar('webpay', anular, consultar, 7000);
  registrar('webpay.token_para_reconsultar', { token, creado: new Date().toISOString() });
}

async function medirOneclick(username, tbkUser) {
  const autorizar = async (monto) => {
    const padre = orden('OP');
    const r = await tbk(ONECLICK_MALL, 'POST', `${ONECLICK}/transactions`, {
      username,
      tbk_user: tbkUser,
      buy_order: padre,
      details: [
        {
          commerce_code: ONECLICK_HIJO,
          buy_order: `${padre}-1`,
          amount: monto,
          installments_number: 1,
        },
      ],
    });
    registrar(`oneclick.autorizar(${monto})`, r);
    return padre;
  };
  const consultarPor = (bo) => tbk(ONECLICK_MALL, 'GET', `${ONECLICK}/transactions/${bo}`);

  // A: parciales hasta agotar el saldo, consultando por el padre y por el hijo.
  const a = await autorizar(10000);
  const consultarA = async () => ({
    porPadre: await consultarPor(a),
    porHijo: await consultarPor(`${a}-1`),
  });
  const anularA = (amount) =>
    tbk(ONECLICK_MALL, 'POST', `${ONECLICK}/transactions/${a}/refunds`, {
      commerce_code: ONECLICK_HIJO,
      detail_buy_order: `${a}-1`,
      amount,
    });
  registrar('oneclick.A.estado.sin_anulaciones', await consultarA());
  await anularYConsultar('oneclick.A', anularA, consultarA, 1000);
  await anularYConsultar('oneclick.A', anularA, consultarA, 2000);
  await anularYConsultar('oneclick.A', anularA, consultarA, 7000);

  // B: anulación total inmediata (Transbank la puede tratar como reversa: REVERSED).
  const b = await autorizar(5000);
  const anularB = (amount) =>
    tbk(ONECLICK_MALL, 'POST', `${ONECLICK}/transactions/${b}/refunds`, {
      commerce_code: ONECLICK_HIJO,
      detail_buy_order: `${b}-1`,
      amount,
    });
  await anularYConsultar('oneclick.B', anularB, () => consultarPor(b), 5000);

  registrar(
    'oneclick.borrar_inscripcion',
    await tbk(ONECLICK_MALL, 'DELETE', `${ONECLICK}/inscriptions`, {
      tbk_user: tbkUser,
      username,
    }),
  );
}

// --- El pago y la inscripción se crean al abrir cada URL, para que el token no venza esperando.
// El token se guarda acá y es el que se confirma: el retorno del navegador puede llegar sin
// parámetros (medido el 2026-10-04: un retorno de Webpay llegó vacío), y confirmar con el token
// propio no depende de cómo vuelva.
const creado = { webpay: null, oneclick: null };
const crearPago = async () => {
  const bo = orden('WP');
  const r = await tbk(WEBPAY_MALL, 'POST', `${WEBPAY}/transactions`, {
    buy_order: bo,
    session_id: orden('S'),
    return_url: `${LOCAL}/retorno/webpay`,
    details: [{ amount: 10000, commerce_code: WEBPAY_HIJO, buy_order: `${bo}-1` }],
  });
  creado.webpay = { token: r.json?.token, bo };
  return r;
};
const username = `saldo-sandbox-${Date.now().toString(36)}`;
const crearInscripcion = async () => {
  const r = await tbk(ONECLICK_MALL, 'POST', `${ONECLICK}/inscriptions`, {
    username,
    email: 'sandbox@example.cl',
    response_url: `${LOCAL}/retorno/oneclick`,
  });
  creado.oneclick = { token: r.json?.token };
  return r;
};

// Webpay exige que el navegador llegue por POST con el token: una página que se auto-envía.
const autoPost = (url, campo, valor) =>
  `<!doctype html><meta charset="utf-8"><body onload="document.forms[0].submit()">` +
  `<form method="post" action="${url}"><input type="hidden" name="${campo}" value="${valor}">` +
  `<button>Ir a Webpay</button></form>`;

const leerCuerpo = (req) =>
  new Promise((ok) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => ok(b));
  });

// `--solo webpay|oneclick` repite una sola de las dos mediciones.
const pendientes = new Set(arg('--solo') ? [arg('--solo')] : ['webpay', 'oneclick']);
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, LOCAL);
  const params = new URLSearchParams(url.search);
  if (req.method === 'POST')
    for (const [k, v] of new URLSearchParams(await leerCuerpo(req))) params.set(k, v);
  const responder = (txt) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(txt);
  };
  const retorno = (paso) =>
    registrar(paso, {
      metodo: req.method,
      contentType: req.headers['content-type'] ?? null,
      claves: [...params.keys()],
    });
  try {
    if (url.pathname === '/webpay' && pendientes.has('webpay')) {
      const pago = await crearPago();
      registrar('webpay.crear', { status: pago.status, json: { url: pago.json?.url } });
      return responder(autoPost(pago.json.url, 'token_ws', pago.json.token));
    }
    if (url.pathname === '/oneclick' && pendientes.has('oneclick')) {
      const insc = await crearInscripcion();
      registrar('oneclick.inscribir', { status: insc.status, json: { url: insc.json?.url_webpay } });
      return responder(autoPost(insc.json.url_webpay, 'TBK_TOKEN', insc.json.token));
    }
    if (url.pathname === '/retorno/webpay' && pendientes.has('webpay') && creado.webpay) {
      retorno('webpay.retorno');
      const { token, bo } = creado.webpay;
      const commit = await tbk(WEBPAY_MALL, 'PUT', `${WEBPAY}/transactions/${token}`);
      registrar('webpay.commit', commit);
      if (commit.json?.details?.[0]?.status !== 'AUTHORIZED')
        return responder('Webpay no autorizó el pago. Volvé a abrir /webpay.');
      pendientes.delete('webpay');
      responder('Pago confirmado. Podés cerrar esta pestaña.');
      await medirWebpay(token, bo);
      terminar();
    } else if (url.pathname === '/retorno/oneclick' && pendientes.has('oneclick') && creado.oneclick) {
      retorno('oneclick.retorno');
      const fin = await tbk(ONECLICK_MALL, 'PUT', `${ONECLICK}/inscriptions/${creado.oneclick.token}`);
      registrar('oneclick.finalizar_inscripcion', {
        status: fin.status,
        json: { ...fin.json, tbk_user: fin.json?.tbk_user ? '<omitido>' : null },
      });
      if (fin.json?.response_code !== 0 || !fin.json.tbk_user)
        return responder('La inscripción no se completó. Volvé a abrir /oneclick.');
      pendientes.delete('oneclick');
      responder('Inscripción terminada. Podés cerrar esta pestaña.');
      await medirOneclick(username, fin.json.tbk_user);
      terminar();
    } else {
      responder('Nada que hacer acá.');
    }
  } catch (e) {
    registrar('error', { ruta: url.pathname, mensaje: String(e) });
  }
});
// Se cierra cuando termina la última medición, no al salir de ella el último retorno: otro
// pedido del navegador (el favicon) llegaba con la medición todavía en curso.
const terminar = () => {
  if (pendientes.size > 0) return;
  console.error('Listo: terminaron todas las mediciones.');
  servidor.close();
};

servidor.listen(PUERTO, () => {
  console.error(`Abrí en el navegador, en este orden:\n${[...pendientes].map((p) => `  ${LOCAL}/${p}`).join('\n')}`);
  console.error('Tarjeta de prueba: VISA 4051 8856 0044 6623, CVV 123; RUT 11.111.111-1, clave 123.');
});
