-- AlterTable: declaración del postulante + rastro de la asignación automática
ALTER TABLE "User" ADD COLUMN     "requiresHomeCare" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDisabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoAssignedPatientId" INTEGER,
ADD COLUMN     "statusChangedAt" TIMESTAMP(3);

-- AlterTable: cédula del paciente (llave de cruce con la postulación)
ALTER TABLE "Patient" ADD COLUMN     "identification" TEXT,
ADD COLUMN     "assignedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_identification_key" ON "Patient"("identification");
