import { Router } from "express";
import { ManagerCheck } from "../../middlewares/managerCheck.middlewares.js";
import { handleImageUpload } from "../../middlewares/upload.middleware.js";
import {
  ListOffers,
  GetOffer,
  ListOfferCoupons,
  ListOfferLinkTargets,
  CreateOffer,
  UpdateOffer,
  DeleteOffer,
} from "../../controller/branchManager/promo-banner.controller.js";
import { PROMO_IMAGE_MAX_BYTES } from "../../services/promo-banner/promo-banner.service.js";

// Offers & banners (#15) — hero-slider posters for the BM's own branch.
const router: Router = Router();

router.use(ManagerCheck);

router.get("/", ListOffers);
router.get("/coupons", ListOfferCoupons);
router.get("/link-targets", ListOfferLinkTargets);
router.get("/:publicId", GetOffer);
// multipart/form-data with the poster in `image` (PATCH also accepts plain JSON)
router.post("/", handleImageUpload("image", { maxBytes: PROMO_IMAGE_MAX_BYTES }), CreateOffer);
router.patch("/:publicId", handleImageUpload("image", { maxBytes: PROMO_IMAGE_MAX_BYTES }), UpdateOffer);
router.delete("/:publicId", DeleteOffer);

export default router;
