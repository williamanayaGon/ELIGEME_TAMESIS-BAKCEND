-- CreateTable
CREATE TABLE "Eps" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nit" TEXT,
    "logoUrl" TEXT,
    "adminUser" TEXT NOT NULL,
    "adminPass" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Eps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "identification" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "senaCode" TEXT,
    "senaFile" TEXT,
    "experienceYears" TEXT,
    "hasTransport" BOOLEAN NOT NULL DEFAULT false,
    "accessCode" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "epsId" INTEGER,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "stratum" TEXT,
    "diagnosis" TEXT,
    "condition" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "careInstructions" TEXT,
    "caregiverId" INTEGER,
    "epsId" INTEGER,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Log" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "mood" TEXT,
    "alert" BOOLEAN NOT NULL DEFAULT false,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caregiverId" INTEGER NOT NULL,
    "patientId" INTEGER,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalVisit" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "time" TEXT,
    "professionalId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "formData" TEXT NOT NULL,

    CONSTRAINT "MedicalVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialReport" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period" TEXT NOT NULL,
    "epsName" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "totalBudget" TEXT NOT NULL,
    "totalExecuted" TEXT NOT NULL,
    "balance" TEXT NOT NULL,
    "expensesData" TEXT NOT NULL,
    "generalObs" TEXT,
    "elaboratedBy" TEXT,
    "reviewedBy" TEXT,

    CONSTRAINT "FinancialReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Eps_adminUser_key" ON "Eps"("adminUser");

-- CreateIndex
CREATE UNIQUE INDEX "User_identification_key" ON "User"("identification");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialReport_reference_key" ON "FinancialReport"("reference");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_epsId_fkey" FOREIGN KEY ("epsId") REFERENCES "Eps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_epsId_fkey" FOREIGN KEY ("epsId") REFERENCES "Eps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalVisit" ADD CONSTRAINT "MedicalVisit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
