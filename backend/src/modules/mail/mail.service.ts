import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface Mail {
  para: string;
  asunto: string;
  /** Cuerpo en texto plano. Sin HTML: son dos mails y ninguno lo necesita. */
  cuerpo: string;
}

/**
 * Envío de mail.
 *
 * **`nodemailer` es el cliente, no el proveedor**: se escribe contra SMTP, así
 * que cambiar de proveedor (Gmail, Resend, SendGrid, SES) el día del deploy es
 * cambiar variables de entorno, no código.
 *
 * ⚠️ **Con `SMTP_HOST` vacío loguea en vez de mandar, y eso no es comodidad de
 * desarrollo: es obligatorio.** Se corren cientos de e2e en cada cierre y en
 * CI; mandando de verdad, cada corrida dispararía mails reales, comería el tope
 * diario de la cuenta y CI necesitaría las credenciales del owner. El fallback
 * es además todo el loop de desarrollo: el link de invitación aparece en el log
 * del backend, clickeable.
 *
 * **Nunca lanza hacia arriba.** Un mail que no sale es un problema, pero no
 * puede tumbar la operación que lo originó: si el alta de un usuario fallara
 * porque el SMTP está caído, el admin vería un error y la cuenta habría quedado
 * creada igual. Se loguea el fallo y se sigue; el token ya está emitido, así
 * que el link se puede volver a mandar.
 *
 * 🚩 **En producción el cuerpo NUNCA se escribe en el log.** El fallback de
 * arriba es correcto en desarrollo y en CI, pero el cuerpo es justamente el que
 * lleva la URL con el token **en claro**: un reset de contraseña o una
 * invitación, servidos a cualquiera con lectura de logs. Tiene su ironía —
 * `TokenAcceso` guarda solo el hash SHA-256 precisamente para que el texto plano
 * exista **una sola vez**, en el link del mail, y este log lo reintroducía en el
 * lugar que más gente puede leer.
 *
 * Con `NODE_ENV=production` y sin `SMTP_HOST`, entonces: se registra un `error`
 * con destinatario y asunto —lo necesario para reenviar a mano— y **sin una
 * línea del cuerpo**. El sistema degrada a "el mail no salió", que es un
 * problema visible, en vez de a "el secreto quedó escrito", que no lo es.
 *
 * ⚠️ **Lo que esto NO hace: tumbar el arranque.** Sería la otra opción —negarse
 * a levantar sin SMTP en producción— y es una decisión de producto abierta, no
 * un detalle: dejaría el POS entero caído porque el mail no está configurado.
 * Queda anotada en `docs/agent/pendientes.md`. El cierre del agujero de arriba
 * no depende de esa respuesta.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly remitente: string;
  private readonly esProduccion: boolean;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    this.esProduccion = this.config.get<string>('NODE_ENV') === 'production';
    this.remitente =
      this.config.get<string>('SMTP_FROM') ?? 'no-reply@startup-pos.local';

    if (!host) {
      this.transporter = null;
      if (this.esProduccion) {
        // `error`, no `warn`: en producción esto no es una comodidad, es que
        // ningún link de invitación ni de reset va a llegar a nadie.
        this.logger.error(
          'SMTP_HOST vacío en producción: NINGÚN mail se va a enviar. ' +
            'Los links de invitación y de reset no llegan, y no se escriben ' +
            'en el log a propósito (llevan el token en claro).',
        );
      } else {
        this.logger.warn(
          'SMTP_HOST vacío: los mails se escriben en el log y NO se envían.',
        );
      }
      return;
    }

    const puerto = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    this.transporter = nodemailer.createTransport({
      host,
      port: puerto,
      // 465 es SMTPS (TLS desde el saludo); 587 es STARTTLS (TLS después).
      // Derivarlo del puerto evita una variable más que se puede contradecir
      // con él.
      secure: puerto === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  /** `true` si hay transporte real configurado. Lo usan los tests. */
  get envioReal(): boolean {
    return this.transporter !== null;
  }

  async enviar(mail: Mail): Promise<void> {
    if (!this.transporter) {
      if (this.esProduccion) {
        // Sin `mail.cuerpo`: ahí vive la URL con el token en claro.
        this.logger.error(
          `[MAIL NO ENVIADO — SMTP_HOST vacío en producción] ` +
            `"${mail.asunto}" para ${mail.para}. El cuerpo NO se loguea: ` +
            `lleva el token en claro. Reenviar desde la app.`,
        );
        return;
      }
      this.logger.log(
        `[MAIL NO ENVIADO — SMTP_HOST vacío]\n` +
          `Para: ${mail.para}\n` +
          `Asunto: ${mail.asunto}\n` +
          `${mail.cuerpo}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.remitente,
        to: mail.para,
        subject: mail.asunto,
        text: mail.cuerpo,
      });
    } catch (e) {
      // Se traga el error a propósito (ver docblock de la clase). Se loguea
      // con el destinatario para poder reenviar a mano.
      this.logger.error(
        `No se pudo enviar el mail "${mail.asunto}" a ${mail.para}: ${
          (e as Error).message
        }`,
      );
    }
  }
}
