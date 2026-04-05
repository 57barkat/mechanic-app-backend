import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { In, IsNull } from "typeorm";
import authRoutes from "./routes/auth.routes";
import requestRoutes from "./routes/request.routes";
import { User, UserRole } from "./entities/User";
import { Request as JobRequest } from "./entities/Request";
import paymentRoutes from "./routes/payment.routes";
import { AppDataSource } from "./config/db";

dotenv.config();

const app = express();
const server = http.createServer(app);
export const io = new Server(server, {
  path: "/socket.io",
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// --- HELPER CONSTANTS & FUNCTIONS ---
const ACTIVE_STATUSES = ["pending", "accepted", "arrived", "working"];
const MAX_DISTANCE_KM = 5;

const getDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

interface OnlineMechanic {
  socketId: string;
  userId: number;
  lat: number | null;
  lng: number | null;
  isBusy: boolean;
}

export const onlineMechanics = new Map<number, OnlineMechanic>();

let lastEmitTime = 0;
const EMIT_INTERVAL = 5000;
let emitTimeout: NodeJS.Timeout | null = null;

const performEmit = () => {
  const list = Array.from(onlineMechanics.values()).filter(
    (m) => m.lat !== null && m.lng !== null && !m.isBusy,
  );
  io.emit("mechanics:update", list);
  lastEmitTime = Date.now();
  if (emitTimeout) {
    clearTimeout(emitTimeout);
    emitTimeout = null;
  }
};

const emitMechanicsThrottled = () => {
  const now = Date.now();
  if (now - lastEmitTime >= EMIT_INTERVAL) {
    performEmit();
  } else if (!emitTimeout) {
    const delay = EMIT_INTERVAL - (now - lastEmitTime);
    emitTimeout = setTimeout(performEmit, delay);
  }
};

// --- ASYNC STARTUP WRAPPER ---
const startServer = async () => {
  try {
    // 1. Wait for DB to be 100% ready
    await AppDataSource.initialize();
    console.log("✅ [DB] Database connected and Metadata loaded successfully");

    // 2. Setup Middleware
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 3. Setup Routes
    app.use("/api/auth", authRoutes);
    app.use("/api/request", requestRoutes);
    app.use("/api/admin", require("./routes/admin.routes").default);
    app.use("/api/payments", paymentRoutes);

    // 4. Socket.io Middleware
    io.use(async (socket: Socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("No token"));
        const payload: any = jwt.verify(
          token,
          process.env.JWT_SECRET || "fallback_secret",
        );
        (socket as any).userId = payload.id;
        next();
      } catch (err) {
        next(new Error("Auth error"));
      }
    });

    // 5. Socket.io Events
    io.on("connection", async (socket: Socket) => {
      const userId = (socket as any).userId;

      // Clean up rooms
      const userRooms = Array.from(socket.rooms);
      userRooms.forEach((room) => {
        if (room.startsWith("request_")) socket.leave(room);
      });

      socket.join(`user_${userId}`);
      socket.join(`mechanic_${userId}`);

      const userRepo = AppDataSource.getRepository(User);
      const requestRepo = AppDataSource.getRepository(JobRequest);

      const dbUser = await userRepo.findOneBy({ id: userId });
      const activeReq = await requestRepo.findOne({
        where: [
          { user: { id: userId }, status: In(ACTIVE_STATUSES) },
          {
            helper: { id: userId },
            status: In(["accepted", "arrived", "working"]),
          },
        ],
        relations: ["helper", "user"],
      });

      if (activeReq) {
        socket.join(`request_${activeReq.id}`);
      }

      socket.on("ride:location_update", ({ requestId, lat, lng }) => {
        if (!requestId || !lat || !lng) return;
        socket.to(`request_${requestId}`).emit("ride:peer_location", {
          senderId: userId,
          lat,
          lng,
        });
      });

      socket.emit("ride:sync", {
        isOnline: dbUser?.isOnline || false,
        requestId: activeReq?.id || null,
        status: activeReq?.status || null,
        hideOffers: activeReq && activeReq.status !== "pending",
      });

      if (dbUser?.role === UserRole.HELPER && dbUser.isOnline) {
        onlineMechanics.set(userId, {
          socketId: socket.id,
          userId,
          lat: dbUser.lat || null,
          lng: dbUser.lng || null,
          isBusy: dbUser.isBusy || false,
        });
        performEmit();
      }

      socket.on("mechanic:online", async () => {
        const helperProfile = await userRepo.findOneBy({ id: userId });
        if (helperProfile) {
          helperProfile.isOnline = true;
          helperProfile.isBusy = false;
          await userRepo.save(helperProfile);
          onlineMechanics.set(userId, {
            socketId: socket.id,
            userId,
            lat: helperProfile.lat || null,
            lng: helperProfile.lng || null,
            isBusy: false,
          });

          socket.emit("stats:update", {
            rating: helperProfile.rating,
            earnings: helperProfile.totalEarnings,
            count: helperProfile.ratingCount,
            commission: helperProfile.pendingBalance,
          });

          const pendingRequests = await requestRepo.find({
            where: { status: "pending", helper: IsNull() },
            relations: ["user"],
            order: { createdAt: "DESC" },
            take: 15,
          });

          pendingRequests.forEach((req) => {
            if (
              req.user.id !== userId &&
              req.lat &&
              req.lng &&
              helperProfile.lat &&
              helperProfile.lng
            ) {
              const distance = getDistance(
                helperProfile.lat,
                helperProfile.lng,
                req.lat,
                req.lng,
              );
              if (distance <= MAX_DISTANCE_KM) {
                socket.emit("request:new", {
                  requestId: req.id,
                  userId: req.user.id,
                  userName: req.user.name,
                  problemType: req.problemType,
                  description: req.description,
                  areaName: (req as any).areaName,
                  lat: req.lat,
                  lng: req.lng,
                  suggestedPrice: req.suggestedPrice,
                  status: req.status || "pending",
                  distance: distance.toFixed(1),
                });
              }
            }
          });
        }
        performEmit();
      });

      socket.on("mechanic:offline", async () => {
        const helperProfile = await userRepo.findOneBy({ id: userId });
        if (helperProfile) {
          helperProfile.isOnline = false;
          helperProfile.isBusy = false;
          await userRepo.save(helperProfile);
        }
        onlineMechanics.delete(userId);
        performEmit();
      });

      socket.on("mechanic:location", async ({ lat, lng }) => {
        let mech = onlineMechanics.get(userId);
        if (!mech) {
          const dbUser = await userRepo.findOneBy({ id: userId });
          onlineMechanics.set(userId, {
            socketId: socket.id,
            userId,
            lat,
            lng,
            isBusy: dbUser?.isBusy || false,
          });
          mech = onlineMechanics.get(userId);
        }
        if (mech) {
          mech.lat = lat;
          mech.lng = lng;
          await userRepo.update({ id: userId }, { lat, lng });
          emitMechanicsThrottled();
        }
      });

      socket.on("ride:cancel", async ({ requestId }) => {
        const request = await requestRepo.findOne({
          where: { id: requestId },
          relations: ["user", "helper"],
        });
        if (!request || !ACTIVE_STATUSES.includes(request.status)) return;
        if (request.user.id !== userId && request.helper?.id !== userId) return;

        request.status = "cancelled";
        await requestRepo.save(request);

        if (request.helper) {
          await userRepo.update({ id: request.helper.id }, { isBusy: false });
          const mech = onlineMechanics.get(request.helper.id);
          if (mech) mech.isBusy = false;
        }

        io.to(`request_${requestId}`).emit("ride:cancelled", {
          requestId,
          cancelledBy: userId,
        });
        io.emit("request:unavailable", { requestId });
        io.to(`user_${request.user.id}`).emit("offers:clear");
        io.in(`request_${requestId}`).socketsLeave(`request_${requestId}`);
        performEmit();
      });

      socket.on("disconnect", async () => {
        if (onlineMechanics.has(userId)) {
          onlineMechanics.delete(userId);
          await userRepo.update({ id: userId }, { isOnline: false });
          performEmit();
        }
      });
    });

    // 6. Final Step: Start listening on port
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () =>
      console.log(`🚀 [SERVER] Running on port ${PORT}`),
    );
  } catch (error) {
    console.error("❌ [FATAL] Server failed to start:", error);
    process.exit(1);
  }
};

// Start the app
startServer();
