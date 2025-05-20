// --- contabilidad.js ---

document.addEventListener('DOMContentLoaded', function() {
    const saldoBancoElement = document.querySelector('#contabilidad .saldo-banco .monto');
    const tablaTransaccionesBody = document.querySelector('#contabilidad .listado-transacciones tbody');
    const formNuevaTransaccion = document.getElementById('form-nueva-transaccion');

    // Función para formatear la fecha y hora
    function formatDate(dateString) {
        const date = new Date(dateString);
        // Ajustar a la zona horaria de Caracas (UTC-4) para evitar problemas de fecha con el navegador
        // Dependerá de cómo tu servidor esté manejando y guardando las fechas.
        // Si tu servidor ya las guarda en UTC-4 o UTC y las quieres mostrar como UTC-4:
        const options = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'America/Caracas' // O la zona horaria que uses
        };
        try {
            return new Intl.DateTimeFormat('es-VE', options).format(date);
        } catch (e) {
            console.warn("Error al formatear fecha con Intl.DateTimeFormat, usando formato de respaldo:", e);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}`;
        }
    }

    // Función para cargar el saldo actual
    function cargarSaldo() {
        fetch('/api/contabilidad/saldo')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 404) {
                        throw new Error('Saldo no encontrado.');
                    } else {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                }
                return response.json();
            })
            .then(data => {
                saldoBancoElement.textContent = parseFloat(data.saldo).toFixed(2);
            })
            .catch(error => {
                console.error('Error al cargar el saldo:', error);
                saldoBancoElement.textContent = 'Error al cargar';
                if (error.message === 'Saldo no encontrado.') {
                    saldoBancoElement.textContent = 'Saldo no disponible.'; // Mensaje específico para 404
                }
            });
    }

    // Función para cargar la lista de transacciones
    function cargarTransacciones() {
        fetch('/api/contabilidad')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 404) {
                        throw new Error('Transacciones no encontradas.');
                    } else {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                }
                return response.json();
            })
            .then(data => {
                tablaTransaccionesBody.innerHTML = ''; // Limpiar la tabla

                if (data.length === 0) {
                    // Ahora el colspan es 8 para coincidir con las 8 columnas del nuevo encabezado
                    tablaTransaccionesBody.innerHTML = '<tr><td colspan="8">No hay transacciones registradas.</td></tr>';
                    return;
                }

                data.forEach(transaccion => {
                    const row = tablaTransaccionesBody.insertRow();

                    // Columna: ID
                    const idCell = row.insertCell();
                    idCell.textContent = transaccion.id || '-'; // Asegúrate de que tu API devuelva el ID de la transacción

                    // Columna: Fecha
                    const fechaCell = row.insertCell();
                    fechaCell.textContent = formatDate(transaccion.fecha);

                    // Columna: Descripción
                    const descripcionCell = row.insertCell();
                    descripcionCell.textContent = transaccion.descripcion;

                    // Columna: Método de Pago (Nueva columna)
                    const metodoPagoCell = row.insertCell();
                    metodoPagoCell.textContent = transaccion.metodo_pago || '-';

                    // Columna: Nota (Nueva columna)
                    const notaCell = row.insertCell();
                    notaCell.textContent = transaccion.nota || '-';

                    // Columna: Egreso (Condicional)
                    const egresoCell = row.insertCell();
                    if (transaccion.tipo === 'egreso') {
                        egresoCell.textContent = parseFloat(transaccion.monto).toFixed(2) + ' $';
                        egresoCell.classList.add('egreso-monto');
                    } else {
                        egresoCell.textContent = ''; // Vacío si es ingreso
                    }

                    // Columna: Ingreso (Condicional)
                    const ingresoCell = row.insertCell();
                    if (transaccion.tipo === 'ingreso') {
                        ingresoCell.textContent = parseFloat(transaccion.monto).toFixed(2) + ' $';
                        ingresoCell.classList.add('ingreso-monto');
                    } else {
                        ingresoCell.textContent = ''; // Vacío si es egreso
                    }

                    // Columna: Acciones (Nueva columna)
                    const accionesCell = row.insertCell();
                    const botonEliminar = document.createElement('button');
                    botonEliminar.textContent = 'Eliminar';
                    botonEliminar.classList.add('boton-accion', 'eliminar-transaccion'); // Asegúrate de tener estilos para .boton-accion
                    botonEliminar.dataset.id = transaccion.id;
                    botonEliminar.addEventListener('click', function() {
                        eliminarTransaccion(transaccion.id);
                    });
                    accionesCell.appendChild(botonEliminar);
                });
            })
            .catch(error => {
                console.error('Error al cargar las transacciones:', error);
                tablaTransaccionesBody.innerHTML = '<tr><td colspan="8">Error al cargar las transacciones.</td></tr>';
                if (error.message === 'Transacciones no encontradas.') {
                    tablaTransaccionesBody.innerHTML = '<tr><td colspan="8">No se encontraron transacciones.</td></tr>';
                }
            });
    }

    // Evento para el formulario de nueva transacción
    formNuevaTransaccion.addEventListener('submit', function(event) {
        event.preventDefault();

        const tipo = document.getElementById('tipo-transaccion').value;
        const descripcion = document.getElementById('descripcion-transaccion').value;
        const monto = parseFloat(document.getElementById('monto-transaccion').value);
        const metodo_pago = document.getElementById('metodo-pago-transaccion').value;
        const nota = document.getElementById('nota-transaccion').value;
        const fecha_raw = document.getElementById('fecha-transaccion').value; // Obtener la fecha en formato YYYY-MM-DD
        
        // Si no se proporciona fecha, el backend podría usar la fecha actual
        const fecha = fecha_raw ? new Date(fecha_raw).toISOString() : new Date().toISOString(); 
        // Convertir a ISO string para enviar al backend (ej: "2025-05-20T00:00:00.000Z")

        if (isNaN(monto)) {
            alert('Por favor, ingrese un monto válido.');
            return;
        }

        const nuevaTransaccion = {
            tipo: tipo,
            descripcion: descripcion,
            monto: monto,
            metodo_pago: metodo_pago,
            nota: nota,
            fecha: fecha // Enviar la fecha
        };

        fetch('/api/contabilidad/nueva', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(nuevaTransaccion)
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errData => {
                    throw new Error(`HTTP error! status: ${response.status}, message: ${errData.error || 'Error al añadir transacción'}`);
                });
            }
            return response.json();
        })
        .then(data => {
            alert(data.message);
            formNuevaTransaccion.reset();
            cargarSaldo();
            cargarTransacciones();
        })
        .catch(error => {
            console.error('Error al añadir la transacción:', error);
            alert(error.message);
        });
    });

    // Función para eliminar una transacción
    function eliminarTransaccion(id) {
        if (confirm('¿Estás seguro de que deseas eliminar esta transacción?')) {
            fetch(`/api/contabilidad/${id}`, {
                method: 'DELETE'
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(errData => {
                        throw new Error(`HTTP error! status: ${response.status}, message: ${errData.error || 'Error al eliminar transacción'}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                alert(data.message);
                cargarSaldo();
                cargarTransacciones();
            })
            .catch(error => {
                console.error('Error al eliminar la transacción:', error);
                alert(error.message);
            });
        }
    }

    // Cargar los datos iniciales al cargar la página
    cargarSaldo();
    cargarTransacciones();
});