import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * `@Global` porque lo consumen módulos que no tienen nada que ver entre sí
 * —`tenants` para la invitación del alta, `auth` para el reset— y van a ser
 * más. La alternativa era importarlo en cada uno; para un servicio sin estado
 * y con una sola dependencia, el global es el patrón que ya usa el proyecto
 * para este caso.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
