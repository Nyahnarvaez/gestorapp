const mysql = require("mysql");
const perfil = "SELECT * FROM perfil";


let conexion = mysql.createConnection({
    host:"localhost",
    database: "gestorapp",
    user: "Nyahgest",
    password: "ZaraBalu2025$%"
});



conexion.connect(function(err){ 
    if(err){
        throw err;
    }else{
        console.log("funciona")
    }
});

 // Insertar datos en MySQL, usando la contraseña hasheada
 let registrar = "INSERT INTO usuario (cdi_perfil, nombre, correo, contrasenia) VALUES ('" + cedula + "', '" + name + "', '" + correo + "', '" + hashedPassword + "')";
