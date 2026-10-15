import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HojaRuta } from './hoja-ruta.entity';
import { Paquete } from './paquete.entity';

@Entity('hoja_ruta_paquetes')
@Index('uq_hoja_ruta_paquetes_en_ruta', ['paqueteId'], {
  unique: true,
  where: `"estado" = 'en_ruta' AND "eliminado_el" IS NULL`,
})
@Index('idx_hoja_ruta_paquetes_hoja', ['hojaRutaId'])
@Index('idx_hoja_ruta_paquetes_paquete', ['paqueteId'])
export class HojaRutaPaquete {
  @PrimaryGeneratedColumn('uuid', { name: 'hoja_ruta_paquete_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'hoja_ruta_id', type: 'uuid' })
  hojaRutaId: string;

  @ManyToOne(() => HojaRuta)
  @JoinColumn({ name: 'hoja_ruta_id' })
  hoja?: HojaRuta;

  @Column({ name: 'paquete_id', type: 'uuid' })
  paqueteId: string;

  @ManyToOne(() => Paquete)
  @JoinColumn({ name: 'paquete_id' })
  paquete?: Paquete;

  @Column({ type: 'varchar', length: 20, default: 'en_ruta' })
  estado: 'en_ruta' | 'entregado' | 'no_entregado';

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
