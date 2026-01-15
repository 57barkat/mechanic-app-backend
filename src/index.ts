import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { AppDataSource } from "./config/db";
import authRoutes from "./routes/auth.routes";
import requestRoutes from "./routes/request.routes";
import { User } from "./entities/User";

dotenv.config();

/* ================= DATABASE ================= */
AppDataSource.initialize()
  .then(() => console.log("✅ Database connected"))
  .catch((err) => console.error("❌ DB error:", err));

/* ================= EXPRESS ================= */
const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/request", requestRoutes);

/* ================= SOCKET ================= */
const server = http.createServer(app);
export const io = new Server(server, {
  path: "/socket.io",
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/* ================= STATE ================= */
interface OnlineMechanic {
  socketId: string;
  userId: number;
  lat: number | null;
  lng: number | null;
}
const onlineMechanics = new Map<number, OnlineMechanic>();

const emitMechanics = () => {
  const list = Array.from(onlineMechanics.values()).filter(
    (m) => m.lat !== null && m.lng !== null
  );
  io.emit("mechanics:update", list);
};

/* ================= SOCKET AUTH ================= */
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
  } catch (err) {
    next(new Error("Auth error"));
  }
});

/* ================= CONNECTION ================= */
io.on("connection", (socket: Socket) => {
  const userId = (socket as any).userId;
  console.log(`🔌 Connected: ${socket.id} (User ${userId})`);

  // Join private rooms for user & mechanic
  socket.join(`user_${userId}`);
  socket.join(`mechanic_${userId}`);

  /* ========== HELPER ONLINE ========== */
  socket.on("mechanic:online", async () => {
    onlineMechanics.set(userId, {
      socketId: socket.id,
      userId,
      lat: null,
      lng: null,
    });
    await AppDataSource.getRepository(User).update(
      { id: userId },
      { isOnline: true }
    );
    emitMechanics();
  });

  socket.on("mechanic:location", async ({ lat, lng }) => {
    const mech = onlineMechanics.get(userId);
    if (mech) {
      mech.lat = lat;
      mech.lng = lng;
      // Note: Updating DB every few seconds might be heavy.
      // Consider only updating the Map (onlineMechanics) and saving to DB less frequently.
      await AppDataSource.getRepository(User).update(
        { id: userId },
        { lat, lng }
      );
      emitMechanics();
    }
  });

  /* ========== HELPER WORKFLOW SOCKETS ========== */

  // Helper reached user
  socket.on("ride:helper-arrived", ({ requestId }) => {
    console.log(`🟢 Helper ${userId} reached for request ${requestId}`);
    // Notify user
    io.to(`user_${requestId}`).emit("ride:helper-arrived", { requestId });
  });

  // Helper started work
  socket.on("ride:start-work", ({ requestId }) => {
    console.log(`🚀 Helper ${userId} started work on request ${requestId}`);
    io.to(`user_${requestId}`).emit("ride:start-work", { requestId });
  });

  // Helper completed work & submitted price
  socket.on("ride:work-done", ({ requestId, finalPrice }) => {
    console.log(
      `✅ Helper ${userId} finished work on request ${requestId} for $${finalPrice}`
    );
    // Notify user to show rating screen
    io.to(`user_${requestId}`).emit("ride:work-done", { requestId });
    // Notify helper to show payment confirmation screen
    io.to(`mechanic_${userId}`).emit("ride:show-payment", {
      requestId,
      finalPrice,
    });
  });

  // User submits rating for helper
  socket.on("user:rate-helper", ({ requestId, rating }) => {
    console.log(
      `⭐ User ${userId} rated helper for request ${requestId}: ${rating}`
    );
    io.to(`mechanic_${userId}`).emit("ride:rating-received", {
      requestId,
      rating,
    });
  });

  /* ========== HELPER OFFLINE ========== */
  socket.on("mechanic:offline", async () => {
    onlineMechanics.delete(userId);
    socket.leave("helpers_room");
    await AppDataSource.getRepository(User).update(
      { id: userId },
      { isOnline: false }
    );
    emitMechanics();
    console.log(`🔴 Mechanic ${userId} offline`);
  });

  /* ========== DISCONNECT ========== */
  socket.on("disconnect", async () => {
    onlineMechanics.delete(userId);
    await AppDataSource.getRepository(User).update(
      { id: userId },
      { isOnline: false }
    );
    emitMechanics();
  });
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
