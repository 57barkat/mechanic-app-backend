import { DataSource } from "typeorm";
import { User } from "../entities/User";
import { Request as JobRequest } from "../entities/Request"; // Aliased to avoid naming conflicts
import { Offer } from "../entities/Offer";
import { AppSetting } from "../entities/AppSetting";
import dotenv from "dotenv";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  synchronize: true, // Set to false in production
  logging: false,
  // Explicitly mapping the entities
  entities: [User, JobRequest, Offer, AppSetting],
  subscribers: [],
  migrations: [],
});
