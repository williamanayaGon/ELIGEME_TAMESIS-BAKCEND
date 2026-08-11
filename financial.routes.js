// =================================================================
// REPORTES FINANCIEROS POR TIPO
// =================================================================
// Cada reporte agrupa líneas de gasto (FinancialLineItem) en vez de un
// JSON opaco, para poder sumar, filtrar y auditar.
//
// Dos reglas gobiernan el módulo:
//   1. valorTotal SIEMPRE se calcula aquí (cantidad × valorUnitario).
//      Nunca se confía en el total que mande el cliente.
//   2. Un reporte ENVIADO es inmutable. Corregirlo exige uno nuevo que
//      referencie al anterior mediante corrigeId.

import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

import {
    requireAuth,
    requireRole,
    alcanceEntidad,
    pacienteEnAlcance,
    registrarEvento
} from './auth.middleware.js';

export const TIPOS = [
    'GENERAL', 'TRASLADOS', 'MEDICAMENTOS', 'INSUMOS',
    'TALENTO_HUMANO', 'AYUDAS_TECNICAS', 'URGENCIAS'
];

const ESTADOS = ['BORRADOR', 'ENVIADO', 'APROBADO', 'OBJETADO'];

// Columnas propias de cada tipo. Viven en metadata (Json) y definen tanto la
// plantilla de importación como las columnas que pinta el formulario.
export const CAMPOS_POR_TIPO = {
    GENERAL: [],
    TRASLADOS: [
        { key: 'origen', label: 'Origen', tipo: 'texto' },
        { key: 'destino', label: 'Destino', tipo: 'texto' },
        { key: 'kilometros', label: 'Kilómetros', tipo: 'numero' },
        { key: 'tipoVehiculo', label: 'Tipo de vehículo', tipo: 'texto' }
    ],
    MEDICAMENTOS: [
        { key: 'codigoCUM', label: 'Código CUM', tipo: 'texto' },
        { key: 'principioActivo', label: 'Principio activo', tipo: 'texto' },
        { key: 'presentacion', label: 'Presentación', tipo: 'texto' }
    ],
    INSUMOS: [
        { key: 'codigo', label: 'Código', tipo: 'texto' },
        { key: 'presentacion', label: 'Presentación', tipo: 'texto' }
    ],
    TALENTO_HUMANO: [
        { key: 'rol', label: 'Rol', tipo: 'texto' },
        { key: 'horas', label: 'Horas', tipo: 'numero' }
    ],
    AYUDAS_TECNICAS: [
        { key: 'tipoAyuda', label: 'Tipo de ayuda', tipo: 'texto' },
        { key: 'serial', label: 'Serial', tipo: 'texto' }
    ],
    URGENCIAS: [
        { key: 'institucion', label: 'Institución', tipo: 'texto' },
        { key: 'diagnostico', label: 'Diagnóstico', tipo: 'texto' }
    ]
};

// Columnas comunes a todos los tipos, en el orden de la plantilla.
const CAMPOS_BASE = [
    { key: 'concepto', label: 'Concepto', tipo: 'texto' },
    { key: 'descripcion', label: 'Descripción', tipo: 'texto' },
    { key: 'cantidad', label: 'Cantidad', tipo: 'numero' },
    { key: 'valorUnitario', label: 'Valor unitario', tipo: 'numero' },
    { key: 'fechaEvento', label: 'Fecha del evento', tipo: 'fecha' }
];

export const columnasDe = (tipo) => [...CAMPOS_BASE, ...(CAMPOS_POR_TIPO[tipo] ?? [])];

// --- Utilidades ---

// Acepta "1.234,56", "$ 1234.56" o 1234.56 y devuelve un número.
const aNumero = (valor) => {
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
    if (valor === null || valor === undefined) return 0;

    let s = String(valor).trim().replace(/[^\d.,-]/g, '');
    // Si hay coma y punto, el último separador es el decimal.
    if (s.includes(',') && s.includes('.')) {
        s = s.lastIndexOf(',') > s.lastIndexOf('.')
            ? s.replace(/\./g, '').replace(',', '.')
            : s.replace(/,/g, '');
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
};

const aFecha = (valor) => {
    if (!valor) return null;
    const d = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
};

// Decimal de Prisma no es serializable como número: se convierte en la salida.
const serializar = (reporte) => ({
    ...reporte,
    items: (reporte.items ?? []).map(i => ({
        ...i,
        cantidad: Number(i.cantidad),
        valorUnitario: Number(i.valorUnitario),
        valorTotal: Number(i.valorTotal)
    })),
    totalCalculado: (reporte.items ?? []).reduce((acc, i) => acc + Number(i.valorTotal), 0)
});

const money = (n) => new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 2
}).format(Number(n) || 0);

// Normaliza las líneas que llegan del cliente y calcula el total en el servidor.
const prepararLineas = (lineas, tipo) => {
    if (!Array.isArray(lineas)) return { error: 'Las líneas deben venir en una lista.' };
    if (lineas.length === 0) return { error: 'El reporte necesita al menos una línea.' };

    const permitidas = new Set((CAMPOS_POR_TIPO[tipo] ?? []).map(c => c.key));
    const preparadas = [];

    for (const [i, linea] of lineas.entries()) {
        const concepto = String(linea.concepto ?? '').trim();
        if (!concepto) return { error: `La línea ${i + 1} no tiene concepto.` };

        const cantidad = aNumero(linea.cantidad ?? 1);
        const valorUnitario = aNumero(linea.valorUnitario);

        if (cantidad <= 0) return { error: `La línea ${i + 1} tiene una cantidad inválida.` };
        if (valorUnitario < 0) return { error: `La línea ${i + 1} tiene un valor unitario negativo.` };

        // Solo se guardan las claves que corresponden al tipo del reporte.
        const metadata = {};
        for (const key of permitidas) {
            if (linea.metadata?.[key] !== undefined && linea.metadata[key] !== '') {
                metadata[key] = linea.metadata[key];
            }
        }

        preparadas.push({
            concepto,
            descripcion: linea.descripcion ? String(linea.descripcion).trim() : null,
            cantidad,
            valorUnitario,
            // Regla 1: el total lo decide el servidor.
            valorTotal: Number((cantidad * valorUnitario).toFixed(2)),
            fechaEvento: aFecha(linea.fechaEvento),
            patientId: linea.patientId ? parseInt(linea.patientId, 10) : null,
            visitId: linea.visitId ? parseInt(linea.visitId, 10) : null,
            metadata: Object.keys(metadata).length ? metadata : null
        });
    }

    return { lineas: preparadas };
};

// Los pacientes referenciados deben pertenecer a la entidad de quien reporta.
const validarPacientes = async (prisma, auth, lineas) => {
    const ids = [...new Set(lineas.map(l => l.patientId).filter(Boolean))];
    for (const id of ids) {
        if (!(await pacienteEnAlcance(prisma, auth, id))) {
            return `El paciente ${id} no pertenece a tu entidad.`;
        }
    }
    return null;
};

// Carga un reporte comprobando que quien pregunta pueda verlo.
const cargarEnAlcance = async (prisma, auth, id) => {
    const reporte = await prisma.financialReport.findUnique({
        where: { id },
        include: { items: { orderBy: { id: 'asc' } } }
    });
    if (!reporte) return { estado: 404, error: 'No encontramos ese reporte.' };

    const scope = alcanceEntidad(auth);
    if (scope.epsId !== undefined && reporte.epsId !== scope.epsId) {
        return { estado: 403, error: 'Ese reporte pertenece a otra entidad.' };
    }
    return { reporte };
};

// Solo CSV y XLSX para la carga masiva.
const uploadHoja = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ok = /\.(csv|xlsx)$/i.test(file.originalname);
        cb(ok ? null : new Error('Solo se aceptan archivos CSV o XLSX.'), ok);
    }
});

// =================================================================

export default function crearRutasFinancieras(prisma) {
    const router = express.Router();

    // Todo el módulo es de uso administrativo.
    router.use(requireAuth, requireRole('ADMIN', 'SUPER'));

    // -------------------------------------------------------------
    // GET /  — listado con filtros
    // -------------------------------------------------------------
    router.get('/', async (req, res) => {
        try {
            const { tipo, estado, desde, hasta } = req.query;
            const where = { ...alcanceEntidad(req.auth) };

            if (tipo && TIPOS.includes(tipo)) where.reportType = tipo;
            if (estado && ESTADOS.includes(estado)) where.estado = estado;

            // El rango se cruza contra el periodo cubierto por el reporte.
            const inicio = aFecha(desde);
            const fin = aFecha(hasta);
            if (inicio) where.periodoFin = { gte: inicio };
            if (fin) where.periodoInicio = { lte: fin };

            const reportes = await prisma.financialReport.findMany({
                where,
                orderBy: { date: 'desc' },
                include: { items: { orderBy: { id: 'asc' } } }
            });

            res.json(reportes.map(serializar));
        } catch (error) {
            console.error('❌ Error listando reportes:', error);
            res.status(500).json({ error: 'No se pudieron cargar los reportes.' });
        }
    });

    // -------------------------------------------------------------
    // GET /plantilla/:tipo  — columnas + XLSX de ejemplo
    // Va antes de /:id para que "plantilla" no se lea como un id.
    // -------------------------------------------------------------
    router.get('/plantilla/:tipo', async (req, res) => {
        const tipo = String(req.params.tipo || '').toUpperCase();
        if (!TIPOS.includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de reporte desconocido.' });
        }

        const columnas = columnasDe(tipo);

        // Sin ?formato=xlsx se devuelve la definición, que es lo que usa el
        // formulario para saber qué columnas pintar.
        if (req.query.formato !== 'xlsx') {
            return res.json({ tipo, columnas });
        }

        try {
            const libro = new ExcelJS.Workbook();
            const hoja = libro.addWorksheet(`Plantilla ${tipo}`);

            hoja.columns = columnas.map(c => ({ header: c.label, key: c.key, width: 22 }));
            hoja.getRow(1).font = { bold: true };
            hoja.getRow(1).fill = {
                type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3C88' }
            };
            hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

            // Una fila de ejemplo para que se entienda el formato esperado.
            const ejemplo = {};
            for (const c of columnas) {
                ejemplo[c.key] =
                    c.tipo === 'numero' ? 1 :
                    c.tipo === 'fecha' ? new Date().toISOString().slice(0, 10) :
                    `Ejemplo ${c.label.toLowerCase()}`;
            }
            hoja.addRow(ejemplo);

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="plantilla-${tipo.toLowerCase()}.xlsx"`);
            await libro.xlsx.write(res);
            res.end();
        } catch (error) {
            console.error('❌ Error generando plantilla:', error);
            res.status(500).json({ error: 'No se pudo generar la plantilla.' });
        }
    });

    // -------------------------------------------------------------
    // POST /importar  — lee CSV/XLSX y devuelve las líneas ya normalizadas
    // No guarda nada: el usuario revisa antes de crear el reporte.
    // -------------------------------------------------------------
    router.post('/importar', uploadHoja.single('archivo'), async (req, res) => {
        try {
            const tipo = String(req.body.tipo || 'GENERAL').toUpperCase();
            if (!TIPOS.includes(tipo)) {
                return res.status(400).json({ error: 'Tipo de reporte desconocido.' });
            }
            if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo CSV o XLSX.' });

            const libro = new ExcelJS.Workbook();
            const esCsv = /\.csv$/i.test(req.file.originalname);
            const { Readable } = await import('stream');
            const flujo = Readable.from(req.file.buffer);

            if (esCsv) await libro.csv.read(flujo);
            else await libro.xlsx.load(req.file.buffer);

            const hoja = libro.worksheets[0];
            if (!hoja || hoja.rowCount < 2) {
                return res.status(400).json({ error: 'El archivo no tiene filas de datos.' });
            }

            const columnas = columnasDe(tipo);
            // El encabezado se empareja por etiqueta, sin distinguir mayúsculas.
            const encabezado = (hoja.getRow(1).values || []).map(v =>
                String(v ?? '').trim().toLowerCase());

            const indiceDe = (col) => encabezado.findIndex(h => h === col.label.toLowerCase());

            const crudas = [];
            for (let i = 2; i <= hoja.rowCount; i++) {
                const fila = hoja.getRow(i);
                const valores = fila.values || [];
                const leer = (col) => {
                    const idx = indiceDe(col);
                    if (idx < 0) return undefined;
                    const v = valores[idx];
                    return v && typeof v === 'object' && 'result' in v ? v.result : v;
                };

                const concepto = leer(CAMPOS_BASE[0]);
                if (!concepto) continue; // fila vacía

                const metadata = {};
                for (const c of (CAMPOS_POR_TIPO[tipo] ?? [])) {
                    const v = leer(c);
                    if (v !== undefined && v !== null && v !== '') metadata[c.key] = v;
                }

                crudas.push({
                    concepto,
                    descripcion: leer(CAMPOS_BASE[1]),
                    cantidad: leer(CAMPOS_BASE[2]),
                    valorUnitario: leer(CAMPOS_BASE[3]),
                    fechaEvento: leer(CAMPOS_BASE[4]),
                    metadata
                });
            }

            const { lineas, error } = prepararLineas(crudas, tipo);
            if (error) return res.status(400).json({ error: `${error} (revisa el archivo)` });

            res.json({
                tipo,
                lineas,
                total: lineas.reduce((a, l) => a + l.valorTotal, 0),
                mensaje: `Se leyeron ${lineas.length} líneas. Revísalas antes de guardar.`
            });
        } catch (error) {
            console.error('❌ Error importando:', error);
            res.status(400).json({ error: 'No se pudo leer el archivo. Verifica que siga la plantilla.' });
        }
    });

    // -------------------------------------------------------------
    // POST /  — crear reporte con sus líneas, en una transacción
    // -------------------------------------------------------------
    router.post('/', async (req, res) => {
        try {
            const d = req.body;
            const tipo = String(d.reportType || 'GENERAL').toUpperCase();
            if (!TIPOS.includes(tipo)) {
                return res.status(400).json({ error: 'Tipo de reporte desconocido.' });
            }

            const periodoInicio = aFecha(d.periodoInicio);
            const periodoFin = aFecha(d.periodoFin);
            if (!periodoInicio || !periodoFin) {
                return res.status(400).json({ error: 'Indica el periodo que cubre el reporte.' });
            }
            if (periodoFin < periodoInicio) {
                return res.status(400).json({ error: 'El periodo termina antes de empezar.' });
            }

            const { lineas, error } = prepararLineas(d.items ?? d.lineas, tipo);
            if (error) return res.status(400).json({ error });

            const problema = await validarPacientes(prisma, req.auth, lineas);
            if (problema) return res.status(403).json({ error: problema });

            const totalEjecutado = lineas.reduce((a, l) => a + l.valorTotal, 0);
            const presupuesto = aNumero(d.totalBudget);

            const creado = await prisma.$transaction(async (tx) => {
                const reporte = await tx.financialReport.create({
                    data: {
                        reference: `RF-${Date.now().toString().slice(-8)}`,
                        reportType: tipo,
                        estado: 'BORRADOR',
                        periodoInicio,
                        periodoFin,
                        period: d.period || `${periodoInicio.toLocaleDateString('es-CO')} a ${periodoFin.toLocaleDateString('es-CO')}`,
                        epsName: d.epsName || '',
                        responsible: d.responsible || '',
                        totalBudget: String(presupuesto),
                        totalExecuted: String(totalEjecutado),
                        balance: String(presupuesto - totalEjecutado),
                        expensesData: '[]', // heredado: las líneas viven en su propia tabla
                        generalObs: d.generalObs || null,
                        elaboratedBy: d.elaboratedBy || null,
                        reviewedBy: d.reviewedBy || null,
                        corrigeId: d.corrigeId ? parseInt(d.corrigeId, 10) : null,
                        epsId: req.auth.epsId,
                        items: { create: lineas }
                    },
                    include: { items: { orderBy: { id: 'asc' } } }
                });
                return reporte;
            });

            await registrarEvento(prisma, req, {
                action: 'CREACION', entity: 'FinancialReport', entityId: creado.id,
                detail: { tipo, lineas: lineas.length, total: totalEjecutado }
            });

            res.status(201).json(serializar(creado));
        } catch (error) {
            console.error('❌ Error creando reporte:', error);
            res.status(500).json({ error: 'No se pudo guardar el reporte.' });
        }
    });

    // -------------------------------------------------------------
    // GET /:id  — detalle
    // -------------------------------------------------------------
    router.get('/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identificador inválido.' });

            const { reporte, estado, error } = await cargarEnAlcance(prisma, req.auth, id);
            if (error) return res.status(estado).json({ error });

            res.json(serializar(reporte));
        } catch (error) {
            console.error('❌ Error obteniendo reporte:', error);
            res.status(500).json({ error: 'No se pudo cargar el reporte.' });
        }
    });

    // -------------------------------------------------------------
    // PUT /:id  — editar, solo mientras sea BORRADOR
    // -------------------------------------------------------------
    router.put('/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identificador inválido.' });

            const { reporte, estado: httpEstado, error: errAlcance } =
                await cargarEnAlcance(prisma, req.auth, id);
            if (errAlcance) return res.status(httpEstado).json({ error: errAlcance });

            // Regla 2: fuera de BORRADOR el contenido está congelado.
            if (reporte.estado !== 'BORRADOR') {
                return res.status(409).json({
                    error: `Este reporte está en estado ${reporte.estado} y ya no se puede editar. Crea uno nuevo que lo corrija.`
                });
            }

            const d = req.body;
            const tipo = String(d.reportType || reporte.reportType).toUpperCase();
            if (!TIPOS.includes(tipo)) {
                return res.status(400).json({ error: 'Tipo de reporte desconocido.' });
            }

            const { lineas, error } = prepararLineas(d.items ?? d.lineas, tipo);
            if (error) return res.status(400).json({ error });

            const problema = await validarPacientes(prisma, req.auth, lineas);
            if (problema) return res.status(403).json({ error: problema });

            const periodoInicio = aFecha(d.periodoInicio) ?? reporte.periodoInicio;
            const periodoFin = aFecha(d.periodoFin) ?? reporte.periodoFin;
            if (periodoFin < periodoInicio) {
                return res.status(400).json({ error: 'El periodo termina antes de empezar.' });
            }

            const totalEjecutado = lineas.reduce((a, l) => a + l.valorTotal, 0);
            const presupuesto = d.totalBudget !== undefined
                ? aNumero(d.totalBudget)
                : aNumero(reporte.totalBudget);

            // Se reemplazan las líneas completas: es más simple y predecible
            // que conciliar altas, bajas y cambios una por una.
            const actualizado = await prisma.$transaction(async (tx) => {
                await tx.financialLineItem.deleteMany({ where: { reportId: id } });
                return tx.financialReport.update({
                    where: { id },
                    data: {
                        reportType: tipo,
                        periodoInicio,
                        periodoFin,
                        period: d.period ?? reporte.period,
                        responsible: d.responsible ?? reporte.responsible,
                        totalBudget: String(presupuesto),
                        totalExecuted: String(totalEjecutado),
                        balance: String(presupuesto - totalEjecutado),
                        generalObs: d.generalObs ?? reporte.generalObs,
                        elaboratedBy: d.elaboratedBy ?? reporte.elaboratedBy,
                        reviewedBy: d.reviewedBy ?? reporte.reviewedBy,
                        items: { create: lineas }
                    },
                    include: { items: { orderBy: { id: 'asc' } } }
                });
            });

            await registrarEvento(prisma, req, {
                action: 'EDICION', entity: 'FinancialReport', entityId: id,
                detail: { lineas: lineas.length, total: totalEjecutado }
            });

            res.json(serializar(actualizado));
        } catch (error) {
            console.error('❌ Error editando reporte:', error);
            res.status(500).json({ error: 'No se pudo actualizar el reporte.' });
        }
    });

    // -------------------------------------------------------------
    // POST /:id/enviar  — BORRADOR -> ENVIADO, congela el contenido
    // -------------------------------------------------------------
    router.post('/:id/enviar', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identificador inválido.' });

            const { reporte, estado: httpEstado, error } =
                await cargarEnAlcance(prisma, req.auth, id);
            if (error) return res.status(httpEstado).json({ error });

            if (reporte.estado !== 'BORRADOR') {
                return res.status(409).json({ error: `Este reporte ya fue enviado (estado ${reporte.estado}).` });
            }
            if (reporte.items.length === 0) {
                return res.status(400).json({ error: 'No se puede enviar un reporte sin líneas.' });
            }

            // El total se recalcula al enviar: es el número que queda en firme.
            const total = reporte.items.reduce((a, i) => a + Number(i.valorTotal), 0);
            const presupuesto = aNumero(reporte.totalBudget);

            const enviado = await prisma.financialReport.update({
                where: { id },
                data: {
                    estado: 'ENVIADO',
                    enviadoAt: new Date(),
                    totalExecuted: String(total),
                    balance: String(presupuesto - total)
                },
                include: { items: { orderBy: { id: 'asc' } } }
            });

            await registrarEvento(prisma, req, {
                action: 'ENVIO', entity: 'FinancialReport', entityId: id,
                detail: { total, lineas: reporte.items.length }
            });

            res.json(serializar(enviado));
        } catch (error) {
            console.error('❌ Error enviando reporte:', error);
            res.status(500).json({ error: 'No se pudo enviar el reporte.' });
        }
    });

    // -------------------------------------------------------------
    // GET /:id/export?formato=pdf|xlsx
    // -------------------------------------------------------------
    router.get('/:id/export', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identificador inválido.' });

            const { reporte, estado, error } = await cargarEnAlcance(prisma, req.auth, id);
            if (error) return res.status(estado).json({ error });

            const formato = (req.query.formato || 'pdf').toLowerCase();
            if (!['pdf', 'xlsx'].includes(formato)) {
                return res.status(400).json({ error: 'Formato no soportado. Usa pdf o xlsx.' });
            }

            const columnas = columnasDe(reporte.reportType);
            const extra = CAMPOS_POR_TIPO[reporte.reportType] ?? [];
            const total = reporte.items.reduce((a, i) => a + Number(i.valorTotal), 0);
            const nombre = `${reporte.reference}-${reporte.reportType.toLowerCase()}`;

            if (formato === 'xlsx') {
                const libro = new ExcelJS.Workbook();
                libro.creator = 'Elígeme';
                const hoja = libro.addWorksheet('Reporte');

                hoja.addRow([`Reporte ${reporte.reportType}`]).font = { bold: true, size: 14 };
                hoja.addRow([`Referencia`, reporte.reference]);
                hoja.addRow([`Estado`, reporte.estado]);
                hoja.addRow([`Periodo`, `${reporte.periodoInicio.toLocaleDateString('es-CO')} a ${reporte.periodoFin.toLocaleDateString('es-CO')}`]);
                hoja.addRow([`Responsable`, reporte.responsible || '—']);
                hoja.addRow([]);

                const encabezado = hoja.addRow([...columnas.map(c => c.label), 'Valor total']);
                encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3C88' } };

                for (const item of reporte.items) {
                    hoja.addRow([
                        item.concepto,
                        item.descripcion || '',
                        Number(item.cantidad),
                        Number(item.valorUnitario),
                        item.fechaEvento ? item.fechaEvento.toLocaleDateString('es-CO') : '',
                        ...extra.map(c => item.metadata?.[c.key] ?? ''),
                        Number(item.valorTotal)
                    ]);
                }

                const filaTotal = hoja.addRow([...columnas.map(() => ''), total]);
                filaTotal.font = { bold: true };
                hoja.columns.forEach(c => { c.width = 20; });

                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
                await libro.xlsx.write(res);
                return res.end();
            }

            // --- PDF institucional ---
            const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${nombre}.pdf"`);
            doc.pipe(res);

            doc.rect(0, 0, doc.page.width, 70).fill('#1f3c88');
            doc.fillColor('#ffffff').fontSize(18).text('ELÍGEME', 40, 22, { continued: false });
            doc.fontSize(10).text('Alcaldía de Támesis — Gestión del cuidado', 40, 46);

            doc.fillColor('#000000').moveDown(3);
            doc.fontSize(15).text(`Reporte financiero — ${reporte.reportType.replace('_', ' ')}`);
            doc.moveDown(0.5).fontSize(9).fillColor('#555555');
            doc.text(`Referencia: ${reporte.reference}     Estado: ${reporte.estado}`);
            doc.text(`Periodo: ${reporte.periodoInicio.toLocaleDateString('es-CO')} a ${reporte.periodoFin.toLocaleDateString('es-CO')}`);
            doc.text(`Responsable: ${reporte.responsible || '—'}`);
            if (reporte.enviadoAt) doc.text(`Enviado: ${reporte.enviadoAt.toLocaleString('es-CO')}`);

            doc.moveDown(1).fillColor('#000000').fontSize(11).text('Detalle de gastos');
            doc.moveDown(0.4);

            // Tabla simple: concepto a la izquierda, importes a la derecha.
            const x0 = 40;
            const ancho = doc.page.width - 80;
            doc.fontSize(8).fillColor('#ffffff');
            const yEnc = doc.y;
            doc.rect(x0, yEnc, ancho, 16).fill('#1f3c88');
            doc.fillColor('#ffffff')
                .text('Concepto', x0 + 4, yEnc + 4, { width: ancho * 0.42 })
                .text('Cant.', x0 + ancho * 0.45, yEnc + 4, { width: ancho * 0.1 })
                .text('V. unitario', x0 + ancho * 0.56, yEnc + 4, { width: ancho * 0.2 })
                .text('V. total', x0 + ancho * 0.78, yEnc + 4, { width: ancho * 0.2 });
            doc.y = yEnc + 20;

            doc.fillColor('#000000').fontSize(8);
            for (const item of reporte.items) {
                if (doc.y > doc.page.height - 90) doc.addPage();
                const y = doc.y;
                const detalle = [item.descripcion, ...extra.map(c => item.metadata?.[c.key]).filter(Boolean)]
                    .filter(Boolean).join(' · ');

                doc.fillColor('#000000').text(item.concepto, x0 + 4, y, { width: ancho * 0.42 });
                if (detalle) doc.fillColor('#777777').fontSize(7).text(detalle, x0 + 4, doc.y, { width: ancho * 0.42 });

                doc.fillColor('#000000').fontSize(8)
                    .text(String(Number(item.cantidad)), x0 + ancho * 0.45, y, { width: ancho * 0.1 })
                    .text(money(item.valorUnitario), x0 + ancho * 0.56, y, { width: ancho * 0.2 })
                    .text(money(item.valorTotal), x0 + ancho * 0.78, y, { width: ancho * 0.2 });

                doc.moveDown(0.6);
                doc.moveTo(x0, doc.y).lineTo(x0 + ancho, doc.y).strokeColor('#e5e7eb').stroke();
                doc.moveDown(0.3);
            }

            doc.moveDown(0.6).fontSize(11).fillColor('#1f3c88')
                .text(`Total ejecutado: ${money(total)}`, { align: 'right' });
            doc.fontSize(9).fillColor('#555555')
                .text(`Presupuesto: ${money(reporte.totalBudget)}   ·   Saldo: ${money(reporte.balance)}`, { align: 'right' });

            if (reporte.generalObs) {
                doc.moveDown(1).fillColor('#000000').fontSize(9)
                    .text('Observaciones', { underline: true }).moveDown(0.3)
                    .fillColor('#333333').text(reporte.generalObs, { width: ancho });
            }

            doc.moveDown(2).fontSize(8).fillColor('#888888')
                .text(`Elaboró: ${reporte.elaboratedBy || '—'}     Revisó: ${reporte.reviewedBy || '—'}`, { align: 'left' });

            doc.end();
        } catch (error) {
            console.error('❌ Error exportando reporte:', error);
            if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el archivo.' });
        }
    });

    return router;
}
