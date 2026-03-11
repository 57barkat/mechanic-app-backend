import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { In } from "typeorm";
import { AppDataSource } from "./config/db";
import authRoutes from "./routes/auth.routes";
import requestRoutes from "./routes/request.routes";
import { User, UserRole } from "./entities/User";
import { Request as JobRequest } from "./entities/Request";

dotenv.config();

const ACTIVE_STATUSES = ["pending", "accepted", "arrived", "working"];

AppDataSource.initialize()
  .then(() => console.log("Database connected"))
  .catch((err) => console.error("DB error:", err));

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/request", requestRoutes);
app.use("/api/admin", require("./routes/admin.routes").default);

const server = http.createServer(app);
export const io = new Server(server, {
  path: "/socket.io",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 60000,
});

interface OnlineMechanic {
  socketId: string;
  userId: number;
  lat: number | null;
  lng: number | null;
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
    (m) => m.lat !== null && m.lng !== null,
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
  } catch {
    next(new Error("Auth error"));
  }
});

io.on("connection", async (socket: Socket) => {
  const userId = (socket as any).userId;
  console.log(`[SOCKET] User ${userId} connected on socket ${socket.id}`);

  // FIX: Force previous connections for this user to leave rooms to prevent "Double Connection Leak"
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
  });

  if (activeReq) {
    console.log(
      `[SOCKET] Active request found (ID: ${activeReq.id}). User ${userId} joining request_${activeReq.id}`,
    );
    socket.join(`request_${activeReq.id}`);
  }

  socket.emit("ride:sync", {
    isOnline: dbUser?.isOnline || false,
    requestId: activeReq?.id || null,
    status: activeReq?.status || null,
  });

  if (activeReq) {
    socket.join(`request_${activeReq.id}`);
  }

  /**
   * 🔥 CRITICAL FIX:
   * If helper reconnects and DB says he is online,
   * re-register him inside memory map.
   */
  if (
    dbUser?.role === UserRole.HELPER &&
    dbUser.isOnline &&
    !onlineMechanics.has(userId)
  ) {
    onlineMechanics.set(userId, {
      socketId: socket.id,
      userId,
      lat: dbUser.lat || null,
      lng: dbUser.lng || null,
    });

    performEmit();
  }

  socket.on("mechanic:online", async () => {
    await userRepo.update({ id: userId }, { isOnline: true, isBusy: false });

    const helperProfile = await userRepo.findOneBy({ id: userId });

    onlineMechanics.set(userId, {
      socketId: socket.id,
      userId,
      lat: helperProfile?.lat || null,
      lng: helperProfile?.lng || null,
    });

    if (helperProfile) {
      socket.emit("stats:update", {
        rating: helperProfile.rating || 0,
        earnings: helperProfile.totalEarnings || 0,
        count: helperProfile.ratingCount || 0,
        commission: helperProfile.pendingBalance || 0,
      });
    }

    const pendingRequests = await requestRepo.find({
      where: { status: "pending" },
      relations: ["user"],
      order: { createdAt: "DESC" },
      take: 10,
    });

    for (const req of pendingRequests) {
      socket.emit("request:new", {
        requestId: req.id,
        userId: req.user.id,
        userName: req.user.name,
        problemType: req.problemType,
        description: req.description,
        lat: req.lat,
        lng: req.lng,
        suggestedPrice: req.suggestedPrice,
        status: req.status || "pending",
      });
    }

    performEmit();
  });

  socket.on("mechanic:location", async ({ lat, lng }) => {
    const mech = onlineMechanics.get(userId);
    if (mech) {
      mech.lat = lat;
      mech.lng = lng;
      await userRepo.update({ id: userId }, { lat, lng });
      emitMechanicsThrottled();
    }
  });

  socket.on("mechanic:offline", async () => {
    const helper = await userRepo.findOneBy({ id: userId });
    if (helper) {
      const pending = Number(helper.pendingBalance) || 0;
      const available = Number(helper.availableBalance) || 0;

      await userRepo.update(
        { id: userId },
        {
          isOnline: false,
          isBusy: false,
          availableBalance: available + pending,
          pendingBalance: 0,
        },
      );
    }

    onlineMechanics.delete(userId);
    performEmit();
  });

  socket.on("ride:cancel", async ({ requestId }) => {
    const request = await requestRepo.findOne({
      where: { id: requestId },
      relations: ["user", "helper"],
    });
    if (!request) return;
    if (request.user.id !== userId && request.helper?.id !== userId) return;

    request.status = "cancelled";
    await requestRepo.save(request);

    io.to(`request_${requestId}`).emit("ride:cancelled", {
      requestId,
      cancelledBy: userId,
    });

    io.emit("request:unavailable", { requestId });
    io.in(`request_${requestId}`).socketsLeave(`request_${requestId}`);
  });

  /**
   * 🔥 FIXED DISCONNECT HANDLER
   * Keeps DB and memory synced.
   */
  socket.on("disconnect", async () => {
    if (onlineMechanics.has(userId)) {
      onlineMechanics.delete(userId);
      await userRepo.update({ id: userId }, { isOnline: false });
      performEmit();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
