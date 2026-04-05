import { Request as ExRequest, Response } from "express";
import { AppDataSource } from "../config/db";
import { User, UserRole } from "../entities/User";
import { Request as JobRequest } from "../entities/Request";
import { Offer } from "../entities/Offer";
import { io, onlineMechanics } from "../index";
import { getDistance } from "geolib";
import { Not, IsNull, In } from "typeorm";
import { AppSetting } from "../entities/AppSetting";

interface AuthRequest extends ExRequest {
  user?: User;
}

const ACTIVE_STATUSES = ["pending", "accepted", "arrived", "working"];
const PROBLEM_RATES: Record<string, { base: number; perKm: number }> = {
  "Flat Tire": { base: 150, perKm: 40 },
  "Battery Jump": { base: 100, perKm: 30 },
  "Engine Issue": { base: 300, perKm: 60 },
  "Fuel Delivery": { base: 80, perKm: 30 },
  "Tow Required": { base: 500, perKm: 100 },
  "Locked Out": { base: 120, perKm: 40 },
  "General Help": { base: 100, perKm: 25 },
};
export const createRequest = async (req: AuthRequest, res: Response) => {
  try {
    // Radius ko body se pakrein, agar nahi hai to default 5km rakhein
    const { problemType, lat, lng, description, areaName, radius } = req.body;
    const searchRadius = radius || 5;

    const user = req.user as User;
    if (!lat || !lng || !problemType || !description) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);
    const offerRepo = AppDataSource.getRepository(Offer);

    // Pehle se pending requests ko cancel karein
    await requestRepo.update(
      { user: { id: user.id }, status: In(["pending", "accepted"]) },
      { status: "cancelled" },
    );
    io.to(`user_${user.id}`).emit("request:cleared_previous");

    // Database se online helpers nikalein (Price calculation ke liye)
    const onlineHelpers = await userRepo.find({
      where: {
        role: UserRole.HELPER,
        isOnline: true,
        isBusy: false,
        lat: Not(IsNull()),
        lng: Not(IsNull()),
      },
    });

    // Price Calculation Logic
    const config = PROBLEM_RATES[problemType] || { base: 100, perKm: 50 };
    let suggestedPrice = config.base;

    if (onlineHelpers.length > 0) {
      const distances = onlineHelpers.map((h) =>
        getDistance(
          { latitude: lat, longitude: lng },
          { latitude: h.lat!, longitude: h.lng! },
        ),
      );
      const nearestDistanceKm = Math.min(...distances) / 1000;
      suggestedPrice += nearestDistanceKm * config.perKm;
    }
    suggestedPrice = Math.round(suggestedPrice);

    // Naya Request create karein
    const newRequest = requestRepo.create({
      user,
      problemType,
      description,
      areaName,
      lat,
      lng,
      status: "pending",
      suggestedPrice,
    });
    await requestRepo.save(newRequest);

    // --- RADIUS FILTERING LOGIC ---
    let foundNearby = false;

    for (const mechanic of onlineMechanics.values()) {
      if (mechanic.isBusy || !mechanic.lat || !mechanic.lng) continue;

      // Distance calculate karein (KM mein)
      const dist =
        getDistance(
          { latitude: lat, longitude: lng },
          { latitude: mechanic.lat, longitude: mechanic.lng },
        ) / 1000;

      // Sirf select kiye gaye radius ke andar walay mechanics ko bhein
      if (dist <= searchRadius) {
        foundNearby = true;
        io.to(mechanic.socketId).emit("request:new", {
          requestId: newRequest.id,
          userId: user.id,
          userName: user.name,
          problemType,
          description,
          areaName,
          lat,
          lng,
          suggestedPrice,
          distance: dist.toFixed(1),
        });
      }
    }

    // Timeout logic (5 mins)
    setTimeout(
      async () => {
        try {
          const checkReq = await requestRepo.findOne({
            where: { id: newRequest.id },
            relations: ["user", "helper"],
          });
          if (checkReq && checkReq.status === "pending" && !checkReq.helper) {
            checkReq.status = "cancelled";
            await requestRepo.save(checkReq);
            await offerRepo.delete({ request: { id: checkReq.id } });
            io.emit("request:unavailable", { requestId: checkReq.id });
            io.to(`user_${checkReq.user.id}`).emit("ride:cancelled", {
              requestId: checkReq.id,
              reason: "timeout",
            });
          }
        } catch (timeoutErr) {
          console.error("Error in request timeout check:", timeoutErr);
        }
      },
      5 * 60 * 1000,
    );

    // Final Response: Agar koi mechanic radius mein nahi mila to "noNearbyFound" bhein
    return res.status(201).json({
      message: foundNearby
        ? "Request created"
        : "Request created but no one nearby",
      noNearbyFound: !foundNearby,
      currentRadius: searchRadius,
      request: {
        id: newRequest.id,
        userId: user.id,
        userName: user.name,
        problemType,
        description,
        areaName,
        lat,
        lng,
        suggestedPrice,
        status: newRequest.status,
      },
    });
  } catch (err) {
    console.error("Create Request Error:", err);
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

    if (!request || !ACTIVE_STATUSES.includes(request.status)) {
      return res.status(400).json({ message: "Request not active" });
    }

    if (request.helper) {
      return res.status(400).json({ message: "Request already accepted" });
    }

    // --- NEW COOLDOWN LOGIC START ---
    const lastOffer = await offerRepo.findOne({
      where: { request: { id: requestId }, mechanic: { id: mechanic.id } },
      order: { createdAt: "DESC" },
    });

    if (lastOffer) {
      const now = new Date();
      const lastTime = new Date(lastOffer.createdAt);
      const diffInSeconds = Math.floor(
        (now.getTime() - lastTime.getTime()) / 1000,
      );

      if (diffInSeconds < 60) {
        return res.status(429).json({
          message: `Please wait ${60 - diffInSeconds} seconds before updating your offer.`,
        });
      }
    }
    // --- NEW COOLDOWN LOGIC END ---

    const rawDistance =
      mechanic.lat && mechanic.lng
        ? getDistance(
            { latitude: mechanic.lat, longitude: mechanic.lng },
            { latitude: request.lat, longitude: request.lng },
          ) / 1000
        : null;

    const distanceKm = rawDistance ? parseFloat(rawDistance.toFixed(2)) : null;
    const finalOfferedPrice = Math.round(offeredPrice);

    const offer = offerRepo.create({
      mechanic,
      request,
      offeredPrice: finalOfferedPrice,
    });
    await offerRepo.save(offer);

    io.to(`user_${request.user.id}`).emit("offer:new", {
      id: offer.id,
      requestId: request.id,
      offeredPrice: finalOfferedPrice,
      distanceKm,
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
  } catch (err) {
    console.error("Make Offer Error:", err);
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

    if (!offer || offer.request.status !== "pending") {
      return res.status(400).json({ message: "Request no longer available" });
    }

    if (offer.request.user.id !== user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    offer.accepted = true;
    await offerRepo.save(offer);

    const request = offer.request;
    request.status = "accepted";
    request.helper = offer.mechanic;
    await requestRepo.save(request);

    // Sync Memory Map: Flag mechanic as busy so they disappear from map for others
    const mechInMemory = onlineMechanics.get(offer.mechanic.id);
    if (mechInMemory) {
      mechInMemory.isBusy = true;
    }

    await userRepo.update({ id: offer.mechanic.id }, { isBusy: true });

    await offerRepo.delete({
      request: { id: request.id },
      accepted: false,
    });

    io.emit("request:unavailable", { requestId: request.id });

    const navigationData = {
      requestId: request.id,
      userLocation: { lat: request.lat, lng: request.lng },
      helperLocation: { lat: offer.mechanic.lat, lng: offer.mechanic.lng },
      offeredPrice: Math.round(offer.offeredPrice),
      helperName: offer.mechanic.name,
    };

    io.to(`user_${user.id}`).emit("offers:clear", { requestId: request.id });
    io.to(`user_${user.id}`).emit("ride:started", navigationData);
    io.to(`mechanic_${offer.mechanic.id}`).emit("ride:started", navigationData);

    // Trigger a global update so the accepted mechanic is removed from all users' maps
    const activeList = Array.from(onlineMechanics.values()).filter(
      (m) => !m.isBusy,
    );
    io.emit("mechanics:update", activeList);

    return res.json({
      message: "Offer accepted",
      request: { id: request.id },
      navigationData: navigationData,
    });
  } catch (err) {
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

    if (!request || !ACTIVE_STATUSES.includes(request.status)) {
      return res.status(400).json({ message: "Request not active" });
    }

    if (request.helper?.id !== helper.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    request.status = "arrived";
    await repo.save(request);

    io.to(`user_${request.user.id}`).emit("helper:arrived", { requestId });

    return res.json({ message: "Arrived" });
  } catch (err) {
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

    if (!request || !ACTIVE_STATUSES.includes(request.status)) {
      return res.status(400).json({ message: "Request not active" });
    }

    if (request.helper?.id !== helper.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    request.status = "working";
    await repo.save(request);

    io.to(`user_${request.user.id}`).emit("helper:working", { requestId });

    return res.json({ message: "Working" });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

export const helperWorkDone = async (req: AuthRequest, res: Response) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const { requestId, finalPrice } = req.body;
    const helperUser = req.user as User;
    const totalAmount = Math.round(parseFloat(finalPrice));

    if (!requestId || isNaN(totalAmount) || totalAmount <= 0) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ message: "Invalid final price" });
    }

    const requestRepo = queryRunner.manager.getRepository(JobRequest);
    const userRepo = queryRunner.manager.getRepository(User);
    const settingRepo = queryRunner.manager.getRepository(AppSetting);

    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request || !ACTIVE_STATUSES.includes(request.status)) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ message: "Request not active" });
    }

    if (request.helper?.id !== helperUser.id) {
      await queryRunner.rollbackTransaction();
      return res.status(403).json({ message: "Forbidden" });
    }

    const commissionSetting = await settingRepo.findOneBy({
      key: "commission_percent",
    });
    let commissionPercent = 0;
    if (commissionSetting?.value) {
      commissionPercent = parseFloat(commissionSetting.value.toString()) || 0;
    }

    const commissionAmount = parseFloat(
      ((totalAmount * commissionPercent) / 100).toFixed(2),
    );

    request.status = "completed";
    request.finalPrice = totalAmount;
    await requestRepo.save(request);

    const helperProfile = await userRepo.findOne({
      where: { id: helperUser.id },
    });

    if (!helperProfile) {
      await queryRunner.rollbackTransaction();
      return res.status(404).json({ message: "Helper not found" });
    }

    helperProfile.totalEarnings = parseFloat(
      ((Number(helperProfile.totalEarnings) || 0) + totalAmount).toFixed(2),
    );
    helperProfile.pendingBalance = parseFloat(
      ((Number(helperProfile.pendingBalance) || 0) + commissionAmount).toFixed(
        2,
      ),
    );
    helperProfile.isBusy = false;
    await userRepo.save(helperProfile);

    // Sync Memory Map: Free the mechanic
    const mechInMemory = onlineMechanics.get(helperProfile.id);
    if (mechInMemory) {
      mechInMemory.isBusy = false;
    }

    await queryRunner.commitTransaction();

    io.to(`user_${request.user.id}`).emit("helper:completed", {
      requestId,
      finalPrice: totalAmount,
    });
    io.to(`mechanic_${helperProfile.id}`).emit("stats:update", {
      earnings: helperProfile.totalEarnings,
      rating: helperProfile.rating,
      count: helperProfile.ratingCount,
      pendingBalance: helperProfile.pendingBalance,
      availableBalance: helperProfile.availableBalance,
      commissionAmount,
    });

    // Notify other users that the mechanic is back on the map
    const activeList = Array.from(onlineMechanics.values()).filter(
      (m) => !m.isBusy,
    );
    io.emit("mechanics:update", activeList);

    return res.json({
      message: "Completed successfully",
      data: {
        finalPrice: totalAmount,
        commissionPercent,
        commissionAmount,
        helperEarned: totalAmount,
      },
    });
  } catch (err: any) {
    await queryRunner.rollbackTransaction();
    return res.status(500).json({ message: "Server error" });
  } finally {
    await queryRunner.release();
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

    if (!request || !ACTIVE_STATUSES.includes(request.status)) {
      return res.status(400).json({ message: "Request not active" });
    }

    const isUser = request.user.id === user.id;
    const isHelper = request.helper?.id === user.id;

    if (!isUser && !isHelper) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Identify who initiated the cancellation
    const cancelledByRole = isUser ? "user" : "helper";

    request.status = "cancelled";
    await requestRepo.save(request);

    // Global emit to clear it from other mechanics' lists
    io.emit("request:unavailable", { requestId: request.id });

    if (request.helper) {
      await userRepo.update({ id: request.helper.id }, { isBusy: false });
      const mechInMemory = onlineMechanics.get(request.helper.id);
      if (mechInMemory) {
        mechInMemory.isBusy = false;
      }
    }

    // Send the cancellation data including the role
    const cancelPayload = {
      requestId: request.id,
      cancelledByRole: cancelledByRole,
    };

    // Notify the User
    io.to(`user_${request.user.id}`).emit("ride:cancelled", cancelPayload);

    // Notify the Mechanic/Helper
    if (request.helper) {
      io.to(`mechanic_${request.helper.id}`).emit(
        "ride:cancelled",
        cancelPayload,
      );
    }

    // Update the live map for everyone
    const activeList = Array.from(onlineMechanics.values()).filter(
      (m) => !m.isBusy,
    );
    io.emit("mechanics:update", activeList);

    return res.json({
      message: "Ride cancelled successfully",
      cancelledByRole,
    });
  } catch (err) {
    console.error("Backend Cancel Error:", err);
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

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.rating) {
      return res.status(400).json({ message: "Already rated" });
    }

    request.rating = Math.round(Number(rating));
    await requestRepo.save(request);

    if (request.helper) {
      const helper = request.helper;
      const currentRating = Number(helper.rating) || 0;
      const currentCount = Number(helper.ratingCount) || 0;
      const newCount = currentCount + 1;
      const newAverage =
        (currentRating * currentCount + Number(rating)) / newCount;

      helper.rating = parseFloat(newAverage.toFixed(2));
      helper.ratingCount = newCount;
      await userRepo.save(helper);

      io.to(`mechanic_${helper.id}`).emit("stats:update", {
        rating: helper.rating,
        earnings: helper.totalEarnings,
        count: helper.ratingCount,
        commission: helper.pendingBalance,
      });
    }

    return res.json({ message: "Rating saved" });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};
