import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando el vaciado y llenado de la base de datos...');

  // 1. Limpiamos las tablas
  await prisma.medicalVisit.deleteMany();
  await prisma.log.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();
  await prisma.eps.deleteMany();

  // 2. Crear las EPS
  const epsList = [
    { name: 'Hospital', adminUser: 'admin@sura', adminPass: 'sura123' },
    { name: 'Savia Salud', adminUser: 'savi', adminPass: 'savi123' },
    { name: 'Coosalud', adminUser: 'coosalud', adminPass: 'coosalud123' }
  ];

  console.log('Creando EPS y credenciales...');
  const creadasEps = [];
  for (const eps of epsList) {
    creadasEps.push(await prisma.eps.create({ data: eps }));
  }

  const suraId = creadasEps[0].id;

  // 3. Crear Doctores (Con código de acceso MED-123)
  const docs = [
    { identification: '1000111222', phone: '3001112233', fullName: 'Dr. Carlos Restrepo', email: 'carlos.restrepo@salud.com', password: 'password123', accessCode: 'MED-123', role: 'PROFESIONAL', status: 'ACTIVO', epsId: suraId, address: 'Hospital Principal' },
    { identification: '1000333444', phone: '3102223344', fullName: 'Dra. Andrea Salazar', email: 'andrea.salazar@salud.com', password: 'password123', accessCode: 'MED-123', role: 'PROFESIONAL', status: 'ACTIVO', epsId: suraId, address: 'Centro Médico Sur' }
  ];

  console.log('Creando doctores...');
  const creadosDocs = [];
  for (const doc of docs) {
    creadosDocs.push(await prisma.user.create({ data: doc }));
  }

  // 4. Crear Cuidadores (Estado 'APROBADO' y código CUI-123)
  const caregivers = [
    { identification: '1111222333', phone: '3203334455', fullName: 'Maria Elena Gomez', email: 'maria.gomez@correo.com', password: 'password123', accessCode: 'CUI-123', role: 'CUIDADOR', status: 'APROBADO', epsId: suraId, address: 'Barrio Centro', experienceYears: '5', hasTransport: false },
    { identification: '2222333444', phone: '3114445566', fullName: 'Juan Fernando Perez', email: 'juan.perez@correo.com', password: 'password123', accessCode: 'CUI-123', role: 'CUIDADOR', status: 'APROBADO', epsId: suraId, address: 'Calle Principal', experienceYears: '3', hasTransport: true },
    { identification: '3333444555', phone: '3125556677', fullName: 'Luz Marina Ramirez', email: 'luz.ramirez@correo.com', password: 'password123', accessCode: 'CUI-123', role: 'CUIDADOR', status: 'APROBADO', epsId: suraId, address: 'Sector Norte', experienceYears: '8', hasTransport: false },
    { identification: '4444555666', phone: '3146667788', fullName: 'Diana Marcela Rios', email: 'diana.rios@correo.com', password: 'password123', accessCode: 'CUI-123', role: 'CUIDADOR', status: 'APROBADO', epsId: suraId, address: 'Barrio Sur', experienceYears: '2', hasTransport: true },
    { identification: '5555666777', phone: '3157778899', fullName: 'Luis Alfonso Toro', email: 'luis.toro@correo.com', password: 'password123', accessCode: 'CUI-123', role: 'CUIDADOR', status: 'APROBADO', epsId: suraId, address: 'Avenida 5', experienceYears: '10', hasTransport: true },
    { identification: '6666777888', phone: '3168889900', fullName: 'Carmen Rosa Villa', email: 'carmen.villa@correo.com', password: 'password123', accessCode: 'CUI-123', role: 'CUIDADOR', status: 'APROBADO', epsId: suraId, address: 'Carrera 10', experienceYears: '4', hasTransport: false },
    { identification: '7777888999', phone: '3179990011', fullName: 'Jorge Ivan Duque', email: 'jorge.duque@correo.com', password: 'password123', accessCode: 'CUI-123', role: 'CUIDADOR', status: 'APROBADO', epsId: suraId, address: 'Vereda Alta', experienceYears: '6', hasTransport: true },
    { identification: '8888999000', phone: '3180001122', fullName: 'Gloria Ines Velez', email: 'gloria.velez@correo.com', password: 'password123', accessCode: 'CUI-123', role: 'CUIDADOR', status: 'APROBADO', epsId: suraId, address: 'Sector Escuela', experienceYears: '1', hasTransport: false }
  ];

  console.log('Creando cuidadores...');
  const creadosCuidadores = [];
  for (const c of caregivers) {
    creadosCuidadores.push(await prisma.user.create({ data: c }));
  }

  // 5. Crear Pacientes
  const patients = [
    { fullName: 'Arturo Calle Osorio', age: 78, diagnosis: 'EPOC severo', address: 'Calle 10 # 11-20', caregiverId: creadosCuidadores[0].id, epsId: suraId },
    { fullName: 'Blanca Nubia Jaramillo', age: 65, diagnosis: 'Hipertensión', address: 'Carrera 9 # 8-45', caregiverId: creadosCuidadores[1].id, epsId: suraId },
    { fullName: 'Roberto Antonio Londoño', age: 82, diagnosis: 'Alzheimer', address: 'Calle 12 # 13-10', caregiverId: creadosCuidadores[2].id, epsId: suraId },
    { fullName: 'Mariela Henao de Castaño', age: 71, diagnosis: 'Insuficiencia Cardíaca', address: 'Vereda San Luis', caregiverId: creadosCuidadores[3].id, epsId: suraId },
    { fullName: 'Jose Misael Echeverri', age: 69, diagnosis: 'Secuelas de ACV', address: 'Carrera 10 # 14-22', caregiverId: creadosCuidadores[4].id, epsId: suraId },
    { fullName: 'Rosalba del Socorro Maya', age: 75, diagnosis: 'Artritis Reumatoide', address: 'Vereda El Rayo', caregiverId: creadosCuidadores[5].id, epsId: suraId },
    { fullName: 'Pedro Luis Quintero', age: 58, diagnosis: 'Enfermedad Renal Crónica', address: 'Calle 9 # 10-15', caregiverId: creadosCuidadores[6].id, epsId: suraId },
    { fullName: 'Consuelo Marín', age: 80, diagnosis: 'Parkinson avanzado', address: 'Carrera 11 # 9-30', caregiverId: creadosCuidadores[7].id, epsId: suraId }
  ];

  console.log('Creando pacientes...');
  for (const p of patients) {
    await prisma.patient.create({ data: p });
  }

  console.log('¡Base de datos lista! Doctores y Cuidadores listos para login.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });