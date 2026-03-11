import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { User, UserRole } from "../entities/User";
import { Request as JobRequest } from "../entities/Request";
import { AppSetting } from "../entities/AppSetting";
import { onlineMechanics } from "..";

export const getStats = async (req: Request, res: Response) => {
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

    const rawData = await requestRepo
      .createQueryBuilder("request")
      .select("DATE_TRUNC('day', request.createdAt)", "day")
      .addSelect("COUNT(*)", "count")
      .where("request.createdAt >= NOW() - INTERVAL '7 days'")
      .groupBy("day")
      .orderBy("day", "ASC")
      .getRawMany();

    const chartData = rawData.map((item) => ({
      name: new Date(item.day).toLocaleDateString("en-US", {
        weekday: "short",
      }),
      requests: parseInt(item.count),
    }));

    return res.json({
      counts: { totalUsers, totalHelpers, pendingHelpers },
      chartData,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const users = await userRepo.find({ where: { role: UserRole.USER } });
    return res.json({ users });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateUser = async (req: Request, res: Response) => {
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
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOne({
      where: { id: userId, role: UserRole.USER },
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    await userRepo.remove(user);

    return res.json({ message: "User deleted" });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const getHelpers = async (req: Request, res: Response) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const helpers = await userRepo.find({ where: { role: UserRole.HELPER } });
    return res.json({ helpers });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const getPendingHelpers = async (req: Request, res: Response) => {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const pendingHelpers = await userRepo.find({
      where: { role: UserRole.HELPER, isVerified: false },
    });
    return res.json({ pendingHelpers });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const verifyHelper = async (req: Request, res: Response) => {
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
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const getCommission = async (req: Request, res: Response) => {
  try {
    const repo = AppDataSource.getRepository(AppSetting);
    const setting = await repo.findOneBy({ key: "commission_percent" });

    return res.json({
      commission: setting ? Number(setting.value) : 0,
    });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateCommission = async (req: Request, res: Response) => {
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
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const getRequests = async (req: Request, res: Response) => {
  try {
    const requestRepo = AppDataSource.getRepository(JobRequest);
    const requests = await requestRepo.find({
      relations: ["user", "helper", "offers"],
    });
    return res.json({ requests });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const getOnlineHelpers = async (req: Request, res: Response) => {
  try {
    const userRepo = AppDataSource.getRepository(User);

    const onlineIds = Array.from(onlineMechanics.keys());

    if (onlineIds.length === 0) {
      return res.json({ helpers: [] });
    }

    const helpers = await userRepo.findByIds(onlineIds);

    const result = helpers.map((helper) => {
      const liveData = onlineMechanics.get(helper.id);

      return {
        id: helper.id,
        name: helper.name,
        email: helper.email,
        lat: liveData?.lat ?? helper.lat,
        lng: liveData?.lng ?? helper.lng,
        rating: helper.rating,
        ratingCount: helper.ratingCount,
        totalEarnings: helper.totalEarnings,
        isBusy: helper.isBusy,
        isOnline: helper.isOnline,
      };
    });

    return res.json({ helpers: result });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};
