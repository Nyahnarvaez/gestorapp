// app.js

require('dotenv').config();

const mysql = require("mysql2");
const express = require("express");
const bcrypt = require('bcrypt');
const session = require('express-session');
const app = express();
const path = require('path');
const port = process.env.PORT || 3000;

// --- Middleware para Logging Básico ---
app.use(function(req, res, next) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- Configuración de Express ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public")); 
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Configuración de express-session ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'un_secreto_muy_seguro_y_largo_por_defecto',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 3600000
    }
}));

// --- MIDDLEWARE PARA CONTROL DE CACHÉ Y VERIFICACIÓN DE SESIÓN ---
app.use(function(req, res, next) {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');

    const protectedPaths = [
        '/index',
        '/api/almacen',
        '/api/contabilidad',
        '/api/contabilidad/saldo',
        '/api/contabilidad/nueva',
        '/api/almacen/nuevo',
        '/api/almacen/',
        '/api/contabilidad/'
    ];

    const isProtected = protectedPaths.some(path => req.path.startsWith(path));

    if (isProtected && !req.session.loggedIn) {
        console.log(`Acceso denegado a ${req.path}. Redirigiendo a login.`);
        return res.redirect('/?showLogin=true');
    }
    next();
});

// --- Configuración del Pool de Conexiones a la Base de Datos MySQL ---
const dbPool = mysql.createPool({
    host: process.env.MYSQLHOST || 'localhost',
    database: process.env.MYSQLDATABASE || 'gestorapp',
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || '',
    port: process.env.MYSQLPORT || 3306,
    connectionLimit: 10
});

dbPool.getConnection(function(err, connection) {
    if (err) {
        console.error('Error al obtener conexión del pool:', err.stack);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            console.error('La conexión a la base de datos se perdió.');
        } else if (err.code === 'ER_CON_COUNT_ERROR') {
            console.error('Demasiadas conexiones activas en el pool.');
        } else if (err.code === 'ECONNREFUSED') {
            console.error('La conexión a la base de datos fue rechazada.');
        }
    } else {
        console.log("Pool de conexiones a la base de datos MySQL iniciado exitosamente!");
        connection.release();
    }
});

// --- Rutas de Autenticación y Páginas Principales ---
app.get("/", function (req, res) {
    res.render("register", { showLogin: req.query.showLogin === 'true' });
});

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

    bcrypt.hash(pass, 10, function (err, hashedPassword) {
        if (err) {
            console.error("Error al crear contraseña hash:", err);
            return res.status(500).send("Error interno al procesar la contraseña.");
        }

        dbPool.getConnection(function(err, connection) {
            if (err) {
                console.error("Error al obtener conexión del pool para registro:", err);
                return res.status(500).send("Error temporal de conexión a la base de datos. Por favor, inténtalo de nuevo.");
            }

            let registrar = `INSERT INTO usuario (nombre, correo, contrasenia) VALUES (?, ?, ?)`;
            connection.query(registrar, [user, email, hashedPassword], function (error, results) {
                if (error) {
                    connection.release();
                    console.error("Error al insertar datos del usuario:", error);
                    if (error.code === 'ER_DUP_ENTRY') {
                        return res.status(409).send("El correo electrónico ya existe.");
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

                    connection.query(crearTablaAlmacen, function (errorCrearTabla) {
                        if (errorCrearTabla) {
                            connection.release();
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

                            connection.query(crearTablaContabilidad, function (errorCrearContabilidad) {
                                if (errorCrearContabilidad) {
                                    connection.release();
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

                                    connection.query(crearTablaFondos, function (errorCrearFondos) {
                                        if (errorCrearFondos) {
                                            connection.release();
                                            console.error(`Error al crear la tabla de fondos '${nombreTablaFondos}':`, errorCrearFondos);
                                            return res.status(500).send("Error al crear la tabla de fondos del usuario.");
                                        } else {
                                            const insertarSaldoInicial = `INSERT INTO ${nombreTablaFondos} (saldo_actual) VALUES (0.00)`;
                                            connection.query(insertarSaldoInicial, function (errorInsertarSaldo) {
                                                connection.release();
                                                if (errorInsertarSaldo) {
                                                    console.error(`Error al insertar el saldo inicial en '${nombreTablaFondos}':`, errorInsertarSaldo);
                                                    return res.status(500).send("Error al inicializar el saldo del usuario.");
                                                } else {
                                                    console.log(`Tabla de fondos '${nombreTablaFondos}' creada para el usuario ${nuevoUsuarioId} con saldo inicial 0.`);
                                                    req.session.loggedIn = true;
                                                    req.session.userId = nuevoUsuarioId;
                                                    req.session.username = user;
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
});

app.post("/login", function (req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send("Por favor, introduce correo y contraseña.");
    }

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para login:", err);
            return res.status(500).send("Error temporal de conexión a la base de datos. Por favor, inténtalo de nuevo.");
        }

        const consulta = `SELECT id, nombre, contrasenia FROM usuario WHERE correo = ?`;
        connection.query(consulta, [email], function (error, results) {
            connection.release();
            if (error) {
                console.error("Error al buscar usuario para inicio de sesión:", error);
                return res.status(500).send("Error al iniciar sesión.");
            }

            console.log("Resultados de la consulta de inicio de sesión:", results);

            if (results.length === 0) {
                return res.status(401).send("Credenciales incorrectas.");
            }

            const usuario = results[0];

            bcrypt.compare(password, usuario.contrasenia, function (err, esValido) {
                if (err) {
                    console.error("Error al comparar contraseñas:", err);
                    return res.status(500).send("Error al iniciar sesión.");
                }

                console.log("¿Contraseña válida?", esValido);

                if (esValido) {
                    req.session.loggedIn = true;
                    req.session.userId = usuario.id;
                    req.session.username = usuario.nombre;
                    return res.redirect("/index");
                } else {
                    return res.status(401).send("Credenciales incorrectas.");
                }
            });
        });
    });
});

app.get("/logout", function (req, res) {
    req.session.destroy(function (err) {
        if (err) {
            console.error("Error al destruir la sesión:", err);
            return res.status(500).send("Error al cerrar sesión.");
        }
        console.log("Sesión cerrada.");
        res.redirect("/?showLogin=true");
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

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para almacén:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(consultaAlmacen, function (error, resultados) {
            connection.release();
            if (error) {
                console.error("Error al obtener datos del almacén:", error);
                return res.status(500).json({ error: "Error al obtener los datos del almacén." });
            }
            res.json(resultados);
        });
    });
});

app.post("/api/almacen/nuevo", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const { codigo_producto, nombre, cantidad, precio, fecha } = req.body;

    if (!nombre || cantidad === undefined || precio === undefined) {
        return res.status(400).json({ error: "Nombre, cantidad y precio son requeridos." });
    }
    if (isNaN(parseFloat(cantidad)) || isNaN(parseFloat(precio))) {
        return res.status(400).json({ error: "Cantidad y precio deben ser números válidos." });
    }

    const nuevoProducto = {
        codigo_producto: codigo_producto || null,
        nombre: nombre,
        cantidad: cantidad,
        precio: precio,
        fecha: fecha || new Date()
    };

    const consultaInsertar = `INSERT INTO ${nombreTablaAlmacen} SET ?`;

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para nuevo producto:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(consultaInsertar, nuevoProducto, function (error, resultado) {
            connection.release();
            if (error) {
                console.error("Error al insertar nuevo producto:", error);
                return res.status(500).json({ error: "Error al guardar el nuevo producto." });
            }
            console.log("Nuevo producto insertado con ID:", resultado.insertId);
            res.status(201).json({ message: "Producto añadido correctamente.", id: resultado.insertId });
        });
    });
});

app.get("/api/almacen/:id", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const productoId = req.params.id;

    const consultaProducto = `SELECT id, codigo_producto, nombre, cantidad, precio, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha FROM ${nombreTablaAlmacen} WHERE id = ?`;

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para producto por ID:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(consultaProducto, [productoId], function (error, resultado) {
            connection.release();
            if (error) {
                console.error("Error al obtener el producto:", error);
                return res.status(500).json({ error: "Error al obtener el producto." });
            }

            if (resultado.length > 0) {
                res.json(resultado[0]);
            } else {
                res.status(404).json({ message: "Producto no encontrado." });
            }
        });
    });
});

app.put("/api/almacen/:id", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const productoId = req.params.id;
    const { codigo_producto, nombre, cantidad, precio, fecha } = req.body;

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

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para actualizar producto:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(consultaActualizar, [codigo_producto || null, nombre, cantidad, precio, fecha || new Date(), productoId], function (error, resultado) {
            connection.release();
            if (error) {
                console.error("Error al actualizar el producto:", error);
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
});

app.delete("/api/almacen/:id", function (req, res) {
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaAlmacen = `almacen_${userId}`;
    const productoId = req.params.id;

    const consultaEliminar = `DELETE FROM ${nombreTablaAlmacen} WHERE id = ?`;

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para eliminar producto:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(consultaEliminar, [productoId], function (error, resultado) {
            connection.release();
            if (error) {
                console.error("Error al eliminar el producto:", error);
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
});

// --- Rutas de API para Gestión de Contabilidad ---
app.get("/api/contabilidad/saldo", function (req, res) {
    console.log("--- Petición a /api/contabilidad/saldo ---");
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaFondos = `fondos_${userId}`;
    const consultaSaldo = `SELECT saldo_actual AS saldo FROM ${nombreTablaFondos}`;

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para saldo:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(consultaSaldo, function (error, resultado) {
            connection.release();
            if (error) {
                console.error("Error al obtener el saldo:", error);
                return res.status(500).json({ error: "Error al obtener el saldo." });
            }
            res.json({ saldo: resultado[0]?.saldo || 0 });
        });
    });
});

app.get("/api/contabilidad", function (req, res) {
    console.log("--- Petición a /api/contabilidad ---");
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaContabilidad = `contabilidad_${userId}`;
    const consultaContabilidad = `SELECT id, fecha, descripcion, tipo, monto, metodo_pago, nota FROM ${nombreTablaContabilidad} ORDER BY fecha DESC`;

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para contabilidad:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(consultaContabilidad, function (error, resultados) {
            connection.release();
            if (error) {
                console.error("Error al obtener datos de contabilidad:", error);
                return res.status(500).json({ error: "Error al obtener los datos de contabilidad." });
            }
            res.json(resultados);
        });
    });
});

app.post("/api/contabilidad/nueva", function (req, res) {
    console.log("--- Petición a /api/contabilidad/nueva ---");
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaContabilidad = `contabilidad_${userId}`;
    const nombreTablaFondos = `fondos_${userId}`;
    const { tipo, descripcion, monto, metodo_pago, nota } = req.body;

    if (!tipo || (tipo !== 'ingreso' && tipo !== 'egreso') || !descripcion || monto === undefined || isNaN(parseFloat(monto))) {
        return res.status(400).json({ error: "Tipo (ingreso/egreso), descripción y monto numérico son requeridos." });
    }

    const montoNumerico = parseFloat(monto);
    const montoParaDB = (tipo === 'egreso' && montoNumerico > 0) ? -montoNumerico : montoNumerico;

    const nuevaTransaccion = {
        tipo: tipo,
        descripcion: descripcion,
        monto: montoParaDB,
        metodo_pago: metodo_pago || null,
        nota: nota || null
    };

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para nueva transacción:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(`INSERT INTO ${nombreTablaContabilidad} SET ?`, nuevaTransaccion, function (error, resultado) {
            if (error) {
                connection.release();
                console.error("Error al guardar la transacción:", error);
                return res.status(500).json({ error: "Error al guardar la transacción." });
            }

            const transaccionId = resultado.insertId;
            console.log("Nueva transacción insertada con ID:", transaccionId);

            const consultaActualizarSaldo = `UPDATE ${nombreTablaFondos} SET saldo_actual = saldo_actual ${tipo === 'ingreso' ? '+' : '-'} ?`;

            connection.query(consultaActualizarSaldo, [montoNumerico], function (errorSaldo) {
                connection.release();
                if (errorSaldo) {
                    console.error("Error al actualizar el saldo:", errorSaldo);
                    return res.status(500).json({ error: "Error al actualizar el saldo después de la transacción." });
                }
                console.log("Saldo actualizado correctamente.");
                res.status(201).json({ message: "Transacción añadida correctamente.", id: transaccionId });
            });
        });
    });
});

app.delete("/api/contabilidad/:id", function (req, res) {
    console.log("--- Petición a /api/contabilidad/:id (DELETE) ---");
    if (!req.session.loggedIn || !req.session.userId) {
        return res.status(401).json({ error: "Usuario no autenticado." });
    }
    const userId = req.session.userId;
    const nombreTablaContabilidad = `contabilidad_${userId}`;
    const nombreTablaFondos = `fondos_${userId}`;
    const transaccionId = req.params.id;

    dbPool.getConnection(function(err, connection) {
        if (err) {
            console.error("Error al obtener conexión del pool para eliminar transacción:", err);
            return res.status(500).json({ error: "Error temporal de conexión. Por favor, inténtalo de nuevo." });
        }

        connection.query(`SELECT tipo, monto FROM ${nombreTablaContabilidad} WHERE id = ?`, [transaccionId], function (errorConsulta, resultadoConsulta) {
            if (errorConsulta) {
                connection.release();
                console.error("Error al obtener la transacción para eliminar:", errorConsulta);
                return res.status(500).json({ error: "Error al obtener la transacción." });
            }

            if (resultadoConsulta.length === 0) {
                connection.release();
                return res.status(404).json({ message: "Transacción no encontrada." });
            }

            const transaccion = resultadoConsulta[0];
            const operacionReversa = transaccion.tipo === 'ingreso' ? '-' : '+';
            const montoReversa = Math.abs(parseFloat(transaccion.monto));

            connection.query(`DELETE FROM ${nombreTablaContabilidad} WHERE id = ?`, [transaccionId], function (errorEliminar) {
                if (errorEliminar) {
                    connection.release();
                    console.error("Error al eliminar la transacción:", errorEliminar);
                    return res.status(500).json({ error: "Error al eliminar la transacción." });
                }

                const consultaActualizarSaldo = `UPDATE ${nombreTablaFondos} SET saldo_actual = saldo_actual ${operacionReversa} ?`;

                connection.query(consultaActualizarSaldo, [montoReversa], function (errorSaldo) {
                    connection.release();
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
});

// --- Inicio del Servidor ---
app.listen(port, function () {
    console.log(`Servidor Express escuchando en el puerto ${port}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`Puedes acceder a tu aplicación localmente en http://localhost:${port}`);
    }
});