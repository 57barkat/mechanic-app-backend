// import { Request, Response } from "express";
// import { AppDataSource } from "../config/db";
// import { Mechanic } from "../entities/Mechanic";
// import { Request as JobRequest } from "../entities/Request";
// import { io } from "../index";
// import { getRoute } from "../utils/mapbox.util";

// export const setMechanicOnlineStatus = async (req: Request, res: Response) => {
//   const mechanicId = (req as any).user.id;
//   const { online } = req.body;

//   if (typeof online !== "boolean") {
//     return res.status(400).json({ message: "online must be boolean" });
//   }

//   try {
//     const repo = AppDataSource.getRepository(Mechanic);
//     const mechanic = await repo.findOneBy({ id: mechanicId });

//     if (!mechanic) {
//       return res.status(404).json({ message: "Mechanic not found" });
//     }

//     mechanic.isOnline = online;
//     await repo.save(mechanic);

//     return res.json({
//       message: online ? "Mechanic is online" : "Mechanic is offline",
//     });
//   } catch (err) {
//     console.error("❌ setMechanicOnlineStatus:", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// };

// /**
//  * ===============================
//  * UPDATE MECHANIC LOCATION
//  * (GLOBAL + REQUEST MODE)
//  * ===============================
//  */
// export const updateMechanicLocation = async (req: Request, res: Response) => {
//   const mechanicId = (req as any).user.id;
//   const { lat, lng, requestId } = req.body;

//   if (typeof lat !== "number" || typeof lng !== "number") {
//     return res.status(400).json({ message: "Invalid coordinates" });
//   }

//   try {
//     const mechanicRepo = AppDataSource.getRepository(Mechanic);
//     const requestRepo = AppDataSource.getRepository(JobRequest);

//     const mechanic = await mechanicRepo.findOneBy({ id: mechanicId });
//     if (!mechanic) {
//       return res.status(404).json({ message: "Mechanic not found" });
//     }

//     // ✅ Always save latest location
//     mechanic.lat = lat;
//     mechanic.lng = lng;
//     await mechanicRepo.save(mechanic);

//     /**
//      * ===============================
//      * GLOBAL LIVE MAP (NO REQUEST)
//      * ===============================
//      */
//     if (mechanic.isOnline) {
//       io.emit("mechanic-global-update", {
//         id: mechanic.id,
//         name: mechanic.name,
//         category: mechanic.category,
//         lat,
//         lng,
//       });
//     }

//     /**
//      * ===============================
//      * REQUEST LIVE MODE
//      * ===============================
//      */
//     if (typeof requestId === "number") {
//       const job = await requestRepo.findOne({
//         where: { id: requestId },
//         relations: ["user"],
//       });

//       if (!job) {
//         return res.status(404).json({ message: "Request not found" });
//       }

//       if (job.status === "accepted" || job.status === "in_progress") {
//         io.to(`request-${requestId}`).emit("mechanic-location", {
//           lat,
//           lng,
//         });

//         if (job.userLat && job.userLng) {
//           const route = await getRoute([lat, lng], [job.userLat, job.userLng]);

//           io.to(`request-${requestId}`).emit("route-update", route);
//         }
//       }
//     }

//     return res.json({
//       message: "Location updated",
//       lat,
//       lng,
//     });
//   } catch (err) {
//     console.error("❌ updateMechanicLocation:", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// };

// /**
//  * ===============================
//  * GET ONLINE MECHANICS (USER MAP)
//  * ===============================
//  */
// export const getOnlineMechanics = async (req: Request, res: Response) => {
//   try {
//     const mechanics = await AppDataSource.getRepository(Mechanic).find({
//       where: { isOnline: true },
//       select: ["id", "name", "lat", "lng", "category"],
//     });

//     return res.json(mechanics);
//   } catch (err) {
//     console.error("❌ getOnlineMechanics:", err);
//     return res.status(500).json({ message: "Server error" });
//   }
// };
