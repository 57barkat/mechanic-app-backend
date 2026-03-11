import { Router } from "express";
import { adminAuth } from "../middlewares/adminAuth.middleware";
import { adminLogin } from "../controllers/adminAuth.controller";
import {
  getStats,
  getUsers,
  updateUser,
  deleteUser,
  getHelpers,
  getPendingHelpers,
  verifyHelper,
  getCommission,
  updateCommission,
  getRequests,
  getOnlineHelpers,
} from "../controllers/admin.controller";

const router = Router();

router.post("/login", adminLogin);

router.use(adminAuth);

router.get("/stats", getStats);

router.get("/users", getUsers);
router.patch("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);

router.get("/helpers", getHelpers);
router.get("/helpers/pending", getPendingHelpers);
router.patch("/helpers/:id/verify", verifyHelper);

router.get("/commission", getCommission);
router.put("/commission", updateCommission);
router.get("/online-helpers", getOnlineHelpers);

router.get("/requests", getRequests);

export default router;
