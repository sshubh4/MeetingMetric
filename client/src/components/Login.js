import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, setToken } from '../api';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await login(email, password);
      setToken(data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg" aria-hidden>
        <div className="swirl swirl-1" />
        <div className="swirl swirl-2" />
        <div className="glow glow-1" />
      </div>
      <div className="auth-card">
        <Link to="/" className="auth-back-link">&larr; Home</Link>
        <div className="auth-brand">
          <div className="brand-text brand-text-lg">
            <span className="brand-meeting">Meeting</span><span className="brand-metric">Metric</span>
          </div>
          <h1>Sign in</h1>
        </div>
        <p className="subtitle">Executive Suite &middot; meeting intelligence</p>
        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary">
            Sign in
          </button>
        </form>
        <p className="footer-link">
          No account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
