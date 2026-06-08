import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from './AppShell';
import { getCalendar, getTeamsStatus, getTeamsCalendar } from '../api';

function pad(n) { return n < 10 ? `0${n}` : `${n}`; }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CalendarPage() {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [data, setData]           = useState(null);
  const [teamsEvents, setTeamsEvents] = useState([]);
  const [error, setError]         = useState('');

  const monthKey = `${cursor.y}-${pad(cursor.m)}`;

  useEffect(() => {
    setError('');
    getCalendar(monthKey).then(setData).catch((e) => setError(e.message));

    const start = new Date(cursor.y, cursor.m - 1, 1).toISOString();
    const end   = new Date(cursor.y, cursor.m, 0, 23, 59, 59).toISOString();
    getTeamsStatus().then((s) => {
      if (s.connected) {
        getTeamsCalendar(start, end).then(setTeamsEvents).catch(() => setTeamsEvents([]));
      }
    }).catch(() => {});
  }, [monthKey, cursor.y, cursor.m]);

  const first      = new Date(cursor.y, cursor.m - 1, 1);
  const startDay   = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m, 0).getDate();

  // Merge local + teams events into byDay
  const byDay = {};
  if (data?.meetings) {
    for (const meet of data.meetings) {
      const d = new Date(meet.calendar_date);
      if (d.getFullYear() === cursor.y && d.getMonth() + 1 === cursor.m) {
        const day = d.getDate();
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push({ ...meet, source: 'local' });
      }
    }
  }
  for (const ev of teamsEvents) {
    const d = new Date(ev.start);
    if (d.getFullYear() === cursor.y && d.getMonth() + 1 === cursor.m) {
      const day = d.getDate();
      if (!byDay[day]) byDay[day] = [];
      const alreadyLocal = byDay[day].some((m) => m.source === 'local' && m.title === ev.subject);
      if (!alreadyLocal) {
        byDay[day].push({ id: `teams-${ev.id}`, title: ev.subject, efficiency_score: null, source: 'teams', teamsId: ev.id });
      }
    }
  }

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prev = () => cursor.m === 1 ? setCursor({ y: cursor.y - 1, m: 12 }) : setCursor({ y: cursor.y, m: cursor.m - 1 });
  const next = () => cursor.m === 12 ? setCursor({ y: cursor.y + 1, m: 1 }) : setCursor({ y: cursor.y, m: cursor.m + 1 });

  const today = now.getDate();
  const isCurrentMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth() + 1;

  return (
    <AppShell title="Calendar" subtitle="Meetings and analyses placed on your timeline">

      {/* Month nav */}
      <div className="card mb-5 flex items-center justify-between py-3 px-4">
        <button type="button" className="btn-ghost" onClick={prev}>←</button>
        <h2 className="text-base font-semibold text-white">
          {new Date(cursor.y, cursor.m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost" onClick={next}>→</button>
          <Link to="/meetings" className="btn-ghost text-xs ml-2 hidden md:inline-flex">All meetings</Link>
        </div>
      </div>

      {error && <p className="text-danger text-sm mb-4">{error}</p>}

      {/* Grid */}
      <div className="card overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-white/[0.06]">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2 text-center text-xs font-medium text-muted">{w}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 auto-rows-fr">
          {cells.map((d, i) => d == null ? (
            <div key={`e-${i}`} className="min-h-[80px] border-b border-r border-white/[0.04]" />
          ) : (
            <div key={d} className={`min-h-[80px] p-1.5 border-b border-r border-white/[0.04] ${isCurrentMonth && d === today ? 'bg-accent/5' : ''}`}>
              <div className={`text-xs font-medium mb-1 w-5 h-5 flex items-center justify-center rounded-full
                ${isCurrentMonth && d === today ? 'bg-accent text-white' : 'text-muted'}`}>
                {d}
              </div>
              <div className="space-y-0.5">
                {(byDay[d] || []).map((m) =>
                  m.source === 'teams' ? (
                    <div key={m.id} className="text-xs rounded px-1.5 py-0.5 truncate bg-indigo-500/20 text-indigo-300 border-l-2 border-indigo-400">
                      {m.title}
                    </div>
                  ) : (
                    <Link key={m.id} to={`/meeting/${m.id}`}
                      className="block text-xs rounded px-1.5 py-0.5 truncate bg-accent/10 text-accent hover:bg-accent/20 transition-colors border-l-2"
                      style={{ borderLeftColor: m.project_color || '#a78bfa' }}>
                      {m.title}
                      {m.efficiency_score != null && (
                        <span className="ml-1 opacity-60">{Math.round(m.efficiency_score * 100)}%</span>
                      )}
                    </Link>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-muted">
        <div className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-accent/70 inline-block" /> Local meeting</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-indigo-400/70 inline-block" /> Teams event</div>
      </div>
    </AppShell>
  );
}

export default CalendarPage;
