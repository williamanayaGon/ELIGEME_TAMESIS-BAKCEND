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

import crypto from 'crypto';
import helmet from 'helmet';
import {
    requireAuth,
    requireRole,
    alcanceEntidad,
    pacienteEnAlcance,
    firmarToken,
    hashearClave,
    verificarClave,
    limiteLogin,
    limiteGeneral,
    registrarEvento
} from './auth.middleware.js';
import crearRutasFinancieras from './financial.routes.js';
//import furagRoutes from './furag.routes.js';/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// --- Multer con restricciones ---
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            // Se descarta el nombre original: puede contener rutas o caracteres peligrosos.
            const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
            cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
        }
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 6 },
    fileFilter: (req, file, cb) => {
        const permitidos = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!permitidos.includes(file.mimetype)) {
            return cb(new Error('Solo se aceptan archivos PDF, JPG o PNG.'));
        }
        cb(null, true);
    }
});

// --- Middleware ---
app.use(helmet());

// Orígenes permitidos. Se normalizan porque una barra final, un espacio o
// unas comillas de más bastan para que el navegador rechace toda respuesta,
// y el error que muestra no dice cuál de las tres fue.
const normalizarOrigen = (valor) =>
    valor.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

const origenesPermitidos = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map(normalizarOrigen)
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        // Sin cabecera Origin: curl, health checks de Render o el propio servidor.
        if (!origin) return callback(null, true);
        callback(null, origenesPermitidos.includes(normalizarOrigen(origin)));
    },
    credentials: true
}));

console.log(
    origenesPermitidos.length
        ? `🌐 Orígenes permitidos: ${origenesPermitidos.join(', ')}`
        : '⚠️  FRONTEND_URL no está definida: el navegador bloqueará todas las peticiones.'
);
app.use(express.json({ limit: '1mb' }));
app.use('/api', limiteGeneral);

// Los soportes documentales quedan detrás de autenticación.
app.use('/uploads', requireAuth, express.static(uploadDir));

// --- Correo, desde variables de entorno ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    }
});

// --- Módulo de reportes de gestión ---
//app.use('/api/furag', furagRoutes);//

// =================================================================
// AYUDAS DE SALIDA SEGURA
// =================================================================

// Ni el hash de la clave ni el código de acceso deben salir del servidor.
const sinCredenciales = ({ password, accessCode, ...resto }) => resto;

// Roles que ven todas las entidades (Superintendencia y admin global).
const esAlcanceGlobal = (auth) =>
    auth?.role === 'SUPER' || (auth?.role === 'ADMIN' && auth?.epsId === null);



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
app.post('/api/ai-assistant', requireAuth, async (req, res) => {
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
// ============================================================================
// B. LOGIN — reemplaza completo el bloque de la línea 113
//    Cambios: sin accesos maestros embebidos, con bcrypt, con JWT y rate limit.
// ============================================================================

app.post('/api/login', limiteLogin, async (req, res) => {
    const { email, credential, type } = req.body;

    if (!email || !credential) {
        return res.status(400).json({ error: 'Escribe tu correo y tu contraseña.' });
    }

    // Mensaje único para todos los fallos: no revela si el correo existe.
    const CREDENCIALES_INVALIDAS = 'El correo o la contraseña no coinciden.';

    try {
        // ------------------------------------------------------------------
        // 1. PACIENTE (acceso por código)
        // ------------------------------------------------------------------
        if (type === 'CODE') {
            const paciente = await prisma.patient.findFirst({
                where: { email },
                select: { id: true, fullName: true, email: true, accessCode: true, epsId: true }
            });

            if (paciente?.accessCode) {
                const { valida } = await verificarClave(credential, paciente.accessCode);
                if (valida) {
                    await registrarEvento(prisma, { ...req, auth: { id: paciente.id, role: 'PACIENTE', epsId: paciente.epsId } }, {
                        action: 'LOGIN', entity: 'Patient', entityId: paciente.id
                    });
                    return res.json({
                        token: firmarToken({ id: paciente.id, role: 'PACIENTE', epsId: paciente.epsId }),
                        user: {
                            id: paciente.id,
                            role: 'PACIENTE',
                            fullName: paciente.fullName,
                            email: paciente.email,
                            epsId: paciente.epsId
                        }
                    });
                }
            }
            return res.status(401).json({ error: CREDENCIALES_INVALIDAS });
        }

        // ------------------------------------------------------------------
        // 2. ADMINISTRADOR DE ENTIDAD
        // ------------------------------------------------------------------
        const cuenta = await prisma.eps.findFirst({ where: { adminUser: email } });

        if (cuenta) {
            const { valida, necesitaMigracion } = await verificarClave(credential, cuenta.adminPass);
            if (!valida) return res.status(401).json({ error: CREDENCIALES_INVALIDAS });

            // Rehashea al vuelo las contraseñas heredadas en texto plano.
            if (necesitaMigracion) {
                await prisma.eps.update({
                    where: { id: cuenta.id },
                    data: { adminPass: await hashearClave(credential) }
                });
                console.log(`🔐 Contraseña migrada a hash: entidad ${cuenta.id}`);
            }

            return res.json({
                token: firmarToken({ id: cuenta.id, role: 'ADMIN', epsId: cuenta.id }),
                user: {
                    id: cuenta.id,
                    fullName: cuenta.name,
                    email: cuenta.adminUser,
                    role: 'ADMIN',
                    isEps: true,
                    epsId: cuenta.id
                }
            });
        }

        // ------------------------------------------------------------------
        // 3. CUIDADORES Y PROFESIONALES
        // ------------------------------------------------------------------
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(401).json({ error: CREDENCIALES_INVALIDAS });

        if (user.role === 'CUIDADOR' && !['APROBADO', 'PRESELECCIONADO'].includes(user.status)) {
            return res.status(403).json({ error: 'Tu solicitud sigue en revisión.' });
        }

        const porClave = await verificarClave(credential, user.password);
        const porCodigo = await verificarClave(credential, user.accessCode);

        if (!porClave.valida && !porCodigo.valida) {
            await registrarEvento(prisma, req, {
                action: 'LOGIN_FALLIDO', entity: 'User', entityId: user.id
            });
            return res.status(401).json({ error: CREDENCIALES_INVALIDAS });
        }

        if (porClave.valida && porClave.necesitaMigracion) {
            await prisma.user.update({
                where: { id: user.id },
                data: { password: await hashearClave(credential) }
            });
        }

        const { password, accessCode, ...userSeguro } = user;

        await registrarEvento(prisma, { ...req, auth: { id: user.id, role: user.role, epsId: user.epsId } }, {
            action: 'LOGIN', entity: 'User', entityId: user.id
        });

        return res.json({
            token: firmarToken({ id: user.id, role: user.role, epsId: user.epsId }),
            user: userSeguro
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        return res.status(500).json({ error: 'No fue posible iniciar sesión. Intenta de nuevo.' });
    }
});


// const nodemailer = require('nodemailer');

// ==========================================
// RUTA CREAR PACIENTE (CON ENVÍO DE CÓDIGO)
// ==========================================
app.post('/api/patients', requireAuth, requireRole('ADMIN', 'SUPER'), async (req, res) => {
    console.log("📥 Recibiendo Paciente:", req.body);

    try {
        const {
            fullName, age, epsId, condition, diagnosis,
            address, phone, stratum, careInstructions,
            zoneCategory, zoneDetail,
            email, // <-- NUEVO CAMPO RECIBIDO DEL FRONTEND
            identification // Cédula: llave de cruce con las postulaciones
        } = req.body;

        // La entidad sale del token. Un admin no puede crear pacientes en otra
        // EPS mandando otro epsId en el cuerpo; solo un rol global puede elegirla.
        const epsIdInt = esAlcanceGlobal(req.auth)
            ? parseInt(epsId, 10)
            : req.auth.epsId;

        const cedula = (identification || '').trim();

        // Validamos que envíen el correo
        if (!fullName || !age || !epsIdInt || !email) {
            return res.status(400).json({ error: "Faltan datos: Nombre, Edad, Correo y EPS son obligatorios." });
        }

        if (cedula) {
            const repetida = await prisma.patient.findUnique({ where: { identification: cedula } });
            if (repetida) {
                return res.status(400).json({ error: "Ya existe un paciente con esa cédula." });
            }
        }

        // 1. GENERAR CÓDIGO ALEATORIO DE 6 DÍGITOS
        const accessCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 2. CREAR PACIENTE EN BD
        const newPatient = await prisma.patient.create({
            data: {
                fullName,
                age: parseInt(age),
                identification: cedula || null,
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

        // 3. ENVIAR CORREO
        // Se reutiliza el transporter global: las credenciales viven en el .env,
        // nunca en el código.
        const mailOptions = {
            from: `"Elígeme - Cuidado" <${process.env.MAIL_USER}>`,
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
app.post('/api/professionals', requireAuth, requireRole('ADMIN', 'SUPER'), async (req, res) => {
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
                from: `"Eligeme Salud" <${process.env.MAIL_USER}>`,
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
app.get('/api/professionals', requireAuth, requireRole('ADMIN', 'SUPER'), async (req, res) => {
    // El alcance sale del token, no de la query: el cliente no elige qué EPS ve.
    const where = { role: 'PROFESIONAL', ...alcanceEntidad(req.auth) };

    // Solo un rol global puede además acotar a una entidad concreta.
    const { epsId } = req.query;
    if (esAlcanceGlobal(req.auth) && epsId && epsId !== 'null' && epsId !== 'undefined') {
        where.epsId = parseInt(epsId, 10);
    }

    try {
        const pros = (await prisma.user.findMany({ where })).map(sinCredenciales);

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
// ============================================================================
// C. GET /api/patients
//    El epsId sale del token, no del query param.
// ============================================================================

app.get('/api/patients', requireAuth, async (req, res) => {
    try {
        const { role, id, epsId } = req.auth;
        let where;

        if (role === 'CUIDADOR') {
            where = { caregiverId: id };
        } else if (role === 'PACIENTE') {
            where = { id };
        } else if (role === 'SUPER' || (role === 'ADMIN' && epsId === null)) {
            where = {};
        } else if (epsId !== null) {
            where = { epsId };
        } else {
            return res.json([]);
        }

        const patients = await prisma.patient.findMany({
            where,
            include: { eps: true, visits: true, logs: true },
            orderBy: { id: 'desc' }
        });

        // El código de acceso no tiene por qué viajar a ninguna interfaz.
        const limpios = patients.map(({ accessCode, ...p }) => p);

        await registrarEvento(prisma, req, {
            action: 'LECTURA', entity: 'Patient', detail: { cantidad: limpios.length }
        });

        res.json(limpios);
    } catch (error) {
        console.error('❌ Error obteniendo pacientes:', error);
        res.status(500).json({ error: 'No se pudieron cargar los pacientes.' });
    }
});

// Asignar Cuidador a Paciente
app.put('/api/patients/:id/assign', requireAuth, requireRole('ADMIN', 'SUPER'), async (req, res) => {
    try {
        const patientId = parseInt(req.params.id, 10);
        const caregiverId = parseInt(req.body.caregiverId, 10);

        if (!Number.isInteger(patientId) || !Number.isInteger(caregiverId)) {
            return res.status(400).json({ error: 'Selecciona un paciente y un cuidador válidos.' });
        }

        const permitido = await pacienteEnAlcance(prisma, req.auth, patientId);
        if (!permitido) {
            return res.status(403).json({ error: 'No tienes acceso a este paciente.' });
        }

        const cuidador = await prisma.user.findUnique({
            where: { id: caregiverId },
            select: { id: true, role: true, status: true, epsId: true }
        });

        if (!cuidador || cuidador.role !== 'CUIDADOR') {
            return res.status(400).json({ error: 'El usuario seleccionado no es un cuidador.' });
        }
        if (cuidador.status !== 'APROBADO') {
            return res.status(400).json({ error: 'El cuidador debe estar aprobado antes de asignarlo.' });
        }

        await prisma.patient.update({
            where: { id: patientId },
            data: { caregiverId, assignedAt: new Date() }
        });

        await registrarEvento(prisma, req, {
            action: 'EDICION', entity: 'Patient', entityId: patientId,
            detail: { asignado: caregiverId }
        });

        res.json({ message: 'Cuidador asignado.' });
    } catch (e) {
        console.error('❌ Error en asignación:', e);
        res.status(500).json({ error: 'No se pudo completar la asignación.' });
    }
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

// Convierte lo que entrega multer en la URL con la que el navegador pedirá el archivo.
const rutaPublica = (campo) => {
    const nombre = campo?.[0]?.filename;
    return nombre ? `/uploads/${nombre}` : null;
};

// 2. RUTA DE REGISTRO
app.post('/api/caregivers', registerUpload, async (req, res) => {
    try {
        const data = req.body;
        const files = req.files || {};

        console.log(`📩 Recibiendo postulación: ${data.fullName} - Tipo: ${data.relationship}`);

        // El formulario viaja como multipart: los booleanos llegan en texto.
        const requiresHomeCare = data.requiresHomeCare === 'true' || data.requiresHomeCare === true;
        const isDisabled = data.isDisabled === 'true' || data.isDisabled === true;

        // El formulario envía "Contratista"; se normaliza para no depender del case.
        const esContratista = String(data.relationship || '').trim().toUpperCase() === 'CONTRATISTA';

        // --- LÓGICA DE ESTADO (AUTO-PRESELECCIÓN) ---
        let initialStatus = 'PENDIENTE';
        let generatedCode = null;
        let userPassword = null;

        // Solo preseleccionamos si es FAMILIAR y cumple requisitos críticos
        // (Los contratistas siempre pasan a revisión manual)
        if (!esContratista) {
            const isCritical = (data.disabilityGrade === 'SEVERA' || data.disabilityGrade === 'TOTAL');
            const hasOrder = (data.hasMedicalOrder === 'SI');

            if (isCritical && hasOrder) {
                initialStatus = 'PRESELECCIONADO';
                generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                userPassword = generatedCode;
            }
        }

        // --- ASIGNACIÓN AUTOMÁTICA DE PACIENTE ---
        // Se dispara cuando el postulante declara que el paciente requiere cuidado
        // en casa Y es discapacitado, Y la cédula que digitó corresponde a un
        // paciente ya registrado en la misma EPS.
        const cedulaPaciente = (data.patientDoc || '').trim();
        const epsIdInt = data.epsId ? parseInt(data.epsId, 10) : null;

        let pacienteAsignado = null;   // paciente que finalmente se asigna
        let motivoNoAsignado = null;   // por qué no se asignó, para informar a la EPS

        if (!esContratista && requiresHomeCare && isDisabled && cedulaPaciente) {
            const candidato = await prisma.patient.findUnique({
                where: { identification: cedulaPaciente },
                select: { id: true, fullName: true, caregiverId: true, epsId: true }
            });

            if (!candidato) {
                motivoNoAsignado = 'NO_ENCONTRADO';
            } else if (epsIdInt !== null && candidato.epsId !== epsIdInt) {
                // El paciente existe pero pertenece a otra entidad: lo revisa un humano.
                motivoNoAsignado = 'OTRA_EPS';
            } else if (candidato.caregiverId) {
                // Se respeta el cuidador actual; la postulación pasa a revisión manual.
                motivoNoAsignado = 'YA_TIENE_CUIDADOR';
            } else {
                pacienteAsignado = candidato;
            }
        }

        // Un paciente asignado automáticamente implica preselección con credenciales.
        if (pacienteAsignado) {
            initialStatus = 'PRESELECCIONADO';
            if (!generatedCode) {
                generatedCode = crypto.randomBytes(4).toString('hex').toUpperCase();
                userPassword = generatedCode;
            }
        } else if (motivoNoAsignado === 'YA_TIENE_CUIDADOR') {
            // Aunque cumpliera los criterios críticos, el conflicto lo decide la EPS.
            initialStatus = 'PENDIENTE';
            generatedCode = null;
            userPassword = null;
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
                requiresHomeCare,
                isDisabled,
                autoAssignedPatientId: pacienteAsignado?.id ?? null,
                statusChangedAt: new Date(),

                // Relación y Servicio
                relationship: data.relationship,
                careType: data.careType,
                startDate: data.startDate ? new Date(data.startDate) : null,

                // --- GUARDADO DE ARCHIVOS EN SUS COLUMNAS CORRECTAS ---
                // Se guarda la URL pública, no la ruta del disco: file.path es
                // absoluta ("C:\...") y no sirve para construir el enlace.
                fileCaregiverId: rutaPublica(files['docCaregiver']),
                filePatientId:   rutaPublica(files['docPatient']),
                fileHistory:     rutaPublica(files['docHistory']),
                filePower:       rutaPublica(files['docPower']),
                fileTraining:    rutaPublica(files['docTraining']),

                // Usamos el campo senaFile para guardar la HV del contratista si existe
                senaFile: rutaPublica(files['docCv']),

                // Credenciales (si aplica)
                accessCode: generatedCode,
                password: userPassword || ''
            }
        });

        // --- VINCULAR EL PACIENTE AL NUEVO CUIDADOR ---
        // La condición sobre caregiverId evita pisar una asignación que haya
        // ocurrido entre la consulta anterior y este punto.
        if (pacienteAsignado) {
            const vinculo = await prisma.patient.updateMany({
                where: { id: pacienteAsignado.id, caregiverId: null },
                data: { caregiverId: newUser.id, assignedAt: new Date() }
            });

            if (vinculo.count === 0) {
                // Alguien tomó el paciente primero: se revierte a revisión manual.
                console.warn(`⚠️ El paciente ${pacienteAsignado.id} ya fue asignado. Postulación ${newUser.id} pasa a PENDIENTE.`);
                pacienteAsignado = null;
                motivoNoAsignado = 'YA_TIENE_CUIDADOR';
                initialStatus = 'PENDIENTE';
                generatedCode = null;

                await prisma.user.update({
                    where: { id: newUser.id },
                    data: { status: 'PENDIENTE', accessCode: null, password: '', autoAssignedPatientId: null }
                });
            }
        }

        // --- ENVIAR CORREO DE PRESELECCIÓN (SOLO SI APLICA) ---
        if (initialStatus === 'PRESELECCIONADO' && generatedCode) {
            const bloquePaciente = pacienteAsignado
                ? `<p>Se te asignó automáticamente el paciente <strong>${pacienteAsignado.fullName}</strong>, ya que la cédula que registraste corresponde a un paciente de nuestra base.</p>`
                : '';
            try {
                await transporter.sendMail({
                    from: `"Eligeme Salud" <${process.env.MAIL_USER}>`,
                    to: newUser.email,
                    subject: '¡Felicidades! Has sido Preseleccionado',
                    html: `
                        <h2>Hola ${newUser.fullName},</h2>
                        <p>Tu solicitud ha sido aprobada automáticamente por la condición del paciente.</p>
                        ${bloquePaciente}
                        <div style="background:#eef2ff; padding:15px; border-radius:8px;">
                            <p><strong>Usuario:</strong> ${newUser.email}</p>
                            <p><strong>Código de Acceso:</strong> ${generatedCode}</p>
                        </div>
                    `
                });
            } catch (err) { console.error("Error correo:", err); }
        }

        console.log(`✅ Usuario creado: ${newUser.id} | Estado: ${initialStatus}` +
            (pacienteAsignado ? ` | Paciente auto-asignado: ${pacienteAsignado.id}` : ''));

        res.json({
            message: "Registro exitoso",
            status: initialStatus,
            autoAssigned: Boolean(pacienteAsignado),
            assignedPatientName: pacienteAsignado?.fullName || null,
            assignmentIssue: motivoNoAsignado
        });

    } catch (e) {
        console.error("❌ Error en registro:", e);
        if (e.code === 'P2002') return res.status(400).json({ error: "Cédula o Correo ya registrados." });
        res.status(500).json({ error: "Error interno del servidor." });
    }
});
// Obtener Cuidadores (FILTRADO POR EPS)
app.get('/api/caregivers', requireAuth, requireRole('ADMIN', 'SUPER'), async (req, res) => {
    const { epsId, status } = req.query;

    // El alcance sale del token, no de la query.
    const where = { role: 'CUIDADOR', ...alcanceEntidad(req.auth) };

    // Solo un rol global puede además acotar a una entidad concreta.
    if (esAlcanceGlobal(req.auth) && epsId && epsId !== 'null' && epsId !== 'undefined') {
        where.epsId = parseInt(epsId, 10);
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
        res.json(users.map(sinCredenciales));
    } catch (error) {
        console.error('❌ Error obteniendo cuidadores:', error);
        res.status(500).json({ error: "Error obteniendo cuidadores" });
    }
});

// Cambio de Estado (Aprobar/Preseleccionar)
app.put('/api/caregivers/:id/status', requireAuth, requireRole('ADMIN', 'SUPER'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    const ESTADOS = ['PENDIENTE', 'PRESELECCIONADO', 'APROBADO', 'RECHAZADO', 'ACTIVO'];
    if (!ESTADOS.includes(status)) {
        return res.status(400).json({ error: 'El estado indicado no es válido.' });
    }

    try {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) return res.status(404).json({ error: 'No encontramos ese cuidador.' });

        // Un admin de entidad no puede tocar cuidadores de otra.
        if (req.auth.role === 'ADMIN' && req.auth.epsId !== null && user.epsId !== req.auth.epsId) {
            return res.status(403).json({ error: 'Este cuidador pertenece a otra entidad.' });
        }

        const updateData = { status, statusChangedAt: new Date() };
        let codigoParaCorreo = null;

        if ((status === 'PRESELECCIONADO' || status === 'APROBADO') && !user.accessCode) {
            // Código de 8 caracteres con entropía criptográfica, no Math.random.
            codigoParaCorreo = crypto.randomBytes(4).toString('hex').toUpperCase();
            updateData.accessCode = await hashearClave(codigoParaCorreo);
        }

        const updated = await prisma.user.update({ where: { id }, data: updateData });

        if (codigoParaCorreo) {
            await transporter.sendMail({
                to: user.email,
                subject: `Tu solicitud pasó a estado ${status}`,
                html: `
                    <p>Hola ${user.fullName},</p>
                    <p>Tu solicitud en el programa de cuidado domiciliario pasó a estado <b>${status}</b>.</p>
                    <p>Tu código de acceso es: <b>${codigoParaCorreo}</b></p>
                    <p>Guárdalo en un lugar seguro. No lo compartas con nadie.</p>
                `
            });
        }

        await registrarEvento(prisma, req, {
            action: 'EDICION', entity: 'User', entityId: id, detail: { nuevoEstado: status }
        });

        const { password, accessCode, ...seguro } = updated;
        res.json(seguro);
    } catch (e) {
        console.error('❌ Error cambiando estado:', e);
        res.status(500).json({ error: 'No se pudo actualizar el estado.' });
    }
});

// Subir Certificado extra
app.post('/api/upload-certificate/:userId', requireAuth, upload.single('certificate'), async (req, res) => {
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
app.post('/api/visits', requireAuth, requireRole('PROFESIONAL', 'ADMIN'), async (req, res) => {
    try {
        // Ahora recibimos la firma y un arreglo opcional de órdenes médicas
        const { professionalId, patientId, formData, signature, medicalOrders } = req.body;
        const paciente = await prisma.patient.findUnique({
            where: { id: parseInt(patientId, 10) },
            select: { epsId: true }
        });
        if (!paciente) return res.status(404).json({ error: 'No encontramos ese paciente.' });

        // 1. Crear la visita médica con su firma
        const newVisit = await prisma.medicalVisit.create({
            data: {
                professionalId: parseInt(professionalId),
                patientId: parseInt(patientId),
                formData: JSON.stringify(formData),
                signature: signature || null,
                time: new Date().toLocaleTimeString(),
                date: new Date(),
                epsId: paciente.epsId
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

// ============================================================================
// D. GET /api/visits — reemplaza la línea 704
//    Antes devolvía TODAS las visitas de TODAS las entidades.
// ============================================================================

app.get('/api/visits', requireAuth, async (req, res) => {
    try {
        const { role, id, epsId } = req.auth;
        let where = {};

        if (role === 'PROFESIONAL') {
            where = { professionalId: id };
        } else if (role === 'CUIDADOR') {
            where = { patient: { caregiverId: id } };
        } else if (role === 'PACIENTE') {
            where = { patientId: id };
        } else if (role === 'SUPER' || (role === 'ADMIN' && epsId === null)) {
            where = {};
        } else if (epsId !== null) {
            where = { patient: { epsId } };
        } else {
            return res.json([]);
        }

        const visits = await prisma.medicalVisit.findMany({
            where,
            orderBy: { date: 'desc' },
            include: {
                patient: {
                    select: { id: true, fullName: true, age: true, diagnosis: true, epsId: true }
                }
            }
        });

        res.json(visits);
    } catch (error) {
        console.error('❌ Error obteniendo visitas:', error);
        res.status(500).json({ error: 'No se pudieron cargar las visitas.' });
    }
});
// ==========================================
// CREAR BITÁCORA
// ==========================================
app.post('/api/logs', requireAuth, requireRole('CUIDADOR', 'ADMIN'), async (req, res) => {
    console.log("📝 Recibiendo nueva bitácora...");

    try {
        // 👇 ACTUALIZADO: Recibimos caregiverSignature desde el frontend
        const { caregiverId, patientId, formData, caregiverSignature } = req.body;

        // Validaciones básicas
        if (!caregiverId || !patientId || !formData) {
            return res.status(400).json({ error: "Faltan datos obligatorios." });
        }
        const paciente = await prisma.patient.findUnique({
            where: { id: parseInt(patientId, 10) },
            select: { epsId: true }
        });
        if (!paciente) return res.status(404).json({ error: 'No encontramos ese paciente.' });
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

                epsId: paciente.epsId,

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

// El módulo completo (listado con filtros, líneas de gasto, envío,
// exportación e importación) vive en financial.routes.js.
app.use('/api/financial-reports', crearRutasFinancieras(prisma));


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
app.get('/api/logs', requireAuth, async (req, res) => {
    try {
        const { role, id, epsId } = req.auth;
        const { patientId } = req.query;

        let where = {};

        if (role === 'CUIDADOR') {
            where = { caregiverId: id };
        } else if (role === 'PACIENTE') {
            where = { patientId: id };
        } else if (role === 'SUPER' || (role === 'ADMIN' && epsId === null)) {
            where = {};
        } else if (epsId !== null) {
            where = { patient: { epsId } };
        } else {
            return res.json([]);
        }

        // El filtro opcional por paciente se aplica ENCIMA del alcance, nunca en su lugar.
        if (patientId && patientId !== 'undefined' && patientId !== 'null') {
            const permitido = await pacienteEnAlcance(prisma, req.auth, patientId);
            if (!permitido) {
                return res.status(403).json({ error: 'No tienes acceso a este paciente.' });
            }
            where.patientId = parseInt(patientId, 10);
        }

        const logs = await prisma.log.findMany({
            where,
            orderBy: { date: 'desc' },
            include: {
                patient: { select: { id: true, fullName: true, epsId: true } }
            }
        });

        res.json(logs);
    } catch (error) {
        console.error('❌ Error obteniendo bitácoras:', error);
        res.status(500).json({ error: 'No se pudo cargar el historial de bitácoras.' });
    }
});
// ============================================================================
// K. MANEJADOR DE ERRORES
//    Evita que las trazas internas lleguen al navegador.
// ============================================================================

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'El archivo supera el límite de 8 MB.' });
        }
        return res.status(400).json({ error: 'No se pudo procesar el archivo.' });
    }
    if (err?.message?.includes('Solo se aceptan archivos')) {
        return res.status(400).json({ error: err.message });
    }
    console.error('❌ Error no controlado:', err);
    res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' });
});
// =================================================================
// INICIO SERVIDOR
// =================================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});