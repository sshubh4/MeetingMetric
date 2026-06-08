import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import AppShell from './AppShell';
import { getOrgRoster, inviteUser, deactivateUser, updateOrgUser } from '../api';
import { useAuth } from '../hooks/useAuth';

const ROLE_BADGE = {
  admin: 'badge-role-admin',
  hr: 'badge-role-hr',
  manager: 'badge-role-manager',
  employee: 'badge-role-employee',
};

function initials(name) {
  if (!name) return 'U';
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function OrgRosterPage() {
  const auth = useAuth();
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteRole, setInviteRole] = useState('employee');
  const [inviteResult, setInviteResult] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [editingRole, setEditingRole] = useState(null);

  const load = () => {
    setLoading(true);
    getOrgRoster()
      .then(setRoster)
      .catch((e) => toast.error(e.response?.data?.error || 'Failed to load roster'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleInvite = async () => {
    setInviting(true);
    try {
      const result = await inviteUser(inviteRole);
      setInviteResult(result);
      toast.success('Invite link created!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create invite');
    } finally {
      setInviting(false);
    }
  };

  const handleDeactivate = async (userId, name) => {
    if (!window.confirm(`Deactivate ${name}? They will lose access immediately.`)) return;
    setDeactivating(userId);
    try {
      await deactivateUser(userId);
      toast.success(`${name} deactivated`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to deactivate');
    } finally {
      setDeactivating(null);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await updateOrgUser(userId, { role: newRole });
      toast.success('Role updated');
      setEditingRole(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update role');
    }
  };

  return (
    <AppShell title="Org Roster" subtitle="Manage your organization's members">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-muted text-sm">{roster.length} member{roster.length !== 1 ? 's' : ''}</p>
        <button type="button" className="btn-primary" onClick={() => { setShowInviteModal(true); setInviteResult(null); }}>
          + Invite Member
        </button>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Manager</th>
                <th>Teams</th>
                <th>Meetings</th>
                <th>Avg Eng.</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${u.active ? 'bg-accent-dim text-white' : 'bg-white/10 text-muted'}`}>
                        {initials(u.fullName)}
                      </div>
                      <span className={u.active ? 'text-slate-200' : 'text-muted line-through'}>
                        {u.fullName || '(unnamed)'}
                      </span>
                    </div>
                  </td>
                  <td className="text-muted text-xs">{u.email}</td>
                  <td>
                    {editingRole === u.id ? (
                      <select
                        className="select text-xs py-1 w-28"
                        defaultValue={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        onBlur={() => setEditingRole(null)}
                        autoFocus
                      >
                        <option value="employee">employee</option>
                        <option value="manager">manager</option>
                        {auth?.role === 'admin' && <option value="hr">hr</option>}
                        {auth?.role === 'admin' && <option value="admin">admin</option>}
                      </select>
                    ) : (
                      <span
                        className={`badge ${ROLE_BADGE[u.role] || 'badge-role-employee'} cursor-pointer`}
                        onClick={() => auth?.role === 'admin' && setEditingRole(u.id)}
                        title={auth?.role === 'admin' ? 'Click to edit role' : undefined}
                      >
                        {u.role}
                      </span>
                    )}
                  </td>
                  <td className="text-muted text-xs">{u.managerName || '—'}</td>
                  <td>
                    <span className={`inline-block w-2 h-2 rounded-full ${u.teamsConnected ? 'bg-positive' : 'bg-white/20'}`} title={u.teamsConnected ? 'Connected' : 'Not connected'} />
                  </td>
                  <td className="text-muted">{u.meetingCount}</td>
                  <td>
                    {u.avgEngagement != null ? (
                      <span className="text-xs text-accent">{u.avgEngagement}%</span>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-muted text-xs">
                    {u.joinedAt ? new Date(u.joinedAt).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    {u.active && u.id !== (auth?.userId) && (
                      <button
                        type="button"
                        className="btn-danger text-xs py-1 px-2"
                        disabled={deactivating === u.id}
                        onClick={() => handleDeactivate(u.id, u.fullName || u.email)}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => { setShowInviteModal(false); setInviteResult(null); }}>
          <div className="card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Invite Member</h3>
              <button type="button" className="text-muted hover:text-white" onClick={() => { setShowInviteModal(false); setInviteResult(null); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {!inviteResult ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-muted uppercase tracking-wider">Role</label>
                  <select className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="hr">HR</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={handleInvite}
                  disabled={inviting}
                >
                  {inviting ? 'Generating…' : 'Generate Invite Link'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted">Share this link. It expires in 24 hours.</p>
                <div className="bg-white/5 rounded-lg p-3 font-mono text-xs text-accent break-all">
                  {inviteResult.inviteUrl}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    onClick={() => { navigator.clipboard.writeText(inviteResult.inviteUrl); toast.success('Copied!'); }}
                  >
                    Copy Link
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setInviteResult(null)}>
                    New Invite
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default OrgRosterPage;
