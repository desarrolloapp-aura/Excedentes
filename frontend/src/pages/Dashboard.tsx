import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.ts'
import { useCart } from '../contexts/CartContext.tsx'
import { useNotification } from '../contexts/NotificationContext.tsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Definimos la interfaz basada en lo que esperamos del backend (excedentes.py)
interface Product {
    litm: string
    dsci: string
    lotn: string
    secu: string
    un: string
    primary_uom: string
    pqoh: number
    pending_stock?: number
}

// Interfaz para mostrar Boletas
interface BoletaDisplay {
    purchase_id: string
    boleta_number: string
    created_at: string
    total_items: number
    items: any[]
}

export default function Dashboard() {
    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const PAGE_SIZE = 50
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [qtyInput, setQtyInput] = useState('')
    const [view, setView] = useState<'catalog' | 'boletas' | 'cart'>('catalog')
    const [boletas, setBoletas] = useState<BoletaDisplay[]>([])

    const { cart, addToCart, removeFromCart, clearCart } = useCart()
    const { showNotification } = useNotification()

    useEffect(() => {
        if (products.length > 0) {
            reconcilePendingStock()
        }
    }, [products])

    useEffect(() => {
        fetchProductsAndReconcile()
    }, [page])

    useEffect(() => {
        if (view === 'boletas') {
            fetchBoletas()
        }
    }, [view])

    const handleSearch = () => {
        setPage(1)
        fetchProductsAndReconcile()
    }

    const fetchProductsAndReconcile = async () => {
        try {
            setLoading(true)
            const { data: { session } } = await supabase.auth.getSession()

            if (!session) return

            let url = `http://127.0.0.1:8000/excedentes/existencias?page=${page}&page_size=${PAGE_SIZE}`
            if (searchTerm) {
                url += `&search=${encodeURIComponent(searchTerm)}`
            }

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${session.access_token}`
                }
            })

            if (!response.ok) throw new Error('Error al cargar productos')

            const data = await response.json()
            const jdeProducts: Product[] = data.items || []
            setTotalPages(Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE)))

            const { data: pendingItems, error } = await supabase
                .from('purchase_items')
                .select('*')
                .eq('procesada', false)

            if (error) {
                console.error("Error fetching pending items", error)
                setProducts(jdeProducts)
                return
            }

            const pendingMap: { [key: string]: number } = {}
            const itemsToProcess: number[] = []

            pendingItems.forEach((pItem) => {
                const litm = pItem.item_code
                const initialStock = pItem.stock_jde_inicial || 0

                const currentProduct = jdeProducts.find(p => p.litm === litm)

                if (currentProduct) {
                    if (currentProduct.pqoh > initialStock) {
                        itemsToProcess.push(pItem.id)
                    } else {
                        pendingMap[litm] = (pendingMap[litm] || 0) + pItem.qty_a_comprar
                    }
                }
            })

            if (itemsToProcess.length > 0) {
                await supabase
                    .from('purchase_items')
                    .update({ procesada: true })
                    .in('id', itemsToProcess)
            }

            const productsWithPending = jdeProducts.map(p => ({
                ...p,
                pending_stock: pendingMap[p.litm] || 0
            }))

            setProducts(productsWithPending)

        } catch (error) {
            console.error(error)
            showNotification('error', 'Error', 'No se pudieron cargar los productos')
        } finally {
            setLoading(false)
        }
    }

    const reconcilePendingStock = () => { }

    const fetchBoletas = async () => {
        try {
            const { data, error } = await supabase
                .from('purchases')
                .select('*')
                .order('created_at', { ascending: false })

            if (error) throw error

            setBoletas(data || [])
        } catch (error) {
            console.error(error)
            showNotification('error', 'Error', 'No se pudieron cargar las boletas')
        }
    }

    const openQuantityModal = (product: Product) => {
        // Check if item is already in cart
        const alreadyInCart = cart.some(item => item.litm === product.litm)

        if (alreadyInCart) {
            showNotification('warning', 'Producto ya en el carro', 'Este producto ya fue agregado. Elimínalo del carro si deseas modificar la cantidad.')
            // Optional: Redirect to cart to show them
            return
        }

        setQtyInput('')
        setSelectedProduct(product)
        setIsModalOpen(true)
    }

    const closeQuantityModal = () => {
        setIsModalOpen(false)
        setSelectedProduct(null)
        setQtyInput('')
    }

    const handleConfirmAddToCart = () => {
        if (!selectedProduct) return

        const targetQty = parseInt(qtyInput)
        const pending = selectedProduct.pending_stock || 0
        const currentStock = selectedProduct.pqoh



        if (!targetQty || targetQty <= 0) {
            showNotification('info', 'Cantidad requerida', 'Por favor ingresa un valor válido mayor a 0.')
            return
        }



        // BLOQUEO ESTRICTO
        if (pending > 0) {
            showNotification('error', 'Compra Pendiente', `Tienes una compra de ${pending} unidades pendiente. Espera a que llegue el stock.`)
            closeQuantityModal()
            return
        }

        if (targetQty <= currentStock) {
            showNotification('warning', 'Stock suficiente', `Ya tienes ${currentStock} en stock. No es necesario comprar.`)
            closeQuantityModal()
            return
        }

        const buyQty = targetQty - currentStock

        const isFirstItem = cart.length === 0

        addToCart({
            id: `${selectedProduct.litm}-${selectedProduct.lotn}`,
            litm: selectedProduct.litm,
            dsci: selectedProduct.dsci,
            primary_uom: selectedProduct.primary_uom,
            cantidad: buyQty,
            currentStock: currentStock,
            targetQuantity: targetQty
        })

        showNotification('success', 'Agregado', `Se agregarán ${buyQty} unidades al carro.`)
        closeQuantityModal()

        if (isFirstItem) {
            setView('cart')
        }
    }

    const handlePurchase = async () => {
        if (cart.length === 0) {
            showNotification('warning', 'Carro vacío', 'Agrega productos antes de comprar')
            return
        }

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user || !user.email) {
                showNotification('error', 'Error', 'Usuario no identificado')
                return
            }

            // ITERAMOS SOBRE CADA ITEM PARA GENERAR UNA BOLETA INDIVIDUAL
            for (const item of cart) {
                // Generamos un ID único para cada boleta (añadimos random para que no colisionen muy rápido en el mismo milisegundo)
                const boletaNumber = `${Date.now()}-${Math.floor(Math.random() * 1000)}`

                // 1. Insertar Cabecera (Purchases) - 1 Boleta por Item
                const { data: purchaseData, error: purchaseError } = await supabase
                    .from('purchases')
                    .insert([{
                        boleta_number: boletaNumber,
                        requested_by_email: user.email,
                        requested_by_name: user.email,
                        total_items: 1, // Siempre 1 item por boleta en este nuevo modelo
                        total_value: 0
                    }])
                    .select()
                    .single()

                if (purchaseError) throw purchaseError

                const purchaseId = purchaseData.purchase_id

                // 2. Insertar Item (Purchase Items)
                const itemToInsert = {
                    purchase_id: purchaseId,
                    item_code: item.litm,
                    item_id: parseInt(item.litm) || 0,
                    centro: item.primary_uom,
                    qty_solicitada: item.targetQuantity,
                    qty_disponible: item.currentStock,
                    qty_a_comprar: item.cantidad,
                    stock_jde_inicial: item.currentStock,
                    procesada: false,
                    line_total: 0
                }

                const { error: itemsError } = await supabase
                    .from('purchase_items')
                    .insert([itemToInsert])

                if (itemsError) throw itemsError

                // 3. Generar PDF Individual
                // Pasamos el item en un array porque la función espera array, pero tendrá length 1
                generatePDF([item], boletaNumber, purchaseData.created_at)
            }

            clearCart()
            showNotification('success', 'Compra realizada', `Se han generado ${cart.length} boletas exitosamente.`)

            fetchProductsAndReconcile()
            setView('boletas') // O 'catalog' según prefiera

        } catch (error: any) {
            console.error('Error al comprar:', error)
            showNotification('error', 'Error en la compra', error.message || 'Ocurrió un error inesperado al procesar uno de los items.')
        }
    }

    const generatePDF = (items: any[], boletaId: string, dateStr: string) => {
        if (items.length === 0) return

        // Custom Compact Format: 210mm wide x 105mm high (Half an A4 Landscape)
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: [210, 105]
        })

        // -- Header --
        doc.setFillColor(63, 81, 181) // Indigo Primary
        doc.rect(0, 0, 210, 30, 'F')

        doc.setTextColor(255, 255, 255)
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.text('SOLICITUD DE PEDIDO', 14, 12)

        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.text('Sistema de Compras JDE', 14, 18)
        doc.text(`Fecha: ${new Date(dateStr).toLocaleString()}`, 14, 23)

        // -- Info Box --
        doc.setFontSize(9)
        doc.text(`N° Documento: ${boletaId}`, 196, 12, { align: 'right' })

        // -- Table --
        const tableData = items.map(item => [
            { content: item.litm || item.item_code, styles: { fontStyle: 'bold' } },
            item.dsci || '---',
            { content: item.cantidad || item.qty_a_comprar, styles: { halign: 'center', textColor: [63, 81, 181], fontStyle: 'bold' } },
            { content: item.primary_uom || item.centro, styles: { halign: 'center' } }
        ])

        autoTable(doc, {
            startY: 35,
            head: [['SKU', 'Descripción', 'Cantidad', 'U. Medida']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: [243, 244, 246],
                textColor: [31, 41, 55],
                fontStyle: 'bold',
                lineWidth: 0.1,
                lineColor: [209, 213, 219],
                halign: 'left'
            },
            styles: {
                fontSize: 9,
                cellPadding: 3,
                lineColor: [229, 231, 235],
                lineWidth: 0.1,
                overflow: 'linebreak',
                valign: 'middle'
            },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 35 },
                2: { halign: 'center', cellWidth: 25 },
                3: { halign: 'center', cellWidth: 25 }
            },
            margin: { top: 35, right: 14, bottom: 15, left: 14 },
            tableWidth: 'auto'
        })

        // -- Footer --
        const pageHeight = doc.internal.pageSize.height
        doc.setDrawColor(200, 200, 200)
        doc.line(14, pageHeight - 15, 196, pageHeight - 15)

        doc.setFontSize(7)
        doc.setTextColor(128, 128, 128)
        doc.text('Este documento es un comprobante interno de solicitud.', 105, pageHeight - 10, { align: 'center' })
        doc.text('El stock se actualizará una vez procesado en JDE.', 105, pageHeight - 6, { align: 'center' })

        doc.save(`boleta-${boletaId}.pdf`)
    }

    const handleDownloadHistoryPDF = async (purchase: BoletaDisplay) => {
        const { data: items, error } = await supabase
            .from('purchase_items')
            .select('*')
            .eq('purchase_id', purchase.purchase_id)

        if (error || !items) {
            showNotification('error', 'Error', 'No se pudieron cargar los items de la boleta')
            return
        }

        // Fetch descriptions from backend to enrich the PDF
        const enrichedItems = await Promise.all(items.map(async (i) => {
            let description = '---'
            try {
                const { data: { session } } = await supabase.auth.getSession()
                if (session) {
                    // We try to fetch the item details to get the description
                    const response = await fetch(`http://127.0.0.1:8000/excedentes/existencias?search=${i.item_code}`, {
                        headers: { 'Authorization': `Bearer ${session.access_token}` }
                    })
                    if (response.ok) {
                        const data = await response.json()
                        if (data.items && data.items.length > 0) {
                            // Find exact match
                            const match = data.items.find((p: any) => String(p.litm) === String(i.item_code))
                            if (match) description = match.dsci
                        }
                    }
                }
            } catch (e) {
                console.error("Could not fetch details for item", i.item_code)
            }

            return {
                litm: i.item_code,
                dsci: description,
                cantidad: i.qty_a_comprar,
                primary_uom: i.centro
            }
        }))

        generatePDF(enrichedItems, purchase.boleta_number, purchase.created_at)
    }

    const handleLogout = async () => {
        await supabase.auth.signOut()
    }

    return (
        <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
            {/* Modal de Cantidad */}
            {isModalOpen && selectedProduct && (
                <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                    <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={closeQuantityModal}></div>
                        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                                <div className="sm:flex sm:items-start">
                                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 sm:mx-0 sm:h-10 sm:w-10">
                                        <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                                        </svg>
                                    </div>
                                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                                        <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                                            Agregar al Carro
                                        </h3>
                                        <div className="mt-2">
                                            <p className="text-sm text-gray-500 mb-4">
                                                Producto: <span className="font-bold">{selectedProduct.dsci}</span> <br />
                                                Stock actual JDE: <span className="font-bold text-gray-800">{selectedProduct.pqoh}</span>
                                            </p>
                                            <label htmlFor="qty" className="block text-sm font-medium text-gray-700">
                                                ¿Cuál es la cantidad total que necesitas?
                                            </label>
                                            <div className="mt-1">
                                                <input
                                                    type="number"
                                                    name="qty"
                                                    id="qty"
                                                    min="1"
                                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border"
                                                    placeholder="Ej: 100"
                                                    value={qtyInput}
                                                    onChange={(e) => setQtyInput(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleConfirmAddToCart()}
                                                    autoFocus
                                                />
                                            </div>
                                            <p className="mt-2 text-xs text-indigo-500">
                                                El sistema calculará automáticamente cuánto comprar basándose en tu stock actual.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                                <button
                                    type="button"
                                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                                    onClick={handleConfirmAddToCart}
                                >
                                    Agregar
                                </button>
                                <button
                                    type="button"
                                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                    onClick={closeQuantityModal}
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Navbar Moderno */}
            <nav className="bg-white shadow sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        <div className="flex items-center">
                            <span
                                onClick={() => setView('catalog')}
                                className="text-2xl font-extrabold text-indigo-600 tracking-tight cursor-pointer hover:opacity-80 transition-opacity"
                            >
                                JDE Compras
                            </span>
                        </div>
                        <div className="flex items-center space-x-6">
                            <button
                                onClick={() => setView('boletas')}
                                className={`text-sm font-medium transition-colors ${view === 'boletas' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                Mis Boletas
                            </button>
                            <button
                                onClick={() => setView('catalog')}
                                className={`text-sm font-medium transition-colors ${view === 'catalog' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                Catálogo
                            </button>

                            <button
                                onClick={() => setView('cart')}
                                className="relative p-2 text-gray-400 hover:text-indigo-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                </svg>
                                {cart.length > 0 && (
                                    <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white transform translate-x-1/4 -translate-y-1/4 bg-red-500 rounded-full">
                                        {cart.length}
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={handleLogout}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-full text-sm font-medium transition-all"
                            >
                                Salir
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto py-8 sm:px-6 lg:px-8">
                {view === 'catalog' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h2 className="text-xl font-bold text-gray-800">Catálogo de Excedentes</h2>
                            <div className="flex space-x-3">
                                <input
                                    type="text"
                                    placeholder="Buscar SKU o nombre..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-64 rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-4 py-2"
                                />
                                <button
                                    onClick={handleSearch}
                                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700 font-medium text-sm transition-colors"
                                >
                                    Buscar
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Descripción</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">U. Neg</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stock JDE</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                                        <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-100">
                                    {loading ? (
                                        <tr><td colSpan={6} className="px-6 py-4 text-center text-gray-500">Cargando productos...</td></tr>
                                    ) : products.map((product) => {
                                        const uniqueId = `${product.litm}-${product.lotn}`
                                        const isPending = product.pending_stock && product.pending_stock > 0
                                        return (
                                            <tr key={uniqueId} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{product.litm}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.dsci}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.primary_uom}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-bold">{product.pqoh}</td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {isPending ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                                            Pendiente (+{product.pending_stock})
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                            Disponible
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                    <button
                                                        onClick={() => openQuantityModal(product)}
                                                        disabled={!!isPending}
                                                        className={`px-4 py-2 rounded-md font-medium text-white transition-all shadow-sm ${isPending
                                                            ? 'bg-gray-300 cursor-not-allowed'
                                                            : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'}`}
                                                    >
                                                        Agregar
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="bg-gray-50 px-6 py-3 flex items-center justify-between border-t border-gray-200">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-gray-600 hover:text-gray-900 disabled:opacity-50">Anterior</button>
                            <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-gray-600 hover:text-gray-900 disabled:opacity-50">Siguiente</button>
                        </div>
                    </div>
                )}

                {view === 'boletas' && (
                    <div className="max-w-5xl mx-auto">
                        <h2 className="text-2xl font-bold text-gray-800 mb-6">Mis Compras Realizadas</h2>
                        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                            {boletas.map(b => (
                                <div key={b.purchase_id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Boleta</p>
                                            <h3 className="text-lg font-bold text-gray-900">#{b.boleta_number}</h3>
                                        </div>
                                        <div className="bg-green-50 rounded-full p-2">
                                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                        </div>
                                    </div>
                                    <p className="text-sm text-gray-500 mb-4">{new Date(b.created_at).toLocaleString()}</p>
                                    <button
                                        onClick={() => handleDownloadHistoryPDF(b)}
                                        className="w-full flex justify-center items-center px-4 py-2 border border-indigo-100 text-sm font-medium rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                                    >
                                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                        Descargar PDF
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {view === 'cart' && (
                    <div className="max-w-4xl mx-auto">
                        <div className="flex items-center justify-between mb-8">
                            <h2 className="text-3xl font-bold text-gray-900">Tu Carro</h2>
                            <button onClick={() => setView('catalog')} className="text-indigo-600 hover:text-indigo-800 font-medium">Continuar Comprando &rarr;</button>
                        </div>

                        {cart.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                                <div className="mx-auto h-24 w-24 text-gray-200 mb-4">
                                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                                </div>
                                <h3 className="text-lg font-medium text-gray-900">Tu carro está vacío</h3>
                                <p className="mt-2 text-gray-500">¿No sabes qué buscar? ¡Tenemos miles de productos!</p>
                                <button onClick={() => setView('catalog')} className="mt-6 inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700">
                                    Ir al Catálogo
                                </button>
                            </div>
                        ) : (
                            <div className="lg:grid lg:grid-cols-12 lg:gap-x-12 lg:items-start">
                                <section className="lg:col-span-7">
                                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                                        <ul className="divide-y divide-gray-200">
                                            {cart.map((item) => (
                                                <li key={item.id} className="p-6 flex sm:flex-row flex-col">
                                                    <div className="flex-shrink-0 w-24 h-24 rounded-md overflow-hidden bg-gray-100 flex items-center justify-center border border-gray-200">
                                                        <span className="text-xl font-bold text-gray-400">
                                                            {item.dsci ? item.dsci.substring(0, 2).toUpperCase() : 'IT'}
                                                        </span>
                                                    </div>

                                                    <div className="ml-0 sm:ml-6 flex-1 flex flex-col mt-4 sm:mt-0">
                                                        <div className="flex justify-between">
                                                            <h3 className="text-lg font-medium text-gray-900 border-b-2 border-transparent hover:border-gray-300 transition-colors inline-block cursor-default">
                                                                {item.dsci}
                                                            </h3>
                                                        </div>
                                                        <p className="mt-1 text-sm text-gray-500">{item.litm}</p>
                                                        <p className="mt-1 text-sm text-gray-500 bg-gray-100 inline-block px-2 rounded-sm w-max mb-4">
                                                            UOM: {item.primary_uom}
                                                        </p>

                                                        <div className="flex justify-between items-center mt-auto">
                                                            <button
                                                                type="button"
                                                                onClick={() => removeFromCart(item.id)}
                                                                className="text-sm font-medium text-red-600 hover:text-red-500 underline"
                                                            >
                                                                Eliminar
                                                            </button>

                                                            <div className="flex items-center border border-gray-300 rounded-md">
                                                                <span className="px-3 py-1 text-gray-600 font-medium bg-gray-50 border-r border-gray-300">Cant</span>
                                                                <span className="px-3 py-1 text-gray-900 font-bold">{item.cantidad}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </section>

                                {/* Sidebar de Resumen */}
                                <section className="lg:col-span-5 mt-16 lg:mt-0">
                                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sticky top-24">
                                        <h2 className="text-lg font-medium text-gray-900 mb-6">Resumen de solicitud</h2>

                                        <dl className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <dt className="text-sm text-gray-600">Items distintos</dt>
                                                <dd className="text-sm font-medium text-gray-900">{cart.length}</dd>
                                            </div>
                                            <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                                                <dt className="text-base font-medium text-gray-900">Total Unidades</dt>
                                                <dd className="text-base font-bold text-gray-900">{cart.reduce((acc, item) => acc + item.cantidad, 0)}</dd>
                                            </div>
                                        </dl>

                                        <div className="mt-6">
                                            <button
                                                onClick={handlePurchase}
                                                className="w-full bg-gray-900 border border-transparent rounded-full shadow-sm py-3 px-4 text-base font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 transition-colors"
                                            >
                                                Proceder a confirmar
                                            </button>
                                        </div>

                                        <div className="mt-6 text-xs text-center text-gray-500">
                                            <p className="flex justify-center items-center gap-2 mb-2">
                                                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                                Generación automática de boletas
                                            </p>
                                            <p>Se generará un documento PDF independiente por cada ítem listado.</p>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    )
}
