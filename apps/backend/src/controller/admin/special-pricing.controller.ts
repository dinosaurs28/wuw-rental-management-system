import { Request, Response } from "express";
import {
  SPECIAL_PRICING_LIST_FILTERS,
  adminCreateSpecialPricingRuleSchema,
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
 * Festival pricing for any branch (AdminCheck) — the branch manager's
 * endpoints with the branch named: ?branchId= on reads, body.branchId on
 * create / preview; edits and deletes by the rule's publicId.
 */

const listFilter = (raw: unknown): SpecialPricingListFilter =>
  (SPECIAL_PRICING_LIST_FILTERS as readonly string[]).includes(String(raw)) ? (raw as SpecialPricingListFilter) : "all";

/** ?branchId= as a positive integer, or null (400 BRANCH_REQUIRED sent). */
function queryBranchId(req: Request, res: Response): number | null {
  const branchId = Number(req.query.branchId);
  if (Number.isInteger(branchId) && branchId > 0) return branchId;
  res.status(StatusCode.BAD_REQUEST).json({ success: false, code: "BRANCH_REQUIRED", message: "Pick a branch" });
  return null;
}

/** GET /admin/pricing/special-rules?branchId=&filter=upcoming|active|past|all */
export const AdminListSpecialRules = async (req: Request, res: Response) => {
  try {
    const branchId = queryBranchId(req, res);
    if (branchId == null) return;
    const data = await listSpecialRules(branchId, listFilter(req.query.filter));
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "AdminListSpecialRules");
  }
};

/** GET /admin/pricing/special-rules/options?branchId= */
export const AdminGetSpecialRuleOptions = async (req: Request, res: Response) => {
  try {
    const branchId = queryBranchId(req, res);
    if (branchId == null) return;
    const data = await specialRuleOptions(branchId);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "AdminGetSpecialRuleOptions");
  }
};

/** POST /admin/pricing/special-rules/preview — body.branchId required. */
export const AdminPreviewSpecialRule = async (req: Request, res: Response) => {
  try {
    const parsed = specialPricingPreviewSchema.safeParse(req.body);
    if (!parsed.success) return invalidSpecialRuleBody(res, parsed.error.issues);
    if (!parsed.data.branchId) {
      return res.status(StatusCode.BAD_REQUEST).json({ success: false, code: "BRANCH_REQUIRED", message: "Pick a branch" });
    }
    const data = await previewSpecialRule(parsed.data.branchId, parsed.data);
    return res.status(StatusCode.OK).json({ success: true, data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "AdminPreviewSpecialRule");
  }
};

/** POST /admin/pricing/special-rules — body.branchId required. */
export const AdminCreateSpecialRule = async (req: Request, res: Response) => {
  try {
    const parsed = adminCreateSpecialPricingRuleSchema.safeParse(req.body);
    if (!parsed.success) return invalidSpecialRuleBody(res, parsed.error.issues);
    const actor = await specialPricingActor(req.public_Id);
    const { branchId, ...input } = parsed.data;
    const data = await createSpecialRule(branchId, input, actor);
    return res.status(StatusCode.CREATED).json({ success: true, message: "Festival pricing created", data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "AdminCreateSpecialRule");
  }
};

/** PATCH /admin/pricing/special-rules/:publicId */
export const AdminUpdateSpecialRule = async (req: Request, res: Response) => {
  try {
    const parsed = updateSpecialPricingRuleSchema.safeParse(req.body);
    if (!parsed.success) return invalidSpecialRuleBody(res, parsed.error.issues);
    const actor = await specialPricingActor(req.public_Id);
    const data = await updateSpecialRule(String(req.params.publicId), parsed.data, actor);
    return res.status(StatusCode.OK).json({ success: true, message: "Festival pricing updated", data });
  } catch (error) {
    return sendSpecialPricingError(res, error, "AdminUpdateSpecialRule");
  }
};

/** DELETE /admin/pricing/special-rules/:publicId */
export const AdminDeleteSpecialRule = async (req: Request, res: Response) => {
  try {
    const actor = await specialPricingActor(req.public_Id);
    await deleteSpecialRule(String(req.params.publicId), actor);
    return res.status(StatusCode.OK).json({ success: true, message: "Festival pricing deleted" });
  } catch (error) {
    return sendSpecialPricingError(res, error, "AdminDeleteSpecialRule");
  }
};
