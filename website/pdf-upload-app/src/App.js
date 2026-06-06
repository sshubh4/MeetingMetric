import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import Login from './components/Login';
import Register from './components/Register';
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
import PrivateRoute from './components/PrivateRoute';
import './App.css';

function App() {
  return (
    <Router basename={process.env.PUBLIC_URL}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
