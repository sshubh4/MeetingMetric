import React from 'react';
import { Navigate } from 'react-router-dom';
import { getToken } from '../api';
import { useAuth, isRole } from '../hooks/useAuth';

export function PrivateRoute({ children }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

export function RoleRoute({ children, roles = [] }) {
  const auth = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (roles.length > 0 && !isRole(auth, ...roles)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="card max-w-md text-center">
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted text-sm">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }
  return children;
}

export default PrivateRoute;
