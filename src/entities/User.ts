import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { Request } from "./Request";

export enum UserRole {
  USER = "user",
  HELPER = "helper",
  ADMIN = "admin",
}

export enum HelperCategory {
  FLAT_TIRE = "flat_tire",
  FUEL = "fuel",
  BATTERY = "battery",
  TOW = "tow",
}

@Entity("users")
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 100 })
  name!: string;

  @Column({ type: "varchar", unique: true })
  email!: string;

  @Column({ type: "varchar" })
  password!: string;

  /* ======================
     LOCATION (REAL-TIME)
  ====================== */
  @Column("double precision", { nullable: true })
  lat!: number | null;

  @Column("double precision", { nullable: true })
  lng!: number | null;

  @Column({ type: "boolean", default: false })
  isOnline!: boolean;

  @Column({ type: "boolean", default: false })
  isBusy!: boolean; // New: true if currently on ride

  /* ======================
     ROLE MANAGEMENT
  ====================== */
  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.USER,
  })
  role!: UserRole;

  /* ======================
     HELPER-ONLY FIELDS
  ====================== */
  @Column({
    type: "enum",
    enum: HelperCategory,
    array: true,
    nullable: true,
  })
  categories!: HelperCategory[] | null;

  @Column({ type: "boolean", default: false })
  isVerified!: boolean;

  @Column({ type: "text", nullable: true })
  cnicImage!: string | null;

  @Column("double precision", {
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value) || 0,
    },
  })
  totalEarnings!: number;

  @Column("double precision", {
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value) || 0,
    },
  })
  rating!: number;

  @Column({ type: "int", default: 0 })
  ratingCount!: number;

  /* ======================
     RELATIONS
  ====================== */
  @OneToMany(() => Request, (request) => request.user)
  requests!: Request[];

  /* ======================
     TIMESTAMPS
  ====================== */
  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
