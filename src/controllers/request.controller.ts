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

/* ================= CREATE REQUEST ================= */
export const createRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { problemType, lat, lng, description } = req.body;
    const user = req.user as User;

    if (!lat || !lng || !problemType) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const repo = AppDataSource.getRepository(JobRequest);
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
      const nearestDistance = Math.min(...distances) / 1000; // km
      suggestedPrice += nearestDistance * 50;
    }

    const newRequest = repo.create({
      user,
      problemType,
      description,
      lat,
      lng,
      status: "pending",
      suggestedPrice,
    });

    await repo.save(newRequest);

    console.log(`✅ New request created by user ${user.id}`);

    // emit request to all online helpers
    io.emit("request:new", {
      requestId: newRequest.id,
      userId: user.id,
      problemType,
      description,
      lat,
      lng,
      suggestedPrice,
    });

    return res
      .status(201)
      .json({ message: "Request created", request: newRequest });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ================= MAKE OFFER ================= */
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

    if (!request) return res.status(404).json({ message: "Request not found" });

    const offer = offerRepo.create({ mechanic, request, offeredPrice });
    await offerRepo.save(offer);

    console.log(
      `🟢 Mechanic ${mechanic.id} made offer for request ${request.id}: ${offeredPrice}`
    );
    io.to(`user_${request.user.id}`).emit("offer:new", {
      id: offer.id,
      offeredPrice,
      mechanic: {
        userId: mechanic.id,
        name: mechanic.name,
      },
    });

    return res.json({ message: "Offer sent", offer });
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

    // 1. Find the request
    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request || request.helper?.id !== helperUser.id) {
      return res
        .status(403)
        .json({ message: "Unauthorized or request not found" });
    }

    if (request.status === "completed") {
      return res
        .status(400)
        .json({ message: "Job already marked as completed" });
    }

    // 2. Update Request details
    request.status = "completed";
    request.finalPrice = finalPrice;
    await requestRepo.save(request);

    // 3. Update Helper's Lifetime Earnings
    // We fetch a fresh copy of the helper to ensure data integrity
    const helperProfile = await userRepo.findOne({
      where: { id: helperUser.id },
    });
    if (helperProfile) {
      helperProfile.totalEarnings =
        (helperProfile.totalEarnings || 0) + finalPrice;
      await userRepo.save(helperProfile);
    }

    // 4. Notify User
    io.to(`user_${request.user.id}`).emit("helper:completed", {
      requestId: request.id,
      finalPrice,
    });

    return res.json({
      message: "Work completed and earnings updated",
      totalEarnings: helperProfile?.totalEarnings,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ================= USER RATE HELPER ================= */
export const userRateHelper = async (req: AuthRequest, res: Response) => {
  try {
    const { requestId, rating } = req.body;
    const user = req.user as User;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Invalid rating value" });
    }

    const requestRepo = AppDataSource.getRepository(JobRequest);
    const userRepo = AppDataSource.getRepository(User);

    // 1. Find the request and the helper
    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });

    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.user.id !== user.id)
      return res.status(403).json({ message: "Forbidden" });
    if (request.rating)
      return res.status(400).json({ message: "Already rated" });

    // 2. Save rating to the Request (Transaction History)
    request.rating = rating;
    await requestRepo.save(request);

    // 3. Update the Helper's Profile Rating
    const helper = request.helper;
    if (helper) {
      const oldCount = helper.ratingCount || 0;
      const oldRating = helper.rating || 0;

      // Calculate new average
      const newCount = oldCount + 1;
      const newAverage = (oldRating * oldCount + rating) / newCount;

      helper.rating = parseFloat(newAverage.toFixed(2));
      helper.ratingCount = newCount;

      await userRepo.save(helper);

      // 4. Notify helper about rating via Socket
      io.to(`mechanic_${helper.id}`).emit("user:rating", {
        requestId: request.id,
        rating,
        newAverage: helper.rating,
      });
    }

    return res.json({ message: "Rating submitted and profile updated" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};
