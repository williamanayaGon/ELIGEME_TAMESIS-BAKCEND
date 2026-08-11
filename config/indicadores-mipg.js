// =================================================================
// CATÁLOGO DE INDICADORES MIPG
// =================================================================
// Cada entrada declara su fórmula en texto Y la consulta que la produce,
// juntas en el mismo sitio. Así el número que sale en el PDF y la fórmula
// impresa debajo no pueden divergir.
//
// Regla del módulo: si no hay datos en el periodo consultado, el indicador
// se reporta como "Sin registrar" (sinDatos: true), NUNCA como cero. Un cero
// afirma que algo no ocurrió; la ausencia de registro no afirma nada.

// Políticas MIPG que la actividad del programa puede respaldar.
export const POLITICAS = {
    SEGUIMIENTO: 'Seguimiento y evaluación del desempeño institucional',
    ESTADISTICA: 'Información estadística',
    SERVICIO: 'Servicio al ciudadano',
    TALENTO: 'Gestión estratégica del talento humano',
    PRESUPUESTO: 'Gestión presupuestal y eficiencia del gasto público',
    TRANSPARENCIA: 'Transparencia, acceso a la información pública',
    PARTICIPACION: 'Participación ciudadana en la gestión pública',
    FORTALECIMIENTO: 'Fortalecimiento organizacional y simplificación de procesos',
    SEGURIDAD_DIGITAL: 'Seguridad digital'
};

// --- Ayudas ---

const sinDatos = (nota) => ({ valor: null, sinDatos: true, nota });

const valor = (v, detalle = null) => ({ valor: v, sinDatos: false, detalle });

const porcentaje = (parte, total) =>
    total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;

// Promedio de días entre dos fechas, sobre los registros que tienen ambas.
const promedioDias = (pares) => {
    const validos = pares.filter(([a, b]) => a && b);
    if (validos.length === 0) return null;
    const suma = validos.reduce((acc, [a, b]) =>
        acc + (new Date(b).getTime() - new Date(a).getTime()), 0);
    return Math.round((suma / validos.length / 86400000) * 10) / 10;
};

const rango = (desde, hasta) => ({ gte: desde, lte: hasta });

// =================================================================

export const INDICADORES = [
    {
        id: 'personas_registradas',
        nombre: 'Personas registradas en el programa',
        formula: 'Conteo de pacientes con fecha de registro dentro del periodo',
        unidad: 'personas',
        politicasRelacionadas: [POLITICAS.ESTADISTICA, POLITICAS.SEGUIMIENTO],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const n = await prisma.patient.count({
                where: { ...scope, createdAt: rango(desde, hasta) }
            });
            if (n === 0) {
                // Puede no haber altas en el periodo, o ser población anterior
                // al registro de la fecha. Se distingue, no se asume.
                const previos = await prisma.patient.count({
                    where: { ...scope, createdAt: null }
                });
                if (previos > 0) {
                    return sinDatos(`Sin altas en el periodo. Hay ${previos} paciente(s) anteriores al registro de fecha de ingreso.`);
                }
            }
            return valor(n);
        }
    },

    {
        id: 'cobertura_asignacion',
        nombre: 'Cobertura de asignación de cuidador',
        formula: 'Pacientes con cuidador asignado ÷ Pacientes registrados × 100',
        unidad: '%',
        politicasRelacionadas: [POLITICAS.SEGUIMIENTO, POLITICAS.ESTADISTICA],
        calcular: async (prisma, { scope }) => {
            const total = await prisma.patient.count({ where: scope });
            if (total === 0) return sinDatos('No hay pacientes registrados.');
            const conCuidador = await prisma.patient.count({
                where: { ...scope, caregiverId: { not: null } }
            });
            return valor(porcentaje(conCuidador, total), {
                conCuidador, total, sinCuidador: total - conCuidador
            });
        }
    },

    {
        id: 'tiempo_asignacion',
        nombre: 'Tiempo promedio hasta la asignación de cuidador',
        formula: 'Promedio de (fecha de asignación − fecha de registro), en días',
        unidad: 'días',
        politicasRelacionadas: [POLITICAS.SERVICIO, POLITICAS.FORTALECIMIENTO],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const filas = await prisma.patient.findMany({
                where: { ...scope, assignedAt: rango(desde, hasta), createdAt: { not: null } },
                select: { createdAt: true, assignedAt: true }
            });
            const prom = promedioDias(filas.map(f => [f.createdAt, f.assignedAt]));
            if (prom === null) {
                return sinDatos('Ninguna asignación del periodo tiene fecha de registro comparable.');
            }
            return valor(prom, { asignacionesMedidas: filas.length });
        }
    },

    {
        id: 'distribucion_etaria',
        nombre: 'Distribución por grupo etario',
        formula: 'Conteo de pacientes agrupados por rango de edad (0-18, 19-59, 60+)',
        unidad: 'personas por grupo',
        politicasRelacionadas: [POLITICAS.ESTADISTICA],
        calcular: async (prisma, { scope }) => {
            const pacientes = await prisma.patient.findMany({
                where: scope, select: { age: true }
            });
            if (pacientes.length === 0) return sinDatos('No hay pacientes registrados.');

            const g = { '0-18': 0, '19-59': 0, '60+': 0, 'Sin edad': 0 };
            for (const p of pacientes) {
                const e = Number(p.age);
                if (!Number.isFinite(e)) g['Sin edad']++;
                else if (e <= 18) g['0-18']++;
                else if (e <= 59) g['19-59']++;
                else g['60+']++;
            }
            return valor(pacientes.length, g);
        }
    },

    {
        id: 'distribucion_estrato',
        nombre: 'Distribución por estrato socioeconómico',
        formula: 'Conteo de pacientes agrupados por estrato declarado',
        unidad: 'personas por estrato',
        politicasRelacionadas: [POLITICAS.ESTADISTICA],
        calcular: async (prisma, { scope }) => {
            const pacientes = await prisma.patient.findMany({
                where: scope, select: { stratum: true }
            });
            if (pacientes.length === 0) return sinDatos('No hay pacientes registrados.');

            const g = {};
            for (const p of pacientes) {
                const limpio = String(p.stratum ?? '').replace(/\D/g, '');
                const clave = limpio >= '1' && limpio <= '6' ? `Estrato ${limpio}` : 'Sin estrato';
                g[clave] = (g[clave] || 0) + 1;
            }
            return valor(pacientes.length, g);
        }
    },

    {
        id: 'cobertura_territorial',
        nombre: 'Cobertura territorial (urbano / rural / resguardo)',
        formula: 'Conteo de pacientes agrupados por categoría de zona registrada',
        unidad: 'personas por zona',
        politicasRelacionadas: [POLITICAS.ESTADISTICA, POLITICAS.PARTICIPACION],
        calcular: async (prisma, { scope }) => {
            const pacientes = await prisma.patient.findMany({
                where: scope, select: { zoneCategory: true }
            });
            if (pacientes.length === 0) return sinDatos('No hay pacientes registrados.');

            const g = {};
            for (const p of pacientes) {
                const z = (p.zoneCategory || '').trim() || 'Sin zona registrada';
                g[z] = (g[z] || 0) + 1;
            }
            return valor(pacientes.length, g);
        }
    },

    {
        id: 'visitas_realizadas',
        nombre: 'Visitas domiciliarias realizadas',
        formula: 'Conteo de visitas médicas con fecha dentro del periodo',
        unidad: 'visitas',
        politicasRelacionadas: [POLITICAS.SEGUIMIENTO, POLITICAS.SERVICIO],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const where = scope.epsId !== undefined
                ? { date: rango(desde, hasta), patient: { epsId: scope.epsId } }
                : { date: rango(desde, hasta) };
            const n = await prisma.medicalVisit.count({ where });
            if (n === 0) return sinDatos('No se registraron visitas en el periodo.');
            return valor(n);
        }
    },

    {
        id: 'bitacoras_registradas',
        nombre: 'Bitácoras de cuidado registradas',
        formula: 'Conteo de bitácoras con fecha dentro del periodo',
        unidad: 'bitácoras',
        politicasRelacionadas: [POLITICAS.SEGUIMIENTO],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const where = scope.epsId !== undefined
                ? { date: rango(desde, hasta), patient: { epsId: scope.epsId } }
                : { date: rango(desde, hasta) };
            const n = await prisma.log.count({ where });
            if (n === 0) return sinDatos('No se registraron bitácoras en el periodo.');
            return valor(n);
        }
    },

    {
        id: 'personas_con_seguimiento',
        nombre: 'Personas con al menos un seguimiento en el periodo',
        formula: 'Pacientes con al menos una bitácora o una visita en el periodo ÷ Pacientes registrados × 100',
        unidad: '%',
        politicasRelacionadas: [POLITICAS.SEGUIMIENTO, POLITICAS.SERVICIO],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const total = await prisma.patient.count({ where: scope });
            if (total === 0) return sinDatos('No hay pacientes registrados.');

            const conSeguimiento = await prisma.patient.count({
                where: {
                    ...scope,
                    OR: [
                        { logs: { some: { date: rango(desde, hasta) } } },
                        { visits: { some: { date: rango(desde, hasta) } } }
                    ]
                }
            });
            if (conSeguimiento === 0) {
                return sinDatos('Ningún paciente registra seguimiento en el periodo.');
            }
            return valor(porcentaje(conSeguimiento, total), { conSeguimiento, total });
        }
    },

    {
        id: 'solicitudes_vinculacion',
        nombre: 'Solicitudes de vinculación de cuidadores recibidas y resueltas',
        formula: 'Conteo de postulaciones del periodo, desagregado por estado',
        unidad: 'solicitudes',
        politicasRelacionadas: [POLITICAS.TALENTO, POLITICAS.SERVICIO],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const filas = await prisma.user.findMany({
                where: { ...scope, role: 'CUIDADOR', createdAt: rango(desde, hasta) },
                select: { status: true }
            });
            if (filas.length === 0) {
                return sinDatos('No se recibieron postulaciones en el periodo.');
            }
            const g = {};
            for (const f of filas) g[f.status] = (g[f.status] || 0) + 1;

            const resueltas = filas.filter(f =>
                ['APROBADO', 'RECHAZADO', 'ACTIVO'].includes(f.status)).length;

            return valor(filas.length, { porEstado: g, resueltas, pendientes: filas.length - resueltas });
        }
    },

    {
        id: 'tiempo_vinculacion',
        nombre: 'Tiempo promedio de trámite de vinculación',
        formula: 'Promedio de (fecha de cambio de estado − fecha de postulación), en días',
        unidad: 'días',
        politicasRelacionadas: [POLITICAS.TALENTO, POLITICAS.FORTALECIMIENTO],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const filas = await prisma.user.findMany({
                where: {
                    ...scope, role: 'CUIDADOR',
                    statusChangedAt: rango(desde, hasta),
                    status: { in: ['APROBADO', 'RECHAZADO', 'ACTIVO', 'PRESELECCIONADO'] }
                },
                select: { createdAt: true, statusChangedAt: true }
            });
            const prom = promedioDias(filas.map(f => [f.createdAt, f.statusChangedAt]));
            if (prom === null) {
                return sinDatos('No hay trámites resueltos con fechas comparables en el periodo.');
            }
            return valor(prom, { tramitesMedidos: filas.length });
        }
    },

    {
        id: 'solicitudes_ciudadanas',
        nombre: 'Solicitudes ciudadanas y tiempo de respuesta',
        formula: 'Conteo de solicitudes del periodo y promedio de (fecha de resolución − fecha de radicación), en días',
        unidad: 'solicitudes',
        politicasRelacionadas: [POLITICAS.SERVICIO, POLITICAS.PARTICIPACION],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const where = scope.epsId !== undefined
                ? { createdAt: rango(desde, hasta), patient: { epsId: scope.epsId } }
                : { createdAt: rango(desde, hasta) };

            const filas = await prisma.serviceRequest.findMany({
                where, select: { status: true, createdAt: true, resolvedAt: true }
            });
            if (filas.length === 0) {
                return sinDatos('No se radicaron solicitudes en el periodo.');
            }
            const prom = promedioDias(filas.map(f => [f.createdAt, f.resolvedAt]));
            const g = {};
            for (const f of filas) g[f.status] = (g[f.status] || 0) + 1;

            return valor(filas.length, {
                porEstado: g,
                diasPromedioRespuesta: prom,
                notaTiempo: prom === null ? 'Ninguna solicitud tiene fecha de resolución registrada.' : null
            });
        }
    },

    {
        id: 'calificacion_servicio',
        nombre: 'Calificación promedio del servicio',
        formula: 'Promedio de las calificaciones registradas en las visitas del periodo (escala 1 a 5)',
        unidad: 'de 5',
        politicasRelacionadas: [POLITICAS.SERVICIO, POLITICAS.SEGUIMIENTO],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const where = {
                date: rango(desde, hasta),
                rating: { not: null },
                ...(scope.epsId !== undefined ? { patient: { epsId: scope.epsId } } : {})
            };
            const filas = await prisma.medicalVisit.findMany({ where, select: { rating: true } });
            if (filas.length === 0) {
                return sinDatos('Ninguna visita del periodo tiene calificación registrada.');
            }
            const suma = filas.reduce((a, f) => a + f.rating, 0);
            return valor(Math.round((suma / filas.length) * 100) / 100, { evaluaciones: filas.length });
        }
    },

    {
        id: 'eventos_acceso',
        nombre: 'Eventos de acceso y operación registrados',
        formula: 'Conteo de eventos de auditoría del periodo, desagregado por acción',
        unidad: 'eventos',
        politicasRelacionadas: [POLITICAS.SEGURIDAD_DIGITAL, POLITICAS.TRANSPARENCIA],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const filas = await prisma.auditEvent.findMany({
                where: { ...scope, createdAt: rango(desde, hasta) },
                select: { action: true }
            });
            if (filas.length === 0) {
                return sinDatos('No hay eventos de auditoría registrados en el periodo.');
            }
            const g = {};
            for (const f of filas) g[f.action] = (g[f.action] || 0) + 1;
            return valor(filas.length, g);
        }
    },

    {
        id: 'ejecucion_presupuestal',
        nombre: 'Ejecución presupuestal por tipo de reporte',
        formula: 'Suma de las líneas de gasto de los reportes enviados en el periodo, agrupada por tipo',
        unidad: 'COP',
        politicasRelacionadas: [POLITICAS.PRESUPUESTO, POLITICAS.TRANSPARENCIA],
        calcular: async (prisma, { desde, hasta, scope }) => {
            const reportes = await prisma.financialReport.findMany({
                where: {
                    ...scope,
                    estado: { in: ['ENVIADO', 'APROBADO'] },
                    periodoInicio: { lte: hasta },
                    periodoFin: { gte: desde }
                },
                include: { items: { select: { valorTotal: true } } }
            });
            if (reportes.length === 0) {
                return sinDatos('No hay reportes financieros enviados que cubran el periodo.');
            }
            const porTipo = {};
            let total = 0;
            for (const r of reportes) {
                const suma = r.items.reduce((a, i) => a + Number(i.valorTotal), 0);
                porTipo[r.reportType] = (porTipo[r.reportType] || 0) + suma;
                total += suma;
            }
            return valor(total, { porTipo, reportes: reportes.length });
        }
    }
];

export const indicadorPorId = (id) => INDICADORES.find(i => i.id === id);

/**
 * Calcula todo el catálogo para un periodo.
 * Un indicador que falle no tumba a los demás: se reporta como sin datos.
 */
export async function calcularCatalogo(prisma, contexto) {
    return Promise.all(INDICADORES.map(async (ind) => {
        const base = {
            id: ind.id,
            nombre: ind.nombre,
            formula: ind.formula,
            unidad: ind.unidad,
            politicasRelacionadas: ind.politicasRelacionadas
        };
        try {
            return { ...base, ...(await ind.calcular(prisma, contexto)) };
        } catch (e) {
            console.error(`❌ Indicador ${ind.id}:`, e.message);
            return { ...base, valor: null, sinDatos: true, nota: 'No se pudo calcular con los datos disponibles.' };
        }
    }));
}
