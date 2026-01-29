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
    proyectos_permitidos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Activo' }] // Lista de IDs permitidos
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
    // NUEVO: Para el Radar de Reembolsos y Auditoría
    estado: { type: String, default: 'finalizado', enum: ['finalizado', 'pendiente_reembolso', 'reembolsado'] },
    creado_por: { type: String, default: 'Sistema' } 
});

const Cuenta = mongoose.model('Cuenta', CuentaSchema);
const Activo = mongoose.model('Activo', ActivoSchema);
const Movimiento = mongoose.model('Movimiento', MovimientoSchema);
const Usuario = mongoose.model('Usuario', UsuarioSchema);

async function inicializarAdmin() {
    const existe = await Usuario.findOne({ user: '1978' });
    if (!existe) {
        // Tu usuario maestro tiene acceso a todo (es_admin: true)
        await Usuario.create({ user: '1978', pass: '1978', es_admin: true });
        console.log("🔐 Admin Maestro creado.");
    }
}

// --- MIDDLEWARE DE SEGURIDAD ---
// Verifica qué proyectos puede ver el usuario
async function filtrarProyectosPorUsuario(usuarioNombre) {
    const usuario = await Usuario.findOne({ user: usuarioNombre });
    if (!usuario) return [];
    if (usuario.es_admin) {
        return await Activo.find(); // El jefe ve todo
    } else {
        // El empleado solo ve lo que tiene en su lista
        return await Activo.find({ _id: { $in: usuario.proyectos_permitidos } });
    }
}

// --- RUTAS API ---

// LOGIN: Ahora devuelve si es admin
app.post('/api/login', async (req, res) => {
    const { user, pass } = req.body;
    const usuario = await Usuario.findOne({ user, pass });
    if (usuario) {
        res.json({ success: true, user: usuario.user, es_admin: usuario.es_admin });
    } else {
        res.status(401).json({ success: false, error: "Credenciales incorrectas" });
    }
});

// OBTENER DATOS (Filtrados por permisos)
app.get('/api/data', async (req, res) => {
    const userReq = req.query.user; // El frontend nos dice quién pide los datos
    if(!userReq) return res.status(403).json({error:"Usuario no identificado"});

    try {
        const misActivos = await filtrarProyectosPorUsuario(userReq);
        const idsActivos = misActivos.map(a => a._id);

        const cuentas = await Cuenta.find(); // Las cuentas de banco las ven todos para poder registrar (se puede restringir también si quieres)
        
        // Traer movimientos: Los del admin ve todos, el empleado solo de sus proyectos
        const usuarioDB = await Usuario.findOne({ user: userReq });
        let filtroMovs = {};
        if (!usuarioDB.es_admin) {
            filtroMovs.activo_id = { $in: idsActivos };
        }

        const movimientos = await Movimiento.find(filtroMovs).sort({ fecha: -1 }).limit(50)
            .populate('cuenta_id', 'nombre')
            .populate('activo_id', 'nombre');
        
        // Reembolsos pendientes (Radar)
        const pendientes = await Movimiento.find({ ...filtroMovs, estado: 'pendiente_reembolso' })
            .populate('activo_id', 'nombre');

        // Patrimonio: Solo calcularlo real para el admin
        let patrimonio = 0;
        if(usuarioDB.es_admin) {
            patrimonio = cuentas.reduce((sum, c) => sum + c.saldo, 0);
        }

        res.json({ cuentas, activos: misActivos, movimientos, patrimonio, pendientes, es_admin: usuarioDB.es_admin });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GESTIÓN DE USUARIOS (Solo Admin)
app.get('/api/usuarios', async (req, res) => {
    const users = await Usuario.find({}, 'user es_admin proyectos_permitidos').populate('proyectos_permitidos', 'nombre');
    res.json(users);
});

app.post('/api/usuarios', async (req, res) => {
    // Crear o Editar usuario con permisos
    const { user, pass, proyectos, action, id } = req.body;
    try {
        if(action === 'crear') {
            await Usuario.create({ user, pass, proyectos_permitidos: proyectos, es_admin: false });
        } else if (action === 'editar') {
            // Si viene pass vacio no lo cambiamos
            let update = { proyectos_permitidos: proyectos };
            if(pass) update.pass = pass;
            await Usuario.findByIdAndUpdate(id, update);
        } else if (action === 'borrar') {
            await Usuario.findByIdAndDelete(id);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error gestión usuario" }); }
});

// MOVIMIENTOS Y REEMBOLSOS
app.post('/api/movimiento', async (req, res) => {
    const { descripcion, monto, cuenta_id, activo_id, tipo, estado, usuario_actual } = req.body;
    
    // Validar permisos del usuario antes de guardar
    const solicitante = await Usuario.findOne({ user: usuario_actual });
    if (!solicitante.es_admin && !solicitante.proyectos_permitidos.includes(activo_id)) {
        return res.status(403).json({ error: "No tienes permiso en este proyecto" });
    }

    let montoReal = Math.abs(monto);
    if (tipo === 'gasto') montoReal = -montoReal;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // Guardamos quién lo hizo y el estado (finalizado o pendiente_reembolso)
        await Movimiento.create([{ 
            descripcion, monto: montoReal, cuenta_id, activo_id, tipo, 
            estado: estado || 'finalizado', creado_por: usuario_actual 
        }], { session });

        // Solo afectamos saldo si NO es pendiente de reembolso (o si es gasto normal)
        // Lógica: 
        // Gasto Normal -> Resta saldo.
        // Gasto "Pendiente Reembolso" -> Resta saldo (porque el dinero salió), pero crea alerta.
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
        // 1. Cambiar estado del original a "reembolsado"
        movOriginal.estado = 'reembolsado';
        await movOriginal.save({ session });

        // 2. Crear el ingreso del dinero de vuelta
        const montoReembolso = Math.abs(movOriginal.monto); // Convertimos el gasto negativo a positivo
        
        await Movimiento.create([{
            descripcion: "✅ REEMBOLSO RECIBIDO: " + movOriginal.descripcion,
            monto: montoReembolso,
            cuenta_id: movOriginal.cuenta_id,
            activo_id: movOriginal.activo_id,
            tipo: 'ingreso',
            estado: 'finalizado',
            creado_por: usuario_actual
        }], { session });

        // 3. Sumar el dinero a la cuenta y proyecto
        await Cuenta.findByIdAndUpdate(movOriginal.cuenta_id, { $inc: { saldo: montoReembolso } }, { session });
        await Activo.findByIdAndUpdate(movOriginal.activo_id, { $inc: { balance_total: montoReembolso } }, { session });

        await session.commitTransaction();
        res.json({ success: true });
    } catch (e) {
        await session.abortTransaction();
        console.error(e);
        res.status(500).json({ error: "Error procesando reembolso" });
    } finally { session.endSession(); }
});

// Creación básica de activos/cuentas (solo admin debería poder idealmente, lo dejamos abierto por simplicidad o puedes restringirlo en frontend)
app.post('/api/cuentas', async (req, res) => { try { await Cuenta.create(req.body); res.json({ok:true}); } catch (e) { res.status(500).json({error:"err"}); }});
app.post('/api/activos', async (req, res) => { try { await Activo.create(req.body); res.json({ok:true}); } catch (e) { res.status(500).json({error:"err"}); }});

app.listen(PORT, () => console.log(`ERP Avanzado corriendo en ${PORT}`));
