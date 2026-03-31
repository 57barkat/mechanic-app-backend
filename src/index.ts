import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { In, IsNull } from "typeorm";
import { AppDataSource } from "./config/db";
import authRoutes from "./routes/auth.routes";
import requestRoutes from "./routes/request.routes";
import { User, UserRole } from "./entities/User";
import { Request as JobRequest } from "./entities/Request";
import paymentRoutes from "./routes/payment.routes";

dotenv.config();

const ACTIVE_STATUSES = ["pending", "accepted", "arrived", "working"];

AppDataSource.initialize()
  .then(() => console.log("[DB] Database connected successfully"))
  .catch((err) => console.error("[DB] Database connection error:", err));

const app = express();

// Standard Middlewares
app.use(cors());

// Body Parsers: Necessary for JazzCash (urlencoded) and App (json)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/request", requestRoutes);
app.use("/api/admin", require("./routes/admin.routes").default);
app.use("/api/payments", paymentRoutes);

const server = http.createServer(app);
export const io = new Server(server, {
  path: "/socket.io",
  cors: { origin: "*", methods: ["GET", "POST"] },
});

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

const emitMechanicsThrottled = () => {
  const now = Date.now();
  if (now - lastEmitTime >= EMIT_INTERVAL) {
    performEmit();
  } else if (!emitTimeout) {
    const delay = EMIT_INTERVAL - (now - lastEmitTime);
    emitTimeout = setTimeout(performEmit, delay);
  }
};

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

io.on("connection", async (socket: Socket) => {
  const userId = (socket as any).userId;
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
      { helper: { id: userId }, status: In(ACTIVE_STATUSES) },
    ],
    relations: ["helper", "user"],
  });
  if (activeReq) {
    socket.join(`request_${activeReq.id}`);
  }
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
    }
    const pendingRequests = await requestRepo.find({
      where: { status: "pending", helper: IsNull() },
      relations: ["user"],
      order: { createdAt: "DESC" },
      take: 10,
    });
    pendingRequests.forEach((req) => {
      if (req.user.id !== userId) {
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
        });
      }
    });
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SERVER] Running on port ${PORT}`));
