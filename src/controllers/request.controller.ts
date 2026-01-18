import { Request as ExRequest, Response } from "express";
import { AppDataSource } from "../config/db";
import { User, UserRole } from "../entities/User";
import { Request as JobRequest } from "../entities/Request";
import { Offer } from "../entities/Offer";
import { io } from "../index";
import { getDistance } from "geolib";
import { Not, IsNull } from "typeorm";

interface AuthRequest extends ExRequest {
  user?: User; // extended req.user
}

export const createRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { problemType, lat, lng, description } = req.body;
    const user = req.user as User;

    if (!lat || !lng || !problemType || !description) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);

    // find online helpers
    const onlineHelpers = await userRepo.find({
      where: {
        role: UserRole.HELPER,
        isOnline: true,
        lat: Not(IsNull()),
        lng: Not(IsNull()),
      },
    });

    // calculate suggested price based on distance
    let suggestedPrice = 100;

    if (onlineHelpers.length > 0) {
      const distances = onlineHelpers.map((h) =>
        getDistance(
          { latitude: lat, longitude: lng },
          { latitude: h.lat!, longitude: h.lng! }
        )
      );

      const nearestDistanceKm = Math.min(...distances) / 1000;
      suggestedPrice += nearestDistanceKm * 50;
    }

    // create request
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
    console.log(req.body);
    console.log(newRequest);
    console.log(`✅ New request created by user ${user.id}`);

    // emit to helpers WITH user name & location
    io.emit("request:new", {
      requestId: newRequest.id,
      userId: user.id,
      userName: user.name, // ✅ IMPORTANT
      problemType,
      description,
      lat,
      lng,
      suggestedPrice,
    });

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
    console.error(err);
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

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    // ❌ Prevent duplicate offers by same helper
    const existingOffer = await offerRepo.findOne({
      where: {
        request: { id: requestId },
        mechanic: { id: mechanic.id },
      },
    });

    if (existingOffer) {
      return res.status(400).json({ message: "Offer already sent" });
    }

    // ✅ Calculate distance (helper → user)
    const distanceKm =
      mechanic.lat && mechanic.lng
        ? getDistance(
            { latitude: mechanic.lat, longitude: mechanic.lng },
            { latitude: request.lat, longitude: request.lng }
          ) / 1000
        : null;

    // ✅ Create offer
    const offer = offerRepo.create({
      mechanic,
      request,
      offeredPrice,
    });

    await offerRepo.save(offer);

    console.log(
      `🟢 Mechanic ${mechanic.id} offered $${offeredPrice} for request ${request.id}`
    );

    // ✅ Emit full offer data to USER
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

    return res.json({
      message: "Offer sent",
      offerId: offer.id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ================= ACCEPT OFFER ================= */
export const acceptOffer = async (req: AuthRequest, res: Response) => {
  try {
    const { offerId } = req.body;
    const user = req.user as User;

    const offerRepo = AppDataSource.getRepository(Offer);
    const requestRepo = AppDataSource.getRepository(JobRequest);

    const offer = await offerRepo.findOne({
      where: { id: offerId },
      relations: ["request", "request.user", "mechanic"],
    });

    if (!offer) return res.status(404).json({ message: "Offer not found" });

    // SECURITY: Prevent someone else from accepting this offer
    if (offer.request.user.id !== user.id)
      return res.status(403).json({ message: "Forbidden" });

    // SECURITY: Prevent double acceptance
    if (offer.request.status !== "pending")
      return res.status(400).json({ message: "Request already handled" });

    offer.accepted = true;
    await offerRepo.save(offer);

    offer.request.status = "accepted";
    offer.request.helper = offer.mechanic;
    await requestRepo.save(offer.request);

    const navigationData = {
      requestId: offer.request.id,
      userLocation: { lat: offer.request.lat, lng: offer.request.lng },
      helperLocation: { lat: offer.mechanic.lat, lng: offer.mechanic.lng },
    };

    // Use the specific user/mechanic rooms we defined in index.ts
    io.to(`user_${user.id}`).emit("ride:started", navigationData);
    io.to(`mechanic_${offer.mechanic.id}`).emit("ride:started", navigationData);

    return res.json({
      message: "Offer accepted",
      request: { id: offer.request.id },
      navigationData,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
};
/* ================= HELPER REACHED ================= */
export const helperArrived = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.body;
    const helper = req.user as User;

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.helper?.id !== helper.id)
      return res.status(403).json({ message: "Forbidden" });

    request.status = "arrived";
    await requestRepo.save(request);

    // Notify user that helper has arrived
    io.to(`user_${request.user.id}`).emit("helper:arrived", {
      requestId: request.id,
    });

    return res.json({ message: "Marked as arrived", request });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ================= HELPER START WORK ================= */
export const helperStartWork = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.body;
    const helper = req.user as User;

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.helper?.id !== helper.id)
      return res.status(403).json({ message: "Forbidden" });

    request.status = "working";
    await requestRepo.save(request);

    // Notify user that work has started
    io.to(`user_${request.user.id}`).emit("helper:working", {
      requestId: request.id,
    });

    return res.json({ message: "Work started", request });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ================= HELPER WORK DONE ================= */
export const helperWorkDone = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId, finalPrice } = req.body;
    const helperUser = req.user as User;
    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);

    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request || request.helper?.id !== helperUser.id) {
      return res
        .status(403)
        .json({ message: "Unauthorized or request not found" });
    }

    request.status = "completed";
    request.finalPrice = finalPrice;
    await requestRepo.save(request);

    // Update Helper Profile and get fresh data
    const helperProfile = await userRepo.findOne({
      where: { id: helperUser.id },
    });
    if (helperProfile) {
      helperProfile.totalEarnings =
        (Number(helperProfile.totalEarnings) || 0) + Number(finalPrice);
      await userRepo.save(helperProfile);

      // Notify Helper of updated earnings immediately
      io.to(`mechanic_${helperProfile.id}`).emit("stats:update", {
        earnings: helperProfile.totalEarnings,
        rating: helperProfile.rating,
        count: helperProfile.ratingCount,
      });
    }

    io.to(`user_${request.user.id}`).emit("helper:completed", {
      requestId: request.id,
      finalPrice,
    });

    return res.json({
      message: "Work completed",
      totalEarnings: helperProfile?.totalEarnings,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const userRateHelper = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId, rating } = req.body;
    console.log("Rating received:", req.body);
    const user = req.user as User;

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);

    // 1. Fetch request AND the helper object
    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["helper", "user"],
    });

    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.rating)
      return res.status(400).json({ message: "Already rated" });

    // 2. Save rating to the request
    request.rating = Number(rating);
    await requestRepo.save(request);

    // 3. Update Helper Profile
    if (request.helper) {
      const helper = request.helper;

      // Force conversion to numbers to be safe
      const currentRating = Number(helper.rating) || 0;
      const currentCount = Number(helper.ratingCount) || 0;
      const newRatingInput = Number(rating);

      const newCount = currentCount + 1;
      const newAverage =
        (currentRating * currentCount + newRatingInput) / newCount;

      // Update helper fields
      helper.rating = parseFloat(newAverage.toFixed(2));
      helper.ratingCount = newCount;

      // SAVE THE HELPER
      await userRepo.save(helper);

      console.log(
        `✅ DB UPDATED: Helper ${helper.id} now has rating ${helper.rating}`
      );

      // 4. Send updated stats to helper via Socket
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
