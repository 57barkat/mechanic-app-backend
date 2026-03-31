import { Request as ExRequest, Response } from "express";
import { AppDataSource } from "../config/db";
import { Request as JobRequest } from "../entities/Request";
import { User } from "../entities/User";

interface AuthRequest extends ExRequest {
  user?: User;
}

export const getJobHistory = async (req: AuthRequest, res: Response) => {
  try {
    const helper = req.user as User;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const requestRepo = AppDataSource.getRepository(JobRequest);

    const [jobs, total] = await requestRepo.findAndCount({
      where: {
        helper: { id: helper.id },
        status: "completed",
      },
      order: { createdAt: "DESC" },
      skip: skip,
      take: limit,
      relations: ["user"],
    });

    return res.json({
      jobs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};
