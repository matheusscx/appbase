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
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly remitente: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    this.remitente =
      this.config.get<string>('SMTP_FROM') ?? 'no-reply@startup-pos.local';

    if (!host) {
      this.transporter = null;
      this.logger.warn(
        'SMTP_HOST vacío: los mails se escriben en el log y NO se envían.',
      );
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
