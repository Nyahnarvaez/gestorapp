document.addEventListener('DOMContentLoaded', () => {
    // Manejo del Almacén de Productos
    const productos = JSON.parse(localStorage.getItem('productos')) || [];
    const listaProductosBody = document.getElementById('lista-productos-body');
    const modalNuevoProducto = document.getElementById('modal-nuevo-producto');
    const formNuevoProducto = document.getElementById('form-nuevo-producto');
    const abrirModalProductoBtn = document.getElementById('abrirModalProducto');
    const cerrarModalProductoBtn = modalNuevoProducto.querySelector('.close-button');

    // NUEVOS ELEMENTOS PARA EL PROVEEDOR
    const modalEditarProveedor = document.getElementById('modal-editar-proveedor');
    const cerrarModalProveedorBtn = document.getElementById('cerrar-modal-proveedor');
    const formEditarProveedor = document.getElementById('form-editar-proveedor');
    const inputProveedorEditar = document.getElementById('input-proveedor');
    const editarProveedorIdProducto = document.getElementById('editar-proveedor-id-producto');

    // Función para guardar productos en localStorage
    const guardarProductos = () => {
        localStorage.setItem('productos', JSON.stringify(productos));
        renderizarProductos(); // Volver a renderizar la tabla
    };

    // Función para renderizar los productos en la tabla
    const renderizarProductos = () => {
        listaProductosBody.innerHTML = ''; // Limpiar la tabla
        productos.forEach(producto => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${producto.id}</td>
                <td>${producto.nombre}</td>
                <td>${producto.cantidad}</td>
                <td>$${producto.precio.toFixed(2)}</td>
                <td>${producto.fechaVencimiento || 'N/A'}</td>
                <td>
                    <span id="proveedor-display-${producto.id}">${producto.proveedor || 'No asignado'}</span>
                    <button class="boton-accion editar-proveedor" data-id="${producto.id}"><i class="fas fa-industry"></i> Proveedor</button>
                </td>
                <td>
                    <button class="boton-accion editar-producto" data-id="${producto.id}"><i class="fas fa-edit"></i> Editar</button>
                    <button class="boton-accion eliminar-producto" data-id="${producto.id}"><i class="fas fa-trash-alt"></i> Eliminar</button>
                </td>
            `;
            listaProductosBody.appendChild(row);
        });

        // Añadir event listeners a los botones de acción después de renderizar
        // (Asumo que tienes alguna lógica para editar/eliminar producto, la dejo comentada si no existe)
        document.querySelectorAll('.editar-producto').forEach(button => {
            button.addEventListener('click', (e) => {
                const id = parseInt(e.currentTarget.dataset.id);
                // Aquí iría tu lógica para editar los detalles del producto
                console.log('Editar producto con ID:', id);
            });
        });

        document.querySelectorAll('.eliminar-producto').forEach(button => {
            button.addEventListener('click', (e) => {
                const id = parseInt(e.currentTarget.dataset.id);
                eliminarProducto(id);
            });
        });

        // NUEVO: Event listener para el botón "Proveedor"
        document.querySelectorAll('.editar-proveedor').forEach(button => {
            button.addEventListener('click', (e) => {
                const id = parseInt(e.currentTarget.dataset.id);
                const producto = productos.find(p => p.id === id);
                if (producto) {
                    editarProveedorIdProducto.value = id; // Guarda el ID del producto
                    inputProveedorEditar.value = producto.proveedor || ''; // Carga el proveedor actual
                    modalEditarProveedor.style.display = 'flex'; // Muestra el modal
                }
            });
        });
    };

    // Función para añadir un nuevo producto
    formNuevoProducto.addEventListener('submit', (e) => {
        e.preventDefault();
        const nuevoProducto = {
            id: productos.length > 0 ? Math.max(...productos.map(p => p.id)) + 1 : 1,
            nombre: document.getElementById('nombre-producto').value,
            cantidad: parseInt(document.getElementById('cantidad-producto').value),
            precio: parseFloat(document.getElementById('precio-producto').value),
            fechaVencimiento: document.getElementById('vencimiento-producto').value,
            proveedor: document.getElementById('proveedor-producto').value.trim() // Captura el proveedor
        };
        productos.push(nuevoProducto);
        guardarProductos();
        formNuevoProducto.reset(); // Limpiar el formulario
        modalNuevoProducto.style.display = 'none'; // Ocultar el modal
    });

    // Función para eliminar un producto
    const eliminarProducto = (id) => {
        const index = productos.findIndex(p => p.id === id);
        if (index !== -1) {
            if (confirm(`¿Estás seguro de que quieres eliminar el producto "${productos[index].nombre}"?`)) {
                productos.splice(index, 1);
                guardarProductos();
            }
        }
    };

    // NUEVO: Manejar el formulario para editar proveedor
    formEditarProveedor.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = parseInt(editarProveedorIdProducto.value);
        const nuevoProveedor = inputProveedorEditar.value.trim();

        const productoIndex = productos.findIndex(p => p.id === id);
        if (productoIndex !== -1) {
            productos[productoIndex].proveedor = nuevoProveedor;
            guardarProductos();
            modalEditarProveedor.style.display = 'none'; // Ocultar el modal
        }
    });

    // Abrir/Cerrar Modales de Almacén
    abrirModalProductoBtn.addEventListener('click', () => {
        modalNuevoProducto.style.display = 'flex';
    });

    cerrarModalProductoBtn.addEventListener('click', () => {
        modalNuevoProducto.style.display = 'none';
        formNuevoProducto.reset(); // Limpiar formulario al cerrar
    });

    cerrarModalProveedorBtn.addEventListener('click', () => {
        modalEditarProveedor.style.display = 'none';
    });

    // Cerrar modales de almacén si se hace clic fuera del contenido
    window.addEventListener('click', (e) => {
        if (e.target === modalNuevoProducto) {
            modalNuevoProducto.style.display = 'none';
            formNuevoProducto.reset();
        }
        if (e.target === modalEditarProveedor) {
            modalEditarProveedor.style.display = 'none';
        }
    });

    // Renderizar productos al cargar la página
    renderizarProductos();
});