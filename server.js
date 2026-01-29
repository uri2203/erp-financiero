const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://invitado:noc123@cluster0.dummy.mongodb.net/finanzas_db";

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '50mb' })); // Aumentado limite para Backups grandes
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("✅ ERP v12.0 (Ultimate) Conectado");
        inicializarDatos();
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

const CategoriaSchema = new mongoose.Schema({ // NUEVO
    nombre: { type: String, required: true },
    tipo: { type: String, enum: ['ingreso', 'gasto'] } // Para filtrar en el select
});

const MovimientoSchema = new mongoose.Schema({
    fecha: { type: Date, default: Date.now },
    descripcion: String,
    categoria: { type: String, default: 'General' }, // NUEVO
    monto: Number,
    cuenta_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Cuenta' },
    activo_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Activo' },
    tipo: { type: String, enum: ['ingreso', 'gasto', 'traspaso_salida', 'traspaso_entrada'] },
    estado: { type: String, default: 'finalizado', enum: ['finalizado', 'pendiente_reembolso', 'reembolsado'] },
    creado_por: { type: String, default: 'Sistema' } 
});

const ArqueoSchema = new mongoose.Schema({
    fecha: { type: Date, default: Date.now },
    usuario: String,
    total: Number,
    detalles: [{ cuenta: String, saldo: Number }]
});

const Cuenta = mongoose.model('Cuenta', CuentaSchema);
const Activo = mongoose.model('Activo', ActivoSchema);
const Categoria = mongoose.model('Categoria', CategoriaSchema);
const Movimiento = mongoose.model('Movimiento', MovimientoSchema);
const Usuario = mongoose.model('Usuario', UsuarioSchema);
const Arqueo = mongoose.model('Arqueo', ArqueoSchema);

async function inicializarDatos() {
    // Admin por defecto
    await Usuario.findOneAndUpdate({ user: '1978' }, { $set: { es_admin: true, pass: '1978', nombre_completo: 'Administrador Principal' } }, { upsert: true });
    // Categorías por defecto si no existen
    const catCount = await Categoria.countDocuments();
    if (catCount === 0) {
        await Categoria.insertMany([
            { nombre: 'Ventas', tipo: 'ingreso' }, { nombre: 'Inversión', tipo: 'ingreso' },
            { nombre: 'Nómina', tipo: 'gasto' }, { nombre: 'Insumos', tipo: 'gasto' },
            { nombre: 'Servicios', tipo: 'gasto' }, { nombre: 'Publicidad', tipo: 'gasto' },
            { nombre: 'Logística', tipo: 'gasto' }, { nombre: 'Otros', tipo: 'gasto' }
        ]);
        console.log("✅ Categorías inicializadas");
    }
}

// --- MIDDLEWARE SEGURIDAD ---
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
        misProyectos.forEach(p => { if(p.cuentas_asociadas) p.cuentas_asociadas.forEach(c => idsCuentasPermitidas.add(c._id.toString())); });
        misCuentas = await Cuenta.find({ _id: { $in: Array.from(idsCuentasPermitidas) } });
        filtroMovs.activo_id = { $in: misProyectos.map(p => p._id) };
    }

    const movimientos = await Movimiento.find(filtroMovs).sort({ fecha: -1 }).limit(50).populate('cuenta_id', 'nombre').populate('activo_id', 'nombre');
    const pendientes = await Movimiento.find({ ...filtroMovs, estado: 'pendiente_reembolso' }).populate('activo_id', 'nombre');
    const categorias = await Categoria.find(); // Enviamos categorías para el select
    
    let patrimonio = misCuentas.reduce((sum, c) => sum + c.saldo, 0);

    return { cuentas: misCuentas, activos: misProyectos, movimientos, patrimonio, pendientes, categorias, es_admin: usuarioDB.es_admin };
}

// --- RUTAS API ---
app.post('/api/login', async (req, res) => { const { user, pass } = req.body; const u = await Usuario.findOne({ user, pass }); if (u) res.json({ success: true, user: u.user, es_admin: u.es_admin }); else res.status(401).json({ error: "Credenciales" }); });
app.get('/api/data', async (req, res) => { try { const data = await obtenerDatosSeguros(req.query.user); res.json(data); } catch (e) { res.status(500).json({ error: e.message }); } });

// CRUD BASICO
app.post('/api/cuentas', async (req, res) => { try { await Cuenta.create(req.body); res.json({ok:true}); } catch (e) { res.status(500).json({error:"err"}); }});
app.put('/api/cuentas/:id', async (req, res) => { try { await Cuenta.findByIdAndUpdate(req.params.id, req.body); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); }});
app.delete('/api/cuentas/:id', async (req, res) => { try { await Cuenta.findByIdAndDelete(req.params.id); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); }});
app.post('/api/activos', async (req, res) => { try { await Activo.create({ nombre: req.body.nombre, cuentas_asociadas: req.body.cuentas }); res.json({ok:true}); } catch (e) { res.status(500).json({error:"err"}); }});
app.put('/api/activos/:id', async (req, res) => { try { await Activo.findByIdAndUpdate(req.params.id, { nombre: req.body.nombre, cuentas_asociadas: req.body.cuentas }); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); }});
app.delete('/api/activos/:id', async (req, res) => { try { await Activo.findByIdAndDelete(req.params.id); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); }});

// USUARIOS
app.get('/api/usuarios', async (req, res) => { const users = await Usuario.find({}, 'user nombre_completo es_admin proyectos_permitidos').populate({ path: 'proyectos_permitidos', populate: { path: 'cuentas_asociadas', model: 'Cuenta' } }); res.json(users); });
app.post('/api/usuarios', async (req, res) => { try { await Usuario.create(req.body); res.json({ success: true }); } catch (e) { res.status(500).json({ error: "Error" }); } });
app.put('/api/usuarios/:id', async (req, res) => { const { user, pass, nombre_completo, proyectos } = req.body; try { const d = { user, nombre_completo, proyectos_permitidos: proyectos }; if(pass && pass.trim()) d.pass = pass; await Usuario.findByIdAndUpdate(req.params.id, d); res.json({ success: true }); } catch (e) { res.status(500).json({ error: "Error" }); } });
app.delete('/api/usuarios/:id', async (req, res) => { try { await Usuario.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: "Error" }); }});

// CATEGORIAS
app.post('/api/categorias', async (req, res) => { try { await Categoria.create(req.body); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); } });
app.delete('/api/categorias/:id', async (req, res) => { try { await Categoria.findByIdAndDelete(req.params.id); res.json({ok:true}); } catch(e){ res.status(500).json({error:"err"}); } });

// TRASPASOS & MOVIMIENTOS
app.post('/api/traspaso', async (req, res) => {
    const { origen_id, destino_id, monto, descripcion, usuario_actual, activo_id } = req.body;
    if(!origen_id || !destino_id || !monto) return res.status(400).json({ error: "Faltan datos" });
    const session = await mongoose.startSession(); session.startTransaction();
    try {
        const m = Math.abs(parseFloat(monto));
        await Movimiento.create([{ descripcion: `➡️ TRASPASO A: ${descripcion||'Otra'}`, monto: -m, cuenta_id: origen_id, activo_id: activo_id||null, tipo: 'traspaso_salida', categoria: 'Traspaso', creado_por: usuario_actual }], { session });
        await Cuenta.findByIdAndUpdate(origen_id, { $inc: { saldo: -m } }, { session });
        await Movimiento.create([{ descripcion: `⬅️ RECIBIDO DE: ${descripcion||'Otra'}`, monto: m, cuenta_id: destino_id, activo_id: activo_id||null, tipo: 'traspaso_entrada', categoria: 'Traspaso', creado_por: usuario_actual }], { session });
        await Cuenta.findByIdAndUpdate(destino_id, { $inc: { saldo: m } }, { session });
        await session.commitTransaction(); res.json({ success: true });
    } catch (e) { await session.abortTransaction(); res.status(500).json({ error: "Error traspaso" }); } finally { session.endSession(); }
});

app.post('/api/movimiento', async (req, res) => {
    const { descripcion, monto, cuenta_id, activo_id, tipo, estado, categoria, usuario_actual } = req.body;
    let m = Math.abs(monto); if (tipo === 'gasto') m = -m;
    const session = await mongoose.startSession(); session.startTransaction();
    try {
        await Movimiento.create([{ descripcion, monto: m, cuenta_id, activo_id, tipo, categoria: categoria || 'General', estado: estado || 'finalizado', creado_por: usuario_actual }], { session });
        await Cuenta.findByIdAndUpdate(cuenta_id, { $inc: { saldo: m } }, { session });
        if (activo_id) await Activo.findByIdAndUpdate(activo_id, { $inc: { balance_total: m } }, { session });
        await session.commitTransaction(); res.json({ success: true });
    } catch (e) { await session.abortTransaction(); res.status(500).json({ error: "Error" }); } finally { session.endSession(); }
});

app.post('/api/arqueo', async (req, res) => { try { await Arqueo.create(req.body); res.json({ success: true }); } catch(e) { res.status(500).json({ error: "Error" }); } });

// --- BACKUP & RESTORE (NUEVO) ---
app.get('/api/backup', async (req, res) => {
    try {
        // Verifica admin
        const u = await Usuario.findOne({ user: req.query.user });
        if(!u || !u.es_admin) return res.status(403).json({error:"Solo admin"});
        
        const backup = {
            usuarios: await Usuario.find(),
            cuentas: await Cuenta.find(),
            activos: await Activo.find(),
            movimientos: await Movimiento.find(),
            categorias: await Categoria.find(),
            arqueos: await Arqueo.find(),
            timestamp: new Date()
        };
        res.json(backup);
    } catch(e) { res.status(500).json({error:"Error generando backup"}); }
});

app.post('/api/restore', async (req, res) => {
    const { data, user } = req.body;
    try {
        const u = await Usuario.findOne({ user });
        if(!u || !u.es_admin) return res.status(403).json({error:"Solo admin"});
        
        // BORRADO TOTAL (PELIGROSO PERO NECESARIO PARA RESTAURAR LIMPIO)
        await Usuario.deleteMany({});
        await Cuenta.deleteMany({});
        await Activo.deleteMany({});
        await Movimiento.deleteMany({});
        await Categoria.deleteMany({});
        await Arqueo.deleteMany({});

        // INSERCIÓN
        if(data.usuarios) await Usuario.insertMany(data.usuarios);
        if(data.cuentas) await Cuenta.insertMany(data.cuentas);
        if(data.activos) await Activo.insertMany(data.activos);
        if(data.movimientos) await Movimiento.insertMany(data.movimientos);
        if(data.categorias) await Categoria.insertMany(data.categorias);
        if(data.arqueos) await Arqueo.insertMany(data.arqueos);

        res.json({ success: true });
    } catch(e) { console.error(e); res.status(500).json({error:"Error en restauración. La base de datos podría estar corrupta."}); }
});

// REPORTES CON CATEGORIAS
app.post('/api/reporte', async (req, res) => {
    const { mes, anio, activo_id, user } = req.body;
    const u = await Usuario.findOne({ user });
    if (!u) return res.status(403).json({ error: "No auto" });
    
    let filtro = {};
    if (mes !== 'todos') {
        const start = new Date(anio, parseInt(mes), 1); const end = new Date(anio, parseInt(mes) + 1, 0, 23, 59, 59);
        filtro.fecha = { $gte: start, $lte: end };
    } else {
        const start = new Date(anio, 0, 1); const end = new Date(anio, 11, 31, 23, 59, 59);
        filtro.fecha = { $gte: start, $lte: end };
    }
    
    if (u.es_admin) { if (activo_id !== 'todos') filtro.activo_id = activo_id; } 
    else { if (activo_id !== 'todos') { if (u.proyectos_permitidos.includes(activo_id)) filtro.activo_id = activo_id; else return res.status(403).json({}); } else filtro.activo_id = { $in: u.proyectos_permitidos }; }

    try {
        const movs = await Movimiento.find(filtro).sort({ fecha: 1 }).populate('activo_id', 'nombre').populate('cuenta_id', 'nombre');
        
        let ingresos=0, gastos=0;
        let catGastos = {}; // Acumulador por categoría

        movs.forEach(m => {
            if(m.tipo==='ingreso' || m.estado==='reembolsado') ingresos += Math.abs(m.monto);
            if(m.tipo==='gasto' && m.estado!=='reembolsado') {
                const monto = Math.abs(m.monto);
                gastos += monto;
                // Sumar a categoria
                const cat = m.categoria || 'Sin Categoría';
                catGastos[cat] = (catGastos[cat] || 0) + monto;
            }
        });
        
        res.json({ ingresos, gastos, neto: ingresos-gastos, detalles: movs, por_categoria: catGastos });
    } catch (e) { res.status(500).json({ error: "Err" }); }
});

app.post('/api/confirmar-reembolso', async (req, res) => {
    const { mov_id, usuario_actual } = req.body;
    const mOrig = await Movimiento.findById(mov_id);
    const session = await mongoose.startSession(); session.startTransaction();
    try {
        mOrig.estado = 'reembolsado'; await mOrig.save({ session });
        const m = Math.abs(mOrig.monto); 
        await Movimiento.create([{ descripcion: "✅ REEMBOLSO: "+mOrig.descripcion, monto: m, cuenta_id: mOrig.cuenta_id, activo_id: mOrig.activo_id, tipo: 'ingreso', categoria: 'Reembolso', estado: 'finalizado', creado_por: usuario_actual }], { session });
        await Cuenta.findByIdAndUpdate(mOrig.cuenta_id, { $inc: { saldo: m } }, { session });
        await Activo.findByIdAndUpdate(mOrig.activo_id, { $inc: { balance_total: m } }, { session });
        await session.commitTransaction(); res.json({ success: true });
    } catch (e) { await session.abortTransaction(); res.status(500).json({}); } finally { session.endSession(); }
});

app.listen(PORT, () => console.log(`ERP v12.0 ULTIMATE en ${PORT}`));
