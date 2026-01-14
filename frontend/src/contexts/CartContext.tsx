import { createContext, useContext, useState, ReactNode } from 'react'

export interface CartItem {
    id: string
    itm: string
    litm: string
    dsci: string
    cantidad: number // Cantidad a comprar
    primary_uom: string
    qty_disponible: number
    total_jde_stock: number
    targetQuantity: number
}

interface CartContextType {
    cart: CartItem[]
    addToCart: (item: CartItem) => void
    removeFromCart: (id: string) => void
    clearCart: () => void
    totalItems: number
}

const CartContext = createContext<CartContextType | undefined>(undefined)

export function CartProvider({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<CartItem[]>([])

    const addToCart = (newItem: CartItem) => {
        setCart((prev) => {
            const existing = prev.find((item) => item.id === newItem.id)
            if (existing) {
                // Si ya existe, sumamos la cantidad
                return prev.map((item) =>
                    item.id === newItem.id
                        ? { ...item, cantidad: item.cantidad + newItem.cantidad }
                        : item
                )
            }
            return [...prev, newItem]
        })
    }

    const removeFromCart = (id: string) => {
        setCart((prev) => prev.filter((item) => item.id !== id))
    }

    const clearCart = () => {
        setCart([])
    }

    const totalItems = cart.reduce((acc, item) => acc + item.cantidad, 0)

    return (
        <CartContext.Provider value={{ cart, addToCart, removeFromCart, clearCart, totalItems }}>
            {children}
        </CartContext.Provider>
    )
}

export function useCart() {
    const context = useContext(CartContext)
    if (context === undefined) {
        throw new Error('useCart must be used within a CartProvider')
    }
    return context
}
