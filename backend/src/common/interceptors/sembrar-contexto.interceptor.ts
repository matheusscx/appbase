import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable } from 'rxjs';
import { RequestContext } from '../context/request-context';
import { type JwtUser } from '../interfaces/jwt-user.interface';

/**
 * Siembra el `RequestContext` con el usuario del token, para que los providers
 * singleton lo lean sin pedir el request por inyección (y sin arrastrar a su
 * controller a `Scope.REQUEST`).
 *
 * **Por qué interceptor y no middleware:** el middleware corre **antes** de los
 * guards, así que todavía no existe `req.user` —lo pone Passport dentro de
 * `JwtAuthGuard`—. El interceptor corre después de los guards y **antes** de los
 * pipes, que es exactamente la ventana que hace falta. Verificado por spike, no
 * deducido de la doc.
 *
 * Se registra global (`APP_INTERCEPTOR` en `CommonModule`): sembrar por
 * controller dejaría el hueco justo donde alguien agregue un controller nuevo.
 *
 * ℹ️ En una ruta pública no hay `user`, y eso **no** es un error acá: el store
 * existe igual y quien necesite el tenant decide qué hacer sin él —
 * `EscalaMonedaPipe`, por ejemplo, tira 403—.
 */
@Injectable()
export class SembrarContextoInterceptor implements NestInterceptor {
  constructor(private readonly contexto: RequestContext) {}

  intercept(
    ejecucion: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (ejecucion.getType() !== 'http') return next.handle();
    const req = ejecucion.switchToHttp().getRequest<{ user?: JwtUser }>();
    return this.contexto.correrCon({ user: req.user }, () => next.handle());
  }
}
