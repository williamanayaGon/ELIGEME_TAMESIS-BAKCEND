-- CreateEnum
CREATE TYPE "TipoReporte" AS ENUM ('GENERAL', 'TRASLADOS', 'MEDICAMENTOS', 'INSUMOS', 'TALENTO_HUMANO', 'AYUDAS_TECNICAS', 'URGENCIAS');

-- CreateEnum
CREATE TYPE "EstadoReporte" AS ENUM ('BORRADOR', 'ENVIADO', 'APROBADO', 'OBJETADO');

-- AlterTable: clasificación y ciclo de vida del reporte.
-- periodoInicio/periodoFin llevan DEFAULT temporal para que la migración no
-- falle si la tabla ya tuviera filas; se retira enseguida.
ALTER TABLE "FinancialReport"
    ADD COLUMN     "reportType" "TipoReporte" NOT NULL DEFAULT 'GENERAL',
    ADD COLUMN     "estado" "EstadoReporte" NOT NULL DEFAULT 'BORRADOR',
    ADD COLUMN     "periodoInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN     "periodoFin" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN     "enviadoAt" TIMESTAMP(3),
    ADD COLUMN     "corrigeId" INTEGER;

ALTER TABLE "FinancialReport" ALTER COLUMN "periodoInicio" DROP DEFAULT;
ALTER TABLE "FinancialReport" ALTER COLUMN "periodoFin" DROP DEFAULT;

-- CreateTable
CREATE TABLE "FinancialLineItem" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "concepto" TEXT NOT NULL,
    "descripcion" TEXT,
    "cantidad" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "valorUnitario" DECIMAL(15,2) NOT NULL,
    "valorTotal" DECIMAL(15,2) NOT NULL,
    "fechaEvento" TIMESTAMP(3),
    "patientId" INTEGER,
    "visitId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialReport_epsId_idx" ON "FinancialReport"("epsId");
CREATE INDEX "FinancialReport_reportType_idx" ON "FinancialReport"("reportType");
CREATE INDEX "FinancialReport_estado_idx" ON "FinancialReport"("estado");
CREATE INDEX "FinancialLineItem_reportId_idx" ON "FinancialLineItem"("reportId");
CREATE INDEX "FinancialLineItem_patientId_idx" ON "FinancialLineItem"("patientId");
CREATE INDEX "FinancialLineItem_fechaEvento_idx" ON "FinancialLineItem"("fechaEvento");

-- AddForeignKey
ALTER TABLE "FinancialReport" ADD CONSTRAINT "FinancialReport_corrigeId_fkey" FOREIGN KEY ("corrigeId") REFERENCES "FinancialReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialLineItem" ADD CONSTRAINT "FinancialLineItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FinancialReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialLineItem" ADD CONSTRAINT "FinancialLineItem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
