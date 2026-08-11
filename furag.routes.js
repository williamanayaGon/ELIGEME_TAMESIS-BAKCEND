// =================================================================
// GENERADOR DE EVIDENCIA FURAG / MIPG
// =================================================================
// Lo que este módulo NO hace: calcular el Índice de Desempeño
// Institucional, puntuar dimensiones o políticas, estimar preparación para
// la próxima medición, o replicar el formulario oficial. Eso lo produce
// Función Pública con una metodología que ELÍGEME no puede reproducir.
//
// Lo que sí hace: organizar la actividad real del programa como soporte
// documental, vincularla a las políticas MIPG que puede respaldar, y
// entregarla en documentos firmables.
//
// Dos principios:
//   1. Un indicador sin datos en el periodo se reporta "Sin registrar",
//      nunca como cero.
//   2. El sistema no infiere brechas ni marca políticas críticas: eso
//      exigiría umbrales que nadie definió. Las brechas las escribe una
//      persona.

import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';

import {
    requireAuth,
    requireRole,
    alcanceEntidad,
    registrarEvento
} from './auth.middleware.js';

import { INDICADORES, POLITICAS, indicadorPorId, calcularCatalogo } from './config/indicadores-mipg.js';

const LEYENDA = 'Soporte de gestión. No sustituye el diligenciamiento del formulario oficial ' +
    'ante el Departamento Administrativo de la Función Pública.';

const ESTADOS_ACCION = ['PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'VENCIDA'];

// Días de antelación con que se avisa que una evidencia va a vencer.
const DIAS_AVISO_VENCIMIENTO = 30;

const aFecha = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

// Periodo por defecto: el año corrido hasta hoy.
const periodoDe = (query) => {
    const hasta = aFecha(query.hasta) ?? new Date();
    const desde = aFecha(query.desde) ?? new Date(hasta.getFullYear(), 0, 1);
    return { desde, hasta };
};

const fmt = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';

// Presenta el valor de un indicador tal como debe leerse en pantalla y en PDF.
const valorLegible = (ind) => {
    if (ind.sinDatos || ind.valor === null) return 'Sin registrar';
    if (ind.unidad === 'COP') {
        return new Intl.NumberFormat('es-CO', {
            style: 'currency', currency: 'COP', maximumFractionDigits: 0
        }).format(ind.valor);
    }
    if (ind.unidad === '%') return `${ind.valor}%`;
    if (ind.unidad === 'de 5') return `${ind.valor} de 5`;
    return `${ind.valor} ${ind.unidad}`;
};

/**
 * El estado VENCIDA no se guarda: se deduce comparando la fecha objetivo con
 * hoy. Guardarlo obligaría a un proceso que recorra la tabla cada día.
 */
const conEstadoVigente = (accion) => {
    const vencida = accion.estado !== 'COMPLETADA'
        && accion.avance < 100
        && new Date(accion.fechaObjetivo) < new Date();
    return { ...accion, estado: vencida ? 'VENCIDA' : accion.estado, vencida };
};

const uploadEvidencia = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
            cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ok = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype);
        cb(ok ? null : new Error('Solo se aceptan archivos PDF, JPG o PNG.'), ok);
    }
});

// --- Encabezado institucional compartido por los PDF ---
function encabezado(doc, titulo) {
    doc.rect(0, 0, doc.page.width, 76).fill('#1f3c88');
    doc.fillColor('#ffffff').fontSize(17).text('ELÍGEME', 40, 20);
    doc.fontSize(9).text('Alcaldía de Támesis — Programa de cuidado domiciliario', 40, 42);

    // La leyenda va arriba, no en letra chica al pie: es lo que evita que el
    // documento se confunda con un reporte oficial.
    doc.fontSize(7).fillColor('#c7d2fe').text(LEYENDA, 40, 58, { width: doc.page.width - 80 });

    doc.fillColor('#000000').moveDown(3.2);
    doc.fontSize(15).text(titulo, 40, 96);
    doc.moveDown(0.5);
}

function pieDeFirmas(doc, responsable, dependencia) {
    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.moveDown(3);
    const y = doc.y;
    const ancho = (doc.page.width - 110) / 2;

    doc.strokeColor('#000000').lineWidth(0.7);
    doc.moveTo(40, y).lineTo(40 + ancho, y).stroke();
    doc.moveTo(70 + ancho, y).lineTo(70 + ancho * 2, y).stroke();

    doc.fontSize(8).fillColor('#000000');
    doc.text(responsable || '—', 40, y + 5, { width: ancho, align: 'center' });
    doc.fillColor('#666666').text('Responsable', 40, y + 17, { width: ancho, align: 'center' });

    doc.fillColor('#000000').text(dependencia || '—', 70 + ancho, y + 5, { width: ancho, align: 'center' });
    doc.fillColor('#666666').text('Dependencia', 70 + ancho, y + 17, { width: ancho, align: 'center' });
}

// =================================================================

export default function crearRutasFurag(prisma) {
    const router = express.Router();

    router.use(requireAuth, requireRole('ADMIN', 'SUPER'));

    // -------------------------------------------------------------
    // GET /indicadores — catálogo con valores del periodo y sus fórmulas
    // -------------------------------------------------------------
    router.get('/indicadores', async (req, res) => {
        try {
            const { desde, hasta } = periodoDe(req.query);
            const scope = alcanceEntidad(req.auth);

            const indicadores = await calcularCatalogo(prisma, { desde, hasta, scope });

            res.json({
                periodo: { desde, hasta },
                leyenda: LEYENDA,
                politicas: Object.values(POLITICAS),
                indicadores
            });
        } catch (error) {
            console.error('❌ Error calculando indicadores:', error);
            res.status(500).json({ error: 'No se pudieron calcular los indicadores.' });
        }
    });

    // -------------------------------------------------------------
    // GET /evidence  ?politica=&origen=
    // -------------------------------------------------------------
    router.get('/evidence', async (req, res) => {
        try {
            const where = { ...alcanceEntidad(req.auth) };
            if (req.query.politica) where.politica = req.query.politica;
            if (['GENERADA', 'CARGADA'].includes(req.query.origen)) where.origen = req.query.origen;

            const evidencias = await prisma.furagEvidence.findMany({
                where, orderBy: { createdAt: 'desc' }
            });

            const hoy = new Date();
            res.json(evidencias.map(e => ({
                ...e,
                // La vigencia es una comparación de fechas, no un juicio.
                vencida: Boolean(e.vigenteHasta && new Date(e.vigenteHasta) < hoy),
                porVencer: Boolean(
                    e.vigenteHasta &&
                    new Date(e.vigenteHasta) >= hoy &&
                    (new Date(e.vigenteHasta) - hoy) / 86400000 <= DIAS_AVISO_VENCIMIENTO
                )
            })));
        } catch (error) {
            console.error('❌ Error listando evidencias:', error);
            res.status(500).json({ error: 'No se pudieron cargar las evidencias.' });
        }
    });

    // -------------------------------------------------------------
    // POST /evidence — registra evidencia cargada por un funcionario
    // -------------------------------------------------------------
    router.post('/evidence', uploadEvidencia.single('archivo'), async (req, res) => {
        try {
            const d = req.body;
            if (!d.politica || !d.nombre) {
                return res.status(400).json({ error: 'Indica al menos la política y el nombre de la evidencia.' });
            }

            const creada = await prisma.furagEvidence.create({
                data: {
                    politica: d.politica,
                    nombre: d.nombre,
                    descripcion: d.descripcion || null,
                    origen: 'CARGADA',
                    archivoUrl: req.file ? `/uploads/${req.file.filename}` : null,
                    responsable: d.responsable || null,
                    dependencia: d.dependencia || null,
                    fechaDocumento: aFecha(d.fechaDocumento),
                    vigenteHasta: aFecha(d.vigenteHasta),
                    observaciones: d.observaciones || null,
                    generadaPor: req.auth.id,
                    epsId: req.auth.epsId
                }
            });

            await registrarEvento(prisma, req, {
                action: 'CREACION', entity: 'FuragEvidence', entityId: creada.id,
                detail: { origen: 'CARGADA', politica: creada.politica }
            });

            res.status(201).json(creada);
        } catch (error) {
            console.error('❌ Error registrando evidencia:', error);
            res.status(500).json({ error: 'No se pudo registrar la evidencia.' });
        }
    });

    // -------------------------------------------------------------
    // POST /evidence/generar — evidencia a partir de un indicador
    // -------------------------------------------------------------
    router.post('/evidence/generar', async (req, res) => {
        try {
            const { indicadorId, politica, desde, hasta, responsable, dependencia, vigenteHasta, observaciones } = req.body;

            const indicador = indicadorPorId(indicadorId);
            if (!indicador) {
                return res.status(400).json({ error: 'Ese indicador no está en el catálogo.' });
            }

            // La política debe ser una de las que el indicador puede respaldar:
            // vincularlo a cualquier otra sería afirmar algo que no se sostiene.
            const elegida = politica || indicador.politicasRelacionadas[0];
            if (!indicador.politicasRelacionadas.includes(elegida)) {
                return res.status(400).json({
                    error: `Este indicador no respalda la política "${elegida}".`,
                    politicasValidas: indicador.politicasRelacionadas
                });
            }

            const periodo = periodoDe({ desde, hasta });
            const scope = alcanceEntidad(req.auth);
            const resultado = await indicador.calcular(prisma, { ...periodo, scope });

            // El valor se congela aquí: el documento no puede cambiar después
            // de emitido aunque los datos sigan moviéndose.
            const creada = await prisma.furagEvidence.create({
                data: {
                    politica: elegida,
                    nombre: indicador.nombre,
                    descripcion: indicador.formula,
                    origen: 'GENERADA',
                    indicadorId: indicador.id,
                    periodoInicio: periodo.desde,
                    periodoFin: periodo.hasta,
                    valorGenerado: {
                        valor: resultado.valor,
                        unidad: indicador.unidad,
                        formula: indicador.formula,
                        sinDatos: Boolean(resultado.sinDatos),
                        nota: resultado.nota ?? null,
                        detalle: resultado.detalle ?? null,
                        generadoEl: new Date().toISOString()
                    },
                    responsable: responsable || null,
                    dependencia: dependencia || null,
                    fechaDocumento: new Date(),
                    vigenteHasta: aFecha(vigenteHasta),
                    observaciones: observaciones || null,
                    generadaPor: req.auth.id,
                    epsId: req.auth.epsId
                }
            });

            await registrarEvento(prisma, req, {
                action: 'CREACION', entity: 'FuragEvidence', entityId: creada.id,
                detail: { origen: 'GENERADA', indicador: indicador.id, sinDatos: Boolean(resultado.sinDatos) }
            });

            res.status(201).json(creada);
        } catch (error) {
            console.error('❌ Error generando evidencia:', error);
            res.status(500).json({ error: 'No se pudo generar la evidencia.' });
        }
    });

    // -------------------------------------------------------------
    // GET /evidence/:id/pdf
    // -------------------------------------------------------------
    router.get('/evidence/:id/pdf', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identificador inválido.' });

            const ev = await prisma.furagEvidence.findUnique({ where: { id } });
            if (!ev) return res.status(404).json({ error: 'No encontramos esa evidencia.' });

            const scope = alcanceEntidad(req.auth);
            if (scope.epsId !== undefined && ev.epsId !== scope.epsId) {
                return res.status(403).json({ error: 'Esa evidencia pertenece a otra entidad.' });
            }

            const doc = new PDFDocument({ size: 'A4', margin: 40 });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="evidencia-${ev.id}.pdf"`);
            doc.pipe(res);

            encabezado(doc, 'Soporte documental de gestión');

            const v = ev.valorGenerado || {};
            const fila = (etiqueta, texto) => {
                doc.fontSize(8).fillColor('#666666').text(etiqueta.toUpperCase());
                doc.fontSize(10).fillColor('#111111').text(texto || '—');
                doc.moveDown(0.6);
            };

            fila('Política MIPG que respalda', ev.politica);
            fila('Indicador', ev.nombre);

            if (ev.origen === 'GENERADA') {
                fila('Fórmula', v.formula || ev.descripcion);
                fila('Periodo', `${fmt(ev.periodoInicio)} a ${fmt(ev.periodoFin)}`);

                // El valor es el corazón del documento: se destaca.
                doc.moveDown(0.2);
                const y = doc.y;
                doc.rect(40, y, doc.page.width - 80, 46)
                    .fillAndStroke(v.sinDatos ? '#f9fafb' : '#eef2ff', '#e5e7eb');
                doc.fillColor('#666666').fontSize(8).text('VALOR', 52, y + 8);
                doc.fillColor(v.sinDatos ? '#6b7280' : '#1f3c88').fontSize(19)
                    .text(valorLegible({ valor: v.valor, unidad: v.unidad, sinDatos: v.sinDatos }), 52, y + 19);
                doc.y = y + 56;

                if (v.sinDatos && v.nota) {
                    doc.fontSize(8).fillColor('#92400e')
                        .text(`Nota: ${v.nota}`, { width: doc.page.width - 80 });
                    doc.moveDown(0.6);
                }

                if (v.detalle && typeof v.detalle === 'object') {
                    doc.fillColor('#666666').fontSize(8).text('DESAGREGACIÓN');
                    doc.moveDown(0.2);
                    for (const [k, val] of Object.entries(v.detalle)) {
                        if (val === null || val === undefined) continue;
                        const texto = typeof val === 'object' ? JSON.stringify(val) : String(val);
                        doc.fillColor('#111111').fontSize(9).text(`• ${k}: ${texto}`, { indent: 8 });
                    }
                    doc.moveDown(0.6);
                }

                fila('Fuente', 'ELÍGEME — registros del programa de cuidado domiciliario');
                fila('Generado el', v.generadoEl ? new Date(v.generadoEl).toLocaleString('es-CO') : fmt(ev.fechaDocumento));
            } else {
                fila('Descripción', ev.descripcion);
                fila('Fecha del documento', fmt(ev.fechaDocumento));
                fila('Archivo adjunto', ev.archivoUrl ? 'Sí, adjunto al registro' : 'Sin archivo');
            }

            if (ev.vigenteHasta) fila('Vigente hasta', fmt(ev.vigenteHasta));
            if (ev.observaciones) fila('Observaciones', ev.observaciones);

            pieDeFirmas(doc, ev.responsable, ev.dependencia);
            doc.end();

            await registrarEvento(prisma, req, {
                action: 'LECTURA', entity: 'FuragEvidence', entityId: id, detail: { formato: 'pdf' }
            });
        } catch (error) {
            console.error('❌ Error generando PDF:', error);
            if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el documento.' });
        }
    });

    // -------------------------------------------------------------
    // PLAN DE MEJORAMIENTO
    // -------------------------------------------------------------
    router.get('/actions', async (req, res) => {
        try {
            const acciones = await prisma.improvementAction.findMany({
                where: alcanceEntidad(req.auth),
                orderBy: { fechaObjetivo: 'asc' }
            });

            const conEstado = acciones.map(conEstadoVigente);
            // El avance del plan es el promedio de los avances registrados:
            // una cuenta sobre lo que alguien escribió, no una estimación.
            const avancePlan = conEstado.length
                ? Math.round(conEstado.reduce((a, x) => a + x.avance, 0) / conEstado.length)
                : null;

            res.json({
                acciones: conEstado,
                resumen: {
                    total: conEstado.length,
                    vencidas: conEstado.filter(a => a.vencida).length,
                    completadas: conEstado.filter(a => a.estado === 'COMPLETADA').length,
                    avancePlan
                }
            });
        } catch (error) {
            console.error('❌ Error listando acciones:', error);
            res.status(500).json({ error: 'No se pudo cargar el plan de mejoramiento.' });
        }
    });

    router.post('/actions', async (req, res) => {
        try {
            const d = req.body;
            const fechaObjetivo = aFecha(d.fechaObjetivo);

            if (!d.politica || !d.brecha || !d.accion || !d.responsable || !d.dependencia) {
                return res.status(400).json({
                    error: 'La política, la brecha, la acción, el responsable y la dependencia son obligatorios.'
                });
            }
            if (!fechaObjetivo) {
                return res.status(400).json({ error: 'Indica una fecha objetivo válida.' });
            }

            const creada = await prisma.improvementAction.create({
                data: {
                    politica: d.politica,
                    brecha: d.brecha,
                    accion: d.accion,
                    responsable: d.responsable,
                    dependencia: d.dependencia,
                    fechaInicio: aFecha(d.fechaInicio),
                    fechaObjetivo,
                    avance: Math.min(100, Math.max(0, parseInt(d.avance, 10) || 0)),
                    estado: ESTADOS_ACCION.includes(d.estado) ? d.estado : 'PENDIENTE',
                    epsId: req.auth.epsId
                }
            });

            await registrarEvento(prisma, req, {
                action: 'CREACION', entity: 'ImprovementAction', entityId: creada.id
            });

            res.status(201).json(conEstadoVigente(creada));
        } catch (error) {
            console.error('❌ Error creando acción:', error);
            res.status(500).json({ error: 'No se pudo crear la acción de mejora.' });
        }
    });

    router.put('/actions/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identificador inválido.' });

            const actual = await prisma.improvementAction.findUnique({ where: { id } });
            if (!actual) return res.status(404).json({ error: 'No encontramos esa acción.' });

            const scope = alcanceEntidad(req.auth);
            if (scope.epsId !== undefined && actual.epsId !== scope.epsId) {
                return res.status(403).json({ error: 'Esa acción pertenece a otra entidad.' });
            }

            const d = req.body;
            const avance = d.avance !== undefined
                ? Math.min(100, Math.max(0, parseInt(d.avance, 10) || 0))
                : actual.avance;

            const actualizada = await prisma.improvementAction.update({
                where: { id },
                data: {
                    politica: d.politica ?? actual.politica,
                    brecha: d.brecha ?? actual.brecha,
                    accion: d.accion ?? actual.accion,
                    responsable: d.responsable ?? actual.responsable,
                    dependencia: d.dependencia ?? actual.dependencia,
                    fechaInicio: d.fechaInicio !== undefined ? aFecha(d.fechaInicio) : actual.fechaInicio,
                    fechaObjetivo: aFecha(d.fechaObjetivo) ?? actual.fechaObjetivo,
                    avance,
                    // Llegar a 100 cierra la acción; el resto lo decide quien edita.
                    estado: avance >= 100
                        ? 'COMPLETADA'
                        : (ESTADOS_ACCION.includes(d.estado) ? d.estado : actual.estado)
                }
            });

            await registrarEvento(prisma, req, {
                action: 'EDICION', entity: 'ImprovementAction', entityId: id, detail: { avance }
            });

            res.json(conEstadoVigente(actualizada));
        } catch (error) {
            console.error('❌ Error actualizando acción:', error);
            res.status(500).json({ error: 'No se pudo actualizar la acción.' });
        }
    });

    // -------------------------------------------------------------
    // GET /alerts — solo comparaciones de fecha, nada de umbrales
    // -------------------------------------------------------------
    router.get('/alerts', async (req, res) => {
        try {
            const scope = alcanceEntidad(req.auth);
            const hoy = new Date();
            const limite = new Date(hoy.getTime() + DIAS_AVISO_VENCIMIENTO * 86400000);

            const [vencidas, porVencer, acciones] = await Promise.all([
                prisma.furagEvidence.findMany({
                    where: { ...scope, vigenteHasta: { lt: hoy } },
                    orderBy: { vigenteHasta: 'asc' }
                }),
                prisma.furagEvidence.findMany({
                    where: { ...scope, vigenteHasta: { gte: hoy, lte: limite } },
                    orderBy: { vigenteHasta: 'asc' }
                }),
                prisma.improvementAction.findMany({
                    where: { ...scope, fechaObjetivo: { lt: hoy }, avance: { lt: 100 } },
                    orderBy: { fechaObjetivo: 'asc' }
                })
            ]);

            res.json({
                diasAviso: DIAS_AVISO_VENCIMIENTO,
                evidenciasVencidas: vencidas,
                evidenciasPorVencer: porVencer,
                accionesAtrasadas: acciones.map(conEstadoVigente),
                total: vencidas.length + porVencer.length + acciones.length
            });
        } catch (error) {
            console.error('❌ Error calculando alertas:', error);
            res.status(500).json({ error: 'No se pudieron calcular las alertas.' });
        }
    });

    // -------------------------------------------------------------
    // GET /executive-report — PDF consolidado del periodo
    // -------------------------------------------------------------
    router.get('/executive-report', async (req, res) => {
        try {
            const { desde, hasta } = periodoDe(req.query);
            const scope = alcanceEntidad(req.auth);

            const [indicadores, evidencias, acciones] = await Promise.all([
                calcularCatalogo(prisma, { desde, hasta, scope }),
                prisma.furagEvidence.findMany({ where: scope, orderBy: { politica: 'asc' } }),
                prisma.improvementAction.findMany({ where: scope, orderBy: { fechaObjetivo: 'asc' } })
            ]);

            const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition',
                `attachment; filename="soporte-gestion-${desde.toISOString().slice(0, 10)}.pdf"`);
            doc.pipe(res);

            encabezado(doc, 'Consolidado de soportes de gestión');
            doc.fontSize(9).fillColor('#555555')
                .text(`Periodo: ${fmt(desde)} a ${fmt(hasta)}`, 40, doc.y);
            doc.moveDown(1.2);

            // --- Indicadores ---
            doc.fillColor('#000000').fontSize(12).text('1. Indicadores del periodo');
            doc.moveDown(0.5);

            for (const ind of indicadores) {
                if (doc.y > doc.page.height - 120) doc.addPage();

                doc.fontSize(10).fillColor('#111111').text(ind.nombre);
                doc.fontSize(7.5).fillColor('#6b7280').text(`Fórmula: ${ind.formula}`);
                doc.fontSize(11)
                    .fillColor(ind.sinDatos ? '#6b7280' : '#1f3c88')
                    .text(valorLegible(ind));
                if (ind.sinDatos && ind.nota) {
                    doc.fontSize(7.5).fillColor('#92400e').text(ind.nota);
                }
                doc.fontSize(7).fillColor('#9ca3af')
                    .text(`Respalda: ${ind.politicasRelacionadas.join(' · ')}`);
                doc.moveDown(0.7);
            }

            // --- Evidencias ---
            doc.addPage();
            doc.fontSize(12).fillColor('#000000').text('2. Evidencias registradas');
            doc.moveDown(0.5);

            if (evidencias.length === 0) {
                doc.fontSize(9).fillColor('#6b7280').text('Sin evidencias registradas.');
            } else {
                let politicaActual = null;
                for (const ev of evidencias) {
                    if (doc.y > doc.page.height - 100) doc.addPage();
                    if (ev.politica !== politicaActual) {
                        politicaActual = ev.politica;
                        doc.moveDown(0.4).fontSize(9).fillColor('#1f3c88').text(politicaActual);
                        doc.moveDown(0.2);
                    }
                    doc.fontSize(9).fillColor('#111111').text(`• ${ev.nombre}`, { indent: 10 });
                    doc.fontSize(7.5).fillColor('#6b7280').text(
                        `${ev.origen} · documento ${fmt(ev.fechaDocumento)}` +
                        (ev.vigenteHasta ? ` · vigente hasta ${fmt(ev.vigenteHasta)}` : ''),
                        { indent: 16 }
                    );
                }
            }

            // --- Plan de mejoramiento ---
            doc.moveDown(1.2);
            if (doc.y > doc.page.height - 160) doc.addPage();
            doc.fontSize(12).fillColor('#000000').text('3. Plan de mejoramiento');
            doc.moveDown(0.5);

            if (acciones.length === 0) {
                doc.fontSize(9).fillColor('#6b7280').text('Sin acciones registradas.');
            } else {
                for (const a of acciones.map(conEstadoVigente)) {
                    if (doc.y > doc.page.height - 100) doc.addPage();
                    doc.fontSize(9).fillColor('#111111').text(`• ${a.accion}`, { indent: 10 });
                    doc.fontSize(7.5).fillColor('#6b7280').text(
                        `${a.politica} · ${a.responsable} (${a.dependencia}) · ` +
                        `objetivo ${fmt(a.fechaObjetivo)} · avance ${a.avance}% · ${a.estado}`,
                        { indent: 16 }
                    );
                    doc.fontSize(7.5).fillColor('#9ca3af').text(`Brecha: ${a.brecha}`, { indent: 16 });
                    doc.moveDown(0.3);
                }
            }

            pieDeFirmas(doc, req.auth.role === 'SUPER' ? 'Superintendencia' : 'Administración', 'ELÍGEME');
            doc.end();

            await registrarEvento(prisma, req, {
                action: 'LECTURA', entity: 'FuragExecutiveReport',
                detail: { desde, hasta, indicadores: indicadores.length }
            });
        } catch (error) {
            console.error('❌ Error generando reporte ejecutivo:', error);
            if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el reporte.' });
        }
    });

    return router;
}
