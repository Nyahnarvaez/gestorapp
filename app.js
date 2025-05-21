// app.js

require('dotenv').config(); // ¡Importante! Carga las variables de entorno al inicio

const mysql = require("mysql");
const express = require("express");
const bcrypt = require('bcrypt');
const session = require('express-session');
const app = express();
const path = require('path');
// Railway asigna un puerto dinámico a tu app a través de la variable de entorno PORT.
// Usamos 3000 como fallback para desarrollo local.
const port = process.env.PORT || 3000;

// --- Middleware para Logging Básico ---
// Útil para ver qué solicitudes recibe tu servidor en los logs de Railway.
app.use(function(req, res, next) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- Configuración de Express ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public")); 
app.use(express.json()); // Para parsear cuerpos de solicitud con formato JSON
app.use(express.urlencoded({ extended: false })); // Para parsear cuerpos de solicitud con URL-encoded data (formularios)

// --- Configuración de express-session ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'un_secreto_muy_seguro_y_largo_por_defecto',
    resave: false, // Evita guardar la sesión si no ha cambiado
    saveUninitialized: true, // Guarda sesiones nuevas que aún no han sido modificadas
    cookie: {
        // 'secure: true' asegura que la cookie solo se envíe sobre HTTPS.
        // En producción (Railway), NODE_ENV será 'production', así que será true.
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true, // La cookie no es accesible a través de JavaScript del lado del cliente
        maxAge: 3600000 // Duración de la sesión en milisegundos (1 hora)
    }
}));

// --- MIDDLEWARE PARA CONTROL DE CACHÉ Y VERIFICACIÓN DE SESIÓN ---
app.use(function(req, res, next) {
    // Cabeceras HTTP para instruir al navegador a no almacenar la página en caché,
    // se muestre una versión en caché de una página que ya no debería ser accesible.
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');

    // Define las rutas que requieren que el usuario esté autenticado (logueado).
    const protectedPaths = [
        '/index',
        '/api/almacen',
        '/api/contabilidad',
        '/api/contabilidad/saldo',
        '/api/contabilidad/nueva',
        '/api/almacen/nuevo',
        '/api/almacen/', // Asegúrate de incluir la base de la ruta de la API si accedes sin ID
        '/api/contabilidad/' // Lo mismo para contabilidad
    ];

    // Verifica si la ruta actual que el usuario intenta acceder es una de las rutas protegidas.
    const isProtected = protectedPaths.some(path => req.path.startsWith(path));

    // Si la ruta es protegida y el usuario NO está logueado, redirige al login.
    if (isProtected && !req.session.loggedIn) {
        console.log(`Acceso denegado a ${req.path}. Redirigiendo a login.`);
        // Redirige a la página de login y pasa un flag para mostrar el formulario de login.
        return res.redirect('/?showLogin=true');
    }
    next(); // Continúa con la siguiente función middleware o ruta si no hay problemas.
});

// --- Configuración de la Conexión a la Base de Datos MySQL ---
// ¡Importante! En Railway, estas variables de entorno serán inyectadas automáticamente
let conexion = mysql.createConnection({
    host: process.env.MYSQLHOST || 'localhost',
    database: process.env.MYSQLDATABASE || 'gestorapp',
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || '',
    port: process.env.MYSQLPORT || 3306,
    // --- AÑADE ESTA LÍNEA PARA RECONEXIÓN AUTOMÁTICA ---
    reconnect: true 
});

// Intentar conectar a la base de datos
conexion.connect(function (err) {
    if (err) {
        console.error('Error al conectar a la base de datos:', err.stack);
        // Si hay un error fatal aquí, podrías querer terminar el proceso para que Render lo reinicie.
        // process.exit(1); 
    } else {
        console.log("Conexión a la base de datos MySQL exitosa!");
    }
});

// --- Rutas de Autenticación y Páginas Principales ---

app.get("/", function (req, res) {
    res.render("register", { showLogin: req.query.showLogin === 'true' });
});

// Ruta para la página principal (index). Requiere sesión iniciada.
app.get("/index", function (req, res) {
    if (req.session.loggedIn) {
        res.render("index", { username: req.session.username || 'Usuario' });
    } else {
        res.redirect("/?showLogin=true");
    }
});

app.post("/validar", function (req, res) {
    console.log("Datos de registro recibidos:", req.body);

    const datos = req.body;
    const { user, email, pass, c_pass } = datos;


    if (!user || !email || !pass || !c_pass) {
        return res.status(400).send("Todos los campos son requeridos.");
    }
    if (pass !== c_pass) {
        return res.status(400).send("Las contraseñas no coinciden.");
    }
    if (!email.includes('@')) {
        return res.status(400).send("Por favor, introduce un correo electrónico válido.");
    }
    if (pass.length < 6) {
        return res.status(400).send("La contraseña debe tener al menos 6 caracteres.");
    }

    // --- Encriptar Contraseña con bcrypt ---
    bcrypt.hash(pass, 10, function (err, hashedPassword) {
        if (err) {
            console.error("Error al crear contraseña hash:", err);
            return res.status(500).send("Error interno al procesar la contraseña.");
        }

        // --- Insertar Nuevo Usuario en la Tabla 'usuario' ---
        let registrar = `INSERT INTO usuario (nombre, correo, contrasenia) VALUES (?, ?, ?)`;
        conexion.query(registrar, [user, email, hashedPassword], function (error, results) {
            if (error) {
                console.error("Error al insertar datos del usuario:", error);
                if (error.code === 'ER_DUP_ENTRY') {
                    // Si el correo ya existe (violación de UNIQUE constraint)
                    return res.status(409).send("El correo electrónico ya existe.");
                }
                // Manejo de otros errores de conexión/query
                if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                    console.error("Conexión a la base de datos perdida. Intentando reconectar...");
                    // Aquí podrías intentar reestablecer la conexión o devolver un error amigable.
                    // Con 'reconnect: true', esto debería ser manejado por el driver.
                    return res.status(500).send("Error temporal de conexión. Por favor, inténtalo de nuevo.");
                }
                return res.status(500).send("Error al registrar el usuario.");
            } else {
                console.log("Usuario registrado correctamente, ID:", results.insertId);

                const nuevoUsuarioId = results.insertId;
                const nombreTablaAlmacen = `almacen_${nuevoUsuarioId}`;
                const crearTablaAlmacen = `
                    CREATE TABLE ${nombreTablaAlmacen} (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        codigo_producto VARCHAR(50),
                        nombre VARCHAR(255) NOT NULL,
                        cantidad INT NOT NULL DEFAULT 0,
                        precio DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX (codigo_producto),
                        INDEX (fecha)
                    )
                `;

                conexion.query(crearTablaAlmacen, function (errorCrearTabla) {
                    if (errorCrearTabla) {
                        console.error(`Error al crear la tabla de almacén '${nombreTablaAlmacen}':`, errorCrearTabla);
                        return res.status(500).send("Error al crear la tabla de almacén del usuario.");
                    } else {
                        console.log(`Tabla de almacén '${nombreTablaAlmacen}' creada para el usuario ${nuevoUsuarioId}`);
                        const nombreTablaContabilidad = `contabilidad_${nuevoUsuarioId}`;
                        const crearTablaContabilidad = `
                            CREATE TABLE ${nombreTablaContabilidad} (
                                id INT AUTO_INCREMENT PRIMARY KEY,
                                fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                                descripcion VARCHAR(255) NOT NULL,
                                tipo ENUM('ingreso', 'egreso') NOT NULL,
                                monto DECIMAL(10, 2) NOT NULL,
                                metodo_pago VARCHAR(50),
                                nota TEXT
                            )
                        `;

                        conexion.query(crearTablaContabilidad, function (errorCrearContabilidad) {
                            if (errorCrearContabilidad) {
                                console.error(`Error al crear la tabla de contabilidad '${nombreTablaContabilidad}':`, errorCrearContabilidad);
                                return res.status(500).send("Error al crear la tabla de contabilidad del usuario.");
                            } else {
                                console.log(`Tabla de contabilidad '${nombreTablaContabilidad}' creada para el usuario ${nuevoUsuarioId}`);

                                const nombreTablaFondos = `fondos_${nuevoUsuarioId}`;
                                const crearTablaFondos = `
                                    CREATE TABLE ${nombreTablaFondos} (
                                        id INT AUTO_INCREMENT PRIMARY KEY,
                                        saldo_actual DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                                        ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
                                    )
                                `;

                                conexion.query(crearTablaFondos, function (errorCrearFondos) {
                                    if (errorCrearFondos) {
                                        console.error(`Error al crear la tabla de fondos '${nombreTablaFondos}':`, errorCrearFondos);
                                        return res.status(500).send("Error al crear la tabla de fondos del usuario.");
                                    } else {
                                        // Insertar el saldo inicial (0.00) en la tabla de fondos
                                        const insertarSaldoInicial = `INSERT INTO ${nombreTablaFondos} (saldo_actual) VALUES (0.00)`;
                                        conexion.query(insertarSaldoInicial, function (errorInsertarSaldo) {
                                            if (errorInsertarSaldo) {
                                                console.error(`Error al insertar el saldo inicial en '${nombreTablaFondos}':`, errorInsertarSaldo);
                                                return res.status(500).send("Error al inicializar el saldo del usuario.");
                                            } else {
                                                console.log(`Tabla de fondos '${nombreTablaFondos}' creada para el usuario ${nuevoUsuarioId} con saldo inicial 0.`);
                                                // Establece la sesión una vez que todas las tablas han sido creadas exitosamente
                                                req.session.loggedIn = true;
                                                req.session.userId = nuevoUsuarioId;
                                                req.session.username = user; // Guarda el nombre de usuario en la sesión
                                                return res.redirect("/index");
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    });
});

// Ruta para manejar el inicio de sesión.
app.post("/login", function (req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send("Por favor, introduce correo y contraseña.");
    }

    // Consulta para buscar el usuario por correo electrónico.
    const consulta = `SELECT id, nombre, contrasenia FROM usuario WHERE correo = ?`;
    conexion.query(consulta, [email], function (error, results) {
        if (error) {
            console.error("Error al buscar usuario para inicio de sesión:", error);
            // Manejo de errores de conexión
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                console.error("Conexión a la base de datos perdida. Intentando reconectar...");
                return res.status(500).send("Error temporal de conexión. Por favor, inténtalo de nuevo.");
            }
            return res.status(500).send("Error al iniciar sesión.");
        }

        console.log("Resultados de la consulta de inicio de sesión:", results);

        if (results.length === 0) {
            // Usuario no encontrado
            return res.status(401).send("Credenciales incorrectas.");
        }

        const usuario = results[0];

        // Comparar la contraseña ingresada con el hash almacenado.
        bcrypt.compare(password, usuario.contrasenia, function (err, esValido) {
            if (err) {
                console.error("Error al comparar contraseñas:", err);
                return res.status(500).send("Error al iniciar sesión.");
            }

            console.log("¿Contraseña válida?", esValido);

            if (esValido) {
                // Autenticación exitosa: Establece la sesión del usuario.
                req.session.loggedIn = true;
                req.session.userId = usuario.id;
                req.session.username = usuario.nombre; // Guarda el nombre de usuario en la sesión
                return res.redirect("/index");
            } else {
                // Contraseña incorrecta
                return res.status(401).send("Credenciales incorrectas.");
            }
        });
    });
});

// Ruta para cerrar sesión.
app.get("/logout", function (req, res) {
    req.session.destroy(function (err) {
        if (err) {
            console.error("Error al destruir la sesión:", err);
            return res.status(500).send("Error al cerrar sesión.");
        }
        console.log("Sesión cerrada.");
        res.redirect("/?showLogin=true"); // Redirige a la página de login
    });
});

// --- Rutas de API para Gestión de Almacén ---
app.get("/api/almacen", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const consultaAlmacen = `SELECT id, codigo_producto, nombre, cantidad, precio, DATE_FORMAT(fecha, '%Y-%m-%d %H:%i:%s') as fecha FROM ${nombreTablaAlmacen} ORDER BY fecha DESC`;

    conexion.query(consultaAlmacen, function (error, resultados) {
        if (error) {
            console.error("Error al obtener datos del almacén:", error);
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al obtener los datos del almacén." });
        }
        res.json(resultados);
    });
});

// Añadir un nuevo producto al almacén del usuario logueado.
app.post("/api/almacen/nuevo", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const { codigo_producto, nombre, cantidad, precio, fecha } = req.body;

    // Validar datos de entrada
    if (!nombre || cantidad === undefined || precio === undefined) {
        return res.status(400).json({ error: "Nombre, cantidad y precio son requeridos." });
    }
    if (isNaN(parseFloat(cantidad)) || isNaN(parseFloat(precio))) {
        return res.status(400).json({ error: "Cantidad y precio deben ser números válidos." });
    }

    const nuevoProducto = {
        codigo_producto: codigo_producto || null, // Permite que sea nulo si no se proporciona
        nombre: nombre,
        cantidad: cantidad,
        precio: precio,
        fecha: fecha || new Date() // Usa la fecha proporcionada o la actual
    };

    const consultaInsertar = `INSERT INTO ${nombreTablaAlmacen} SET ?`;

    conexion.query(consultaInsertar, nuevoProducto, function (error, resultado) {
        if (error) {
            console.error("Error al insertar nuevo producto:", error);
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al guardar el nuevo producto." });
        }
        console.log("Nuevo producto insertado con ID:", resultado.insertId);
        res.status(201).json({ message: "Producto añadido correctamente.", id: resultado.insertId });
    });
});

// Obtener los datos de un producto específico por ID.
app.get("/api/almacen/:id", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const productoId = req.params.id;

    const consultaProducto = `SELECT id, codigo_producto, nombre, cantidad, precio, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha FROM ${nombreTablaAlmacen} WHERE id = ?`;

    conexion.query(consultaProducto, [productoId], function (error, resultado) {
        if (error) {
            console.error("Error al obtener el producto:", error);
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al obtener el producto." });
        }

        if (resultado.length > 0) {
            res.json(resultado[0]);
        } else {
            res.status(404).json({ message: "Producto no encontrado." });
        }
    });
});

// Actualizar un producto existente.
app.put("/api/almacen/:id", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const productoId = req.params.id;
    const { codigo_producto, nombre, cantidad, precio, fecha } = req.body;

    // Validar datos de entrada
    if (!nombre || cantidad === undefined || precio === undefined) {
        return res.status(400).json({ error: "Nombre, cantidad y precio son requeridos." });
    }
    if (isNaN(parseFloat(cantidad)) || isNaN(parseFloat(precio))) {
        return res.status(400).json({ error: "Cantidad y precio deben ser números válidos." });
    }

    const consultaActualizar = `
        UPDATE ${nombreTablaAlmacen}
        SET codigo_producto = ?, nombre = ?, cantidad = ?, precio = ?, fecha = ?
        WHERE id = ?
    `;

    conexion.query(consultaActualizar, [codigo_producto || null, nombre, cantidad, precio, fecha || new Date(), productoId], function (error, resultado) {
        if (error) {
            console.error("Error al actualizar el producto:", error);
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al actualizar el producto." });
        }

        if (resultado.affectedRows > 0) {
            console.log(`Producto con ID ${productoId} actualizado correctamente.`);
            res.json({ message: "Producto actualizado correctamente." });
        } else {
            res.status(404).json({ message: "Producto no encontrado." });
        }
    });
});

// Eliminar un producto del almacén del usuario logueado.
app.delete("/api/almacen/:id", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const productoId = req.params.id;

    const consultaEliminar = `DELETE FROM ${nombreTablaAlmacen} WHERE id = ?`;

    conexion.query(consultaEliminar, [productoId], function (error, resultado) {
        if (error) {
            console.error("Error al eliminar el producto:", error);
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al eliminar el producto." });
        }

        if (resultado.affectedRows > 0) {
            console.log(`Producto con ID ${productoId} eliminado correctamente.`);
            res.json({ message: "Producto eliminado correctamente." });
        } else {
            res.status(404).json({ message: "Producto no encontrado." });
        }
    });
});

// --- Rutas de API para Gestión de Contabilidad ---

// Obtener el saldo actual del usuario logueado.
app.get("/api/contabilidad/saldo", function (req, res) {
    console.log("--- Petición a /api/contabilidad/saldo ---");
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaFondos = `fondos_${userId}`;
    const consultaSaldo = `SELECT saldo_actual AS saldo FROM ${nombreTablaFondos}`;

    conexion.query(consultaSaldo, function (error, resultado) {
        if (error) {
            console.error("Error al obtener el saldo:", error);
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al obtener el saldo." });
        }
        res.json({ saldo: resultado[0]?.saldo || 0 }); // Retorna 0 si no hay saldo o es nulo
    });
});

// Obtener todas las transacciones de contabilidad del usuario logueado.
app.get("/api/contabilidad", function (req, res) {
    console.log("--- Petición a /api/contabilidad ---");
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaContabilidad = `contabilidad_${userId}`;
    const consultaContabilidad = `SELECT id, fecha, descripcion, tipo, monto, metodo_pago, nota FROM ${nombreTablaContabilidad} ORDER BY fecha DESC`;

    conexion.query(consultaContabilidad, function (error, resultados) {
        if (error) {
            console.error("Error al obtener datos de contabilidad:", error);
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al obtener los datos de contabilidad." });
        }
        res.json(resultados);
    });
});

// Agregar una nueva transacción de contabilidad.
app.post("/api/contabilidad/nueva", function (req, res) {
    console.log("--- Petición a /api/contabilidad/nueva ---");
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaContabilidad = `contabilidad_${userId}`;
    const nombreTablaFondos = `fondos_${userId}`;
    const { tipo, descripcion, monto, metodo_pago, nota } = req.body;

    // Validación de datos de entrada
    if (!tipo || (tipo !== 'ingreso' && tipo !== 'egreso') || !descripcion || monto === undefined || isNaN(parseFloat(monto))) {
        return res.status(400).json({ error: "Tipo (ingreso/egreso), descripción y monto numérico son requeridos." });
    }

    const montoNumerico = parseFloat(monto);
    // Para egresos, almacenamos el monto como negativo en la tabla de contabilidad
    const montoParaDB = (tipo === 'egreso' && montoNumerico > 0) ? -montoNumerico : montoNumerico;

    const nuevaTransaccion = {
        tipo: tipo,
        descripcion: descripcion,
        monto: montoParaDB, // Guarda el monto con el signo correcto
        metodo_pago: metodo_pago || null,
        nota: nota || null
    };

    conexion.query(`INSERT INTO ${nombreTablaContabilidad} SET ?`, nuevaTransaccion, function (error, resultado) {
        if (error) {
            console.error("Error al guardar la transacción:", error);
            if (error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al guardar la transacción." });
        }

        const transaccionId = resultado.insertId;
        console.log("Nueva transacción insertada con ID:", transaccionId);

        // Actualizar el saldo en la tabla de fondos (siempre suma el monto tal como se recibió del usuario para el cálculo)
        const consultaActualizarSaldo = `UPDATE ${nombreTablaFondos} SET saldo_actual = saldo_actual ${tipo === 'ingreso' ? '+' : '-'} ?`;

        conexion.query(consultaActualizarSaldo, [montoNumerico], function (errorSaldo) {
            if (errorSaldo) {
                console.error("Error al actualizar el saldo:", errorSaldo);
                // Si el saldo no se actualiza, la base de datos podría estar inconsistente.
                // Es importante monitorear estos errores.
                return res.status(500).json({ error: "Error al actualizar el saldo después de la transacción." });
            }
            console.log("Saldo actualizado correctamente.");
            res.status(201).json({ message: "Transacción añadida correctamente.", id: transaccionId });
        });
    });
});

// Eliminar una transacción de contabilidad.
app.delete("/api/contabilidad/:id", function (req, res) {
    console.log("--- Petición a /api/contabilidad/:id (DELETE) ---");
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaContabilidad = `contabilidad_${userId}`;
    const nombreTablaFondos = `fondos_${userId}`;
    const transaccionId = req.params.id;

    // Primero, obtener el tipo y monto de la transacción a eliminar para revertir el saldo.
    conexion.query(`SELECT tipo, monto FROM ${nombreTablaContabilidad} WHERE id = ?`, [transaccionId], function (errorConsulta, resultadoConsulta) {
        if (errorConsulta) {
            console.error("Error al obtener la transacción para eliminar:", errorConsulta);
            if (errorConsulta.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
            }
            return res.status(500).json({ error: "Error al obtener la transacción." });
        }

        if (resultadoConsulta.length === 0) {
            return res.status(404).json({ message: "Transacción no encontrada." });
        }

        const transaccion = resultadoConsulta[0];
        // Determina la operación inversa para el saldo (si era ingreso, restas; si era egreso, sumas el valor absoluto)
        const operacionReversa = transaccion.tipo === 'ingreso' ? '-' : '+';
        // Usa el valor absoluto del monto para el cálculo de reversa en el saldo.
        const montoReversa = Math.abs(parseFloat(transaccion.monto));

        // Ahora, eliminar la transacción de la tabla de contabilidad.
        conexion.query(`DELETE FROM ${nombreTablaContabilidad} WHERE id = ?`, [transaccionId], function (errorEliminar) {
            if (errorEliminar) {
                console.error("Error al eliminar la transacción:", errorEliminar);
                if (errorEliminar.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
                    return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
                }
                return res.status(500).json({ error: "Error al eliminar la transacción." });
            }

            // Actualizar el saldo en la tabla de fondos después de la eliminación.
            const consultaActualizarSaldo = `UPDATE ${nombreTablaFondos} SET saldo_actual = saldo_actual ${operacionReversa} ?`;

            conexion.query(consultaActualizarSaldo, [montoReversa], function (errorSaldo) {
                if (errorSaldo) {
                    console.error("Error al actualizar el saldo después de eliminar:", errorSaldo);
                    return res.status(500).json({ error: "Error al actualizar el saldo." });
                }
                console.log("Transacción eliminada y saldo actualizado correctamente.");
                res.json({ message: "Transacción eliminada correctamente." });
            });
        });
    });
});

// --- Inicio del Servidor ---
app.listen(port, function () {
    console.log(`Servidor Express escuchando en el puerto ${port}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`Puedes acceder a tu aplicación localmente en http://localhost:${port}`);
    }
});