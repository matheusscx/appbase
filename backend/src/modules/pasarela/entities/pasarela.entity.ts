import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarelas')
export class Pasarela {
  @PrimaryColumn({ name: 'pasarela_id', type: 'uuid' })
  pasarelaId: string;

  @Column({ unique: true })
  codigo: string; // 'oneclick', 'webpay_plus', ...

  @Column()
  nombre: string;

  @Column({ name: 'soporta_tokenizacion', default: false })
  soportaTokenizacion: boolean;

  @Column({ name: 'soporta_cobro_recurrente', default: false })
  soportaCobroRecurrente: boolean;

  @Column({ name: 'soporta_mall', default: false })
  soportaMall: boolean;

  @Column({ name: 'url_produccion' })
  urlProduccion: string;

  @Column({ name: 'url_pruebas' })
  urlPruebas: string;

  // Blobs cifrados AES-256-GCM ('v1:iv:tag:data') — credenciales mall de la plataforma
  @Column({ name: 'configuracion_produccion', type: 'text', nullable: true })
  configuracionProduccion: string | null;

  @Column({ name: 'configuracion_pruebas', type: 'text', nullable: true })
  configuracionPruebas: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
