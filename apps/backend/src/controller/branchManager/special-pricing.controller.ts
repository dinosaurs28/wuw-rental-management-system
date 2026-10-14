import { Request, Response } from "express";
import {
  SPECIAL_PRICING_LIST_FILTERS,
  createSpecialPricingRuleSchema,
  specialPricingPreviewSchema,
  updateSpecialPricingRuleSchema,
  type SpecialPricingListFilter,
} from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import {
  createSpecialRule,
  deleteSpecialRule,
  invalidSpecialRuleBody,
  listSpecialRules,
  previewSpecialRule,
  sendSpecialPricingError,
  specialPricingActor,
  specialRuleOptions,
  updateSpecialRule,
} from "../../services/pricing/special-pricing-rule.service.js";

/**
 * Festival pricing — the manager's own branch (ManagerCheck: req.branch_Id).
 * A rule changes the rent of every priced block with at least half of its time
 * on its dates by its percentage (utils/pricing/specialDateRule.ts).
 */

const listFilter = (raw: unknown): SpecialPricingListFilter =>
  (SPECIAL_PRICING_LIST_FILTERS as readonly string[]).includes(String(raw)) ? (raw as SpecialPricingListFilter) : "all";

/** GET /branchManager/pricing/special-rules?filter=upcoming|active|past|all */
export const ListSpecialRules = async (req: Request, res: Response) => {
  try {
    const data = await listSpecialRules(req.branch_Id, listFilter(req.query.filter));
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "ListSpecialRules");
  }
};

/** GET /branchManager/pricing/special-rules/options — the branch's categories and vehicles to pick from. */
export const GetSpecialRuleOptions = async (req: Request, res: Response) => {
  try {
    const data = await specialRuleOptions(req.branch_Id);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "GetSpecialRuleOptions");
  }
};

/** POST /branchManager/pricing/special-rules/preview — a draft rule's 24-hour rents before → after. */
export const PreviewSpecialRule = async (req: Request, res: Response) => {
  try {
    const parsed = specialPricingPreviewSchema.safeParse(req.body);
    if (!parsed.success) return invalidSpecialRuleBody(res, parsed.error.issues);
    const data = await previewSpecialRule(req.branch_Id, parsed.data);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "PreviewSpecialRule");
  }
};

/** POST /branchManager/pricing/special-rules */
export const CreateSpecialRule = async (req: Request, res: Response) => {
  try {
    const parsed = createSpecialPricingRuleSchema.safeParse(req.body);
    if (!parsed.success) return invalidSpecialRuleBody(res, parsed.error.issues);
    const actor = await specialPricingActor(req.public_Id);
    const data = await createSpecialRule(req.branch_Id, parsed.data, actor);
    return res.status(StatusCode.CREATED).json({ success: true, message: "Festival pricing created", data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "CreateSpecialRule");
  }
};

/** PATCH /branchManager/pricing/special-rules/:publicId — edit, pause ({ active: false }) or resume. */
export const UpdateSpecialRule = async (req: Request, res: Response) => {
  try {
    const parsed = updateSpecialPricingRuleSchema.safeParse(req.body);
    if (!parsed.success) return invalidSpecialRuleBody(res, parsed.error.issues);
    const actor = await specialPricingActor(req.public_Id);
    const data = await updateSpecialRule(String(req.params.publicId), parsed.data, actor, req.branch_Id);
    return res.status(StatusCode.OK).json({ success: true, message: "Festival pricing updated", data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "UpdateSpecialRule");
  }
};

/** DELETE /branchManager/pricing/special-rules/:publicId — bookings already made keep their prices. */
export const DeleteSpecialRule = async (req: Request, res: Response) => {
  try {
    const actor = await specialPricingActor(req.public_Id);
    await deleteSpecialRule(String(req.params.publicId), actor, req.branch_Id);
    return res.status(StatusCode.OK).json({ success: true, message: "Festival pricing deleted" });
  } catch (error) {
    return sendSpecialPricingError(res, error, "DeleteSpecialRule");
  }
};
