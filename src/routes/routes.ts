import { Router } from "express";
import { AppDataSource, io } from "../index";
import { User, Helper, Request, Offer, Rating } from "../entities/entites";

const router = Router();

// Helper signup with CNIC requirement
router.post("/helper/signup", async (req, res) => {
  const { name, phone, cnicImage } = req.body; // CNIC Image included as per requirement
  const helperRepo = AppDataSource.getRepository(Helper);
  let helper = await helperRepo.findOneBy({ phone });
  if (!helper) {
    helper = helperRepo.create({
      name,
      phone,
      cnicImage,
      wallet: 0,
      isOnline: false,
      rating: 5,
      ratingCount: 0,
    });
    await helperRepo.save(helper);
  }
  res.json({ ...helper, userType: "helper" });
});

router.post("/helper/login", async (req, res) => {
  const { phone } = req.body;
  const helperRepo = AppDataSource.getRepository(Helper);
  const helper = await helperRepo.findOneBy({ phone });
  if (!helper) return res.status(404).json({ message: "Helper not found" });
  res.json({ ...helper, userType: "helper" });
});

router.get("/helper/:id", async (req, res) => {
  const helperRepo = AppDataSource.getRepository(Helper);
  const helper = await helperRepo.findOneBy({ id: req.params.id } as any);
  res.json(helper);
});

// Create Request (User side)
router.post("/request", async (req, res) => {
  const { userId, problemType, lat, lng } = req.body;
  const userRepo = AppDataSource.getRepository(User);
  const requestRepo = AppDataSource.getRepository(Request);

  const user = await userRepo.findOneBy({ id: userId });
  if (!user) return res.status(404).json({ message: "User not found" });

  const request = requestRepo.create({
    user,
    problemType,
    userLat: lat,
    userLng: lng,
    status: "pending",
  });
  await requestRepo.save(request);

  const helperRepo = AppDataSource.getRepository(Helper);
  const onlineHelpers = await helperRepo.findBy({ isOnline: true });

  onlineHelpers.forEach((h) => {
    io.to(`helper_${h.id}`).emit("new-request", request);
  });

  res.json(request);
});

// Helper sends a bid
router.post("/offer", async (req, res) => {
  const { requestId, helperId, price, eta } = req.body;
  const offerRepo = AppDataSource.getRepository(Offer);
  const requestRepo = AppDataSource.getRepository(Request);
  const helperRepo = AppDataSource.getRepository(Helper);

  const request = await requestRepo.findOne({
    where: { id: requestId },
    relations: ["user"],
  });
  const helper = await helperRepo.findOneBy({ id: helperId });

  if (request && helper) {
    const offer = offerRepo.create({ request, helper, price, eta });
    await offerRepo.save(offer);
    io.to(`user_${request.user.id}`).emit("new-offer", offer);
    res.json(offer);
  } else {
    res.status(404).json({ message: "Data not found" });
  }
});

export default router;
