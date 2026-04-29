import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * Fetches and exposes the current user's permissions from user_permissions.
 * Falls back to safe defaults (hidden) when no row exists.
 *
 * Usage:
 *   const { screenVisible, detailOn, loading } = usePermissions()
 *   if (!screenVisible('leaderboard')) return null
 *   {detailOn('leaderboard', 'show_spark_log') && <LogTable />}
 */
export function usePermissions() {
  const { currentUser } = useAuth()
  const [perms, setPerms]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser?.id) { setLoading(false); return }

    // Admins bypass all user-level permissions
    if (currentUser.is_admin) {
      setPerms('admin')
      setLoading(false)
      return
    }

    supabase
      .from('user_permissions')
      .select('permissions')
      .eq('employee_id', currentUser.id)
      .single()
      .then(({ data }) => {
        if (!data) {
          setPerms(null) // no row → all hidden
        } else {
          try { setPerms(JSON.parse(data.permissions)) }
          catch { setPerms(null) }
        }
        setLoading(false)
      })
  }, [currentUser?.id])

  /** Is this whole screen accessible to the current user? */
  const screenVisible = (screenId) => {
    if (perms === 'admin') return true
    return perms?.screens?.[screenId]?.visible === true
  }

  /** Is a specific detail flag enabled for the current user? */
  const detailOn = (screenId, detailId) => {
    if (perms === 'admin') return true
    return perms?.screens?.[screenId]?.details?.[detailId] !== false
  }

  return { perms, loading, screenVisible, detailOn }
}
