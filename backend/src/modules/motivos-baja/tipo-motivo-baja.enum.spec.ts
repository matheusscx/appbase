import {
  TipoMotivoBaja,
  tipoMotivoBajaDescuenta,
} from './tipo-motivo-baja.enum';

describe('tipoMotivoBajaDescuenta', () => {
  it.each([
    [TipoMotivoBaja.MERMA, true],
    [TipoMotivoBaja.CORTESIA, true],
    // La comida del personal sale de cocina igual que una cortesía: descuenta.
    [TipoMotivoBaja.CONSUMO_PERSONAL, true],
    // Ese plato nunca salió de cocina.
    [TipoMotivoBaja.NO_ELABORADO, false],
  ])('%s → %s', (tipo, esperado) => {
    expect(tipoMotivoBajaDescuenta(tipo)).toBe(esperado);
  });
});
