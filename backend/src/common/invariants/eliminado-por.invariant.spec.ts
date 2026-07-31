import { getMetadataArgsStorage } from 'typeorm';

// Invariante de la papelera: toda entidad restaurable declara quién la borró.
// Sin `eliminado_por` la papelera muestra el "quién" vacío y degrada en silencio
// — no falla nada, simplemente deja de informar. Ver la spec del 2026-07-31.
import { Categoria } from '../../modules/categorias/entities/categoria.entity';
import { Descuento } from '../../modules/descuentos/entities/descuento.entity';
import { Recargo } from '../../modules/recargos/entities/recargo.entity';
import { Impuesto } from '../../modules/impuestos/entities/impuesto.entity';
import { Tercero } from '../../modules/terceros/entities/tercero.entity';
import { Cajon } from '../../modules/cajones/entities/cajon.entity';
import { Garzon } from '../../modules/garzones/entities/garzon.entity';
import { Turno } from '../../modules/turnos/entities/turno.entity';
import { Impresora } from '../../modules/impresoras/entities/impresora.entity';
import { Salon } from '../../modules/salones/entities/salon.entity';
import { Mesa } from '../../modules/salones/entities/mesa.entity';
import { GrupoModificador } from '../../modules/grupos-modificadores/entities/grupo-modificador.entity';
import { CausaMerma } from '../../modules/mermas/entities/causa-merma.entity';
import { MotivoDiferenciaCaja } from '../../modules/motivos-diferencia/entities/motivo-diferencia-caja.entity';
import { MotivoDiferenciaInventario } from '../../modules/motivos-diferencia-inventario/entities/motivo-diferencia-inventario.entity';
import { Item } from '../../modules/items/entities/item.entity';

const RESTAURABLES = [
  Categoria,
  Descuento,
  Recargo,
  Impuesto,
  Tercero,
  Cajon,
  Garzon,
  Turno,
  Impresora,
  Salon,
  Mesa,
  GrupoModificador,
  CausaMerma,
  MotivoDiferenciaCaja,
  MotivoDiferenciaInventario,
  Item,
];

describe('Invariante papelera: eliminado_por en toda entidad restaurable', () => {
  it('las 16 entidades del alcance declaran eliminado_por como uuid nullable', () => {
    const faltantes = RESTAURABLES.filter((target) => {
      const col = getMetadataArgsStorage().columns.find(
        (c) =>
          c.target === target &&
          ((c.options as { name?: string }).name ?? c.propertyName) ===
            'eliminado_por',
      );
      if (!col) return true;
      const o = col.options as { type?: unknown; nullable?: boolean };
      return o.type !== 'uuid' || o.nullable !== true;
    }).map((t) => t.name);

    expect(faltantes).toEqual([]);
  });

  it('el alcance es de 16 entidades', () => {
    // Si este número cambia, la spec cambió: actualizar ambos a la vez.
    expect(RESTAURABLES).toHaveLength(16);
  });
});
