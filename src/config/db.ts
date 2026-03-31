import { DataSource } from "typeorm"; // remove Transaction from here
import { User } from "../entities/User";
import { Request as JobRequest } from "../entities/Request";
import { Offer } from "../entities/Offer";
import { AppSetting } from "../entities/AppSetting";
import dotenv from "dotenv";
import { Payment } from "../entities/transactions";

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
  entities: [User, JobRequest, Offer, AppSetting, Payment],
  subscribers: [],
  migrations: [],
});
