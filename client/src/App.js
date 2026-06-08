import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';
import CalendarPage from './components/CalendarPage';
import MeetingsListPage from './components/MeetingsListPage';
import MeetingDetail from './components/MeetingDetail';
import ProjectsPage from './components/ProjectsPage';
import TeamPage from './components/TeamPage';
import SettingsPage from './components/SettingsPage';
import AnalyzePage from './components/AnalyzePage';
import IntelligencePage from './components/IntelligencePage';
import ReportsPage from './components/ReportsPage';
import MyProfilePage from './components/MyProfilePage';
import OrgRosterPage from './components/OrgRosterPage';
import { PrivateRoute, RoleRoute } from './components/PrivateRoute';

function App() {
  return (
    <Router basename={process.env.PUBLIC_URL}>
      <Toaster position="bottom-right" toastOptions={{ style: { background: '#1e2028', color: '#e8eaed', border: '1px solid rgba(255,255,255,0.1)' } }} />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/calendar" element={<PrivateRoute><CalendarPage /></PrivateRoute>} />
        <Route path="/meetings" element={<PrivateRoute><MeetingsListPage /></PrivateRoute>} />
        <Route path="/meeting/:id" element={<PrivateRoute><MeetingDetail /></PrivateRoute>} />
        <Route path="/projects" element={<PrivateRoute><ProjectsPage /></PrivateRoute>} />
        <Route path="/team" element={<PrivateRoute><TeamPage /></PrivateRoute>} />
        <Route path="/analyze" element={<PrivateRoute><AnalyzePage /></PrivateRoute>} />
        <Route path="/intelligence" element={<PrivateRoute><IntelligencePage /></PrivateRoute>} />
        <Route path="/reports" element={<PrivateRoute><ReportsPage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
        <Route path="/me" element={<PrivateRoute><MyProfilePage /></PrivateRoute>} />
        <Route path="/org/roster" element={<PrivateRoute><RoleRoute roles={['hr', 'admin']}><OrgRosterPage /></RoleRoute></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
