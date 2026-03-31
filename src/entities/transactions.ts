import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";

@Entity("payments")
export class Payment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  txnRefNo!: string; // Your unique Order ID sent to JazzCash

  @Column("double precision")
  amount!: number;

  @Column({ default: "PENDING" })
  status!: string; // PENDING, SUCCESS, FAILED

  @Column({ nullable: true })
  jazzcashTransactionId!: string; // pp_RetRefNo from JazzCash

  @ManyToOne(() => User, (user) => user.requests)
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column()
  userId!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
