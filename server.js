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
        console.log("✅ ERP Financiero Conectado");
        inicializarUsuarioMaestro();
    })
    .catch(err => console.error("❌ Error BD:", err));

// --- MODELOS ---
const CuentaSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    tipo: { type: String, default: 'banco' }, 
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
    tipo: { type: String, enum: ['ingreso', 'gasto'] }
});

const UsuarioSchema = new mongoose.Schema({
    user: { type: String, required: true, unique: true },
    pass: { type: String, required: true }
});

const Cuenta = mongoose.model('Cuenta', CuentaSchema);
const Activo = mongoose.model('Activo', ActivoSchema);
const Movimiento = mongoose.model('Movimiento', MovimientoSchema);
const Usuario = mongoose.model('Usuario', UsuarioSchema);

async function inicializarUsuarioMaestro() {
    const existe = await Usuario.findOne({ user: '1978' });
    if (!existe) {
        await Usuario.create({ user: '1978', pass: '1978' });
        console.log("🔐 Usuario Maestro 1978 creado.");
    }
}

// --- RUTAS API ---

app.post('/api/login', async (req, res) => {
    const { user, pass } = req.body;
    const usuario = await Usuario.findOne({ user, pass });
    if (usuario) res.json({ success: true, user: usuario.user });
    else res.status(401).json({ success: false, error: "Credenciales incorrectas" });
});

app.get('/api/data', async (req, res) => {
    try {
        const cuentas = await Cuenta.find();
        const activos = await Activo.find();
        const movimientos = await Movimiento.find().sort({ fecha: -1 }).limit(20)
            .populate('cuenta_id', 'nombre')
            .populate('activo_id', 'nombre');
        let patrimonio = cuentas.reduce((sum, c) => sum + c.saldo, 0);
        res.json({ cuentas, activos, movimientos, patrimonio });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// NUEVO: RUTA PARA REPORTES FILTRADOS
app.post('/api/reporte', async (req, res) => {
    const { mes, anio, activo_id } = req.body;
    
    let filtro = {};

    // 1. Filtrar por Fecha
    if (mes !== 'todos') {
        // Mes específico (Ojo: en JS los meses van de 0 a 11)
        const start = new Date(anio, parseInt(mes), 1);
        const end = new Date(anio, parseInt(mes) + 1, 0, 23, 59, 59);
        filtro.fecha = { $gte: start, $lte: end };
    } else {
        // Todo el año
        const start = new Date(anio, 0, 1);
        const end = new Date(anio, 11, 31, 23, 59, 59);
        filtro.fecha = { $gte: start, $lte: end };
    }

    // 2. Filtrar por Proyecto (Si se seleccionó uno específico)
    if (activo_id !== 'todos') {
        filtro.activo_id = activo_id;
    }

    try {
        const movs = await Movimiento.find(filtro);
        
        // Calcular Ingresos vs Gastos
        let ingresos = 0;
        let gastos = 0;

        movs.forEach(m => {
            if(m.tipo === 'ingreso') ingresos += Math.abs(m.monto);
            if(m.tipo === 'gasto') gastos += Math.abs(m.monto); // Sumamos valor absoluto para la gráfica
        });

        res.json({ ingresos, gastos, neto: ingresos - gastos, cantidad: movs.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error generando reporte" });
    }
});

app.post('/api/cuentas', async (req, res) => {
    try { const nueva = await Cuenta.create(req.body); res.json(nueva); } catch (e) { res.status(500).json({ error: "Error" }); }
});
app.post('/api/activos', async (req, res) => {
    try { const nuevo = await Activo.create(req.body); res.json(nuevo); } catch (e) { res.status(500).json({ error: "Error" }); }
});
app.post('/api/usuarios', async (req, res) => {
    try { const nuevo = await Usuario.create(req.body); res.json({success:true}); } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.post('/api/movimiento', async (req, res) => {
    const { descripcion, monto, cuenta_id, activo_id, tipo } = req.body;
    if (!monto || !cuenta_id) return res.status(400).json({ error: "Datos faltantes" });

    let montoReal = Math.abs(monto);
    if (tipo === 'gasto') montoReal = -montoReal;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        await Movimiento.create([{ descripcion, monto: montoReal, cuenta_id, activo_id, tipo }], { session });
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

app.listen(PORT, () => console.log(`ERP con Reportes corriendo en ${PORT}`));
