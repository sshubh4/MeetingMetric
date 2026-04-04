import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getToken } from '../api';

function LandingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (getToken()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  return (
    <div className="landing">
      {/* Animated abstract background */}
      <div className="landing-bg" aria-hidden>
        <div className="swirl swirl-1" />
        <div className="swirl swirl-2" />
        <div className="swirl swirl-3" />
        <div className="glow glow-1" />
        <div className="glow glow-2" />
      </div>

      {/* Nav */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="landing-logo brand-text">
            <span className="brand-meeting">Meeting</span><span className="brand-metric">Metric</span>
          </Link>
          <nav className="landing-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#stack">Tech</a>
          </nav>
          <Link to="/login" className="landing-signin">Sign In</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-hero">
        <h1 className="landing-headline">
          Meeting<br />Intelligence.
        </h1>
        <p className="landing-sub">
          Transform meeting transcripts into actionable insights. AI-powered engagement
          scoring, sentiment analysis, and coaching for every participant.
        </p>
        <div className="landing-ctas">
          <Link to="/register" className="landing-btn-primary">Get Started Free</Link>
          <a href="#features" className="landing-btn-ghost">See More</a>
        </div>
      </section>

      {/* Features */}
      <section className="landing-section" id="features">
        <h2 className="landing-section-title">Why MeetingMetric?</h2>
        <div className="landing-features-grid">
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
            </div>
            <h3>Engagement Scoring</h3>
            <p>Five AI dimensions — engagement, sentiment, collaboration, initiative, clarity — scored 0-1 per speaker.</p>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </div>
            <h3>Executive Dashboard</h3>
            <p>Efficiency trends, alerts, calendar view, and project-based organization in a single pane of glass.</p>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h3>AI Coaching</h3>
            <p>Evidence-backed, actionable feedback for every participant — built from transcript analysis, not opinions.</p>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            </div>
            <h3>Teams Integration</h3>
            <p>Connect Microsoft Teams with one click. Import transcripts directly from your meetings via Graph API.</p>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <h3>Semantic Search</h3>
            <p>Ask natural-language questions across all your meetings. MiniLM embeddings power instant retrieval.</p>
          </div>
          <div className="landing-feature">
            <div className="landing-feature-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <h3>Privacy First</h3>
            <p>Explainable AI with role-based access. No hidden models — every score is traceable to transcript evidence.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="landing-section" id="how">
        <h2 className="landing-section-title">How it works</h2>
        <div className="landing-steps">
          <div className="landing-step">
            <div className="step-num">01</div>
            <h3>Upload or Connect</h3>
            <p>Paste a transcript, upload a PDF, or import directly from Microsoft Teams.</p>
          </div>
          <div className="landing-step-arrow" aria-hidden>&#8594;</div>
          <div className="landing-step">
            <div className="step-num">02</div>
            <h3>AI Analysis</h3>
            <p>Our pipeline segments speakers, scores five dimensions, and generates coaching insights.</p>
          </div>
          <div className="landing-step-arrow" aria-hidden>&#8594;</div>
          <div className="landing-step">
            <div className="step-num">03</div>
            <h3>Actionable Results</h3>
            <p>View participant scorecards, efficiency gauges, radar charts, and trends over time.</p>
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="landing-section" id="stack">
        <h2 className="landing-section-title">Built with</h2>
        <div className="landing-tech-row">
          {['React', 'Node.js', 'Express', 'SQLite', 'Transformers.js', 'Microsoft Graph', 'Recharts', 'MSAL'].map(t => (
            <span key={t} className="tech-chip">{t}</span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="landing-section landing-cta-section">
        <h2>Ready to measure what matters?</h2>
        <p className="landing-sub" style={{ margin: '1rem auto 2rem', maxWidth: 500 }}>
          Create a free account and start analyzing your first meeting in minutes.
        </p>
        <Link to="/register" className="landing-btn-primary">Create Account</Link>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <span>&copy; {new Date().getFullYear()} MeetingMetric</span>
        <span className="landing-footer-sep">&middot;</span>
        <span>AI Meeting Intelligence for HR</span>
      </footer>
    </div>
  );
}

export default LandingPage;
