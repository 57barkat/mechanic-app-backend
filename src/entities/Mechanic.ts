// import {
//   Entity,
//   PrimaryGeneratedColumn,
//   Column,
//   CreateDateColumn,
//   UpdateDateColumn,
//   OneToMany,
// } from "typeorm";
// import { Request } from "./Request";

// @Entity("mechanics")
// export class Mechanic {
//   @PrimaryGeneratedColumn()
//   id!: number;

//   @Column()
//   name!: string;

//   @Column({ unique: true })
//   email!: string;

//   @Column()
//   password!: string;

//   @Column()
//   category!: string;

//   @Column({ default: "mechanic" })
//   role!: string;

//   @Column("double precision", { nullable: true })
//   lat!: number | null;

//   @Column("double precision", { nullable: true })
//   lng!: number | null;

//   @Column({ default: true })
//   isAvailable!: boolean;

//   @OneToMany(() => Request, (request) => request.mechanic)
//   requests!: Request[];
//   @Column({ default: false })
//   isOnline!: boolean;

//   @CreateDateColumn()
//   createdAt!: Date;

//   @UpdateDateColumn()
//   updatedAt!: Date;
// }
