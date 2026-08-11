-- AlterTable: permanencia en el programa.
-- Los pacientes existentes se consideran ACTIVO, que es su estado real hoy:
-- ninguno ha sido marcado como egresado.
ALTER TABLE "Patient"
    ADD COLUMN     "programStatus" TEXT NOT NULL DEFAULT 'ACTIVO',
    ADD COLUMN     "egresadoAt" TIMESTAMP(3),
    ADD COLUMN     "motivoEgreso" TEXT;

-- CreateTable: parámetros que fija la entidad, con su justificación
CREATE TABLE "ProgramSetting" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "justificacion" TEXT NOT NULL,
    "definidoPor" INTEGER,
    "epsId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramSetting_clave_epsId_key" ON "ProgramSetting"("clave", "epsId");
CREATE INDEX "ProgramSetting_epsId_idx" ON "ProgramSetting"("epsId");
