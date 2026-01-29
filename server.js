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
        console.log("✅ ERP Empresarial Conectado");
        inicializarAdmin();
    })
    .catch(err => console.error("❌ Error BD:", err));

// --- MODELOS ---
const UsuarioSchema = new mongoose.Schema({
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
    icono: { type: String, default: '🚀' }
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

// --- CORRECCIÓN AQUÍ: FUERZA EL RANGO DE ADMIN ---
async function inicializarAdmin() {
    // Busca al usuario 1978 y LO OBLIGA a ser admin y tener la contraseña correcta
    await Usuario.findOneAndUpdate(
        { user: '1978' },
        { $set: { es_admin: true, pass: '1978' } },
        { upsert: true, new: true } 
    );
    console.log("🔐 Usuario 1978 actualizado a SUPER ADMIN.");
}

// --- MIDDLEWARE ---
async function filtrarProyectosPorUsuario(usuarioNombre) {
    const usuario = await Usuario.findOne({ user: usuarioNombre });
    if (!usuario) return [];
    if (usuario.es_admin) {
        return await Activo.find(); // Admin ve todo
    } else {
        return await Activo.find({ _id: { $in: usuario.proyectos_permitidos } });
    }
}

// --- RUTAS API ---

app.post('/api/login', async (req, res) => {
    const { user, pass } = req.body;
    const usuario = await Usuario.findOne({ user, pass });
    if (usuario) {
        res.json({ success: true, user: usuario.user, es_admin: usuario.es_admin });
    } else {
        res.status(401).json({ success: false, error: "Credenciales incorrectas" });
    }
});

app.get('/api/data', async (req, res) => {
    const userReq = req.query.user; 
    if(!userReq) return res.status(403).json({error:"Usuario no identificado"});

    try {
        const usuarioDB = await Usuario.findOne({ user: userReq });
        if(!usuarioDB) return res.status(404).json({error: "Usuario no encontrado"});

        const misActivos = await filtrarProyectosPorUsuario(userReq);
        const idsActivos = misActivos.map(a => a._id);
        const cuentas = await Cuenta.find(); 
        
        let filtroMovs = {};
        if (!usuarioDB.es_admin) {
            filtroMovs.activo_id = { $in: idsActivos };
        }

        const movimientos = await Movimiento.find(filtroMovs).sort({ fecha: -1 }).limit(50)
            .populate('cuenta_id', 'nombre')
            .populate('activo_id', 'nombre');
        
        const pendientes = await Movimiento.find({ ...filtroMovs, estado: 'pendiente_reembolso' })
            .populate('activo_id', 'nombre');

        let patrimonio = 0;
        if(usuarioDB.es_admin) {
            patrimonio = cuentas.reduce((sum, c) => sum + c.saldo, 0);
        }

        res.json({ cuentas, activos: misActivos, movimientos, patrimonio, pendientes, es_admin: usuarioDB.es_admin });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// NUEVO: RUTA REPORTE (Restaurada para el admin)
app.post('/api/reporte', async (req, res) => {
    const { mes, anio, activo_id } = req.body;
    let filtro = {};
    if (mes !== 'todos') {
        const start = new Date(anio, parseInt(mes), 1);
        const end = new Date(anio, parseInt(mes) + 1, 0, 23, 59, 59);
        filtro.fecha = { $gte: start, $lte: end };
    } else {
        const start = new Date(anio, 0, 1);
        const end = new Date(anio, 11, 31, 23, 59, 59);
        filtro.fecha = { $gte: start, $lte: end };
    }
    if (activo_id !== 'todos') filtro.activo_id = activo_id;

    try {
        const movs = await Movimiento.find(filtro);
        let ingresos = 0; let gastos = 0;
        movs.forEach(m => {
            if(m.tipo === 'ingreso' || m.estado === 'reembolsado') ingresos += Math.abs(m.monto);
            if(m.tipo === 'gasto' && m.estado !== 'reembolsado') gastos += Math.abs(m.monto);
        });
        res.json({ ingresos, gastos, neto: ingresos - gastos, cantidad: movs.length });
    } catch (e) { res.status(500).json({ error: "Error reporte" }); }
});

app.get('/api/usuarios', async (req, res) => {
    const users = await Usuario.find({}, 'user es_admin proyectos_permitidos').populate('proyectos_permitidos', 'nombre');
    res.json(users);
});

app.post('/api/usuarios', async (req, res) => {
    const { user, pass, proyectos, action, id } = req.body;
    try {
        if(action === 'crear') {
            await Usuario.create({ user, pass, proyectos_permitidos: proyectos, es_admin: false });
        } else if (action === 'editar') {
            let update = { proyectos_permitidos: proyectos };
            if(pass) update.pass = pass;
            await Usuario.findByIdAndUpdate(id, update);
        } else if (action === 'borrar') {
            await Usuario.findByIdAndDelete(id);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error gestión usuario" }); }
});

app.post('/api/movimiento', async (req, res) => {
    const { descripcion, monto, cuenta_id, activo_id, tipo, estado, usuario_actual } = req.body;
    
    const solicitante = await Usuario.findOne({ user: usuario_actual });
    if (!solicitante.es_admin && !solicitante.proyectos_permitidos.includes(activo_id)) {
        return res.status(403).json({ error: "No tienes permiso en este proyecto" });
    }

    let montoReal = Math.abs(monto);
    if (tipo === 'gasto') montoReal = -montoReal;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        await Movimiento.create([{ 
            descripcion, monto: montoReal, cuenta_id, activo_id, tipo, 
            estado: estado || 'finalizado', creado_por: usuario_actual 
        }], { session });

        // Solo restamos saldo si NO es un gasto pendiente de reembolso
        // Si está esperando reembolso, el dinero salió, así que sí restamos, pero marcamos la alerta.
        await Cuenta.findByIdAndUpdate(cuenta_id, { $inc: { saldo: montoReal } }, { session });
        
        if (activo_id) {
            await Activo.findByIdAndUpdate(activo_id, { $inc: { balance_total: montoReal } }, { session });
        }
        await session.commitTransaction();
        res.json({ success: true });
    } catch (e) {
        await session.abortTransaction();
        res.status(500).json({ error: "Error transacción" });
    } finally { session.endSession(); }
});

app.post('/api/confirmar-reembolso', async (req, res) => {
    const { mov_id, usuario_actual } = req.body;
    const movOriginal = await Movimiento.findById(mov_id);
    if(!movOriginal) return res.status(404).json({error:"No existe"});

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        movOriginal.estado = 'reembolsado';
        await movOriginal.save({ session });

        const montoReembolso = Math.abs(movOriginal.monto); 
        await Movimiento.create([{
            descripcion: "✅ REEMBOLSO RECIBIDO: " + movOriginal.descripcion,
            monto: montoReembolso,
            cuenta_id: movOriginal.cuenta_id,
            activo_id: movOriginal.activo_id,
            tipo: 'ingreso',
            estado: 'finalizado',
            creado_por: usuario_actual
        }], { session });

        await Cuenta.findByIdAndUpdate(movOriginal.cuenta_id, { $inc: { saldo: montoReembolso } }, { session });
        await Activo.findByIdAndUpdate(movOriginal.activo_id, { $inc: { balance_total: montoReembolso } }, { session });

        await session.commitTransaction();
        res.json({ success: true });
    } catch (e) {
        await session.abortTransaction();
        res.status(500).json({ error: "Error reembolso" });
    } finally { session.endSession(); }
});

app.post('/api/cuentas', async (req, res) => { try { await Cuenta.create(req.body); res.json({ok:true}); } catch (e) { res.status(500).json({error:"err"}); }});
app.post('/api/activos', async (req, res) => { try { await Activo.create(req.body); res.json({ok:true}); } catch (e) { res.status(500).json({error:"err"}); }});

app.listen(PORT, () => console.log(`ERP Final corriendo en ${PORT}`));
