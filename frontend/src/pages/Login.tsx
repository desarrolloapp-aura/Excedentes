import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.ts'
import { useNotification } from '../contexts/NotificationContext.tsx'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const { showNotification } = useNotification()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    // Verificar si venimos de un redireccionamiento con error (ej: acceso denegado por el trigger)
    const params = new URLSearchParams(window.location.hash.substring(1)) // Remove #
    const errorDescription = params.get('error_description')

    if (errorDescription) {
      // Traducir mensajes comunes si es necesario
      let displayMessage = decodeURIComponent(errorDescription)
      if (displayMessage.includes('Acceso Denegado') || displayMessage.includes('row-level security policy')) {
        displayMessage = 'ACCESO DENEGADO: Tu cuenta de Google no pertenece a la organización @aura.cl.'
      }
      setErrorMessage(displayMessage)
      showNotification('error', 'Error de Acceso', displayMessage)

      // Limpiar el hash para que no se quede el error ahí si refresca
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [showNotification])

  const handleGoogleLogin = async () => {
    setErrorMessage(null)
    try {
      setLoading(true)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Redirigir al Login para capturar errores si fallara. 
          // Si es exitoso, App.tsx redirigirá a /excedentes automáticamente.
          redirectTo: `${window.location.origin}/login`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
            hd: 'aura.cl', // Restringe el login a cuentas @aura.cl en la pantalla de Google
          },
        },
      })
      if (error) throw error
    } catch (error: any) {
      showNotification(
        'error',
        'Error al iniciar sesión',
        `No pudimos iniciar sesión con Google. ${error.message || 'Por favor, intenta nuevamente.'}`
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Excedentes Aura
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sistema de consulta de excedentes y compras
          </p>

          {errorMessage && (
            <div className="mt-4 bg-red-50 border-l-4 border-red-500 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-bold text-red-700">
                    {errorMessage}
                  </p>
                </div>
              </div>
            </div>
          )}

          {!errorMessage && (
            <div className="mt-4 bg-blue-50 border-l-4 border-blue-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-blue-700">
                    Acceso exclusivo para colaboradores de Aura.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 space-y-6">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors shadow-lg"
          >
            <span className="absolute left-0 inset-y-0 flex items-center pl-3">
              {/* Google Icon */}
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z" />
              </svg>
            </span>
            {loading ? 'Conectando...' : 'Iniciar Sesión con Google Aura'}
          </button>
        </div>
      </div>
    </div>
  )
}
