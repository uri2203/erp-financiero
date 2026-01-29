const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://invitado:noc123@cluster0.dummy.mongodb.net/finanzas_db";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("✅ ERP v7.0 (PDF Pro) Conectado");
        inicializarAdmin();
    })
    .catch(err => console.error("❌ Error BD:", err));

// --- MODELOS ---
const UsuarioSchema = new mongoose.Schema({
    nombre_completo: { type: String, default: 'Usuario Sistema' },
    user: { type: String, required: true, unique: true },
    pass: { type: String, required: true },
    es_admin: { type: Boolean, default: false },
    proyectos_permitidos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Activo' }] 
});

const CuentaSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    icono: { type: String, default: '💳' }
});

const ActivoSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    balance_total: { type: Number, default: 0 },
    icono: { type: String, default: '🚀' },
    cuentas_asociadas: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Cuenta' }] 
});

const MovimientoSchema = new mongoose.Schema({
    fecha: { type: Date, default: Date.now },
    descripcion: String,
    monto: Number,
    cuenta_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Cuenta' },
    activo_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Activo' },
    tipo: { type: String, enum: ['ingreso', 'gasto'] },
    estado: { type: String, default: 'finalizado', enum: ['finalizado', 'pendiente_reembolso', 'reembolsado'] },
    creado_por: { type: String, default: 'Sistema' } 
});

const Cuenta = mongoose.model('Cuenta', CuentaSchema);
const Activo = mongoose.model('Activo', ActivoSchema);
const Movimiento = mongoose.model('Movimiento', MovimientoSchema);
const Usuario = mongoose.model('Usuario', UsuarioSchema);

async function inicializarAdmin() {
    await Usuario.findOneAndUpdate(
        { user: '1978' },
        { $set: { es_admin: true, pass: '1978', nombre_completo: 'Administrador Principal' } },
        { upsert: true, new: true } 
    );
}

// --- LOGICA DE DATOS SEGURA ---
async function obtenerDatosSeguros(usuarioReq) {
    const usuarioDB = await Usuario.findOne({ user: usuarioReq });
    if (!usuarioDB) throw new Error("Usuario no encontrado");

    let misProyectos = [], misCuentas = [], filtroMovs = {};

    if (usuarioDB.es_admin) {
        misProyectos = await Activo.find().populate('cuentas_asociadas');
        misCuentas = await Cuenta.find();
    } else {
        misProyectos = await Activo.find({ _id: { $in: usuarioDB.proyectos_permitidos } }).populate('cuentas_asociadas');
        let idsCuentasPermitidas = new Set();
        misProyectos.forEach(p => {
            if(p.cuentas_asociadas) p.cuentas_asociadas.forEach(c => idsCuentasPermitidas.add(c._id.toString()));
        });
        misCuentas = await Cuenta.find({ _id: { $in: Array.from(idsCuentasPermitidas) } });
        filtroMovs.activo_id = { $in: misProyectos.map(p => p._id) };
    }

    const movimientos = await Movimiento.find(filtroMovs).sort({ fecha: -1 }).limit(50)
        .populate('cuenta_id', 'nombre').populate('activo_id', 'nombre');
    
    const pendientes = await Movimiento.find({ ...filtroMovs, estado: 'pendiente_reembolso' })
        .populate('activo_id', 'nombre');

    let patrimonio = misCuentas.reduce((sum, c) => sum + c.saldo, 0);

    return { cuentas: misCuentas, activos: misProyectos, movimientos, patrimonio, pendientes, es_admin: usuarioDB.es_admin };
}

// --- RUTAS API ---
app.post('/api/login', async (req, res) => {
    const { user, pass } = req.body;
    const usuario = await Usuario.findOne({ user, pass });
    if (usuario) res.json({ success: true, user: usuario.user, es_admin: usuario.es_admin });
    else res.status(401).json({ success: false, error: "Credenciales incorrectas" });
});

app.get('/api/data', async (req, res) => {
    try {
        const data = await obtenerDatosSeguros(req.query.user);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// CRUD 
app.post('/api/cuentas', async (req, res) => { try { await Cuenta.create(req.body); res.json({ok:true}); } catch (e) { res.status(500).json({error:"err"}); }});
app.put('/api/cuentas/:id', async (req, res) => { try { await Cuenta.findByIdAndUpdate(req.params.id, req.body); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); }});
app.delete('/api/cuentas/:id', async (req, res) => { try { await Cuenta.findByIdAndDelete(req.params.id); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); }});
app.post('/api/activos', async (req, res) => { try { await Activo.create({ nombre: req.body.nombre, cuentas_asociadas: req.body.cuentas }); res.json({ok:true}); } catch (e) { res.status(500).json({error:"err"}); }});
app.put('/api/activos/:id', async (req, res) => { try { await Activo.findByIdAndUpdate(req.params.id, { nombre: req.body.nombre, cuentas_asociadas: req.body.cuentas }); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); }});
app.delete('/api/activos/:id', async (req, res) => { try { await Activo.findByIdAndDelete(req.params.id); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); }});

app.get('/api/usuarios', async (req, res) => {
    const users = await Usuario.find({}, 'user nombre_completo es_admin proyectos_permitidos').populate('proyectos_permitidos', 'nombre');
    res.json(users);
});
app.post('/api/usuarios', async (req, res) => {
    const { user, pass, nombre_completo, proyectos, action, id } = req.body;
    try {
        if(action === 'crear') await Usuario.create({ user, pass, nombre_completo, proyectos_permitidos: proyectos, es_admin: false });
        else if (action === 'borrar') await Usuario.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error gestión usuario" }); }
});

app.post('/api/movimiento', async (req, res) => {
    const { descripcion, monto, cuenta_id, activo_id, tipo, estado, usuario_actual } = req.body;
    let montoReal = Math.abs(monto);
    if (tipo === 'gasto') montoReal = -montoReal;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        await Movimiento.create([{ descripcion, monto: montoReal, cuenta_id, activo_id, tipo, estado: estado || 'finalizado', creado_por: usuario_actual }], { session });
        await Cuenta.findByIdAndUpdate(cuenta_id, { $inc: { saldo: montoReal } }, { session });
        if (activo_id) await Activo.findByIdAndUpdate(activo_id, { $inc: { balance_total: montoReal } }, { session });
        await session.commitTransaction();
        res.json({ success: true });
    } catch (e) { await session.abortTransaction(); res.status(500).json({ error: "Error transacción" }); } finally { session.endSession(); }
});

// --- REPORTES PRO (CON DETALLE) ---
app.post('/api/reporte', async (req, res) => {
    const { mes, anio, activo_id, user } = req.body;
    
    const usuarioDB = await Usuario.findOne({ user });
    if (!usuarioDB) return res.status(403).json({ error: "No autorizado" });

    let filtro = {};

    // 1. Fecha
    if (mes !== 'todos') {
        const start = new Date(anio, parseInt(mes), 1);
        const end = new Date(anio, parseInt(mes) + 1, 0, 23, 59, 59);
        filtro.fecha = { $gte: start, $lte: end };
    } else {
        const start = new Date(anio, 0, 1);
        const end = new Date(anio, 11, 31, 23, 59, 59);
        filtro.fecha = { $gte: start, $lte: end };
    }

    // 2. Seguridad Proyecto
    if (usuarioDB.es_admin) {
        if (activo_id !== 'todos') filtro.activo_id = activo_id;
    } else {
        if (activo_id !== 'todos') {
            if (usuarioDB.proyectos_permitidos.includes(activo_id)) filtro.activo_id = activo_id;
            else return res.status(403).json({ error: "No tienes acceso" });
        } else {
            filtro.activo_id = { $in: usuarioDB.proyectos_permitidos };
        }
    }

    try {
        // AHORA TRAEMOS TODOS LOS MOVIMIENTOS DETALLADOS
        const movs = await Movimiento.find(filtro).sort({ fecha: 1 })
            .populate('activo_id', 'nombre')
            .populate('cuenta_id', 'nombre');

        let ingresos = 0; let gastos = 0;
        movs.forEach(m => {
            if(m.tipo === 'ingreso' || m.estado === 'reembolsado') ingresos += Math.abs(m.monto);
            if(m.tipo === 'gasto' && m.estado !== 'reembolsado') gastos += Math.abs(m.monto);
        });
        
        // Enviamos detalles para la tabla del PDF
        res.json({ ingresos, gastos, neto: ingresos - gastos, cantidad: movs.length, detalles: movs });
    } catch (e) { res.status(500).json({ error: "Error reporte" }); }
});

app.post('/api/confirmar-reembolso', async (req, res) => {
    const { mov_id, usuario_actual } = req.body;
    const movOriginal = await Movimiento.findById(mov_id);
    if(!movOriginal) return res.status(404).json({error:"No existe"});
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        movOriginal.estado = 'reembolsado'; await movOriginal.save({ session });
        const montoReembolso = Math.abs(movOriginal.monto); 
        await Movimiento.create([{ descripcion: "✅ REEMBOLSO RECIBIDO: " + movOriginal.descripcion, monto: montoReembolso, cuenta_id: movOriginal.cuenta_id, activo_id: movOriginal.activo_id, tipo: 'ingreso', estado: 'finalizado', creado_por: usuario_actual }], { session });
        await Cuenta.findByIdAndUpdate(movOriginal.cuenta_id, { $inc: { saldo: montoReembolso } }, { session });
        await Activo.findByIdAndUpdate(movOriginal.activo_id, { $inc: { balance_total: montoReembolso } }, { session });
        await session.commitTransaction();
        res.json({ success: true });
    } catch (e) { await session.abortTransaction(); res.status(500).json({ error: "Error reembolso" }); } finally { session.endSession(); }
});

app.listen(PORT, () => console.log(`ERP v7.0 PDF en ${PORT}`));
