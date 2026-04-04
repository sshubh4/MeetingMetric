import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register, setToken } from '../api';

function Register() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    organisation: '',
    role: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      return setError('Passwords do not match');
    }
    try {
      const data = await register(form);
      setToken(data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
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
          <h1>Create account</h1>
        </div>
        <p className="subtitle">HR-friendly contribution analytics</p>
        <form onSubmit={handleSubmit}>
          <label>
            Full Name *
            <input
              type="text"
              value={form.fullName}
              onChange={set('fullName')}
              required
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </label>
          <label>
            Work Email *
            <input
              type="email"
              value={form.email}
              onChange={set('email')}
              required
              placeholder="jane@company.com"
              autoComplete="email"
            />
          </label>
          <div className="form-row">
            <label>
              Organisation
              <input
                type="text"
                value={form.organisation}
                onChange={set('organisation')}
                placeholder="Acme Corp"
                autoComplete="organization"
              />
            </label>
            <label>
              Role / Title
              <input
                type="text"
                value={form.role}
                onChange={set('role')}
                placeholder="HR Manager"
                autoComplete="organization-title"
              />
            </label>
          </div>
          <label>
            Password (6+ characters) *
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm Password *
            <input
              type="password"
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary">
            Create Account
          </button>
        </form>
        <p className="footer-link">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
