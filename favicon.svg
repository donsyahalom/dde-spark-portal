import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function ChangePasswordPage() {
  const { currentUser, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const isFirstTime = currentUser?.must_change_password

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (newPass !== confirm) { setError('Passwords do not match'); return }
    if (newPass.length < 6) { setError('Password must be at least 6 characters'); return }
    if (!isFirstTime && current !== currentUser?.password_hash) {
      setError('Current password is incorrect'); return
    }
    setLoading(true)
    const { error: updateError } = await supabase
      .from('employees')
      .update({ password_hash: newPass, must_change_password: false })
      .eq('id', currentUser.id)
    setLoading(false)
    if (updateError) { setError('Failed to update password'); return }
    await refreshUser()
    setSuccess('Password updated successfully!')
    setTimeout(() => navigate('/leaderboard'), 1500)
  }

  return (
    <div className="login-page">
      <div className="login-box fade-in">
        <img src="/logo.png" alt="DDE" className="login-logo" style={{height:'60px'}}
          onError={e => { e.target.style.display='none' }} />
        <h1 className="login-title">{isFirstTime ? 'Welcome! Set Your Password' : 'Change Password'}</h1>
        {isFirstTime && (
          <div className="alert alert-warning" style={{marginBottom:'20px'}}>
            ⚡ Please set a new password before continuing.
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}
        <form onSubmit={handleSubmit}>
          {!isFirstTime && (
            <div className="form-group">
              <label className="form-label">Current Password</label>
              <input className="form-input" type="password" value={current}
                onChange={e => setCurrent(e.target.value)} required />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input className="form-input" type="password" value={newPass}
              onChange={e => setNewPass(e.target.value)} placeholder="Min 6 characters" required />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input className="form-input" type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)} required />
          </div>
          <button className="btn btn-gold" type="submit" disabled={loading}
            style={{width:'100%', justifyContent:'center', marginTop:'8px', padding:'14px'}}>
            {loading ? 'Updating...' : '🔑 Update Password'}
          </button>
          {!isFirstTime && (
            <button type="button" className="btn btn-outline"
              style={{width:'100%', justifyContent:'center', marginTop:'10px'}}
              onClick={() => navigate(-1)}>
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
