// =================================================================
// AUTENTICACIÓN, ALCANCE POR ENTIDAD Y LÍMITES DE PETICIONES
// =================================================================
// Este módulo concentra todo lo que index.js necesita para saber
// quién hace cada petición y qué tiene permitido ver.

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const JWT_SECRET = process.env.JWT_SECRET;
const VIGENCIA_TOKEN = '12h';

// Sin secreto no hay sesiones válidas: es preferible no arrancar
// a firmar tokens con un valor por defecto que cualquiera adivine.
if (!JWT_SECRET) {
    throw new Error('Falta JWT_SECRET en el archivo .env. El servidor no puede firmar sesiones sin él.');
}

// Roles que ven información de todas las entidades.
const ROLES_GLOBALES = ['SUPER'];

// -----------------------------------------------------------------
// TOKENS
// -----------------------------------------------------------------

/**
 * Firma la sesión. Solo viajan los tres datos que definen el alcance:
 * quién es, con qué rol y a qué entidad pertenece.
 */
export function firmarToken({ id, role, epsId }) {
    return jwt.sign(
        { id, role, epsId: epsId ?? null },
        JWT_SECRET,
        { expiresIn: VIGENCIA_TOKEN }
    );
}

/**
 * Extrae el token del encabezado Authorization o, como alternativa,
 * del query string. Lo segundo existe porque las etiquetas <img> y los
 * enlaces de descarga a /uploads no pueden mandar encabezados.
 */
function extraerToken(req) {
    const encabezado = req.headers.authorization || '';
    if (encabezado.startsWith('Bearer ')) return encabezado.slice(7).trim();
    if (typeof req.query?.token === 'string') return req.query.token;
    return null;
}

/**
 * Middleware. Deja en req.auth = { id, role, epsId } y corta con 401
 * si el token falta, está vencido o fue alterado.
 */
export function requireAuth(req, res, next) {
    const token = extraerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Necesitas iniciar sesión.' });
    }

    try {
        const datos = jwt.verify(token, JWT_SECRET);
        req.auth = {
            id: datos.id,
            role: datos.role,
            epsId: datos.epsId ?? null
        };
        return next();
    } catch (e) {
        const vencido = e.name === 'TokenExpiredError';
        return res.status(401).json({
            error: vencido ? 'Tu sesión expiró. Vuelve a entrar.' : 'Sesión inválida.'
        });
    }
}

/**
 * Middleware de rol. Se usa siempre después de requireAuth.
 */
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.auth) {
            return res.status(401).json({ error: 'Necesitas iniciar sesión.' });
        }
        if (!roles.includes(req.auth.role)) {
            return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
        }
        return next();
    };
}

// -----------------------------------------------------------------
// ALCANCE POR ENTIDAD
// -----------------------------------------------------------------

/**
 * Filtro Prisma según quién consulta. La Superintendencia y el admin
 * global (ADMIN sin epsId) ven todo; el resto solo su propia entidad.
 */
export function alcanceEntidad(auth) {
    if (!auth) return { epsId: -1 }; // Sin sesión no se devuelve nada.
    if (ROLES_GLOBALES.includes(auth.role)) return {};
    if (auth.role === 'ADMIN' && auth.epsId === null) return {};
    if (auth.epsId === null || auth.epsId === undefined) return { epsId: -1 };
    return { epsId: auth.epsId };
}

/**
 * ¿Este usuario puede tocar a este paciente? Se consulta la EPS real
 * del paciente en vez de confiar en lo que venga en la petición.
 */
export async function pacienteEnAlcance(prisma, auth, patientId) {
    const id = parseInt(patientId, 10);
    if (!auth || !Number.isInteger(id)) return false;

    const paciente = await prisma.patient.findUnique({
        where: { id },
        select: { id: true, epsId: true, caregiverId: true }
    });
    if (!paciente) return false;

    if (ROLES_GLOBALES.includes(auth.role)) return true;
    if (auth.role === 'ADMIN' && auth.epsId === null) return true;
    if (auth.role === 'PACIENTE') return paciente.id === auth.id;
    if (auth.role === 'CUIDADOR') return paciente.caregiverId === auth.id;

    // ADMIN de entidad y PROFESIONAL: solo pacientes de su EPS.
    return auth.epsId !== null && paciente.epsId === auth.epsId;
}

// -----------------------------------------------------------------
// CONTRASEÑAS
// -----------------------------------------------------------------

const RONDAS_BCRYPT = 10;
const PREFIJOS_BCRYPT = ['$2a$', '$2b$', '$2y$'];

const esHash = (valor) =>
    typeof valor === 'string' && PREFIJOS_BCRYPT.some(p => valor.startsWith(p));

export async function hashearClave(textoPlano) {
    return bcrypt.hash(String(textoPlano), RONDAS_BCRYPT);
}

/**
 * Compara una credencial contra lo guardado.
 *
 * Devuelve `necesitaMigracion: true` cuando el valor almacenado estaba
 * en texto plano (cuentas creadas antes de que se hashearan). Quien
 * llama debe rehashearlo. La comparación en texto plano es de tiempo
 * constante para no filtrar información por la duración.
 */
export async function verificarClave(textoPlano, guardado) {
    const fallo = { valida: false, necesitaMigracion: false };

    // accessCode y password son opcionales: pueden llegar null o ''.
    if (!textoPlano || !guardado) return fallo;

    if (esHash(guardado)) {
        try {
            return { valida: await bcrypt.compare(String(textoPlano), guardado), necesitaMigracion: false };
        } catch {
            return fallo;
        }
    }

    const a = Buffer.from(String(textoPlano));
    const b = Buffer.from(String(guardado));
    const valida = a.length === b.length && crypto.timingSafeEqual(a, b);

    return { valida, necesitaMigracion: valida };
}

// -----------------------------------------------------------------
// LÍMITES DE PETICIONES
// -----------------------------------------------------------------

// El login es el blanco natural de la fuerza bruta: ventana estrecha.
export const limiteLogin = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' }
});

// Techo general para el resto de /api.
export const limiteGeneral = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones. Espera un momento.' }
});

// -----------------------------------------------------------------
// AUDITORÍA
// -----------------------------------------------------------------

/**
 * Registra quién hizo qué en la tabla AuditEvent.
 *
 * Alimenta además el indicador de eventos de acceso del módulo FURAG.
 *
 * Nunca lanza: una falla de auditoría no debe tumbar la petición que la
 * originó. Si el insert falla, queda el rastro en la salida del servidor.
 */
export async function registrarEvento(prisma, req, { action, entity, entityId = null, detail = null }) {
    try {
        await prisma.auditEvent.create({
            data: {
                action,
                entity,
                entityId,
                detail: detail ?? undefined,
                actorId: req?.auth?.id ?? null,
                actorRole: req?.auth?.role ?? null,
                epsId: req?.auth?.epsId ?? null
            }
        });
    } catch (e) {
        const quien = req?.auth ? `${req.auth.role}#${req.auth.id}` : 'anónimo';
        console.error(
            `No se pudo registrar la auditoría (${action} ${entity} por ${quien}):`,
            e.message
        );
    }
}
