-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "twoFARecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "is2FAEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFARecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "twoFASecret" TEXT;

