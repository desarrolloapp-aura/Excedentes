import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.ts'
import { useCart } from '../contexts/CartContext.tsx'
import { useNotification } from '../contexts/NotificationContext.tsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Definimos la interfaz basada en lo que esperamos del backend (excedentes.py)
interface Product {
    itm: string  // Short ID (numeric)
    litm: string // Second ID (COLITM/SKU)
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
    requested_by_email: string
    total_items: number
    items: any[]
    descripcion?: string
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
    const [view, setView] = useState<'catalog' | 'requisiciones' | 'cart'>('catalog')
    const [requisiciones, setRequisiciones] = useState<BoletaDisplay[]>([])
    const [purchaseDescription, setPurchaseDescription] = useState('')

    const { cart, addToCart, removeFromCart, clearCart } = useCart()
    const { showNotification } = useNotification()

    const [searchTermInput, setSearchTermInput] = useState('')

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearchTerm(searchTermInput)
        }, 500)
        return () => clearTimeout(timer)
    }, [searchTermInput])

    useEffect(() => {
        setPage(1)
    }, [searchTerm])

    useEffect(() => {
        if (view === 'catalog') {
            fetchProductsAndReconcile()
        }
    }, [page, searchTerm, view])

    useEffect(() => {
        if (view === 'requisiciones') {
            fetchRequisiciones()
        }
    }, [view])

    const fetchProductsAndReconcile = async () => {
        try {
            setLoading(true)
            const { data: { session } } = await supabase.auth.getSession()

            if (!session) return

            let url = `http://192.168.1.245:8000/excedentes/existencias?page=${page}&page_size=${PAGE_SIZE}`
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

            console.log("--- INICIO RECONCILIACIÓN ---")
            console.log(`Buscando items pendientes... (Total JDE traídos: ${jdeProducts.length})`)

            const { data: pendingItems, error } = await supabase
                .from('purchase_items')
                .select('*')
                .eq('procesada', false)

            if (error) {
                console.error("Error al buscar items en Supabase:", error)
                setProducts(jdeProducts)
                return
            }

            const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000
            const now = new Date().getTime()
            const pendingMap: { [key: string]: number } = {}
            const itemsToProcess: number[] = []

            pendingItems.forEach((pItem) => {
                const litm = pItem.item_code
                const initialStock = pItem.stock_jde_inicial || 0
                const createdAt = pItem.created_at ? new Date(pItem.created_at).getTime() : now
                const currentProduct = jdeProducts.find(p => p.litm === litm)

                const diffMs = now - createdAt

                if (currentProduct && currentProduct.pqoh !== initialStock) {
                    itemsToProcess.push(pItem.id)
                } else if (diffMs > FIVE_DAYS_MS) {
                    itemsToProcess.push(pItem.id)
                } else {
                    pendingMap[litm] = (pendingMap[litm] || 0) + pItem.qty_a_comprar
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
            console.error('FetchProducts Error:', error)
            // Solo mostrar error si seguimos en el catálogo para evitar ruidos en otras vistas
            if (view === 'catalog') {
                showNotification('error', 'Error de Conexión', 'No se pudieron sincronizar las existencias. Verifica tu conexión a la red local.')
            }
        } finally {
            setLoading(false)
        }
    }
    const fetchRequisiciones = async () => {
        try {
            const { data, error } = await supabase
                .from('purchases')
                .select('*')
                .order('created_at', { ascending: false })

            if (error) throw error

            setRequisiciones(data || [])
        } catch (error) {
            console.error(error)
            showNotification('error', 'Error', 'No se pudieron cargar las requisiciones')
        }
    }

    const openQuantityModal = (product: Product) => {
        const alreadyInCart = cart.some(item => item.litm === product.litm)

        if (alreadyInCart) {
            showNotification('warning', 'Producto ya en la solicitud', 'Este producto ya fue agregado. Elimínalo de la solicitud si deseas modificar la cantidad.')
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

        const buyQty = parseInt(qtyInput)

        if (!buyQty || buyQty <= 0) {
            showNotification('info', 'Cantidad requerida', 'Por favor ingresa un valor válido mayor a 0.')
            return
        }

        const netAvailable = selectedProduct.pqoh - (selectedProduct.pending_stock || 0)
        const isPending = (selectedProduct.pending_stock || 0) > 0

        if (isPending) {
            showNotification('error', 'Reservado Pendiente', `Este producto tiene un monto reservado pendiente. Por favor espera a que se procese en JDE para solicitar el resto.`)
            closeQuantityModal()
            return
        }

        if (buyQty > netAvailable) {
            showNotification('error', 'Stock insuficiente', `No puedes solicitar más del stock real disponible (${netAvailable}).`)
            return
        }

        const isFirstItem = cart.length === 0

        addToCart({
            id: `${selectedProduct.litm}-${selectedProduct.lotn}`,
            itm: selectedProduct.itm,
            litm: selectedProduct.litm,
            dsci: selectedProduct.dsci,
            primary_uom: selectedProduct.primary_uom,
            cantidad: buyQty,
            qty_disponible: netAvailable,
            total_jde_stock: selectedProduct.pqoh,
            targetQuantity: buyQty
        })

        showNotification('success', 'Agregado', `Se agregaron ${buyQty} unidades a la solicitud.`)
        closeQuantityModal()

        if (isFirstItem) {
            setView('cart')
        }
    }

    const handlePurchase = async () => {
        if (cart.length === 0) {
            showNotification('warning', 'Solicitud vacía', 'Agrega productos antes de confirmar')
            return
        }

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user || !user.email) {
                showNotification('error', 'Error', 'Usuario no identificado')
                return
            }

            const boletaNumber = `${Date.now()}-${Math.floor(Math.random() * 1000)}`

            const { data: purchaseData, error: purchaseError } = await supabase
                .from('purchases')
                .insert([{
                    boleta_number: boletaNumber,
                    requested_by_email: user.email,
                    requested_by_name: user.email,
                    total_items: cart.length,
                    total_value: 0,
                    descripcion: purchaseDescription
                }])
                .select()
                .single()

            if (purchaseError) throw purchaseError

            const purchaseId = purchaseData.purchase_id

            const itemsToInsert = cart.map(item => ({
                purchase_id: purchaseId,
                item_code: item.litm,
                item_id: parseInt(item.itm) || 0,
                centro: item.primary_uom,
                qty_solicitada: item.targetQuantity,
                qty_disponible: item.qty_disponible,
                qty_a_comprar: item.cantidad,
                stock_jde_inicial: item.total_jde_stock,
                procesada: false,
                line_total: 0
            }))

            const { error: itemsError } = await supabase
                .from('purchase_items')
                .insert(itemsToInsert)

            if (itemsError) throw itemsError

            generatePDF(cart, boletaNumber, purchaseData.created_at, user.email, purchaseDescription)

            clearCart()
            setPurchaseDescription('')
            showNotification('success', 'Éxito', `Has realizado la requisición con éxito.`)

            // Recargar productos para actualizar stock JDE
            setTimeout(() => {
                fetchProductsAndReconcile()
                setView('requisiciones')
            }, 500)

        } catch (error: any) {
            console.error('Error al solicitar:', error)
            showNotification('error', 'Error en la solicitud', error.message || 'Ocurrió un error inesperado al procesar el pedido.')
        }
    }

    const generatePDF = (items: any[], boletaId: string, dateStr: string, email: string, description?: string) => {
        if (items.length === 0) return

        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: [210, 105]
        })

        doc.setFillColor(63, 81, 181)
        doc.rect(0, 0, 210, 30, 'F')

        doc.setTextColor(255, 255, 255)
        doc.setFontSize(18)
        doc.setFont('helvetica', 'bold')
        doc.text('REQUISICIÓN', 14, 12)

        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.text('Sistema de Requisiciones JDE', 14, 18)
        doc.text(`Solicitante: ${email}`, 14, 23)
        doc.text(`Fecha: ${new Date(dateStr).toLocaleString()}`, 14, 27)

        doc.setFontSize(9)
        doc.text(`N° Documento: ${boletaId}`, 196, 12, { align: 'right' })

        if (description) {
            doc.setFontSize(9)
            doc.setFont('helvetica', 'bold')
            doc.text(`Descripción:`, 196, 18, { align: 'right' })
            doc.setFontSize(8)
            doc.setFont('helvetica', 'normal')
            const splitDescription = doc.splitTextToSize(description, 70)
            doc.text(splitDescription, 196, 22, { align: 'right' })
        }

        const tableData = items.map(item => [
            { content: item.litm || item.item_code, styles: { fontStyle: 'bold' } },
            item.dsci || '---',
            { content: item.pqoh || item.qty_disponible || 0, styles: { halign: 'center' } },
            { content: item.cantidad || item.qty_a_comprar, styles: { halign: 'center', textColor: [63, 81, 181], fontStyle: 'bold' } },
            { content: item.primary_uom || item.centro, styles: { halign: 'center' } }
        ])

        autoTable(doc, {
            startY: 35,
            head: [['SKU', 'Descripción', 'Stock JDE', 'Cantidad Solicitada', 'UNE']],
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
                1: { cellWidth: 'auto' },
                2: { halign: 'center', cellWidth: 25 },
                3: { halign: 'center', cellWidth: 45 },
                4: { halign: 'center', cellWidth: 32 }
            },
            margin: { top: 35, right: 14, bottom: 15, left: 14 },
            tableWidth: 'auto'
        })

        const pageHeight = doc.internal.pageSize.height
        doc.setDrawColor(200, 200, 200)
        doc.line(14, pageHeight - 15, 196, pageHeight - 15)

        doc.setFontSize(7)
        doc.setTextColor(128, 128, 128)
        doc.text('Este documento es un comprobante interno de requisición.', 105, pageHeight - 10, { align: 'center' })
        doc.text('El stock se actualizará una vez procesado en JDE.', 105, pageHeight - 6, { align: 'center' })

        const filename = `requisicion-${boletaId}.pdf`

        // Mejor manejo para móviles
        if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            const blob = doc.output('blob');
            const blobURL = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobURL;
            link.download = filename;
            link.click();

            // Fallback: abrir en nueva pestaña si el download falla
            setTimeout(() => {
                window.open(blobURL, '_blank');
            }, 100);
        } else {
            doc.save(filename)
        }
    }

    const handleDownloadHistoryPDF = async (purchase: BoletaDisplay) => {
        const { data: items, error } = await supabase
            .from('purchase_items')
            .select('*')
            .eq('purchase_id', purchase.purchase_id)

        if (error || !items) {
            showNotification('error', 'Error', 'No se pudieron cargar los items de la requisición')
            return
        }

        const enrichedItems = await Promise.all(items.map(async (i) => {
            let description = '---'
            try {
                const { data: { session } } = await supabase.auth.getSession()
                if (session) {
                    const response = await fetch(`http://192.168.1.245:8000/excedentes/existencias?search=${i.item_code}`, {
                        headers: { 'Authorization': `Bearer ${session.access_token}` }
                    })
                    if (response.ok) {
                        const data = await response.json()
                        if (data.items && data.items.length > 0) {
                            const match = data.items.find((p: any) => String(p.litm) === String(i.item_code))
                            if (match) description = match.dsci
                        }
                    }
                }
            } catch (err) {
                console.error('Error fetching description:', err)
            }
            return {
                ...i,
                dsci: description
            }
        }))

        generatePDF(enrichedItems, purchase.boleta_number, purchase.created_at, purchase.requested_by_email, purchase.descripcion)
    }

    const handleLogout = async () => {
        await supabase.auth.signOut()
    }

    return (
        <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
            {isModalOpen && selectedProduct && (
                <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                    <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={closeQuantityModal}></div>
                        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
                        <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full w-[92%] sm:w-full border-t-4 border-indigo-600">
                            <div className="bg-white px-4 pt-6 pb-6 sm:p-8">
                                <div className="sm:flex sm:items-start">
                                    <div className="hidden sm:flex mx-auto flex-shrink-0 items-center justify-center h-12 w-12 rounded-full bg-indigo-50 sm:mx-0 sm:h-10 sm:w-10">
                                        <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                                        </svg>
                                    </div>
                                    <div className="mt-0 text-left sm:ml-4 w-full">
                                        <h3 className="text-xl leading-6 font-black text-gray-900 mb-4" id="modal-title">
                                            📦 Agregar a la Solicitud
                                        </h3>
                                        <div className="mt-2">
                                            <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-100">
                                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Producto seleccionado</p>
                                                <p className="text-sm font-black text-gray-800 leading-tight mb-2">{selectedProduct.dsci}</p>
                                                <div className="flex flex-col gap-1 text-[11px]">
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-500">Stock JDE Total:</span>
                                                        <b className="text-gray-900">{selectedProduct.pqoh}</b>
                                                    </div>
                                                    {(selectedProduct.pending_stock || 0) > 0 && (
                                                        <div className="flex justify-between text-orange-600">
                                                            <span>Reservado por otros:</span>
                                                            <b>-{selectedProduct.pending_stock}</b>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-between pt-1 border-t border-gray-200 font-black text-indigo-700">
                                                        <span>Disponible para ti:</span>
                                                        <span>{selectedProduct.pqoh - (selectedProduct.pending_stock || 0)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <label htmlFor="qty" className="block text-sm font-black text-gray-700 mb-2">
                                                ¿Qué cantidad deseas solicitar?
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    pattern="\d*"
                                                    inputMode="numeric"
                                                    name="qty"
                                                    id="qty"
                                                    min="1"
                                                    max={selectedProduct.pqoh - (selectedProduct.pending_stock || 0)}
                                                    className="block w-full text-lg sm:text-sm border-2 border-gray-200 rounded-xl p-4 sm:p-3 focus:border-indigo-500 focus:ring-0 font-black transition-all shadow-inner"
                                                    placeholder={`Máx: ${selectedProduct.pqoh - (selectedProduct.pending_stock || 0)}`}
                                                    value={qtyInput}
                                                    onChange={(e) => setQtyInput(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleConfirmAddToCart()}
                                                    autoFocus
                                                />
                                            </div>
                                            <p className="mt-3 text-[11px] leading-relaxed text-indigo-500 font-medium bg-indigo-100/30 p-2 rounded-lg border border-indigo-100/50 text-center">
                                                ✨ Cantidad máxima a solicitar: <b className="text-indigo-700">{selectedProduct.pqoh - (selectedProduct.pending_stock || 0)}</b>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-gray-50 px-6 py-4 sm:px-8 sm:flex sm:flex-row-reverse gap-3">
                                <button
                                    type="button"
                                    className="w-full sm:w-auto inline-flex justify-center rounded-xl border border-transparent shadow-lg px-6 py-4 sm:py-2 bg-indigo-600 text-base sm:text-sm font-black text-white hover:bg-indigo-700 active:scale-95 transition-all"
                                    onClick={handleConfirmAddToCart}
                                >
                                    Confirmar
                                </button>
                                <button
                                    type="button"
                                    className="mt-3 sm:mt-0 w-full sm:w-auto inline-flex justify-center rounded-xl border border-gray-200 shadow-sm px-6 py-4 sm:py-2 bg-white text-base sm:text-sm font-bold text-gray-600 hover:bg-gray-100 active:scale-95 transition-all"
                                    onClick={closeQuantityModal}
                                >
                                    Volver
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <nav className="bg-white shadow sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col sm:flex-row justify-between h-auto sm:h-16 items-center py-4 sm:py-0 space-y-4 sm:space-y-0">
                        <div className="flex items-center">
                            <span
                                onClick={() => setView('catalog')}
                                className="text-xl sm:text-2xl font-extrabold text-indigo-600 tracking-tight cursor-pointer hover:opacity-80 transition-opacity text-center sm:text-left"
                            >
                                JDE Solicitud de Excedentes
                            </span>
                        </div>
                        <div className="flex items-center space-x-3 sm:space-x-6">
                            <button
                                onClick={() => setView('requisiciones')}
                                className={`text-xs sm:text-sm font-medium transition-colors ${view === 'requisiciones' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <span className="sm:hidden">Requisición</span>
                                <span className="hidden sm:inline">Requisiciones</span>
                            </button>
                            <button
                                onClick={() => setView('catalog')}
                                className={`text-xs sm:text-sm font-medium transition-colors ${view === 'catalog' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
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
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all"
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
                        <div className="px-4 py-5 sm:px-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50/50 space-y-4 sm:space-y-0">
                            <h2 className="text-lg sm:text-xl font-bold text-gray-800">Catálogo de Excedentes</h2>
                            <div className="relative w-full sm:w-80">
                                <input
                                    type="text"
                                    placeholder="Buscar SKU, item o nombre..."
                                    value={searchTermInput}
                                    onChange={(e) => setSearchTermInput(e.target.value)}
                                    className="w-full rounded-xl border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm px-4 py-2.5 pr-10 border-2"
                                />
                                {searchTermInput && (
                                    <button
                                        onClick={() => setSearchTermInput('')}
                                        className="absolute right-10 top-2.5 text-gray-400 hover:text-gray-600 p-0.5"
                                    >
                                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                                {loading ? (
                                    <div className="absolute right-3 top-3">
                                        <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    </div>
                                ) : (
                                    <div className="absolute right-3 top-3 text-gray-400">
                                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="hidden md:block overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Descripción</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">UNE</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stock JDE</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Reservado</th>
                                        <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className={`bg-white divide-y divide-gray-100 transition-opacity duration-200 ${loading && products.length > 0 ? 'opacity-50' : 'opacity-100'}`}>
                                    {loading && products.length === 0 ? (
                                        [...Array(8)].map((_, i) => (
                                            <tr key={i} className="animate-pulse">
                                                <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-100 rounded w-16"></div></td>
                                                <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-100 rounded w-64"></div></td>
                                                <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-100 rounded w-12"></div></td>
                                                <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-100 rounded w-8"></div></td>
                                                <td className="px-6 py-4 whitespace-nowrap"><div className="h-8 bg-gray-100 rounded-full w-20"></div></td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right"><div className="h-9 bg-gray-100 rounded-md w-24 ml-auto"></div></td>
                                            </tr>
                                        ))
                                    ) : products.length === 0 ? (
                                        <tr><td colSpan={6} className="px-6 py-4 text-center text-gray-500">No se encontraron productos</td></tr>
                                    ) : (
                                        products.map((product) => {
                                            const uniqueId = `${product.litm}-${product.lotn}`
                                            const isPending = !!(product.pending_stock && product.pending_stock > 0)
                                            const netAvailable = product.pqoh - (product.pending_stock || 0)
                                            return (
                                                <tr key={uniqueId} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{product.litm}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.dsci}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.primary_uom}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-bold">{product.pqoh}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="flex flex-col gap-1">
                                                            {isPending && (
                                                                <span className="inline-flex items-center w-fit px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">
                                                                    Reservado: -{product.pending_stock}
                                                                </span>
                                                            )}
                                                            {netAvailable <= 0 ? (
                                                                <span className="inline-flex items-center w-fit px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                                                                    No disponible
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center w-fit px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">
                                                                    Disponible: {netAvailable}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                        <button
                                                            onClick={() => openQuantityModal(product)}
                                                            disabled={isPending || netAvailable <= 0}
                                                            className={`px-4 py-2 rounded-md font-medium text-white transition-all shadow-sm ${(isPending || netAvailable <= 0)
                                                                ? 'bg-gray-300 cursor-not-allowed'
                                                                : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'}`}
                                                        >
                                                            Solicitar
                                                        </button>
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile View Card Layout */}
                        <div className="md:hidden">
                            <div className={`p-4 space-y-4 transition-opacity duration-200 ${loading && products.length > 0 ? 'opacity-50' : 'opacity-100'}`}>
                                {loading && products.length === 0 ? (
                                    [...Array(5)].map((_, i) => (
                                        <div key={i} className="bg-white border border-gray-100 rounded-lg p-4 animate-pulse">
                                            <div className="h-4 bg-gray-100 rounded w-1/3 mb-2"></div>
                                            <div className="h-5 bg-gray-100 rounded w-full mb-4"></div>
                                            <div className="flex justify-between items-center">
                                                <div className="h-4 bg-gray-100 rounded w-16"></div>
                                                <div className="h-9 bg-gray-100 rounded-md w-24"></div>
                                            </div>
                                        </div>
                                    ))
                                ) : products.length === 0 ? (
                                    <div className="text-center py-8 text-gray-500">No se encontraron productos</div>
                                ) : (
                                    products.map((product) => {
                                        const uniqueId = `${product.litm}-${product.lotn}`
                                        const isPending = !!(product.pending_stock && product.pending_stock > 0)
                                        const netAvailable = product.pqoh - (product.pending_stock || 0)
                                        return (
                                            <div key={uniqueId} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm active:bg-gray-50 transition-colors">
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">SKU: {product.litm}</span>
                                                    <div className="flex flex-col items-end gap-1">
                                                        {isPending && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">
                                                                RESERVADO: -{product.pending_stock}
                                                            </span>
                                                        )}
                                                        {netAvailable <= 0 ? (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                                                                NO DISPONIBLE
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">
                                                                DISPONIBLE: {netAvailable}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <h3 className="text-sm font-bold text-gray-900 mb-1 line-clamp-2">{product.dsci}</h3>
                                                <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100">
                                                    <div>
                                                        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Stock JDE Total</p>
                                                        <p className="text-lg font-black text-gray-800">{product.pqoh}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => openQuantityModal(product)}
                                                        disabled={isPending || netAvailable <= 0}
                                                        className={`px-6 py-2 rounded-lg text-sm font-bold text-white transition-all ${(isPending || netAvailable <= 0)
                                                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                                            : 'bg-indigo-600 hover:bg-indigo-700 shadow-md active:scale-95'}`}
                                                    >
                                                        Solicitar
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </div>
                        <div className="bg-gray-50 px-4 sm:px-6 py-4 flex items-center justify-between border-t border-gray-200">
                            <button
                                onClick={() => {
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                    setPage(p => Math.max(1, p - 1));
                                }}
                                disabled={page === 1}
                                className="text-xs sm:text-sm font-bold text-gray-600 hover:text-gray-900 disabled:opacity-40 px-3 sm:px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm active:scale-95 transition-all"
                            >
                                &larr; Anterior
                            </button>
                            <div className="flex flex-col items-center">
                                <span className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-widest">Página</span>
                                <span className="text-sm sm:text-base font-black text-indigo-600">{page} <span className="text-gray-300 font-medium px-1">/</span> {totalPages}</span>
                            </div>
                            <button
                                onClick={() => {
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                    setPage(p => Math.min(totalPages, p + 1));
                                }}
                                disabled={page === totalPages}
                                className="text-xs sm:text-sm font-bold text-gray-600 hover:text-gray-900 disabled:opacity-40 px-3 sm:px-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm active:scale-95 transition-all"
                            >
                                Siguiente &rarr;
                            </button>
                        </div>
                    </div>
                )}

                {view === 'requisiciones' && (
                    <div className="max-w-5xl mx-auto">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 space-y-4 sm:space-y-0 text-center sm:text-left">
                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 w-full sm:w-auto">Historial de Requisiciones</h2>
                            <button onClick={() => setView('catalog')} className="text-indigo-600 hover:text-indigo-800 font-medium text-sm">
                                &larr; Volver al Catálogo
                            </button>
                        </div>

                        {requisiciones.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                                <div className="mx-auto h-24 w-24 text-gray-200 mb-4">
                                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                </div>
                                <h3 className="text-lg font-medium text-gray-900">No hay requisiciones registradas</h3>
                                <p className="mt-2 text-gray-500">Aún no has realizado ninguna solicitud de excedentes.</p>
                                <button onClick={() => setView('catalog')} className="mt-6 inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700">
                                    Ver Catálogo
                                </button>
                            </div>
                        ) : (
                            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                                {requisiciones.map(b => (
                                    <div key={b.purchase_id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Requisición</p>
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
                        )}
                    </div>
                )}

                {view === 'cart' && (
                    <div className="max-w-4xl mx-auto px-4">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 space-y-4 sm:space-y-0">
                            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Tu Solicitud</h2>
                            <button onClick={() => setView('catalog')} className="text-indigo-600 hover:text-indigo-800 font-medium text-sm">
                                &larr; Volver al Catálogo
                            </button>
                        </div>

                        {cart.length === 0 ? (
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                                <div className="mx-auto h-24 w-24 text-gray-200 mb-4">
                                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                                </div>
                                <h3 className="text-lg font-medium text-gray-900">Tu solicitud está vacía</h3>
                                <p className="mt-2 text-gray-500">¿No sabes qué buscar? ¡Tenemos miles de productos!</p>
                                <button onClick={() => setView('catalog')} className="mt-6 inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700">
                                    Ir al Catálogo
                                </button>
                            </div>
                        ) : (
                            <div className="lg:grid lg:grid-cols-12 lg:gap-x-12 lg:items-start">
                                <section className="lg:col-span-12 xl:col-span-7">
                                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                                        <ul className="divide-y divide-gray-200">
                                            {cart.map((item) => (
                                                <li key={item.id} className="p-4 sm:p-6 flex flex-row items-center sm:items-start group hover:bg-indigo-50/10 transition-colors">
                                                    <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-gray-50 flex items-center justify-center border border-gray-100 group-hover:bg-white group-hover:shadow-sm transition-all">
                                                        <span className="text-xl sm:text-2xl font-black text-indigo-200 group-hover:text-indigo-400 transition-colors">
                                                            {item.dsci ? item.dsci.substring(0, 2).toUpperCase() : 'IT'}
                                                        </span>
                                                    </div>

                                                    <div className="ml-4 sm:ml-6 flex-1 flex flex-col">
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <h3 className="text-sm sm:text-lg font-black text-gray-900 line-clamp-2 leading-tight">
                                                                    {item.dsci}
                                                                </h3>
                                                                <span className="inline-block mt-1 text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded">SKU: {item.litm}</span>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => removeFromCart(item.id)}
                                                                className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                                                            >
                                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                            </button>
                                                        </div>

                                                        <div className="flex flex-col mt-3 pt-3 border-t border-gray-100">
                                                            <span className="text-[10px] text-gray-400 uppercase font-extrabold tracking-widest">Cantidad a Solicitar</span>
                                                            <span className="text-2xl font-black text-indigo-600">{item.cantidad}</span>
                                                        </div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </section>

                                <section className="lg:col-span-12 xl:col-span-5 mt-8 xl:mt-0">
                                    <div className="bg-white rounded-lg shadow-md border border-indigo-100 p-6 sticky top-24 ring-1 ring-indigo-50">
                                        <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center">
                                            <svg className="w-5 h-5 mr-2 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                                            Resumen de la Solicitud
                                        </h2>

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

                                        <div className="mt-8 space-y-2">
                                            <label htmlFor="description" className="block text-xs font-black text-indigo-500 uppercase tracking-widest">
                                                Descripción de la Solicitud
                                            </label>
                                            <textarea
                                                id="description"
                                                rows={3}
                                                className="block w-full rounded-xl border-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm transition-all bg-indigo-50/30 placeholder-indigo-300"
                                                placeholder="Ej: Repuestos para proyecto planta 2, Urgente..."
                                                value={purchaseDescription}
                                                onChange={(e) => setPurchaseDescription(e.target.value)}
                                            />
                                        </div>

                                        <div className="mt-6">
                                            <button
                                                onClick={handlePurchase}
                                                className="w-full bg-indigo-600 border border-transparent rounded-full shadow-lg py-4 px-6 text-lg font-black text-white hover:bg-indigo-700 active:scale-95 transition-all"
                                            >
                                                Confirmar Solicitud
                                            </button>
                                        </div>

                                        <div className="mt-6 text-xs text-center text-gray-500">
                                            <p className="flex justify-center items-center gap-2 mb-2">
                                                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                                Generación de comprobante único
                                            </p>
                                            <p>Se generará un documento PDF consolidado con todos los ítems de esta solicitud.</p>
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
