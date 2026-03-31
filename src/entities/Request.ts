import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User";
import { Offer } from "./Offer";

export type RequestStatus =
  | "pending"
  | "accepted"
  | "arrived"
  | "working"
  | "completed"
  | "cancelled";

@Entity("requests")
export class Request {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, (user) => user.requests, { eager: true })
  user!: User;

  @Column()
  problemType!: string;

  @Column({ type: "text", nullable: true })
  description?: string;
  @Column({ type: "varchar", length: 255, nullable: true })
  areaName?: string;

  @Column("double precision")
  lat!: number;

  @Column("double precision")
  lng!: number;

  @Column({
    type: "enum",
    enum: [
      "pending",
      "accepted",
      "arrived",
      "working",
      "completed",
      "cancelled",
    ],
    default: "pending",
  })
  status!: RequestStatus;

  // Suggested price calculated by server based on distance
  @Column({ type: "double precision", nullable: true })
  suggestedPrice?: number;

  // Assigned helper once accepted
  @ManyToOne(() => User, { nullable: true, eager: true })
  helper?: User;

  // Offers from mechanics
  @OneToMany(() => Offer, (offer) => offer.request)
  offers!: Offer[];

  // Final price paid by user
  @Column({ type: "double precision", nullable: true })
  finalPrice?: number;

  // Rating given by user
  @Column({ type: "int", nullable: true })
  rating?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
