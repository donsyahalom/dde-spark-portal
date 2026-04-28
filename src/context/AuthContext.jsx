import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('dde_user')
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored))
      } catch (e) {
        localStorage.removeItem('dde_user')
      }
    }
    setLoading(false)
  }, [])

  const login = async (email, password) => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (error || !data) return { error: 'Invalid email or password' }
    if (data.password_hash !== password) return { error: 'Invalid email or password' }
    // Block archived employees — credentials still exist but access is revoked
    if (data.is_archived) return { error: 'This account has been deactivated. Please contact your administrator.' }

    // Process daily reset (CT timezone) and vesting on login
    await supabase.rpc('reset_daily_sparks')
    await supabase.rpc('process_vesting')

    // Re-fetch with updated data
    const { data: refreshed } = await supabase
      .from('employees')
      .select('*')
      .eq('id', data.id)
      .single()

    const user = refreshed || data
    setCurrentUser(user)
    localStorage.setItem('dde_user', JSON.stringify(user))
    return { user }
  }

  const logout = () => {
    setCurrentUser(null)
    localStorage.removeItem('dde_user')
  }

  const refreshUser = async () => {
    if (!currentUser) return
    const { data } = await supabase
      .from('employees')
      .select('*')
      .eq('id', currentUser.id)
      .single()
    if (data) {
      setCurrentUser(data)
      localStorage.setItem('dde_user', JSON.stringify(data))
    }
    return data
  }

  return (
    <AuthContext.Provider value={{ currentUser, login, logout, refreshUser, loading, setCurrentUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
