import { DataSource } from "typeorm";
import { User } from "../entities/User";
// import { Mechanic } from "../entities/Mechanic";
import { Request } from "../entities/Request";
import dotenv from "dotenv";
import { Offer } from "../entities/Offer";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  synchronize: true,
  logging: false,
  entities: [User, Request, Offer],
});
