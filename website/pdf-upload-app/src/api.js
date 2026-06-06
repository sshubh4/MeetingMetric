import axios from 'axios';

const baseURL = process.env.REACT_APP_API_URL || '';

export function getToken() {
  return localStorage.getItem('mm_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('mm_token', token);
  else localStorage.removeItem('mm_token');
}

const api = axios.create({
  baseURL: baseURL || undefined,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) {
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

export async function register({ email, password, confirmPassword, fullName, organisation, role }) {
  const { data } = await api.post('/api/register', { email, password, confirmPassword, fullName, organisation, role });
  return data;
}

export async function login(email, password) {
  const { data } = await api.post('/api/login', { email, password });
  return data;
}

export async function analyzeMeeting({ title, text, file, projectId, scheduledAt }) {
  const form = new FormData();
  form.append('title', title || 'Untitled meeting');
  if (text) form.append('text', text);
  if (file) form.append('file', file);
  if (projectId) form.append('project_id', String(projectId));
  if (scheduledAt) form.append('scheduled_at', scheduledAt);
  const url = `${baseURL || ''}/api/meetings/analyze`;
  const { data } = await axios.post(url, form, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
  });
  return data;
}

export async function listMeetings() {
  const { data } = await api.get('/api/meetings');
  return data;
}

export async function getMeeting(id) {
  const { data } = await api.get(`/api/meetings/${id}`);
  return data;
}

export async function getDashboard() {
  const { data } = await api.get('/api/dashboard');
  return data;
}

export async function searchMeetings(query) {
  const { data } = await api.post('/api/search', { query });
  return data;
}

export async function listProjects() {
  const { data } = await api.get('/api/projects');
  return data;
}

export async function createProject(body) {
  const { data } = await api.post('/api/projects', body);
  return data;
}

export async function getCalendar(month) {
  const { data } = await api.get('/api/calendar', { params: { month } });
  return data;
}

export async function getTeamParticipants(params = {}) {
  const { data } = await api.get('/api/team/participants', { params });
  return data;
}

export async function assignMeetingProject(meetingId, projectId) {
  const { data } = await api.patch(`/api/meetings/${meetingId}/project`, { project_id: projectId });
  return data;
}

export async function getProjectDetail(id) {
  const { data } = await api.get(`/api/projects/${id}/detail`);
  return data;
}

export async function getReports(params = {}) {
  const { data } = await api.get('/api/reports', { params });
  return data;
}

export async function getTeamsStatus() {
  const { data } = await api.get('/api/teams/status');
  return data;
}

export async function getTeamsAuthUrl() {
  const { data } = await api.get('/api/teams/connect');
  return data;
}

export async function disconnectTeams() {
  const { data } = await api.delete('/api/teams/disconnect');
  return data;
}

export async function listTeamsMeetings() {
  const { data } = await api.get('/api/teams/meetings');
  return data;
}

export async function importTeamsMeeting(meetingId, subject) {
  const { data } = await api.post('/api/teams/import', { meetingId, subject });
  return data;
}

export async function getTeamsCalendar(start, end) {
  const { data } = await api.get('/api/teams/calendar', { params: { start, end } });
  return data;
}

export async function getTeamsProfile() {
  const { data } = await api.get('/api/teams/profile');
  return data;
}

export async function getUserProfile() {
  const { data } = await api.get('/api/user/profile');
  return data;
}

export async function updateUserProfile(body) {
  const { data } = await api.patch('/api/user/profile', body);
  return data;
}

export default api;
