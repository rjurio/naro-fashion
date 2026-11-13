-- Rental cancellation reason (round 25C F). Expand-only: four nullable columns.
-- Why / by whom / when a booking was cancelled; the money is handled as
-- CANCELLATION refund requests (rentals/cancellation.ts). Existing rows unchanged.

-- AlterTable
ALTER TABLE "RentalOrder" ADD COLUMN     "cancellationNote" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

