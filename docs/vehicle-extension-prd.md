# Product Requirements Document
## Vehicle Extension Feature
**Project:** Vehicle Rental Management System (VRMS)
**Audience:** Branch Owners & Operations Staff
**Version:** 1.0
**Date:** April 4, 2026

---

## 1. What Is This Feature?

The Vehicle Extension feature allows a customer who has already rented a vehicle to request extra rental days **without having to return the vehicle first**.

Think of it like extending your hotel stay — instead of checking out and checking back in, you just ask to stay longer.

---

## 2. Why Do We Need This?

Right now, if a customer wants to keep the vehicle longer, they either:
- Have to call the branch and it's handled manually with no record in the system
- Have to return the vehicle and re-book it, which is inconvenient

This feature creates a **proper process** that is tracked, fair to all customers, and reduces confusion for staff.

---

## 3. Who Uses This?

| Person | What They Do |
|---|---|
| **Customer** | Requests an extension on their active booking |
| **Branch Staff / Admin** | Reviews the request, approves or rejects it |
| **Other Customers** | May be affected if they had booked the same vehicle |

---

## 4. The Main Flows

---

### Flow A — Simple Extension (No Conflict)

> **Scenario:** Customer booked a car from May 3 to May 5. They want to extend to May 7. Nobody else has booked that car after May 5.

```
Customer requests extension (May 5 → May 7)
        ↓
System checks: Is the vehicle free from May 5 to May 7?
        ↓
YES — No conflict found
        ↓
Admin approves (or auto-approves if enabled)
        ↓
Booking is extended. Customer keeps the vehicle.
        ↓
New invoice / extra charge is generated for the extra days.
```

**Result:** Smooth. No issues. Customer happy.

---

### Flow B — Extension with a Conflict (The Tricky One)

> **Scenario:** Customer A booked a car from May 3 to May 5. On May 4, they request an extension to May 7. But Customer B has already booked the **same vehicle** from May 6 to May 8.

```
Customer A requests extension (May 5 → May 7)
        ↓
System checks: Is the vehicle free from May 5 to May 7?
        ↓
NO — Customer B has booked it from May 6 to May 8
        ↓
CONFLICT DETECTED
        ↓
System presents two options to the Admin:
   Option 1 → Partial Extension (May 5 to May 6 only — 1 extra day)
   Option 2 → Reject extension. Customer A returns on May 5 as planned.
        ↓
Admin makes a decision and notifies both customers.
```

**Resolution Options for the Admin:**

| Option | What Happens | Best Used When |
|---|---|---|
| **Partial Extension** | Customer A gets 1 extra day (May 5-6). Returns before Customer B picks up. | There is a small window of free time |
| **Reject Extension** | Customer A returns on original date. Customer B gets the car as planned. | No free days available at all |
| **Reassign Customer B** | Same model car is found for Customer B. Customer A gets full extension. | Another unit of same model is available |
| **Escalate to Manager** | Admin flags the conflict and a senior person decides. | High-value bookings or VIP customers |

---

### Flow C — Customer Returns and Picks Up a New Vehicle

> **Scenario:** Extension is not possible on the same vehicle. Customer needs the vehicle longer but must return the original one.

```
Extension denied (vehicle not available)
        ↓
System checks: Is another vehicle of same/similar type available?
        ↓
If YES → Offer customer a substitute vehicle
   Customer returns Vehicle A on original date
   Customer picks up Vehicle B immediately after
   New booking is created for Vehicle B
        ↓
If NO → Customer must return with no replacement available
   System shows "No vehicles available" message
   Staff can manually explore options (upgrades, nearby branch)
```

**Important:** In Flow C, the customer will have a gap or switch. The system should show this clearly — same price if same category, or adjusted price if different category.

---

## 5. Edge Cases & How to Handle Them

---

### Edge Case 1 — Only One Car of That Model Exists

> **Example:** The branch has only **1 Toyota Fortuner**. Customer A has it. Customer B booked that exact car. Customer A requests extension.

**Problem:** There is no backup Fortuner to give Customer B.

**Solution:**
- System must flag this as a **"High Conflict — Single Unit Model"**
- Admin must be notified immediately, not just at the time of review
- Customer B should be notified **early** (not on the day of pickup) that their booking may be affected
- Options to offer Customer B:
  - A similar vehicle (e.g., another SUV) at the same price
  - A full refund if they do not accept the substitute
  - A discount/credit for the inconvenience
- Customer A's extension should **not be silently approved** in this case — it requires manual admin confirmation

---

### Edge Case 2 — Extension Requested on the Day of Return

> **Example:** Customer is supposed to return the car today but calls in the morning asking to extend.

**Problem:** Staff may not have time to check and there could be a booking starting today.

**Solution:**
- System should flag same-day extension requests as **urgent**
- Admin gets an alert/notification immediately
- If there is a booking starting that same day, extension is automatically blocked and admin is shown the conflict
- Grace period rule: Define a cut-off time (e.g., extensions must be requested at least 4 hours before return time)

---

### Edge Case 3 — Customer Does Not Return on Time (No Extension Requested)

> **Example:** Customer was supposed to return on May 5. They don't show up. They didn't request an extension either.

**Problem:** This is not an extension — it's an overdue/late return. Another customer may be waiting.

**Solution:**
- After return time passes, system marks booking as **"Overdue"**
- Staff gets an alert to call the customer
- Automatic late fee starts accumulating (configurable by admin)
- If next customer is affected, they are notified and offered a substitute or rescheduled pickup
- This is different from an extension — the customer did **not** have approval to keep the vehicle

---

### Edge Case 4 — Customer Requests Extension Multiple Times

> **Example:** Customer extends from May 5 → May 7, then again from May 7 → May 9.

**Problem:** Each extension needs to be re-validated. The system should not just blindly approve based on the first extension.

**Solution:**
- Each extension request goes through the **same conflict-check process** as the first one
- System should track extension history on the booking
- Admin should see a note like: "This booking has been extended 2 times already"
- Optionally, admin can set a rule: **maximum number of extensions per booking** (e.g., max 2 extensions)

---

### Edge Case 5 — Vehicle Goes for Maintenance After Current Booking

> **Example:** Vehicle is scheduled for servicing on May 6. Customer wants to extend to May 7.

**Problem:** The maintenance slot would be missed if extension is approved.

**Solution:**
- System should check maintenance schedules, not just customer bookings
- If a maintenance slot conflicts with the extension, admin is notified
- Admin can either:
  - Reject the extension (maintenance takes priority)
  - Reschedule maintenance if it is not urgent
- Maintenance conflicts should be shown separately from customer booking conflicts

---

### Edge Case 6 — Pricing Changes During Extension Period

> **Example:** Customer booked at a weekday rate. Extension falls on a weekend where rates are higher.

**Solution:**
- System calculates extension cost based on the **rate applicable to the new dates**, not the original booking rate
- Customer is shown the new price before confirming
- Customer must accept the new price to confirm the extension

---

### Edge Case 7 — Customer Cancels After Requesting Extension

> **Example:** Customer requested extension on May 4 (from May 5 to May 7). Admin approved. Now customer cancels the extension on May 5.

**Solution:**
- Extension can be cancelled before the extension period starts
- If within the branch's cancellation window, no penalty
- If cancelled after the extension period has started, normal cancellation/refund policy applies
- Any customer who was displaced (reassigned or rejected) due to this extension — should they be notified that the original vehicle is now available? **Yes** — system should alert admin to re-accommodate them if possible.

---

### Edge Case 8 — Branch Has Vehicles at Multiple Locations

> **Example:** Customer is at Location A. Extension is blocked there. But Location B has the same vehicle free.

**Solution:**
- This is an **out-of-scope transfer** and should require manual admin handling
- System can show that the model is available at another branch, but the logistics (delivering the car, extra charges) must be handled manually
- Do not auto-approve cross-branch solutions in version 1

---

## 6. Notification Plan

| Event | Who Gets Notified | How |
|---|---|---|
| Extension requested | Admin / Branch Staff | Dashboard alert + SMS/Email |
| Extension approved | Customer | SMS + Email |
| Extension rejected | Customer | SMS + Email with reason |
| Conflict detected | Admin | Immediate alert |
| Another customer's booking affected | That customer | SMS + Email (early warning) |
| Overdue return | Admin + Customer | Automated alert after grace period |
| Same-day extension request | Admin | Urgent alert |

---

## 7. What the Admin Screen Should Show

When an admin reviews an extension request, they should see:

1. **Customer name** and current booking details
2. **Requested new return date**
3. **Conflict status** — Green (no conflict) / Yellow (partial conflict) / Red (full conflict)
4. **Conflicting booking details** (if any) — which customer, which dates
5. **Available alternatives** — other vehicles of same type/category
6. **Price difference** for the extra days
7. **Action buttons** — Approve / Reject / Partial Approve / Reassign Conflicting Customer

---

## 8. Business Rules Summary (Simple Version)

| Rule | Setting |
|---|---|
| Can a customer request extension themselves? | Yes (from app/portal) — pending admin approval |
| Can admin auto-approve if no conflict? | Configurable (On/Off per branch) |
| Maximum extensions per booking | Configurable (default: 2) |
| Minimum notice for same-day extension | Configurable (default: 4 hours) |
| What triggers a late fee? | Return time exceeded without approved extension |
| Can extension be cancelled? | Yes, before extension period starts |

---

## 9. Out of Scope (Version 1)

These are things we are **not** doing in the first version to keep it simple:

- Automatic reassignment of conflicting customer (admin decides manually)
- Cross-branch vehicle transfers
- Customer-to-customer vehicle swaps
- Extension requests for vehicles already in maintenance

---

## 10. Success Criteria

The feature is working correctly when:

- A staff member can see all extension requests in one place
- Conflicts are flagged before approval, not after
- No customer arrives to pick up a vehicle that was given away due to an unmanaged extension
- Every extension has a record — who approved it, when, what was charged
- Customers are informed early if their booking is at risk

---

*This document is meant to be reviewed by the branch owner and operations team before development begins. All business rules marked as "Configurable" can be adjusted per branch preference.*
