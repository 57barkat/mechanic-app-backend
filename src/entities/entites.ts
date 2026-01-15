import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/* =======================
   USER (REQUESTOR)
======================= */
@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ unique: true })
  phone!: string;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => Request, (r) => r.user)
  requests!: Request[];
}

/* =======================
   HELPER (SERVICE PROVIDER)
======================= */
@Entity()
export class Helper {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ unique: true })
  phone!: string;

  @Column({ nullable: true })
  cnicImage!: string;

  @Column({ default: false })
  isOnline!: boolean;

  @Column("float", { nullable: true })
  lat!: number;

  @Column("float", { nullable: true })
  lng!: number;

  @Column("float", { default: 0 })
  wallet!: number;

  @Column("float", { default: 0 })
  rating!: number;

  @Column("int", { default: 0 })
  ratingCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => Offer, (o) => o.helper)
  offers!: Offer[];
}

/* =======================
   REQUEST (JOB)
======================= */
@Entity()
export class Request {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, (u) => u.requests)
  user!: User;

  @Column()
  problemType!: string;

  @Column("float")
  userLat!: number;

  @Column("float")
  userLng!: number;

  @Column({ default: "pending" }) // pending | accepted | completed
  status!: string;

  @Column({ nullable: true })
  acceptedHelperId!: number;

  @Column({ nullable: true })
  price!: number;

  @Column({ nullable: true })
  eta!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => Offer, (o) => o.request)
  offers!: Offer[];
}

/* =======================
   OFFER (HELPER BID)
======================= */
@Entity()
export class Offer {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Request, (r) => r.offers)
  request!: Request;

  @ManyToOne(() => Helper, (h) => h.offers)
  helper!: Helper;

  @Column("float")
  price!: number;

  @Column("int")
  eta!: number; // minutes

  @CreateDateColumn()
  createdAt!: Date;
}

/* =======================
   RATING
======================= */
@Entity()
export class Rating {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Helper)
  helper!: Helper;

  @ManyToOne(() => User)
  user!: User;

  @Column("int")
  stars!: number;

  @Column({ nullable: true })
  comment!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
