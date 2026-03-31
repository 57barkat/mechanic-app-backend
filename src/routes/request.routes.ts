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
  cancelRide,
} from "../controllers/request.controller";
import { getJobHistory } from "../controllers/history.controller";

const router = Router();

router.post("/create", authMiddleware, createRequest);
router.post("/offer", authMiddleware, makeOffer);
router.post("/offer/accept", authMiddleware, acceptOffer);
router.post("/helper/arrived", authMiddleware, helperArrived);
router.post("/helper/start", authMiddleware, helperStartWork);
router.post("/helper/done", authMiddleware, helperWorkDone);
router.post("/user/rate", authMiddleware, userRateHelper);
router.post("/cancel", authMiddleware, cancelRide);
router.get("/history", authMiddleware, getJobHistory);

export default router;
