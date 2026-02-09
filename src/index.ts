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
import { User } from "./entities/User";
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
});

interface OnlineMechanic {
  socketId: string;
  userId: number;
  lat: number | null;
  lng: number | null;
}

const onlineMechanics = new Map<number, OnlineMechanic>();

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
    (m) => m.lat !== null && m.lng !== null
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
      process.env.JWT_SECRET || "fallback_secret"
    );
    (socket as any).userId = payload.id;
    next();
  } catch {
    next(new Error("Auth error"));
  }
});

io.on("connection", async (socket: Socket) => {
  const userId = (socket as any).userId;

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

  socket.emit("ride:sync", {
    isOnline: dbUser?.isOnline || false,
    requestId: activeReq?.id || null,
    status: activeReq?.status || null,
  });

  if (activeReq) {
    socket.join(`request_${activeReq.id}`);
  }

  const currentList = Array.from(onlineMechanics.values()).filter(
    (m) => m.lat && m.lng
  );
  socket.emit("mechanics:update", currentList);

  socket.on("mechanic:online", async () => {
    onlineMechanics.set(userId, {
      socketId: socket.id,
      userId,
      lat: null,
      lng: null,
    });
    await userRepo.update({ id: userId }, { isOnline: true });

    const helperProfile = await userRepo.findOneBy({ id: userId });
    if (helperProfile) {
      socket.emit("stats:update", {
        rating: helperProfile.rating || 0,
        earnings: helperProfile.totalEarnings || 0,
        count: helperProfile.ratingCount || 0,
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
    onlineMechanics.delete(userId);
    await userRepo.update({ id: userId }, { isOnline: false });
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

    io.in(`request_${requestId}`).socketsLeave(`request_${requestId}`);
  });

  socket.on("disconnect", () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
