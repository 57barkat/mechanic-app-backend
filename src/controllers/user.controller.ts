// import { Request, Response } from "express";
// import { AppDataSource } from "../config/db";
// // import { Mechanic } from "../entities/Mechanic";

// // Get mechanics by category
// export const getMechanicsByCategory = async (req: Request, res: Response) => {
//   const { category } = req.params;

//   try {
//     const mechanics = await AppDataSource.getRepository(Mechanic).find({
//       where: { category },
//     });

//     res.json(mechanics);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Server error" });
//   }
// };
