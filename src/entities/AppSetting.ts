import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("app_settings")
export class AppSetting {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  key!: string;

  @Column()
  value!: string;
}
