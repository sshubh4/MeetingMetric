import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { login, register, setToken } from '../api';

function EyeIcon({ open }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  );
}

function PasswordField({ value, onChange, placeholder, label }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className="input pr-10"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-slate-200 transition-colors"
          onClick={() => setShow(!show)}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('invite') ? 'register' : 'login');

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Register state
  const [fullName, setFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [inviteToken, setInviteToken] = useState(searchParams.get('invite') || '');
  const [regLoading, setRegLoading] = useState(false);

  useEffect(() => {
    const inv = searchParams.get('invite');
    if (inv) {
      setInviteToken(inv);
      setTab('register');
    }
  }, [searchParams]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    try {
      const data = await login(loginEmail, loginPassword);
      setToken(data.token);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
      setLoginLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (regPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setRegLoading(true);
    try {
      const body = { email: regEmail, password: regPassword, fullName, confirmPassword };
      if (inviteToken.trim()) {
        body.inviteToken = inviteToken.trim();
      } else if (orgName.trim()) {
        body.orgName = orgName.trim();
      } else {
        toast.error('Enter your organization name or an invite token');
        setRegLoading(false);
        return;
      }
      const data = await register(body);
      setToken(data.token);
      toast.success('Account created!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed');
      setRegLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">
            <span className="text-accent">Meeting</span>Metric
          </h1>
          <p className="text-muted text-sm mt-1">AI-powered meeting analytics</p>
        </div>

        {/* Card */}
        <div className="card">
          {/* Tabs */}
          <div className="flex border-b border-white/10 mb-6">
            {['login', 'register'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 pb-3 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'text-accent border-b-2 border-accent -mb-px'
                    : 'text-muted hover:text-slate-200'
                }`}
              >
                {t === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          {/* Login form */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-muted uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  className="input"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoFocus
                />
              </div>
              <PasswordField
                label="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button type="submit" className="btn-primary w-full mt-2" disabled={loginLoading}>
                {loginLoading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* Register form */}
          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-muted uppercase tracking-wider">Full Name</label>
                <input
                  type="text"
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  className="input"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </div>
              <PasswordField
                label="Password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="Min. 8 characters"
              />
              <PasswordField
                label="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
              />

              <div className="border-t border-white/10 pt-4">
                <p className="text-xs text-muted mb-3">
                  {inviteToken ? 'You have an invite token — org is pre-configured.' : 'Join your organization:'}
                </p>
                {!inviteToken ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted uppercase tracking-wider">Organization Name</label>
                      <input
                        type="text"
                        className="input"
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        placeholder="Acme Corp"
                      />
                    </div>
                    <div className="text-center text-xs text-muted">— or —</div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted uppercase tracking-wider">Invite Token</label>
                      <input
                        type="text"
                        className="input"
                        value={inviteToken}
                        onChange={(e) => setInviteToken(e.target.value)}
                        placeholder="Paste invite token"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-positive/10 border border-positive/20 rounded-lg px-3 py-2">
                    <span className="text-positive text-xs">Invite token applied</span>
                    <button
                      type="button"
                      className="ml-auto text-muted hover:text-slate-200 text-xs"
                      onClick={() => setInviteToken('')}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              <button type="submit" className="btn-primary w-full" disabled={regLoading}>
                {regLoading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthPage;
