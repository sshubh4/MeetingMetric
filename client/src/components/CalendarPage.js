import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from './AppShell';
import { getCalendar, getTeamsStatus, getTeamsCalendar } from '../api';

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function CalendarPage() {
  const now = new Date();
  const [cursor, setCursor] = useState({
    y: now.getFullYear(),
    m: now.getMonth() + 1,
  });
  const [data, setData] = useState(null);
  const [teamsEvents, setTeamsEvents] = useState([]);
  const [error, setError] = useState('');

  const monthKey = `${cursor.y}-${pad(cursor.m)}`;

  useEffect(() => {
    setError('');
    getCalendar(monthKey)
      .then(setData)
      .catch((e) => setError(e.message));

    const start = new Date(cursor.y, cursor.m - 1, 1).toISOString();
    const end = new Date(cursor.y, cursor.m, 0, 23, 59, 59).toISOString();
    getTeamsStatus().then((s) => {
      if (s.connected) {
        getTeamsCalendar(start, end).then(setTeamsEvents).catch(() => setTeamsEvents([]));
      }
    }).catch(() => {});
  }, [monthKey, cursor.y, cursor.m]);

  const first = new Date(cursor.y, cursor.m - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m, 0).getDate();

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
        byDay[day].push({
          id: `teams-${ev.id}`,
          title: ev.subject,
          efficiency_score: null,
          source: 'teams',
          isOnlineMeeting: ev.isOnlineMeeting,
          teamsId: ev.id,
        });
      }
    }
  }

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prev = () => {
    if (cursor.m === 1) setCursor({ y: cursor.y - 1, m: 12 });
    else setCursor({ y: cursor.y, m: cursor.m - 1 });
  };
  const next = () => {
    if (cursor.m === 12) setCursor({ y: cursor.y + 1, m: 1 });
    else setCursor({ y: cursor.y, m: cursor.m + 1 });
  };

  return (
    <AppShell
      title="Calendar"
      subtitle="Meetings and analyses placed on your timeline"
    >
      <div className="exec-card cal-toolbar">
        <button type="button" className="btn-ghost" onClick={prev}>
          ←
        </button>
        <h2 className="cal-title">
          {new Date(cursor.y, cursor.m - 1, 1).toLocaleString('default', {
            month: 'long',
            year: 'numeric',
          })}
        </h2>
        <button type="button" className="btn-ghost" onClick={next}>
          →
        </button>
        <Link to="/meetings" className="btn-ghost cal-cta">
          All meetings
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="exec-card cal-grid-wrap">
        <div className="cal-weekdays">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
            <div key={w} className="cal-wd">
              {w}
            </div>
          ))}
        </div>
        <div className="cal-cells">
          {cells.map((d, i) =>
            d == null ? (
              <div key={`e-${i}`} className="cal-cell cal-empty" />
            ) : (
              <div key={d} className="cal-cell">
                <div className="cal-day-num">{d}</div>
                <div className="cal-day-meets">
                  {(byDay[d] || []).map((m) =>
                    m.source === 'teams' ? (
                      <div
                        key={m.id}
                        className="cal-meet-pill cal-teams-pill"
                        style={{ borderLeftColor: '#6264a7' }}
                      >
                        <span className="cal-meet-title">{m.title}</span>
                        <span className="cal-meet-eff teams-badge">Teams</span>
                      </div>
                    ) : (
                      <Link
                        key={m.id}
                        to={`/meeting/${m.id}`}
                        className="cal-meet-pill"
                        style={{ borderLeftColor: m.project_color || '#a78bfa' }}
                      >
                        <span className="cal-meet-title">{m.title}</span>
                        <span className="cal-meet-eff">
                          {m.efficiency_score != null
                            ? `${Math.round(m.efficiency_score * 100)}`
                            : '—'}
                        </span>
                      </Link>
                    )
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </AppShell>
  );
}

export default CalendarPage;
