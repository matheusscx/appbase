import { Injectable } from '@nestjs/common';

@Injectable()
export class TestService {
  leer() {
    return { message: 'Leyendo' };
  }

  crear() {
    return { message: 'Creando' };
  }

  actualizar() {
    return { message: 'Actualizando' };
  }

  eliminar() {
    return { message: 'Eliminando' };
  }
}
