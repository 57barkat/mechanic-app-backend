import { DataSource } from "typeorm";
import { User } from "../entities/User";
import { Request as JobRequest } from "../entities/Request";
import { Offer } from "../entities/Offer";
import { AppSetting } from "../entities/AppSetting";
import { Payment } from "../entities/transactions";
import dotenv from "dotenv";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  // Updated default port to 20380 for Aiven
  port: parseInt(process.env.DB_PORT || "20380"),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  // Aiven's default database name is usually 'defaultdb'
  database: process.env.DB_NAME || "defaultdb",

  // --- CRITICAL FOR AIVEN CONNECTION ---
  ssl: {
    rejectUnauthorized: false, // Required for Aiven's secure cloud connection
  },

  // Keep synchronize: true for development, but set to false for production later
  synchronize: true,
  logging: false,
  entities: [User, JobRequest, Offer, AppSetting, Payment],
  subscribers: [],
  migrations: [],
});
