import React from 'react';
import { Navigate } from 'react-router-dom';
import { getToken } from '../api';

function PrivateRoute({ children }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default PrivateRoute;
