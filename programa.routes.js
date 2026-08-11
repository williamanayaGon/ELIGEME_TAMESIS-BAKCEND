// =================================================================
// CARACTERIZACIÓN DEL PROGRAMA
// =================================================================
// Este módulo se llama "Caracterización del programa", no "ADRES".
// ELÍGEME conoce a las personas registradas en el programa de cuidado
// domiciliario, no a la población del municipio. Por eso aquí no hay
// puntaje de preparación, ni oportunidades de financiación cuantificadas,
// ni montos proyectados: eso exigiría datos censales y criterios de
// elegibilidad que la plataforma no tiene.
//
// Lo que sí produce: un retrato de a quién atiende el programa, con qué
// intensidad y con qué resultados, donde cada cifra se puede rastrear a
// las filas que la produjeron.
//
// Sobre las situaciones detectadas: solo se señalan hechos verificables
// —conteos y proporciones— con el criterio exacto a la vista. Un juicio
// del tipo "baja capacidad preventiva" exigiría un umbral que nadie
// definió, y por eso no existe.

import express from 'express';
import PDFDocument from 'pdfkit';

import {
    requireAuth,
    requireRole,
    alcanceEntidad,
    registrarEvento
} from './auth.middleware.js';

// Clave del único parámetro configurable por ahora.
const CLAVE_UMBRAL = 'dias_sin_seguimiento';

// Valor de arranque, explícitamente marcado como no elegido por la entidad.
// La interfaz lo muestra como pendiente de definir, no como una decisión.
const UMBRAL_POR_DEFECTO = 60;
const JUSTIFICACION_POR_DEFECTO =
    'Valor inicial sugerido por la plataforma. La entidad no lo ha definido todavía.';

const aFecha = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

const periodoDe = (query = {}) => {
    const hasta = aFecha(query.hasta) ?? new Date();
    const desde = aFecha(query.desde) ?? new Date(hasta.getFullYear(), 0, 1);
    return { desde, hasta };
};

const proporcion = (parte, total) =>
    total > 0 ? Math.round((parte / total) * 1000) / 10 : null;

const fmt = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';

const money = (n) => new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
}).format(Number(n) || 0);

// Agrupa una lista por una clave, con etiqueta para los vacíos.
const agrupar = (filas, obtener, vacio) => {
    const g = {};
    for (const f of filas) {
        const k = obtener(f) || vacio;
        g[k] = (g[k] || 0) + 1;
    }
    return g;
};

// Filtro de pacientes por entidad.
const scopePacientes = (auth) => alcanceEntidad(auth);

// Filtro de registros que cuelgan del paciente (visitas, bitácoras).
const scopePorPaciente = (auth) => {
    const s = alcanceEntidad(auth);
    return s.epsId !== undefined ? { patient: { epsId: s.epsId } } : {};
};

// Lee el umbral de la entidad. Devuelve además si fue ella quien lo fijó,
// porque no es lo mismo un criterio propio que un valor de arranque.
async function leerUmbral(prisma, auth) {
    const fila = await prisma.programSetting.findFirst({
        where: { clave: CLAVE_UMBRAL, epsId: auth.epsId ?? null }
    });

    if (!fila) {
        return {
            dias: UMBRAL_POR_DEFECTO,
            justificacion: JUSTIFICACION_POR_DEFECTO,
            definidoPorLaEntidad: false
        };
    }
    return {
        dias: parseInt(fila.valor, 10) || UMBRAL_POR_DEFECTO,
        justificacion: fila.justificacion,
        definidoPorLaEntidad: true,
        actualizado: fila.updatedAt
    };
}

// =================================================================
// CÁLCULOS
// =================================================================
// Viven aparte de las rutas para que el dossier los invoque directamente.
// Pedirle al servidor sus propias secciones por HTTP haría el documento
// dependiente del proxy que tenga delante, gastaría el límite de
// peticiones y duplicaría la autenticación en cada sección.

async function calcularPerfil(prisma, auth) {
    const scope = scopePacientes(auth);

    const pacientes = await prisma.patient.findMany({
        where: scope,
        select: {
            id: true, age: true, stratum: true, zoneCategory: true,
            diagnosis: true, caregiverId: true, programStatus: true, createdAt: true
        }
    });

    if (pacientes.length === 0) {
        return { vacio: true, mensaje: 'No hay personas registradas en el programa.', total: 0 };
    }

    const activas = pacientes.filter(p => p.programStatus === 'ACTIVO').length;
    const egresadas = pacientes.filter(p => p.programStatus === 'EGRESADO').length;
    const conCuidador = pacientes.filter(p => p.caregiverId).length;

    // Grupos etarios. El de 60 o más se reporta aparte porque es el corte
    // que usan la mayoría de programas de cuidado.
    const etario = { '0-18': 0, '19-59': 0, '60+': 0, 'Sin edad registrada': 0 };
    for (const p of pacientes) {
        const e = Number(p.age);
        if (!Number.isFinite(e)) etario['Sin edad registrada']++;
        else if (e <= 18) etario['0-18']++;
        else if (e <= 59) etario['19-59']++;
        else etario['60+']++;
    }

    const estrato = agrupar(pacientes, p => {
        const n = String(p.stratum ?? '').replace(/\D/g, '');
        return n >= '1' && n <= '6' ? `Estrato ${n}` : null;
    }, 'Sin estrato registrado');

    const territorio = agrupar(pacientes, p => p.zoneCategory?.trim(), 'Sin zona registrada');

    // Diagnósticos: se normaliza para que "EPOC severo" y "EPOC Severo" no
    // cuenten como dos cosas distintas.
    const diagnosticos = agrupar(pacientes, p => {
        const d = (p.diagnosis || '').split('(')[0].trim();
        if (!d || d === '.') return null;
        return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
    }, 'Sin diagnóstico registrado');

    const topDiagnosticos = Object.entries(diagnosticos)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([nombre, conteo]) => ({
            nombre, conteo, porcentaje: proporcion(conteo, pacientes.length)
        }));

    return {
        vacio: false,
        total: pacientes.length,
        permanencia: { activas, egresadas },
        cobertura: {
            conCuidador,
            sinCuidador: pacientes.length - conCuidador,
            porcentajeConCuidador: proporcion(conCuidador, pacientes.length)
        },
        etario: {
            grupos: etario,
            sesentaOMas: etario['60+'],
            porcentajeSesentaOMas: proporcion(etario['60+'], pacientes.length)
        },
        estrato,
        territorio,
        topDiagnosticos,
        sinFechaRegistro: pacientes.filter(p => !p.createdAt).length
    };
}

async function calcularIntensidad(prisma, auth, query) {
    const { desde, hasta } = periodoDe(query);
    const scope = scopePacientes(auth);
    const scopeHijo = scopePorPaciente(auth);
    const umbral = await leerUmbral(prisma, auth);

    const totalPacientes = await prisma.patient.count({ where: scope });
    if (totalPacientes === 0) {
        return {
            vacio: true,
            mensaje: 'No hay personas registradas, así que no hay intensidad que medir.',
            periodo: { desde, hasta },
            umbral
        };
    }

    const [visitas, bitacoras] = await Promise.all([
        prisma.medicalVisit.count({ where: { ...scopeHijo, date: { gte: desde, lte: hasta } } }),
        prisma.log.count({ where: { ...scopeHijo, date: { gte: desde, lte: hasta } } })
    ]);

    // Personas sin seguimiento reciente, según el umbral de la entidad.
    const corte = new Date(Date.now() - umbral.dias * 86400000);
    const sinSeguimiento = await prisma.patient.count({
        where: {
            ...scope,
            programStatus: 'ACTIVO',
            logs: { none: { date: { gte: corte } } },
            visits: { none: { date: { gte: corte } } }
        }
    });

    // Tiempo promedio entre visitas: se calcula por paciente y luego se
    // promedia, para que quien recibe muchas visitas no domine la cifra.
    const conVisitas = await prisma.patient.findMany({
        where: { ...scope, visits: { some: { date: { gte: desde, lte: hasta } } } },
        select: {
            id: true,
            visits: {
                where: { date: { gte: desde, lte: hasta } },
                select: { date: true },
                orderBy: { date: 'asc' }
            }
        }
    });

    const intervalos = [];
    for (const p of conVisitas) {
        for (let i = 1; i < p.visits.length; i++) {
            intervalos.push((new Date(p.visits[i].date) - new Date(p.visits[i - 1].date)) / 86400000);
        }
    }
    const diasEntreVisitas = intervalos.length
        ? Math.round((intervalos.reduce((a, b) => a + b, 0) / intervalos.length) * 10) / 10
        : null;

    return {
        vacio: false,
        periodo: { desde, hasta },
        umbral,
        totalPacientes,
        visitas: { total: visitas, porPersona: Math.round((visitas / totalPacientes) * 100) / 100 },
        bitacoras: { total: bitacoras, porPersona: Math.round((bitacoras / totalPacientes) * 100) / 100 },
        sinSeguimientoReciente: {
            conteo: sinSeguimiento,
            criterio: `Personas activas sin bitácora ni visita desde hace ${umbral.dias} días o más`,
            desdeFecha: corte
        },
        diasPromedioEntreVisitas: diasEntreVisitas,
        notaIntervalos: intervalos.length === 0
            ? 'Ninguna persona registra dos o más visitas en el periodo, así que no hay intervalo que promediar.'
            : `Calculado sobre ${intervalos.length} intervalo(s) entre visitas consecutivas.`
    };
}

async function calcularCapacidad(prisma, auth) {
    const scope = scopePacientes(auth);

    const [cuidadores, profesionales, pacientesActivos, asignados] = await Promise.all([
        prisma.user.findMany({
            where: { ...scope, role: 'CUIDADOR' },
            select: { id: true, status: true }
        }),
        prisma.user.count({ where: { ...scope, role: 'PROFESIONAL' } }),
        prisma.patient.count({ where: { ...scope, programStatus: 'ACTIVO' } }),
        prisma.patient.findMany({
            where: { ...scope, caregiverId: { not: null } },
            select: { caregiverId: true }
        })
    ]);

    if (cuidadores.length === 0 && profesionales === 0) {
        return {
            vacio: true,
            mensaje: 'No hay cuidadores ni profesionales registrados.',
            pacientesActivos
        };
    }

    const porEstado = agrupar(cuidadores, c => c.status, 'SIN ESTADO');
    const aprobados = cuidadores.filter(c => ['APROBADO', 'ACTIVO'].includes(c.status)).length;
    const pendientes = cuidadores.filter(c => c.status === 'PENDIENTE').length;

    // Cuidadores que efectivamente tienen a alguien a cargo.
    const conCarga = new Set(asignados.map(a => a.caregiverId));

    return {
        vacio: false,
        cuidadores: {
            total: cuidadores.length,
            aprobados,
            pendientes,
            conPacienteACargo: conCarga.size,
            porEstado
        },
        profesionales,
        pacientesActivos,
        // La relación se calcula solo sobre quienes pueden recibir carga.
        pacientesPorCuidador: aprobados > 0
            ? Math.round((pacientesActivos / aprobados) * 100) / 100
            : null,
        notaRelacion: aprobados === 0
            ? 'No hay cuidadores aprobados, así que la relación de carga no es calculable.'
            : `Calculada sobre ${aprobados} cuidador(es) aprobado(s).`
    };
}

async function calcularSituaciones(prisma, auth) {
    const scope = scopePacientes(auth);
    const umbral = await leerUmbral(prisma, auth);
    const total = await prisma.patient.count({ where: scope });

    if (total === 0) {
        return {
            vacio: true,
            mensaje: 'No hay personas registradas, así que no hay situaciones que señalar.',
            situaciones: []
        };
    }

    const corte = new Date(Date.now() - umbral.dias * 86400000);

    const [sinCuidador, sinSeguimiento, rurales, sinDiagnostico, postulacionesPendientes] =
        await Promise.all([
            prisma.patient.count({ where: { ...scope, caregiverId: null } }),
            prisma.patient.count({
                where: {
                    ...scope, programStatus: 'ACTIVO',
                    logs: { none: { date: { gte: corte } } },
                    visits: { none: { date: { gte: corte } } }
                }
            }),
            prisma.patient.count({
                where: { ...scope, zoneCategory: { not: { in: ['Casco Urbano', ''] } } }
            }),
            prisma.patient.count({
                where: { ...scope, OR: [{ diagnosis: null }, { diagnosis: '' }] }
            }),
            prisma.user.count({ where: { ...scope, role: 'CUIDADOR', status: 'PENDIENTE' } })
        ]);

    // Cada situación es un conteo o una proporción, con el criterio a la
    // vista y el enlace al listado que la sostiene. Ninguna es un juicio.
    const situaciones = [
        {
            id: 'sin_cuidador',
            hecho: `${sinCuidador} persona(s) registrada(s) no tienen cuidador asignado`,
            conteo: sinCuidador,
            criterio: 'Pacientes cuyo campo de cuidador asignado está vacío',
            tipo: 'conteo',
            enlace: '/dashboard?tab=PACIENTES&filtro=sin-cuidador'
        },
        {
            id: 'sin_seguimiento',
            hecho: `${sinSeguimiento} persona(s) activa(s) no registran seguimiento en los últimos ${umbral.dias} días`,
            conteo: sinSeguimiento,
            criterio: `Pacientes activos sin bitácora ni visita desde ${fmt(corte)}`,
            tipo: 'conteo',
            umbralConfigurable: true,
            umbralDefinidoPorLaEntidad: umbral.definidoPorLaEntidad,
            justificacionUmbral: umbral.justificacion,
            enlace: '/dashboard?tab=PACIENTES&filtro=sin-seguimiento'
        },
        {
            id: 'proporcion_rural',
            hecho: `El ${proporcion(rurales, total)}% de las personas atendidas vive fuera del casco urbano`,
            conteo: rurales,
            porcentaje: proporcion(rurales, total),
            criterio: 'Pacientes cuya zona registrada no es "Casco Urbano"',
            tipo: 'proporcion',
            enlace: '/dashboard?tab=PACIENTES'
        },
        {
            id: 'sin_diagnostico',
            hecho: `${sinDiagnostico} persona(s) no tienen diagnóstico registrado`,
            conteo: sinDiagnostico,
            criterio: 'Pacientes con el campo de diagnóstico vacío',
            tipo: 'conteo',
            enlace: '/dashboard?tab=PACIENTES'
        },
        {
            id: 'postulaciones_pendientes',
            hecho: `${postulacionesPendientes} postulación(es) de cuidador siguen pendientes de revisión`,
            conteo: postulacionesPendientes,
            criterio: 'Usuarios con rol cuidador en estado PENDIENTE',
            tipo: 'conteo',
            enlace: '/dashboard?tab=SOLICITUDES'
        }
    ].filter(s => s.conteo > 0);

    return {
        vacio: false,
        total,
        umbral,
        situaciones,
        nota: 'Todas las situaciones son conteos o proporciones sobre registros existentes. ' +
              'El sistema no emite juicios sobre la calidad del programa.'
    };
}

async function calcularRecursos(prisma, auth, periodo, personasAtendidas) {
    const reportes = await prisma.financialReport.findMany({
        where: {
            ...scopePacientes(auth),
            estado: { in: ['ENVIADO', 'APROBADO'] },
            periodoInicio: { lte: periodo.hasta },
            periodoFin: { gte: periodo.desde }
        },
        include: { items: { select: { valorTotal: true } } }
    });

    const porTipo = {};
    let ejecutado = 0;
    for (const r of reportes) {
        const s = r.items.reduce((a, i) => a + Number(i.valorTotal), 0);
        porTipo[r.reportType] = (porTipo[r.reportType] || 0) + s;
        ejecutado += s;
    }

    return {
        reportes: reportes.length,
        ejecutado,
        porTipo,
        costoPorPersona: (reportes.length > 0 && personasAtendidas > 0)
            ? Math.round(ejecutado / personasAtendidas)
            : null
    };
}

// =================================================================

export default function crearRutasPrograma(prisma) {
    const router = express.Router();

    router.use(requireAuth, requireRole('ADMIN', 'SUPER'));

    // Las rutas son envoltorios delgados sobre los cálculos de arriba.
    const responder = (calcular) => async (req, res) => {
        try {
            res.json(await calcular(prisma, req.auth, req.query));
        } catch (error) {
            console.error('❌ Error en caracterización:', error);
            res.status(500).json({ error: 'No se pudo calcular la sección.' });
        }
    };

    router.get('/perfil', responder(calcularPerfil));
    router.get('/intensidad', responder(calcularIntensidad));
    router.get('/capacidad', responder(calcularCapacidad));
    router.get('/situaciones', responder(calcularSituaciones));

    // -------------------------------------------------------------
    // GET/PUT /umbral — el criterio lo fija la entidad, no la plataforma
    // -------------------------------------------------------------
    router.get('/umbral', async (req, res) => {
        try {
            res.json(await leerUmbral(prisma, req.auth));
        } catch (error) {
            console.error('❌ Error leyendo umbral:', error);
            res.status(500).json({ error: 'No se pudo leer el umbral.' });
        }
    });

    router.put('/umbral', async (req, res) => {
        try {
            const dias = parseInt(req.body.dias, 10);
            const justificacion = String(req.body.justificacion || '').trim();

            if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
                return res.status(400).json({ error: 'El umbral debe estar entre 1 y 365 días.' });
            }
            // Sin justificación el número queda sin defensa; se exige.
            if (justificacion.length < 10) {
                return res.status(400).json({
                    error: 'Explica por qué la entidad eligió ese umbral (mínimo 10 caracteres).'
                });
            }

            const epsId = req.auth.epsId ?? null;
            const existente = await prisma.programSetting.findFirst({
                where: { clave: CLAVE_UMBRAL, epsId }
            });

            const guardado = existente
                ? await prisma.programSetting.update({
                    where: { id: existente.id },
                    data: { valor: String(dias), justificacion, definidoPor: req.auth.id }
                })
                : await prisma.programSetting.create({
                    data: {
                        clave: CLAVE_UMBRAL, valor: String(dias), justificacion,
                        definidoPor: req.auth.id, epsId
                    }
                });

            await registrarEvento(prisma, req, {
                action: 'EDICION', entity: 'ProgramSetting', entityId: guardado.id,
                detail: { clave: CLAVE_UMBRAL, dias }
            });

            res.json({ dias, justificacion, definidoPorLaEntidad: true, actualizado: guardado.updatedAt });
        } catch (error) {
            console.error('❌ Error guardando umbral:', error);
            res.status(500).json({ error: 'No se pudo guardar el umbral.' });
        }
    });

    // -------------------------------------------------------------
    // GET /dossier — PDF consolidado de caracterización
    // -------------------------------------------------------------
    router.get('/dossier', async (req, res) => {
        try {
            const periodo = periodoDe(req.query);
            const { desde, hasta } = periodo;

            // Se invocan los mismos cálculos que alimentan la pantalla, de modo
            // que el PDF no puede divergir de lo que el usuario acaba de ver.
            const [perfil, intensidad, capacidad, situaciones] = await Promise.all([
                calcularPerfil(prisma, req.auth),
                calcularIntensidad(prisma, req.auth, req.query),
                calcularCapacidad(prisma, req.auth),
                calcularSituaciones(prisma, req.auth)
            ]);

            const atendidas = perfil.vacio ? 0 : perfil.total;
            const recursos = await calcularRecursos(prisma, req.auth, periodo, atendidas);

            const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition',
                `attachment; filename="caracterizacion-${desde.toISOString().slice(0, 10)}.pdf"`);
            doc.pipe(res);

            doc.rect(0, 0, doc.page.width, 76).fill('#1f3c88');
            doc.fillColor('#ffffff').fontSize(17).text('ELÍGEME', 40, 22);
            doc.fontSize(9).text('Alcaldía de Támesis — Programa de cuidado domiciliario', 40, 44);
            doc.fillColor('#000000');

            doc.fontSize(16).text('Caracterización del programa', 40, 100);
            doc.fontSize(9).fillColor('#555555')
                .text(`Periodo: ${fmt(desde)} a ${fmt(hasta)}   ·   Generado: ${new Date().toLocaleString('es-CO')}`);
            doc.moveDown(1.2);

            const titulo = (t) => {
                if (doc.y > doc.page.height - 140) doc.addPage();
                doc.moveDown(0.6).fillColor('#1f3c88').fontSize(12).text(t);
                doc.moveDown(0.3).fillColor('#000000').fontSize(9);
            };
            const dato = (k, v) => doc.fillColor('#111111').fontSize(9).text(`${k}: ${v}`, { indent: 8 });
            const vacio = (m) => doc.fillColor('#6b7280').fontSize(9).text(m, { indent: 8 });

            // --- 1. Perfil ---
            titulo('1. Perfil de las personas atendidas');
            if (perfil.vacio) {
                vacio(perfil.mensaje);
            } else {
                dato('Total registradas', perfil.total);
                dato('Activas', perfil.permanencia.activas);
                dato('Egresadas', perfil.permanencia.egresadas);
                dato('Con cuidador asignado', `${perfil.cobertura.conCuidador} (${perfil.cobertura.porcentajeConCuidador}%)`);
                dato('Sin cuidador asignado', perfil.cobertura.sinCuidador);
                dato('60 años o más', `${perfil.etario.sesentaOMas} (${perfil.etario.porcentajeSesentaOMas}%)`);

                doc.moveDown(0.4).fillColor('#374151').text('Grupos etarios', { indent: 8 });
                for (const [k, v] of Object.entries(perfil.etario.grupos)) dato(`  ${k}`, v);

                doc.moveDown(0.4).fillColor('#374151').text('Estrato', { indent: 8 });
                for (const [k, v] of Object.entries(perfil.estrato)) dato(`  ${k}`, v);

                doc.moveDown(0.4).fillColor('#374151').text('Territorio', { indent: 8 });
                for (const [k, v] of Object.entries(perfil.territorio)) dato(`  ${k}`, v);

                if (perfil.topDiagnosticos.length) {
                    doc.moveDown(0.4).fillColor('#374151').text('Diagnósticos más frecuentes', { indent: 8 });
                    for (const d of perfil.topDiagnosticos) dato(`  ${d.nombre}`, `${d.conteo} (${d.porcentaje}%)`);
                }
                if (perfil.sinFechaRegistro > 0) {
                    doc.moveDown(0.3).fillColor('#92400e').fontSize(8).text(
                        `${perfil.sinFechaRegistro} persona(s) no tienen fecha de registro: son anteriores a que el programa la guardara.`,
                        { indent: 8 }
                    );
                }
            }

            // --- 2. Intensidad ---
            titulo('2. Intensidad de la atención');
            if (intensidad.vacio) {
                vacio(intensidad.mensaje);
            } else {
                dato('Visitas en el periodo', `${intensidad.visitas.total} (${intensidad.visitas.porPersona} por persona)`);
                dato('Bitácoras en el periodo', `${intensidad.bitacoras.total} (${intensidad.bitacoras.porPersona} por persona)`);
                dato('Sin seguimiento reciente', intensidad.sinSeguimientoReciente.conteo);
                doc.fillColor('#6b7280').fontSize(8)
                    .text(`Criterio: ${intensidad.sinSeguimientoReciente.criterio}`, { indent: 16 });
                doc.fontSize(8).text(
                    intensidad.umbral.definidoPorLaEntidad
                        ? `Umbral definido por la entidad: ${intensidad.umbral.justificacion}`
                        : `Umbral no definido por la entidad. ${intensidad.umbral.justificacion}`,
                    { indent: 16 }
                );
                doc.fontSize(9).fillColor('#111111');
                dato('Días promedio entre visitas', intensidad.diasPromedioEntreVisitas ?? 'No calculable');
                doc.fillColor('#6b7280').fontSize(8).text(intensidad.notaIntervalos, { indent: 16 });
            }

            // --- 3. Capacidad ---
            titulo('3. Capacidad del programa');
            if (capacidad.vacio) {
                vacio(capacidad.mensaje);
            } else {
                dato('Cuidadores registrados', capacidad.cuidadores.total);
                dato('Cuidadores aprobados', capacidad.cuidadores.aprobados);
                dato('Cuidadores con paciente a cargo', capacidad.cuidadores.conPacienteACargo);
                dato('Postulaciones pendientes', capacidad.cuidadores.pendientes);
                dato('Profesionales vinculados', capacidad.profesionales);
                dato('Pacientes activos', capacidad.pacientesActivos);
                dato('Pacientes por cuidador aprobado', capacidad.pacientesPorCuidador ?? 'No calculable');
                doc.fillColor('#6b7280').fontSize(8).text(capacidad.notaRelacion, { indent: 16 });
            }

            // --- 4. Recursos ---
            titulo('4. Recursos');
            if (recursos.reportes === 0) {
                vacio('No hay reportes financieros enviados que cubran el periodo, así que no hay ejecución que informar.');
            } else {
                dato('Ejecución total', money(recursos.ejecutado));
                for (const [t, v] of Object.entries(recursos.porTipo)) dato(`  ${t}`, money(v));
                dato('Costo promedio por persona atendida',
                    recursos.costoPorPersona !== null ? money(recursos.costoPorPersona) : 'No calculable');
                doc.fillColor('#6b7280').fontSize(8).text(
                    `Calculado sobre ${recursos.reportes} reporte(s) enviado(s) y ${atendidas} persona(s) registrada(s).`,
                    { indent: 16 }
                );
            }

            // --- 5. Situaciones ---
            titulo('5. Situaciones detectadas');
            if (situaciones.vacio || situaciones.situaciones.length === 0) {
                vacio(situaciones.mensaje ?? 'No se detectaron situaciones con los criterios aplicados.');
            } else {
                for (const s of situaciones.situaciones) {
                    if (doc.y > doc.page.height - 110) doc.addPage();
                    doc.fillColor('#111111').fontSize(9).text(`• ${s.hecho}`, { indent: 8 });
                    doc.fillColor('#6b7280').fontSize(8).text(`Criterio: ${s.criterio}`, { indent: 16 });
                    doc.moveDown(0.3);
                }
                doc.moveDown(0.2).fillColor('#6b7280').fontSize(8)
                    .text(situaciones.nota, { indent: 8, width: doc.page.width - 100 });
            }

            // --- 6. Alcance (obligatoria) ---
            if (doc.y > doc.page.height - 220) doc.addPage();
            doc.moveDown(1);
            const y = doc.y;
            doc.rect(40, y, doc.page.width - 80, 140).fillAndStroke('#fffbeb', '#fcd34d');
            doc.fillColor('#92400e').fontSize(11).text('Alcance de este documento', 52, y + 12);

            doc.fillColor('#78350f').fontSize(8.5).text('QUÉ CUBRE', 52, y + 34);
            doc.fontSize(8).text(
                'Exclusivamente las personas registradas en ELÍGEME dentro del programa de cuidado ' +
                'domiciliario, y la actividad que quedó registrada sobre ellas: asignaciones, visitas, ' +
                'bitácoras y ejecución financiera reportada en la plataforma.',
                52, y + 46, { width: doc.page.width - 104 }
            );

            doc.fontSize(8.5).fillColor('#78350f').text('QUÉ NO CUBRE', 52, y + 86);
            doc.fontSize(8).text(
                'La población total del municipio, la demanda no atendida, los criterios de elegibilidad ' +
                'de convocatorias y cualquier proyección de financiación. Esas cifras las aporta la ' +
                'Secretaría de Planeación; esta plataforma no las tiene y no las estima.',
                52, y + 98, { width: doc.page.width - 104 }
            );

            doc.end();

            await registrarEvento(prisma, req, {
                action: 'LECTURA', entity: 'ProgramaDossier',
                detail: { desde, hasta, personas: atendidas }
            });
        } catch (error) {
            console.error('❌ Error generando dossier:', error);
            if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el dossier.' });
        }
    });

    return router;
}
