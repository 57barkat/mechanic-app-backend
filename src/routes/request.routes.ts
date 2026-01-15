import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  createRequest,
  makeOffer,
  acceptOffer,
  helperArrived,
  helperStartWork,
  helperWorkDone,
  userRateHelper,
} from "../controllers/request.controller";

const router = Router();

// User creates a new request
router.post("/create", authMiddleware, createRequest);

// Mechanic makes an offer
router.post("/offer", authMiddleware, makeOffer);

// User accepts an offer
router.post("/offer/accept", authMiddleware, acceptOffer);

// ===== HELPER WORKFLOW =====

// Helper presses "Reached" (arrived at user)
router.post("/helper/arrived", authMiddleware, helperArrived);

// Helper presses "Start Work"
router.post("/helper/start", authMiddleware, helperStartWork);

// Helper presses "Work Done" and submits final price
router.post("/helper/done", authMiddleware, helperWorkDone);

// ===== USER RATING =====

// User rates helper after work is completed
router.post("/user/rate", authMiddleware, userRateHelper);

export default router;
