import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config'
function generateAccessCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// =================================================================
// CONFIGURACIÓN BÁSICA
// =================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Archivos (Multer)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuración Correo
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'anayawilliam421@gmail.com', //  CORREO
        pass: 'bjsd rxqk uduf fucb'        // CONTRASEÑA APP
    }
});



import OpenAI from "openai";

// =================================================================
// CO-PILOTO CON IA PARA CUIDADORES (VERSIÓN AUTO-FREE)
// =================================================================

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
 apiKey: process.env.OPENROUTER_API_KEY,
});

// =================================================================
// ASISTENTE VIRTUAL IA (COMPATIBLE CON CUIDADORES Y PACIENTES)
// =================================================================
app.post('/api/ai-assistant', async (req, res) => {
    const { message, userType } = req.body; // userType es opcional ('patient' o 'caregiver')

    if (!message) {
        return res.status(400).json({ error: "El mensaje es requerido." });
    }

    try {
        // Prompt base de seguridad y comportamiento
        let systemPrompt = "Eres un Asistente Virtual de Salud y Bienestar en Casa. Tu objetivo es dar recomendaciones sencillas, amables y empáticas sobre cuidados diarios, hábitos saludables y bienestar general. IMPORTANTE: No des diagnósticos médicos ni recetes medicamentos. Si detectas una emergencia grave (sangrado, desmayo, dificultad para respirar, dolor fuerte en el pecho), indica de inmediato llamar a la línea de emergencias 123 o comunicarse con la EPS.";

        // Adaptación dinámica de tono
        if (userType === 'patient') {
            systemPrompt += " Te estás dirigiendo directamente al PACIENTE. Háblale con calidez, paciencia y responde sus dudas personales sobre su recuperación y autocuidado.";
        } else {
            systemPrompt += " Te estás dirigiendo al CUIDADOR o familiar del paciente. Ayúdalo con el manejo del paciente en casa, posturas, rutinas y consejos para evitar el agotamiento.";
        }

        const response = await openai.chat.completions.create({
            model: "openrouter/auto",
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: message
                }
            ]
        });

        const reply = response.choices[0].message.content;
        res.json({ reply });

    } catch (error) {
        console.error("❌ Error en el asistente de IA:", error);
        res.status(500).json({ error: "Lo siento, el servicio de asistencia virtual no está disponible ahora." });
    }
});

console.log("🚀 Iniciando Servidor con Lógica de Separación de EPS...");

// =================================================================
// 1. LOGIN (CUIDADORES, ADMIN GLOBAL, EPS Y PROFESIONALES)
// =================================================================
// =================================================================
// LOGIN UNIFICADO (SUPERINTENDENCIA, ADMIN, EPS, USUARIOS)
// =================================================================
app.post('/api/login', async (req, res) => {
    // Nota: 'credential' recibe la contraseña o el código de acceso
    const { email, credential, type } = req.body;
    console.log("Cuerpo de la petición:", req.body);
    console.log(`🔑 Intento de login: ${email} - Tipo: ${type || 'PASSWORD'}`);

    try {
    if (type === 'CODE'|| type == 'PASSWORD') {
                // Buscamos si es un paciente usando su código
                const patientUser = await prisma.patient.findFirst({
                    where: { email: email, accessCode: credential }
                });

                if (patientUser) {
                    return res.json({
                        id: patientUser.id,
                        role: 'PACIENTE',
                        name: patientUser.fullName,
                        email: patientUser.email
                    });
                }
            }
        // ---------------------------------------------------------
        // 1. SUPERINTENDENCIA (Acceso Hardcoded para Auditoría)
        // ---------------------------------------------------------
        if (email === 'super@test.com' && credential === '123') {
            console.log("✅ Acceso concedido: Superintendencia Nacional de Salud");
            return res.json({
                id: 999,
                fullName: 'Superintendencia Nacional de Salud',
                email: 'super@test.com',
                role: 'SUPER', // Este rol activa el DashboardSuperintendencia en el Front
                epsId: null
            });
        }

        // ---------------------------------------------------------
        // 2. ADMIN GLOBAL (Dueño de la plataforma, ve todo)
        // ---------------------------------------------------------
        if (email === 'admin@eps.com' && credential === 'admin123') {
            return res.json({
                id: 0,
                fullName: 'Super Admin',
                email,
                role: 'ADMIN',
                epsId: null
            });
        }

        // ---------------------------------------------------------
        // 3. ADMIN DE EPS (Savia, Sura, Coosalud)
        // ---------------------------------------------------------
        const epsAccount = await prisma.eps.findFirst({
            where: { adminUser: email, adminPass: credential }
        });

        if (epsAccount) {
            console.log(`✅ EPS Logueada: ${epsAccount.name} (ID: ${epsAccount.id})`);
            return res.json({
                id: epsAccount.id,
                fullName: epsAccount.name,
                email: epsAccount.adminUser,
                role: 'ADMIN',
                isEps: true,
                epsId: epsAccount.id // ESTE ID ES LA CLAVE PARA FILTRAR TODO
            });
        }

        // ---------------------------------------------------------
        // 4. USUARIOS (Cuidadores y Profesionales)
        // ---------------------------------------------------------
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

        // Validación Estado Cuidador (Solo si es CUIDADOR revisamos si está aprobado/preseleccionado)
        if (user.role === 'CUIDADOR' && user.status !== 'APROBADO' && user.status !== 'PRESELECCIONADO') {
            return res.status(403).json({ error: "Tu solicitud sigue en revisión." });
        }

        // Verificación de credenciales (Password o Código)
        // A. Login por CÓDIGO (type === 'CODE')
        const isCodeLogin = type === 'CODE' && user.accessCode === credential;

        // B. Login por CONTRASEÑA (type normal)
        // Nota: Si el usuario no tiene password seteado, permitimos entrar con accessCode temporalmente si coinciden
        const isPassLogin = type !== 'CODE' && (user.password === credential || (user.password === '' && user.accessCode === credential));

        if (isCodeLogin || isPassLogin) {
            return res.json({
                ...user,
                epsId: user.epsId // Retornamos la EPS a la que pertenece el usuario
            });
        }

        // Si fallan todas las validaciones anteriores
        return res.status(401).json({ error: "Credenciales incorrectas" });

    } catch (error) {
        console.error("❌ Error login:", error);
        res.status(500).json({ error: "Error de servidor" });
    }
});


// const nodemailer = require('nodemailer');

// ==========================================
// RUTA CREAR PACIENTE (CON ENVÍO DE CÓDIGO)
// ==========================================
app.post('/api/patients', async (req, res) => {
    console.log("📥 Recibiendo Paciente:", req.body);

    try {
        const {
            fullName, age, epsId, condition, diagnosis,
            address, phone, stratum, careInstructions,
            zoneCategory, zoneDetail,
            email // <-- NUEVO CAMPO RECIBIDO DEL FRONTEND
        } = req.body;

        const epsIdInt = parseInt(epsId);

        // Validamos que envíen el correo
        if (!fullName || !age || !epsIdInt || !email) {
            return res.status(400).json({ error: "Faltan datos: Nombre, Edad, Correo y EPS son obligatorios." });
        }

        // 1. GENERAR CÓDIGO ALEATORIO DE 6 DÍGITOS
        const accessCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 2. CREAR PACIENTE EN BD
        const newPatient = await prisma.patient.create({
            data: {
                fullName,
                age: parseInt(age),
                email,            // Guardamos el correo
                accessCode,       // Guardamos la contraseña temporal
                condition: condition || diagnosis || "No especificada",
                diagnosis: diagnosis || condition,
                address: address || "",
                phone: phone || "",
                stratum: stratum || "0",
                careInstructions: careInstructions || "",
                zoneCategory: zoneCategory || "",
                zoneDetail: zoneDetail || "",
                epsId: epsIdInt,
            }
        });

        // 3. ENVIAR CORREO (Usa tus credenciales reales aquí)
        const transporter = nodemailer.createTransport({
            service: 'gmail', // Cambia si usas otro servicio
            auth: {
                  user: 'anayawilliam421@gmail.com', //  CORREO
                  pass: 'bjsd rxqk uduf fucb'  // Tu contraseña de aplicación
            }
        });

        const mailOptions = {
            from: '"Elígeme - Cuidado" <tu_correo@gmail.com>',
            to: email,
            subject: "Tu Código de Acceso - Elígeme",
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #1f3c88;">¡Hola, ${fullName}!</h2>
                    <p>Has sido registrado en la plataforma <b>Elígeme</b>.</p>
                    <p>Para acceder a tu panel de paciente, ver tu historia clínica y hacer solicitudes, usa este código de acceso temporal junto con tu correo en nuestra página principal:</p>
                    <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
                        <span style="font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #1f3c88;">${accessCode}</span>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        console.log(`✅ Paciente creado y correo enviado a: ${email}`);
        res.status(201).json(newPatient);

    } catch (error) {
        console.error("❌ Error creando paciente:", error);
        res.status(500).json({ error: "Error técnico: " + error.message });
    }
});
// ==========================================
// NUEVO: GUARDAR EVALUACIÓN DEL CUIDADOR
// ==========================================
app.post('/api/visits/evaluation', async (req, res) => {
    try {
        const { visitId, rating, comments } = req.body;

        const updatedVisit = await prisma.medicalVisit.update({
            where: { id: parseInt(visitId) },
            data: {
                rating: parseInt(rating),
                evalComments: comments
            }
        });

        res.json({ message: "Evaluación guardada exitosamente", visit: updatedVisit });
    } catch (error) {
        console.error("❌ Error guardando evaluación:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});
// ==========================================
// 2. CREAR PROFESIONAL (CON CÓDIGO ALEATORIO)
// ==========================================
app.post('/api/professionals', async (req, res) => {
    console.log("CREANDO PROFESIONAL:", req.body);

    try {
        const { fullName, email, identification, phone, epsId } = req.body;

        if (!fullName || !email || !identification) {
            return res.status(400).json({ error: "Faltan datos obligatorios." });
        }


        const accessCode = generateAccessCode();

        const newProfessional = await prisma.user.create({
            data: {
                fullName,
                email,
                identification,
                phone: phone || "",
                address: "Consultorio EPS",
                role: 'PROFESIONAL',
                status: 'ACTIVO',


                password: accessCode,
                accessCode: accessCode,

                epsId: epsId ? parseInt(epsId) : null
            }
        });


        try {
            await transporter.sendMail({
                from: '"Eligeme Salud" <anayawilliam421@gmail.com>',
                to: email,
                subject: '👨‍⚕️ Bienvenido - Tu Acceso',
                html: `
                    <h2>Bienvenido, Dr/a. ${fullName}</h2>
                    <p>Has sido registrado en el sistema.</p>
                    <p>Tu usuario es: <b>${email}</b></p>
                    <p>Tu código de acceso es: <b style="font-size: 20px; color: blue;">${accessCode}</b></p>
                    <p>Por favor, no compartas este código.</p>
                `
            });
            console.log(`✉️ Correo enviado a ${email} con código ${accessCode}`);
        } catch (e) { console.error("Error enviando correo:", e); }

        res.status(201).json(newProfessional);

    } catch (error) {
        if (error.code === 'P2002') return res.status(400).json({ error: "Correo o cédula ya registrados." });
        console.error("❌ Error:", error);
        res.status(500).json({ error: "Error interno" });
    }
});

// Obtener lista de profesionales (FILTRADO POR EPS Y CON PROMEDIO DE ESTRELLAS)
app.get('/api/professionals', async (req, res) => {
    const { epsId } = req.query;
    const where = { role: 'PROFESIONAL' };

    if (epsId && epsId !== 'null' && epsId !== 'undefined') {
        where.epsId = parseInt(epsId);
    }

    try {
        const pros = await prisma.user.findMany({ where });

        // Buscamos todas las visitas que tengan calificación
        const evaluatedVisits = await prisma.medicalVisit.findMany({
            where: { rating: { not: null } },
            select: { professionalId: true, rating: true }
        });

        // Calculamos el promedio para cada profesional
        const prosWithRatings = pros.map(pro => {
            const proVisits = evaluatedVisits.filter(v => v.professionalId === pro.id);
            const totalRating = proVisits.reduce((sum, visit) => sum + visit.rating, 0);
            const averageRating = proVisits.length > 0 ? (totalRating / proVisits.length).toFixed(1) : 0;

            return {
                ...pro,
                averageRating: parseFloat(averageRating),
                totalEvaluations: proVisits.length
            };
        });

        res.json(prosWithRatings);
    } catch (error) {
        console.error("❌ Error obteniendo profesionales:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});
// ==========================================
// OBTENER PACIENTES (COMPLETO: CUIDADOR Y MÉDICO)
// ==========================================
app.get('/api/patients', async (req, res) => {
    try {
        const { epsId, caregiverId } = req.query;
        console.log(`🔎 Buscando pacientes. Filtros -> EPS: ${epsId} | Cuidador: ${caregiverId}`);

        const where = {};

        // 1. Si es EPS o MÉDICO (filtran por EPS)
        if (epsId && epsId !== 'undefined') {
            where.epsId = parseInt(epsId);
        }
        // 2. Si es CUIDADOR (filtra por asignación)
        else if (caregiverId && caregiverId !== 'undefined') {
            where.caregiverId = parseInt(caregiverId);
        }
        else {
            return res.json([]); // Seguridad
        }

        const patients = await prisma.patient.findMany({
            where: where,
            include: {

                eps: true,      // Información de la EPS
                visits: true,   // Historial de visitas médicas
                logs: true      // Bitácoras hechas por el cuidador

            },
            orderBy: { id: 'desc' }
        });

        res.json(patients);

    } catch (error) {
        console.error("❌ Error obteniendo pacientes:", error);
        res.status(500).json({ error: "Error al cargar pacientes" });
    }
});



// Asignar Cuidador a Paciente
app.put('/api/patients/:id/assign', async (req, res) => {
    try {
        await prisma.patient.update({
            where: { id: parseInt(req.params.id) },
            data: { caregiverId: parseInt(req.body.caregiverId) }
        });
        res.json({ message: "Asignado correctamente" });
    } catch (e) { res.status(500).json({ error: "Error en asignación" }); }
});

// ==========================================
// REEMPLAZAR EN index.js (Registro Inteligente)
// ==========================================

// 1. CONFIGURACIÓN DE MULTER: Definimos exactamente qué archivos aceptamos
const registerUpload = upload.fields([
    { name: 'docCaregiver', maxCount: 1 }, // Cédula Cuidador
    { name: 'docPatient', maxCount: 1 },   // Cédula Paciente
    { name: 'docHistory', maxCount: 1 },   // Historia Clínica
    { name: 'docPower', maxCount: 1 },     // Poder
    { name: 'docTraining', maxCount: 1 },  // Diploma SENA
    { name: 'docCv', maxCount: 1 }         // Hoja de Vida (Contratista)
]);

// 2. RUTA DE REGISTRO
app.post('/api/caregivers', registerUpload, async (req, res) => {
    try {
        const data = req.body;
        const files = req.files || {};

        console.log(`📩 Recibiendo postulación: ${data.fullName} - Tipo: ${data.relationship}`);

        // --- LÓGICA DE ESTADO (AUTO-PRESELECCIÓN) ---
        let initialStatus = 'PENDIENTE';
        let generatedCode = null;
        let userPassword = null;

        // Solo preseleccionamos si es FAMILIAR y cumple requisitos críticos
        // (Los contratistas siempre pasan a revisión manual)
        if (data.relationship !== 'CONTRATISTA') {
            const isCritical = (data.disabilityGrade === 'SEVERA' || data.disabilityGrade === 'TOTAL');
            const hasOrder = (data.hasMedicalOrder === 'SI');

            if (isCritical && hasOrder) {
                initialStatus = 'PRESELECCIONADO';
                generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                userPassword = generatedCode;
            }
        }

        // --- CREAR USUARIO EN BD ---
        const newUser = await prisma.user.create({
            data: {
                fullName: data.fullName,
                email: data.email,
                identification: data.identification,
                phone: data.phone,
                address: data.address,
                docType: data.docType,
                birthDate: data.birthDate ? new Date(data.birthDate) : null,

                role: 'CUIDADOR', // Siempre es rol Cuidador en el sistema
                status: initialStatus,

                // Datos de la postulación
                epsId: data.epsId ? parseInt(data.epsId) : null,
                senaCode: data.senaCode || null,
                experienceYears: data.experienceYears || "0",
                hasTransport: data.hasTransport === 'true',

                // Datos del Paciente (Solo si es familiar)
                patientName: data.patientName || null,
                patientDoc: data.patientDoc || null,
                disabilityGrade: data.disabilityGrade || null,
                hasMedicalOrder: data.hasMedicalOrder || null,
                diagnosis: data.diagnosis || null,

                // Relación y Servicio
                relationship: data.relationship,
                careType: data.careType,
                startDate: data.startDate ? new Date(data.startDate) : null,

                // --- GUARDADO DE ARCHIVOS EN SUS COLUMNAS CORRECTAS ---
                // Nota: Usamos el operador ?. para evitar errores si no suben algún archivo
                fileCaregiverId: files['docCaregiver']?.[0]?.path || null,
                filePatientId:   files['docPatient']?.[0]?.path || null,
                fileHistory:     files['docHistory']?.[0]?.path || null,
                filePower:       files['docPower']?.[0]?.path || null,
                fileTraining:    files['docTraining']?.[0]?.path || null,

                // Usamos el campo senaFile para guardar la HV del contratista si existe
                senaFile: files['docCv']?.[0]?.path || null,

                // Credenciales (si aplica)
                accessCode: generatedCode,
                password: userPassword || ''
            }
        });

        // --- ENVIAR CORREO DE PRESELECCIÓN (SOLO SI APLICA) ---
        if (initialStatus === 'PRESELECCIONADO' && generatedCode) {
            try {
                await transporter.sendMail({
                    from: '"Eligeme Salud" <anayawilliam421@gmail.com>',
                    to: newUser.email,
                    subject: '¡Felicidades! Has sido Preseleccionado',
                    html: `
                        <h2>Hola ${newUser.fullName},</h2>
                        <p>Tu solicitud ha sido aprobada automáticamente por la condición del paciente.</p>
                        <div style="background:#eef2ff; padding:15px; border-radius:8px;">
                            <p><strong>Usuario:</strong> ${newUser.email}</p>
                            <p><strong>Código de Acceso:</strong> ${generatedCode}</p>
                        </div>
                    `
                });
            } catch (err) { console.error("Error correo:", err); }
        }

        console.log(`✅ Usuario creado: ${newUser.id} | Estado: ${initialStatus}`);
        res.json({ message: "Registro exitoso", status: initialStatus });

    } catch (e) {
        console.error("❌ Error en registro:", e);
        if (e.code === 'P2002') return res.status(400).json({ error: "Cédula o Correo ya registrados." });
        res.status(500).json({ error: "Error interno del servidor." });
    }
});
// Obtener Cuidadores (FILTRADO POR EPS)
app.get('/api/caregivers', async (req, res) => {
    const { epsId, status } = req.query;

    const where = { role: 'CUIDADOR' };

    // Filtro por EPS
    if (epsId && epsId !== 'null' && epsId !== 'undefined') {
        where.epsId = parseInt(epsId);
    }
    // Filtro por Status (Pendiente, Aprobado, etc.)
    if (status) {
        where.status = status;
    }

    try {
        const users = await prisma.user.findMany({
            where,
            orderBy: { id: 'desc' },
            include: { eps: true } // Para ver a qué EPS postularon (útil para Super Admin)
        });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: "Error obteniendo cuidadores" });
    }
});

// Cambio de Estado (Aprobar/Preseleccionar)
app.put('/api/caregivers/:id/status', async (req, res) => {
    const { id } = req.params; const { status } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { id: parseInt(id) } });
        if (!user) return res.status(404).json({ error: "No encontrado" });

        let updateData = { status };
        let newAccessCode = user.accessCode;

        if (status === 'PRESELECCIONADO' || status === 'APROBADO') {
            if (!newAccessCode) {
                newAccessCode = Math.floor(100000 + Math.random() * 900000).toString();
                updateData.accessCode = newAccessCode;
            }
            // Enviar correo
             await transporter.sendMail({
                to: user.email,
                subject: `🎉 Estado Actualizado: ${status}`,
                html: `<h2>Tu solicitud ha sido actualizada a ${status}.</h2><p>Tu código de acceso es: <b>${newAccessCode}</b></p>`
            });
        }

        const updated = await prisma.user.update({ where: { id: parseInt(id) }, data: updateData });
        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error cambiando estado" });
    }
});

// Subir Certificado extra
app.post('/api/upload-certificate/:userId', upload.single('certificate'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Sin archivo" });
    try {
        await prisma.user.update({
            where: { id: parseInt(req.params.userId) },
            data: { senaFile: `/uploads/${req.file.filename}` }
        });
        res.json({ message: "Archivo subido" });
    } catch (e) { res.status(500).json({ error: "Error subida" }); }
});

// =================================================================
// 5. VISITAS MÉDICAS Y ÓRDENES
// =================================================================
app.post('/api/visits', async (req, res) => {
    try {
        // Ahora recibimos la firma y un arreglo opcional de órdenes médicas
        const { professionalId, patientId, formData, signature, medicalOrders } = req.body;

        // 1. Crear la visita médica con su firma
        const newVisit = await prisma.medicalVisit.create({
            data: {
                professionalId: parseInt(professionalId),
                patientId: parseInt(patientId),
                formData: JSON.stringify(formData),
                signature: signature || null,
                time: new Date().toLocaleTimeString(),
                date: new Date()
            }
        });

        // 2. Si el médico generó órdenes (cambios de medicamento, especialistas), las guardamos
        if (medicalOrders && medicalOrders.length > 0) {
            const ordersToSave = medicalOrders.map(order => ({
                orderType: order.type,
                description: order.description,
                professionalId: parseInt(professionalId),
                patientId: parseInt(patientId),
                visitId: newVisit.id,
                signature: order.signature || null
            }));

            await prisma.medicalOrder.createMany({
                data: ordersToSave
            });
            console.log(`✅ ${medicalOrders.length} órdenes médicas generadas.`);
        }

        console.log(`✅ Visita registrada con éxito. Paciente ID: ${patientId}`);
        res.json({ message: "Visita y órdenes guardadas", visit: newVisit });
    } catch (error) {
        console.error("❌ Error guardando visita:", error);
        res.status(500).json({ error: "Error guardando visita y órdenes" });
    }
});

// Obtener Visitas
app.get('/api/visits', async (req, res) => {
    // Aquí también podrías filtrar por EPS si pasas el patientId o professionalId vinculados
    const visits = await prisma.medicalVisit.findMany({
        orderBy: { date: 'desc' },
        include: { patient: true }
    });
    res.json(visits);
});
// ==========================================
// CREAR BITÁCORA
// ==========================================
app.post('/api/logs', async (req, res) => {
    console.log("📝 Recibiendo nueva bitácora...");

    try {
        // 👇 ACTUALIZADO: Recibimos caregiverSignature desde el frontend
        const { caregiverId, patientId, formData, caregiverSignature } = req.body;

        // Validaciones básicas
        if (!caregiverId || !patientId || !formData) {
            return res.status(400).json({ error: "Faltan datos obligatorios." });
        }

        // CREACIÓN EN BASE DE DATOS
        const newLog = await prisma.log.create({
            data: {
                caregiverId: parseInt(caregiverId),
                patientId: parseInt(patientId),
                date: new Date(),

                // Guardamos todo el formulario
                content: JSON.stringify(formData),

                // Extraemos el estado de ánimo
                mood: formData.mood || "Tranquilo",

                // Extraemos si hay alerta
                alert: Boolean(formData.alert),

                // 👇 NUEVO: Guardamos la firma digital en la base de datos 👇
                caregiverSignature: caregiverSignature || null
            }
        });

        console.log(`✅ Bitácora guardada. ID: ${newLog.id}`);
        res.status(201).json(newLog);

    } catch (error) {
        console.error("❌ Error guardando bitácora:", error);
        res.status(500).json({ error: "Error interno al guardar bitácora." });
    }
});
// ==========================================
// OBTENER VISITA PENDIENTE DE CALIFICAR PARA EL CUIDADOR
// ==========================================
app.get('/api/visits/pending-evaluation/:caregiverId', async (req, res) => {
    try {
        const { caregiverId } = req.params;

        // 1. Buscamos la última visita del paciente asignado a este cuidador que NO tenga calificación
        const pendingVisit = await prisma.medicalVisit.findFirst({
            where: {
                rating: null, // Solo las que no han sido calificadas
                patient: {
                    caregiverId: parseInt(caregiverId) // Que pertenezcan al paciente de este cuidador
                }
            },
            orderBy: {
                date: 'desc' // Traer la más reciente
            }
        });

        // Si no hay visitas pendientes, devolvemos null
        if (!pendingVisit) {
            return res.json(null);
        }

        // 2. Buscamos los datos del profesional que hizo la visita
        const professional = await prisma.user.findUnique({
            where: { id: pendingVisit.professionalId }
        });

        // 3. Enviamos los datos listos para el frontend
        res.json({
            visitId: pendingVisit.id,
            name: professional ? professional.fullName : 'Doctor',
            specialty: professional?.position || 'Atención Domiciliaria'
        });

    } catch (error) {
        console.error("❌ Error buscando visitas pendientes:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});
// =================================================================
// 7. REPORTES FINANCIEROS Y OTROS
// =================================================================

// Crear Reporte
app.post('/api/financial-reports', async (req, res) => {
    try {
        const data = req.body;
        const ref = `RF-${Date.now().toString().slice(-6)}`;

        const newReport = await prisma.financialReport.create({
            data: {
                reference: ref,
                period: data.period,
                epsName: data.epsName,
                responsible: data.responsible,
                totalBudget: String(data.totalBudget),
                totalExecuted: String(data.totalExecuted),
                balance: String(data.balance),
                expensesData: JSON.stringify(data.expenses),
                generalObs: data.generalObs,
                elaboratedBy: data.elaboratedBy,
                reviewedBy: data.reviewedBy
            }
        });
        console.log(`💰 Reporte Financiero: ${ref}`);
        res.json(newReport);
    } catch (error) {
        console.error("Error reporte:", error);
        res.status(500).json({ error: "Error al guardar reporte" });
    }
});

// Obtener Reportes
app.get('/api/financial-reports', async (req, res) => {
    try {
        const reports = await prisma.financialReport.findMany({ orderBy: { date: 'desc' } });
        res.json(reports);
    } catch (error) { res.status(500).json({ error: "Error reportes" }); }
});

// Lista de EPS (Para el select del formulario público)
app.get('/api/eps-list', async (req, res) => {
    try {
        const eps = await prisma.eps.findMany({ select: { id: true, name: true } });
        res.json(eps);
    } catch (error) { res.status(500).json({ error: "Error al cargar EPS" }); }
});


// =================================================================
// 6. OBTENER BITÁCORAS
// =================================================================
app.get('/api/logs', async (req, res) => {
    try {
        const { caregiverId, patientId } = req.query;


        console.log(`🔎 Buscando historial de bitácoras. Filtros -> Caregiver: ${caregiverId} | Patient: ${patientId}`);

        const where = {};


        if (caregiverId && caregiverId !== 'undefined' && caregiverId !== 'null') {
            where.caregiverId = parseInt(caregiverId);
        }

        if (patientId && patientId !== 'undefined' && patientId !== 'null') {
            where.patientId = parseInt(patientId);
        }

        const logs = await prisma.log.findMany({
            where: where,
            orderBy: { date: 'desc' }, // Las más nuevas primero
            include: {
                patient: true
            }
        });

        res.json(logs);

    } catch (error) {
        console.error("❌ Error obteniendo historial de bitácoras:", error);
        res.status(500).json({ error: "Error al cargar el historial de bitácoras" });
    }
});
// =================================================================
// INICIO SERVIDOR
// =================================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});