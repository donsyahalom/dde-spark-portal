import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await login(email, password)
    setLoading(false)
    if (result.error) {
      setError(result.error)
    } else {
      if (result.user.must_change_password) {
        navigate('/change-password')
      } else {
        navigate('/leaderboard')
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-box fade-in">
        <img src="/logo.png" alt="DDE Logo" className="login-logo"
          onError={e => { e.target.style.display = 'none' }} />
        <h1 className="login-title">DDE Spark Portal</h1>
        <p className="login-subtitle">Sign in to access your sparks</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input className="form-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@dde.com" required />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button className="btn btn-gold" type="submit" disabled={loading}
            style={{width:'100%', justifyContent:'center', marginTop:'8px', padding:'14px'}}>
            {loading ? 'Signing in...' : '✨ Sign In'}
          </button>
        </form>
        <p style={{textAlign:'center', marginTop:'20px', fontSize:'0.78rem', color:'var(--white-dim)'}}>
          Default password: <code style={{color:'var(--gold)'}}>spark123</code>
        </p>
      </div>
    </div>
  )
}
