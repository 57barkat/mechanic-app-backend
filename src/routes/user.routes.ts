// import { Router } from "express";
// import { authMiddleware } from "../middlewares/auth.middleware";
// import { roleMiddleware } from "../middlewares/role.middleware";
// import { getMechanicsByCategory } from "../controllers/user.controller";
// import { updateMechanicLocation } from "../controllers/mechanic.controller";

// const router = Router();

// // Only users can fetch mechanics
// router.get(
//   "/mechanics/:category",
//   authMiddleware,
//   roleMiddleware(["user"]),
//   getMechanicsByCategory
// );
// router.put(
//   "/me/location",
//   authMiddleware,
//   roleMiddleware(["mechanic"]),
//   updateMechanicLocation
// );

// export default router;
