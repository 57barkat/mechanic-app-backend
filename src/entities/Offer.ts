import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User";
import { Request } from "./Request";

@Entity("offers")
export class Offer {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, { eager: true })
  mechanic!: User;

  @ManyToOne(() => Request, (request) => request.offers)
  request!: Request;

  @Column("double precision")
  offeredPrice!: number;

  @Column({ default: false })
  accepted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
