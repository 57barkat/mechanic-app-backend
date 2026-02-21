import { Request as ExRequest, Response } from "express";
import { AppDataSource } from "../config/db";
import { User, UserRole } from "../entities/User";
import { Request as JobRequest } from "../entities/Request";
import { Offer } from "../entities/Offer";
import { io, onlineMechanics } from "../index";
import { getDistance } from "geolib";
import { Not, IsNull } from "typeorm";
import { AppSetting } from "../entities/AppSetting";

interface AuthRequest extends ExRequest {
  user?: User;
}

const ACTIVE_STATUSES = ["pending", "accepted", "arrived", "working"];

export const createRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { problemType, lat, lng, description } = req.body;
    const user = req.user as User;

    if (!lat || !lng || !problemType || !description) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);

    const onlineHelpers = await userRepo.find({
      where: {
        role: UserRole.HELPER,
        isOnline: true,
        isBusy: false,
        lat: Not(IsNull()),
        lng: Not(IsNull()),
      },
    });

    let suggestedPrice = 100;
    if (onlineHelpers.length > 0) {
      const distances = onlineHelpers.map((h) =>
        getDistance(
          { latitude: lat, longitude: lng },
          { latitude: h.lat!, longitude: h.lng! },
        ),
      );
      const nearestDistanceKm = Math.min(...distances) / 1000;
      suggestedPrice += nearestDistanceKm * 50;
    }

    const newRequest = requestRepo.create({
      user,
      problemType,
      description,
      lat,
      lng,
      status: "pending",
      suggestedPrice,
    });

    await requestRepo.save(newRequest);

    for (const mechanic of onlineMechanics.values()) {
      const mechUser = await userRepo.findOneBy({ id: mechanic.userId });
      if (!mechUser || mechUser.isBusy) continue;

      io.to(mechanic.socketId).emit("request:new", {
        requestId: newRequest.id,
        userId: user.id,
        userName: user.name,
        problemType,
        description,
        lat,
        lng,
        suggestedPrice,
      });
    }

    return res.status(201).json({
      message: "Request created",
      request: {
        id: newRequest.id,
        userId: user.id,
        userName: user.name,
        problemType,
        description,
        lat,
        lng,
        suggestedPrice,
        status: newRequest.status,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

export const makeOffer = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId, offeredPrice } = req.body;
    const mechanic = req.user as User;

    if (!requestId || !offeredPrice) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const offerRepo = AppDataSource.getRepository(Offer);

    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user"],
    });

    if (!request || !ACTIVE_STATUSES.includes(request.status))
      return res.status(400).json({ message: "Request not active" });

    if (request.helper)
      return res.status(400).json({ message: "Request already accepted" });

    const existingOffer = await offerRepo.findOne({
      where: { request: { id: requestId }, mechanic: { id: mechanic.id } },
    });
    if (existingOffer)
      return res.status(400).json({ message: "Offer already sent" });

    const distanceKm =
      mechanic.lat && mechanic.lng
        ? getDistance(
            { latitude: mechanic.lat, longitude: mechanic.lng },
            { latitude: request.lat, longitude: request.lng },
          ) / 1000
        : null;

    const offer = offerRepo.create({ mechanic, request, offeredPrice });
    await offerRepo.save(offer);

    io.to(`user_${request.user.id}`).emit("offer:new", {
      id: offer.id,
      requestId: request.id,
      offeredPrice,
      distanceKm: distanceKm ? Number(distanceKm.toFixed(2)) : null,
      helper: {
        userId: mechanic.id,
        name: mechanic.name,
        lat: mechanic.lat,
        lng: mechanic.lng,
        rating: mechanic.rating || 0,
        ratingCount: mechanic.ratingCount || 0,
      },
    });

    return res.json({ message: "Offer sent", offerId: offer.id });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const acceptOffer = async (req: AuthRequest, res: Response) => {
  try {
    const { offerId } = req.body;
    const user = req.user as User;

    const offerRepo = AppDataSource.getRepository(Offer);
    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);

    const offer = await offerRepo.findOne({
      where: { id: offerId },
      relations: ["request", "request.user", "mechanic"],
    });

    if (!offer || !ACTIVE_STATUSES.includes(offer.request.status))
      return res.status(400).json({ message: "Request not active" });

    if (offer.request.user.id !== user.id)
      return res.status(403).json({ message: "Forbidden" });

    offer.accepted = true;
    await offerRepo.save(offer);

    const request = offer.request;
    request.status = "accepted";
    request.helper = offer.mechanic;
    await requestRepo.save(request);

    await userRepo.update({ id: offer.mechanic.id }, { isBusy: true });

    io.emit("request:unavailable", { requestId: request.id });

    const navigationData = {
      requestId: request.id,
      userLocation: { lat: request.lat, lng: request.lng },
      helperLocation: { lat: offer.mechanic.lat, lng: offer.mechanic.lng },
      offeredPrice: offer.offeredPrice,
    };

    io.to(`user_${user.id}`).emit("ride:started", navigationData);
    io.to(`mechanic_${offer.mechanic.id}`).emit("ride:started", navigationData);

    // FIXED: Returning exact structure frontend expects
    return res.json({
      message: "Offer accepted",
      request: { id: request.id },
      navigationData: navigationData,
    });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const helperArrived = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.body;
    const helper = req.user as User;

    const repo = AppDataSource.getRepository(JobRequest);
    const request = await repo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request || !ACTIVE_STATUSES.includes(request.status))
      return res.status(400).json({ message: "Request not active" });

    if (request.helper?.id !== helper.id)
      return res.status(403).json({ message: "Forbidden" });

    request.status = "arrived";
    await repo.save(request);

    io.to(`user_${request.user.id}`).emit("helper:arrived", { requestId });

    return res.json({ message: "Arrived" });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const helperStartWork = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.body;
    const helper = req.user as User;

    const repo = AppDataSource.getRepository(JobRequest);
    const request = await repo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request || !ACTIVE_STATUSES.includes(request.status))
      return res.status(400).json({ message: "Request not active" });

    if (request.helper?.id !== helper.id)
      return res.status(403).json({ message: "Forbidden" });

    request.status = "working";
    await repo.save(request);

    io.to(`user_${request.user.id}`).emit("helper:working", { requestId });

    return res.json({ message: "Working" });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const helperWorkDone = async (req: AuthRequest, res: Response) => {
  const queryRunner = AppDataSource.createQueryRunner();
  console.log("==== helperWorkDone START ====");

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const { requestId, finalPrice } = req.body;
    const helperUser = req.user as User;
    const totalAmount = parseFloat(finalPrice);

    if (!requestId || isNaN(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({ message: "Invalid final price" });
    }

    const requestRepo = queryRunner.manager.getRepository(JobRequest);
    const userRepo = queryRunner.manager.getRepository(User);
    const settingRepo = queryRunner.manager.getRepository(AppSetting);

    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper", "offers"],
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (totalAmount < (request?.suggestedPrice || 0)) {
      return res.status(400).json({
        message: `Price cannot be lower than Rs ${request.suggestedPrice}`,
      });
    }

    if (!ACTIVE_STATUSES.includes(request.status)) {
      return res.status(400).json({ message: "Request not active" });
    }

    if (request.helper?.id !== helperUser.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const commissionSetting = await settingRepo.findOneBy({
      key: "commission_percent",
    });

    let commissionPercent = 0;
    if (commissionSetting?.value) {
      commissionPercent =
        parseFloat(
          commissionSetting.value.toString().replace("%", "").trim(),
        ) || 0;
    }

    const commissionAmount = (totalAmount * commissionPercent) / 100;
    const mechanicEarning = totalAmount - commissionAmount;

    request.status = "completed";
    request.finalPrice = totalAmount;
    await requestRepo.save(request);

    const helperProfile = await userRepo.findOne({
      where: { id: helperUser.id },
    });

    if (!helperProfile) {
      return res.status(404).json({ message: "Helper not found" });
    }

    helperProfile.totalEarnings =
      (Number(helperProfile.totalEarnings) || 0) + mechanicEarning;
    helperProfile.availableBalance =
      (Number(helperProfile.availableBalance) || 0) + mechanicEarning;
    helperProfile.pendingBalance =
      (Number(helperProfile.pendingBalance) || 0) + commissionAmount;
    helperProfile.isBusy = false;

    await userRepo.save(helperProfile);

    // COMMIT FIRST
    await queryRunner.commitTransaction();

    // === RESTORED SOCKET EVENTS ===

    // 1. Notify the User (Triggers the Rating Screen)
    io.to(`user_${request.user.id}`).emit("helper:completed", {
      requestId,
      finalPrice: totalAmount,
    });

    // 2. Update Helper's Stats (Live updates their earnings/rating)
    io.to(`mechanic_${helperProfile.id}`).emit("stats:update", {
      earnings: helperProfile.totalEarnings,
      rating: helperProfile.rating,
      count: helperProfile.ratingCount,
      commission: helperProfile.pendingBalance, // Useful to keep this updated too
    });

    // 3. Clean up the room
    io.in(`request_${request.id}`).socketsLeave(`request_${request.id}`);
    // ===============================

    return res.json({ message: "Completed successfully" });
  } catch (err: any) {
    await queryRunner.rollbackTransaction();
    return res.status(500).json({
      message: "Server error",
      error: err?.message,
    });
  } finally {
    await queryRunner.release();
    console.log("==== helperWorkDone END ====");
  }
};

export const cancelRide = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.body;
    const user = req.user as User;

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);

    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request || !ACTIVE_STATUSES.includes(request.status))
      return res.status(400).json({ message: "Request not active" });

    const isUser = request.user.id === user.id;
    const isHelper = request.helper?.id === user.id;
    if (!isUser && !isHelper)
      return res.status(403).json({ message: "Forbidden" });

    request.status = "cancelled";
    await requestRepo.save(request);

    io.emit("request:unavailable", { requestId: request.id });

    if (request.helper)
      await userRepo.update({ id: request.helper.id }, { isBusy: false });

    io.to(`request_${request.id}`).emit("ride:cancelled", { requestId });
    io.to(`user_${request.user.id}`).emit("ride:cancelled", { requestId });
    if (request.helper)
      io.to(`mechanic_${request.helper.id}`).emit("ride:cancelled", {
        requestId,
      });

    io.in(`request_${request.id}`).socketsLeave(`request_${request.id}`);

    return res.json({ message: "Ride cancelled" });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

export const userRateHelper = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId, rating } = req.body;
    const user = req.user as User;

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);

    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["helper", "user"],
    });

    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.rating)
      return res.status(400).json({ message: "Already rated" });

    request.rating = Number(rating);
    await requestRepo.save(request);

    if (request.helper) {
      const helper = request.helper;
      const currentRating = Number(helper.rating) || 0;
      const currentCount = Number(helper.ratingCount) || 0;
      const newRatingInput = Number(rating);

      const newCount = currentCount + 1;
      const newAverage =
        (currentRating * currentCount + newRatingInput) / newCount;

      helper.rating = parseFloat(newAverage.toFixed(2));
      helper.ratingCount = newCount;
      await userRepo.save(helper);

      io.to(`mechanic_${helper.id}`).emit("stats:update", {
        rating: helper.rating,
        earnings: helper.totalEarnings,
        count: helper.ratingCount,
      });
    }

    return res.json({ message: "Rating saved" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};
