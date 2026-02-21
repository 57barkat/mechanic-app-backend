import { Router } from "express";
import { AppDataSource } from "../config/db";
import { User, UserRole } from "../entities/User";
import { Request as JobRequest } from "../entities/Request";
import { adminAuth } from "../middlewares/adminAuth.middleware";
import { adminLogin } from "../controllers/adminAuth.controller";
import { AppSetting } from "../entities/AppSetting";

const router = Router();

/* ===== PUBLIC ===== */
// Admin login
router.post("/login", adminLogin);

/* ===== PROTECTED ===== */
router.use(adminAuth); // all routes below require admin
router.get("/stats", async (req, res) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const requestRepo = AppDataSource.getRepository(JobRequest);

    const totalUsers = await userRepo.count({ where: { role: UserRole.USER } });
    const totalHelpers = await userRepo.count({
      where: { role: UserRole.HELPER },
    });
    const pendingHelpers = await userRepo.count({
      where: { role: UserRole.HELPER, isVerified: false },
    });

    // POSTGRES SPECIFIC QUERY
    const rawData = await requestRepo
      .createQueryBuilder("request")
      // DATE_TRUNC groups by the start of the day
      .select("DATE_TRUNC('day', request.createdAt)", "day")
      .addSelect("COUNT(*)", "count")
      // Postgres interval syntax: NOW() - INTERVAL '7 days'
      .where("request.createdAt >= NOW() - INTERVAL '7 days'")
      .groupBy("day")
      .orderBy("day", "ASC")
      .getRawMany();

    const chartData = rawData.map((item) => ({
      // Format the date to a readable day name (e.g., "Mon")
      name: new Date(item.day).toLocaleDateString("en-US", {
        weekday: "short",
      }),
      requests: parseInt(item.count),
    }));

    return res.json({
      counts: { totalUsers, totalHelpers, pendingHelpers },
      chartData: chartData,
    });
  } catch (err) {
    console.error("Stats Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});
/* ===== USERS ===== */
// Get all users
router.get("/users", async (req, res) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const users = await userRepo.find({ where: { role: UserRole.USER } });
    return res.json({ users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Edit user info
router.patch("/users/:id", async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { name, email } = req.body;
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOne({
      where: { id: userId, role: UserRole.USER },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name;
    if (email) user.email = email;

    await userRepo.save(user);
    return res.json({ message: "User updated", user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Delete user
router.delete("/users/:id", async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOne({
      where: { id: userId, role: UserRole.USER },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    await userRepo.remove(user);
    return res.json({ message: "User deleted" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* ===== HELPERS ===== */
// Get all helpers
router.get("/helpers", async (req, res) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const helpers = await userRepo.find({ where: { role: UserRole.HELPER } });
    return res.json({ helpers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get pending helpers (unverified)
router.get("/helpers/pending", async (req, res) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const pendingHelpers = await userRepo.find({
      where: { role: UserRole.HELPER, isVerified: false },
    });
    return res.json({ pendingHelpers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Verify / Unverify helper
router.patch("/helpers/:id/verify", async (req, res) => {
  try {
    const helperId = parseInt(req.params.id);
    const { isVerified } = req.body;

    if (typeof isVerified !== "boolean") {
      return res.status(400).json({ message: "isVerified boolean required" });
    }

    const userRepo = AppDataSource.getRepository(User);
    const helper = await userRepo.findOne({
      where: { id: helperId, role: UserRole.HELPER },
    });

    if (!helper) return res.status(404).json({ message: "Helper not found" });

    helper.isVerified = isVerified;
    await userRepo.save(helper);

    return res.json({
      message: `Helper ${isVerified ? "approved" : "unapproved"} successfully`,
      helper: {
        id: helper.id,
        name: helper.name,
        email: helper.email,
        isVerified: helper.isVerified,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});
router.get("/commission", async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(AppSetting);

    const setting = await repo.findOneBy({ key: "commission_percent" });

    return res.json({
      commission: setting ? Number(setting.value) : 0,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});
router.put("/commission", async (req, res) => {
  try {
    const { percent } = req.body;

    if (typeof percent !== "number" || percent < 0 || percent > 100) {
      return res.status(400).json({ message: "Invalid commission percent" });
    }

    const repo = AppDataSource.getRepository(AppSetting);

    let setting = await repo.findOneBy({ key: "commission_percent" });

    if (!setting) {
      setting = repo.create({
        key: "commission_percent",
        value: percent.toString(),
      });
    } else {
      setting.value = percent.toString();
    }

    await repo.save(setting);

    return res.json({
      message: "Commission updated",
      commission: percent,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

/* ===== REQUESTS ===== */
// Get all requests (with user, helper, offers)
router.get("/requests", async (req, res) => {
  try {
    const requestRepo = AppDataSource.getRepository(JobRequest);
    const requests = await requestRepo.find({
      relations: ["user", "helper", "offers"],
    });
    return res.json({ requests });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
