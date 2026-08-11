-- AlterTable: fecha de registro del paciente.
-- Anulable a propósito: las filas anteriores no tienen ese dato y no se puede
-- inventar. Los indicadores las reportan como "Sin registrar", no como cero.
ALTER TABLE "Patient" ADD COLUMN     "createdAt" TIMESTAMP(3);

-- AlterTable: sello de resolución para medir el tiempo de respuesta
ALTER TABLE "ServiceRequest" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FuragEvidence" (
    "id" SERIAL NOT NULL,
    "politica" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "origen" TEXT NOT NULL,
    "indicadorId" TEXT,
    "periodoInicio" TIMESTAMP(3),
    "periodoFin" TIMESTAMP(3),
    "valorGenerado" JSONB,
    "archivoUrl" TEXT,
    "responsable" TEXT,
    "dependencia" TEXT,
    "fechaDocumento" TIMESTAMP(3),
    "vigenteHasta" TIMESTAMP(3),
    "observaciones" TEXT,
    "generadaPor" INTEGER,
    "epsId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuragEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImprovementAction" (
    "id" SERIAL NOT NULL,
    "politica" TEXT NOT NULL,
    "brecha" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "responsable" TEXT NOT NULL,
    "dependencia" TEXT NOT NULL,
    "fechaInicio" TIMESTAMP(3),
    "fechaObjetivo" TIMESTAMP(3) NOT NULL,
    "avance" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "epsId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER,
    "detail" JSONB,
    "actorId" INTEGER,
    "actorRole" TEXT,
    "epsId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuragEvidence_politica_idx" ON "FuragEvidence"("politica");
CREATE INDEX "FuragEvidence_vigenteHasta_idx" ON "FuragEvidence"("vigenteHasta");
CREATE INDEX "FuragEvidence_epsId_idx" ON "FuragEvidence"("epsId");
CREATE INDEX "ImprovementAction_estado_fechaObjetivo_idx" ON "ImprovementAction"("estado", "fechaObjetivo");
CREATE INDEX "ImprovementAction_epsId_idx" ON "ImprovementAction"("epsId");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE INDEX "AuditEvent_epsId_idx" ON "AuditEvent"("epsId");
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");
