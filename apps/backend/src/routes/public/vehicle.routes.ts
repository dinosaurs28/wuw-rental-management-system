import { Router } from "express";
import {
  getPublicVehicles,
  getPublicVehiclesDetails,
  getVehicleGroupDetails,
} from "../../controller/public/vehicles.controller.js";
import { createBookingSummary } from "../../controller/booking/getBookInfo.controller.js";
import { getCustomerBookingLimits } from "../../controller/booking/customerLimits.controller.js";
import { authCheckJwt } from "../../middlewares/authCheck.middlewares.js";
import { checkProfileCompletion } from "../../middlewares/profileCheck.middleware.js";
import { rejectBlacklistedCustomer } from "../../middlewares/blacklistCheck.middleware.js";
import { getPublicBranches } from "../../controller/public/getPublicBranches.controller.js";
import { getPublicCategories } from "../../controller/public/categories.controller.js";
import { ValidateCoupon } from "../../controller/public/discount-validate.controller.js";
import { getBranchSchedule } from "../../controller/public/branchSchedule.controller.js";
import { GetPublicOffers } from "../../controller/public/offers.controller.js";
import express from "express";
import { ClaimDeferredLink, RecordDeferredLink } from "../../controller/public/deferred-link.controller.js";
const router: Router = Router();
router.get("/branches", getPublicBranches);
router.get("/branch/:branchPublicId/schedule", getBranchSchedule);
router.post("/discount/validate", ValidateCoupon);
router.get("/categories", getPublicCategories);
// Offer posters for the hero slider (#15): ?branch=<publicId> → that branch's + global
router.get("/offers", GetPublicOffers);
router.get("/vehicles", getPublicVehicles);
router.get("/vehicles/group/:groupKey", getVehicleGroupDetails);
router.get("/vehicles/:id", getPublicVehiclesDetails);
router.get("/customer/booking-limits", authCheckJwt, checkProfileCompletion, getCustomerBookingLimits);
// The KYC picture is optional (X2): the profile gate (DL + Aadhaar numbers) decides.
// Blacklisted customers (#13) are refused first: 403 CUSTOMER_BLACKLISTED.
router
  .route("/vehicles/booking")
  .all(authCheckJwt, rejectBlacklistedCustomer, checkProfileCompletion)
  .post(createBookingSummary);
// Deferred deep links (#16): the website records the shared vehicle just before
// the app-store redirect; the app claims it on its first launch. text/plain is
// accepted so the website can use navigator.sendBeacon.
const deferredLinkBody = express.text({ type: "text/plain", limit: "2kb" });
router.post("/deferred-links", deferredLinkBody, RecordDeferredLink);
router.post("/deferred-links/claim", deferredLinkBody, ClaimDeferredLink);

export default router;
