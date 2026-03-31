import express from "express";
import {
  createPayment,
  initiatePayment,
  getPaymentStatus, // ✅ New status check route
} from "../controllers/payment.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

// Initiate payment (user must be logged in)
router.post("/initiate", authMiddleware, initiatePayment);

// JazzCash callback (no JWT required, JazzCash cannot provide JWT)
router.post("/jazzcash-callback", createPayment);

// New route: Frontend checks payment status after callback
router.get("/status/:txnRefNo", authMiddleware, getPaymentStatus);

export default router;
