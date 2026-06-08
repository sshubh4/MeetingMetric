import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import AppShell from './AppShell';
import { searchMeetings } from '../api';

const EXAMPLE_QUERIES = ['decisions made', 'action items', 'blockers', 'budget', 'next steps'];

function IntelligencePage() {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState(null);
  const [message, setMessage]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
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

  const handleSubmit = (e) => { e.preventDefault(); runSearch(query); };
  const handleChip   = (s)  => { setQuery(s); runSearch(s); };

  return (
    <AppShell title="Intelligence" subtitle="Semantic search across all meeting transcripts">
      <div className="max-w-3xl">

        {/* Search bar */}
        <div className="card mb-5">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="search"
              className="input flex-1"
              placeholder='Try "action items", "budget discussion", "Alice decision"…'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn-primary" disabled={loading || !query.trim()}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
        </div>

        {error && <p className="text-danger text-sm mb-4">{error}</p>}

        {/* Empty state */}
        {results === null && !loading && !error && (
          <div className="card text-center py-12">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-base font-semibold text-white mb-2">Find anything across your meetings</h3>
            <p className="text-muted text-sm max-w-md mx-auto mb-6 leading-relaxed">
              Results are ranked by semantic relevance — not just keyword matching.
              Ask in plain English and get back the most relevant transcript chunks.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mb-6">
              {EXAMPLE_QUERIES.map((s) => (
                <button key={s} type="button"
                  className="px-3 py-1.5 rounded-full text-xs border border-white/10 text-muted hover:text-white hover:border-accent/40 transition-colors"
                  onClick={() => handleChip(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted leading-relaxed">
              Requires <code className="bg-white/5 px-1 rounded">USE_ML=1</code> on the backend.{' '}
              <Link to="/analyze" className="text-accent hover:underline">Analyze a meeting</Link> to build the index.
            </p>
          </div>
        )}

        {/* No results */}
        {results !== null && results.length === 0 && (
          <div className="card">
            {message ? (
              <div className="space-y-2">
                <p className="text-muted text-sm">{message}</p>
                <p className="text-xs text-muted">
                  Ensure the backend is running without <code className="bg-white/5 px-1 rounded">USE_ML=0</code>, then{' '}
                  <Link to="/analyze" className="text-accent hover:underline">analyze a meeting</Link> to build the embedding index.
                </p>
              </div>
            ) : (
              <p className="text-muted text-sm">
                No results for <strong className="text-slate-200">"{lastQuery}"</strong>. Try a different phrase.
              </p>
            )}
          </div>
        )}

        {/* Results */}
        {results !== null && results.length > 0 && (
          <>
            <p className="text-xs text-muted mb-3">
              {results.length} result{results.length !== 1 ? 's' : ''} for{' '}
              <strong className="text-slate-200">"{lastQuery}"</strong>
            </p>
            <div className="space-y-3">
              {results.map((r, i) => (
                <div key={i} className="card hover:border-white/10 transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <Link to={`/meeting/${r.meeting_id}`} className="font-semibold text-slate-200 text-sm hover:text-accent transition-colors">
                      {r.title}
                    </Link>
                    <span className="badge bg-accent-dim/20 text-accent flex-shrink-0">
                      {(r.score * 100).toFixed(0)}% match
                    </span>
                  </div>
                  <p className="text-sm text-muted italic leading-relaxed mb-3">"{r.text_snippet}"</p>
                  <Link to={`/meeting/${r.meeting_id}`} className="text-xs text-accent hover:underline">
                    Open full meeting →
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default IntelligencePage;
