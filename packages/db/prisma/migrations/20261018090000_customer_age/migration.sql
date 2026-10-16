-- Oct 18 2026: customers enter their age on the profile form instead of a date
-- of birth, Driving Licence number and Aadhaar number. Customer.dob and the two
-- identity numbers are kept (existing data, and staff still record the DL number
-- at pickup); older customers' age is derived from dob when shown.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "age" INTEGER;
