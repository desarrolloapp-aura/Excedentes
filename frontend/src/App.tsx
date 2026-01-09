import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase.ts'
import { NotificationProvider } from './contexts/NotificationContext.tsx'
import { CartProvider } from './contexts/CartContext.tsx'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'




function PrivateRoute({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
            setLoading(false)
        })

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
        })

        return () => subscription.unsubscribe()
    }, [])

    if (loading) {
        return <div className="flex justify-center items-center h-screen">Cargando...</div>
    }

    if (!session) {
        return <Navigate to="/login" />
    }

    return <>{children}</>
}

function App() {
    const [session, setSession] = useState<any>(null)

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
        })

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
        })

        return () => subscription.unsubscribe()
    }, [])

    return (
        <NotificationProvider>
            <CartProvider>
                <Router>
                    <Routes>
                        <Route
                            path="/login"
                            element={session ? <Navigate to="/excedentes" /> : <Login />}
                        />
                        <Route
                            path="/excedentes"
                            element={
                                <PrivateRoute>
                                    <Dashboard />
                                </PrivateRoute>
                            }
                        />
                        <Route path="/" element={<Navigate to="/excedentes" />} />
                    </Routes>
                </Router>
            </CartProvider>
        </NotificationProvider>
    )
}

export default App
