import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { User, UserRole, HelperCategory } from "../entities/User";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

/**
 * =======================
 * REGISTER USER / HELPER
 * =======================
 */
export const registerUser = async (req: Request, res: Response) => {
  const { name, email, password, role, categories } = req.body;

  try {
    const userRepo = AppDataSource.getRepository(User);

    // ✅ Check existing user
    const existingUser = await userRepo.findOneBy({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = userRepo.create({
      name,
      email,
      password: hashedPassword,
      role: role ?? UserRole.USER,
      categories:
        role === UserRole.HELPER && Array.isArray(categories)
          ? categories
          : null,
      isOnline: false,
      isVerified: false,
    });

    await userRepo.save(newUser);

    console.log("✅ User registered:", newUser.id, newUser.role);

    res.status(201).json({
      message: "User registered successfully",
    });
  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * =======================
 * LOGIN USER / HELPER
 * =======================
 */
export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOne({
      where: { email },
    });

    if (!user) {
      console.log("❌ Invalid email");
      return res.status(400).json({ message: "Invalid email" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Invalid password");
      return res.status(400).json({ message: "Invalid password" });
    }

    // ✅ JWT includes role (important for frontend & sockets)
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" },
    );

    console.log("✅ User logged in:", user.id, user.role);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        categories: user.categories,
        isOnline: user.isOnline,
      },
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
