-- AlterTable: entidad del paciente copiada en bitácoras y visitas
ALTER TABLE "Log" ADD COLUMN     "epsId" INTEGER;
ALTER TABLE "MedicalVisit" ADD COLUMN     "epsId" INTEGER;

-- Rellenar los registros existentes con la EPS de su paciente.
UPDATE "Log" l
SET "epsId" = p."epsId"
FROM "Patient" p
WHERE l."patientId" = p."id" AND l."epsId" IS NULL;

UPDATE "MedicalVisit" v
SET "epsId" = p."epsId"
FROM "Patient" p
WHERE v."patientId" = p."id" AND v."epsId" IS NULL;
