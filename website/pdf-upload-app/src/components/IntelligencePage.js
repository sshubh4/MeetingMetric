import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import AppShell from './AppShell';
import { searchMeetings } from '../api';

const EXAMPLE_QUERIES = ['decisions made', 'action items', 'blockers', 'budget', 'next steps'];

function IntelligencePage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);   // null = not searched yet
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const inputRef = useRef(null);

  const runSearch = async (q) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    setResults(null);
    setMessage('');
    setLastQuery(trimmed);
    try {
      const data = await searchMeetings(trimmed);
      setResults(data.results || []);
      setMessage(data.message || '');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    runSearch(query);
  };

  const handleChip = (s) => {
    setQuery(s);
    runSearch(s);
  };

  return (
    <AppShell title="Intelligence" subtitle="Semantic search across all meeting transcripts">
      <div style={{ maxWidth: 780 }}>

        {/* ── Search bar ── */}
        <div className="exec-card" style={{ marginBottom: '1.25rem' }}>
          <form onSubmit={handleSubmit} className="search-form">
            <input
              ref={inputRef}
              type="search"
              className="search-input"
              placeholder='Try "action items", "budget discussion", "Alice decision"…'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className="btn-primary compact"
              disabled={loading || !query.trim()}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
        </div>

        {error && <p className="error" style={{ marginBottom: '0.75rem' }}>{error}</p>}

        {/* ── Empty state (pre-search) ── */}
        {results === null && !loading && !error && (
          <div className="exec-card intel-empty">
            <div style={{ padding: '2.5rem 1rem' }}>
              <div style={{ fontSize: 44, marginBottom: '0.75rem' }}>🔍</div>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>Find anything across your meetings</h3>
              <p className="muted" style={{ maxWidth: 420, margin: '0 auto 1.25rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
                Results are ranked by semantic relevance — not just keyword matching.
                Ask in plain English and get back the most relevant transcript chunks.
              </p>
              <div className="intel-hint-chips">
                {EXAMPLE_QUERIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="btn-ghost small"
                    style={{ borderRadius: 999 }}
                    onClick={() => handleChip(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="muted small" style={{ marginTop: '1.75rem', lineHeight: 1.6 }}>
                Requires <code>USE_ML=1</code> (the default) on the backend so embeddings are
                generated when meetings are analyzed.{' '}
                <Link to="/analyze">Analyze a meeting</Link> to build the search index.
              </p>
            </div>
          </div>
        )}

        {/* ── Empty results / embeddings disabled ── */}
        {results !== null && results.length === 0 && (
          <div className="exec-card">
            {message ? (
              <>
                <p className="muted" style={{ margin: '0 0 0.5rem' }}>{message}</p>
                <p className="muted small" style={{ margin: 0 }}>
                  To enable semantic search, ensure the backend is started without{' '}
                  <code>USE_ML=0</code>, then{' '}
                  <Link to="/analyze">analyze a meeting</Link> to build the embedding index.
                </p>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No results for <strong style={{ color: '#e8eaed' }}>"{lastQuery}"</strong>.
                Try a different phrase.
              </p>
            )}
          </div>
        )}

        {/* ── Results ── */}
        {results !== null && results.length > 0 && (
          <>
            <p className="intel-results-count">
              {results.length} result{results.length !== 1 ? 's' : ''} for{' '}
              <strong style={{ color: '#e8eaed' }}>"{lastQuery}"</strong>
            </p>
            <ul className="search-results" style={{ padding: 0, margin: 0 }}>
              {results.map((r, i) => (
                <li
                  key={i}
                  style={{
                    padding: '1rem 1.25rem',
                    marginBottom: '0.5rem',
                    background: 'rgba(16,18,24,0.8)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 'var(--radius)',
                    listStyle: 'none',
                    transition: 'border-color 0.2s',
                  }}
                >
                  <div className="result-head">
                    <Link
                      to={`/meeting/${r.meeting_id}`}
                      style={{ fontWeight: 600, color: '#e8eaed', fontSize: '0.92rem' }}
                    >
                      {r.title}
                    </Link>
                    <span
                      className="score-pill"
                      style={{
                        background: 'rgba(124,58,237,0.15)',
                        color: '#a78bfa',
                        padding: '0.2rem 0.55rem',
                        borderRadius: 6,
                        fontWeight: 600,
                      }}
                    >
                      {(r.score * 100).toFixed(0)}% match
                    </span>
                  </div>
                  <p className="snippet" style={{ margin: '0.5rem 0 0.6rem', fontStyle: 'italic' }}>
                    "{r.text_snippet}"
                  </p>
                  <Link
                    to={`/meeting/${r.meeting_id}`}
                    style={{ fontSize: '0.8rem', color: 'var(--exec-muted)' }}
                  >
                    Open full meeting →
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default IntelligencePage;
