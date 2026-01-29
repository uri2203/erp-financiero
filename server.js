const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// CONEXIÓN BD - Usamos la misma nube de Mongo, pero una base de datos DIFERENTE (/finanzas_db)
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://invitado:noc123@cluster0.dummy.mongodb.net/finanzas_db";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Conexión a MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ ERP Financiero Conectado a MongoDB"))
    .catch(err => console.error("❌ Error BD:", err));

// --- MODELOS DE DATOS ---
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

const Cuenta = mongoose.model('Cuenta', CuentaSchema);
const Activo = mongoose.model('Activo', ActivoSchema);
const Movimiento = mongoose.model('Movimiento', MovimientoSchema);

// --- RUTAS API ---

// 1. Obtener Datos
app.get('/api/data', async (req, res) => {
    try {
        const cuentas = await Cuenta.find();
        const activos = await Activo.find();
        const movimientos = await Movimiento.find().sort({ fecha: -1 }).limit(20)
            .populate('cuenta_id', 'nombre')
            .populate('activo_id', 'nombre');
        
        // Calcular Patrimonio Total
        let patrimonio = cuentas.reduce((sum, c) => sum + c.saldo, 0);
        res.json({ cuentas, activos, movimientos, patrimonio });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Crear Cuenta
app.post('/api/cuentas', async (req, res) => {
    try {
        const nueva = await Cuenta.create(req.body);
        res.json(nueva);
    } catch (e) { res.status(500).json({ error: "Error creando cuenta" }); }
});

// 3. Crear Activo
app.post('/api/activos', async (req, res) => {
    try {
        const nuevo = await Activo.create(req.body);
        res.json(nuevo);
    } catch (e) { res.status(500).json({ error: "Error creando activo" }); }
});

// 4. Registrar Movimiento
app.post('/api/movimiento', async (req, res) => {
    const { descripcion, monto, cuenta_id, activo_id, tipo } = req.body;
    
    if (!monto || !cuenta_id) return res.status(400).json({ error: "Faltan datos" });

    // Ajustar signo: Gasto resta, Ingreso suma
    let montoReal = Math.abs(monto);
    if (tipo === 'gasto') montoReal = -montoReal;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // A) Guardar historial
        const mov = await Movimiento.create([{
            descripcion, monto: montoReal, cuenta_id, activo_id, tipo
        }], { session });

        // B) Actualizar Saldo Cuenta
        await Cuenta.findByIdAndUpdate(cuenta_id, { 
            $inc: { saldo: montoReal } 
        }, { session });

        // C) Actualizar Rentabilidad Activo
        if (activo_id) {
            await Activo.findByIdAndUpdate(activo_id, {
                $inc: { balance_total: montoReal }
            }, { session });
        }

        await session.commitTransaction();
        res.json({ success: true });

    } catch (e) {
        await session.abortTransaction();
        console.error(e);
        res.status(500).json({ error: "Error en transacción" });
    } finally {
        session.endSession();
    }
});

app.listen(PORT, () => console.log(`ERP Financiero corriendo en puerto ${PORT}`));