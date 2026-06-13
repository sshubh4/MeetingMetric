import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { getToken } from '../api';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const ASSET = process.env.PUBLIC_URL || '';

// ── Feature data ──────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>
      </svg>
    ),
    title: 'Engagement Scoring',
    desc: 'Five AI dimensions — engagement, sentiment, collaboration, initiative, clarity — scored per speaker.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
      </svg>
    ),
    title: 'Teams Auto-Sync',
    desc: 'Connect Microsoft Teams with one click. Every recorded meeting auto-imported via the Graph API.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
    title: 'AI Coaching',
    desc: 'Evidence-backed, actionable feedback for every participant — built from transcript analysis.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>
    ),
    title: 'Executive Dashboard',
    desc: 'Efficiency trends, triage alerts, and team health metrics — all in one clear view.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
    title: 'Semantic Search',
    desc: 'Ask natural-language questions across all your meetings. MiniLM embeddings power instant retrieval.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    title: 'Role-Based Access',
    desc: 'Employee, Manager, HR, and Admin views. Every data access decision enforced server-side.',
  },
];

// ── Typewriter: char-by-char instant reveal ───────────────────────────────────
function TypewriterLine({ text, startDelay = 0, charDelay = 0.04, className = '' }) {
  return (
    <span className={className} aria-label={text}>
      {text.split('').map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: startDelay + i * charDelay, duration: 0.001 }}
          aria-hidden="true"
        >
          {char === ' ' ? ' ' : char}
        </motion.span>
      ))}
    </span>
  );
}

// ── Product dashboard mockup ──────────────────────────────────────────────────
function ProductMock() {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-[#14110c]
                    overflow-hidden shadow-2xl shadow-black/60">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.08] bg-white/[0.02]">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
        <div className="flex-1 mx-4 h-5 rounded-md bg-white/5 flex items-center px-2">
          <span className="text-[10px] text-zinc-600">meetingmetric.app/dashboard</span>
        </div>
      </div>
      <div className="flex">
        <div className="hidden sm:flex flex-col gap-1.5 w-12 shrink-0 border-r border-white/[0.06] py-3 px-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`w-8 h-8 rounded-lg flex items-center justify-center
              ${i === 0 ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-white/[0.03]'}`}>
              <div className={`w-3.5 h-3.5 rounded ${i === 0 ? 'bg-amber-400/70' : 'bg-white/15'}`} />
            </div>
          ))}
        </div>
        <div className="flex-1 p-4 md:p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3.5">
            {[
              { l: 'Meetings', v: '24', d: '+12%' },
              { l: 'Efficiency', v: '78%', d: '+8%' },
              { l: 'Participation', v: '94%', d: '+3%' },
              { l: 'Participants', v: '47', d: '+15%' },
            ].map((k) => (
              <div key={k.l} className="bg-white/[0.04] rounded-xl p-3 border border-white/[0.06]">
                <div className="text-[11px] text-zinc-600 mb-1">{k.l}</div>
                <div className="text-xl font-bold text-white">{k.v}</div>
                <div className="text-[10px] text-emerald-400 mt-0.5">↑ {k.d}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] text-zinc-500">Efficiency trendline</span>
                <div className="flex gap-1">
                  {['7D', '30D', '90D'].map((t, i) => (
                    <span key={t} className={`text-[9px] px-2 py-0.5 rounded-full
                      ${i === 1 ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-600'}`}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="h-24 flex items-end gap-1">
                {[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88, 72, 92].map((h, i) => (
                  <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-amber-500/30 to-amber-400/70"
                       style={{ height: h * 0.9 + '%' }} />
                ))}
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
              <div className="text-[11px] text-zinc-500 mb-3">Top performers</div>
              {[
                { n: 'Sarah Chen', s: 94, c: 'bg-amber-400' },
                { n: 'Marcus Lee', s: 88, c: 'bg-orange-400' },
                { n: 'Aria Patel', s: 82, c: 'bg-yellow-400' },
              ].map((p) => (
                <div key={p.n} className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] text-white">
                    {p.n[0]}
                  </div>
                  <span className="text-[11px] text-zinc-300 flex-1 truncate">{p.n}</span>
                  <div className="w-12 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div className={`h-full ${p.c}`} style={{ width: p.s + '%' }} />
                  </div>
                  <span className="text-[10px] text-zinc-400 w-5 text-right">{p.s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
function LandingPage() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [howIn, setHowIn] = useState(false);
  const howInRef = useRef(false);

  useEffect(() => {
    if (getToken()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  // Headline timing
  const LINE1_DONE  = 0.15 + 20 * 0.034;
  const LINE2_START = LINE1_DONE + 0.04;
  const LINE2_DUR   = 0.38;
  const AFTER_HEAD  = LINE2_START + LINE2_DUR + 0.1;

  // Shatter tile grid (7 × 5)
  const COLS = 7, ROWS = 5;
  const TILES = useMemo(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const arr = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        arr.push({
          r, c,
          dx: (Math.random() * 2 - 1) * vw * 0.65,
          dy: (Math.random() * 2 - 1) * vh * 0.6 - vh * 0.1,
          rot: (Math.random() * 2 - 1) * 160,
        });
      }
    }
    return arr;
  }, []);

  // Lenis ↔ ScrollTrigger sync + reliable "how it works" reveal trigger
  useEffect(() => {
    const lenis = window.__lenis;
    const checkHow = () => {
      if (howInRef.current) return;
      const el = document.querySelector('.how-section');
      if (!el) return;
      if (el.getBoundingClientRect().top < window.innerHeight * 0.82) {
        howInRef.current = true;
        setHowIn(true);
      }
    };
    const onScroll = () => { ScrollTrigger.update(); checkHow(); };
    if (lenis) lenis.on('scroll', onScroll);
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('load', refresh);
    const t = setTimeout(refresh, 900);
    checkHow();
    return () => {
      if (lenis) lenis.off('scroll', onScroll);
      window.removeEventListener('load', refresh);
      clearTimeout(t);
    };
  }, []);

  // GSAP cinematic — one big pinned stage: shatter → reveal → spin + pan
  useGSAP(() => {
    const tiles = gsap.utils.toArray('.shatter-tile');
    const stage = gsap.timeline({
      scrollTrigger: {
        trigger: '.stage', start: 'top top', end: '+=380%',
        scrub: 1, pin: true, anticipatePin: 1,
      },
    });

    // ── PHASE 1: hero clears + the mountain shatters into frames (0 → 0.42) ──
    stage.to('.stage-hero', { opacity: 0, yPercent: -12, duration: 0.16, ease: 'none' }, 0);
    stage.to('.stage-overlay', { opacity: 0, duration: 0.16, ease: 'none' }, 0);
    stage.to(tiles, {
      x: (i) => TILES[i].dx,
      y: (i) => TILES[i].dy,
      rotation: (i) => TILES[i].rot,
      scale: 0.15, opacity: 0, ease: 'power2.in',
      duration: 0.3,
      stagger: { amount: 0.12, from: 'center', grid: [ROWS, COLS] },
    }, 0.04);                                            // last tile gone ≈ 0.46

    // ── PHASE 2: product reveals fully, then HOLDS (0.4 → 0.7) ──────────────
    stage.fromTo('.stage-product',
      { opacity: 0, scale: 0.86 },
      { opacity: 1, scale: 1, duration: 0.2, ease: 'power2.out' }, 0.42);
    // (gap 0.62 → 0.72 = the rest beat — scrub dwells on the product here)

    // ── PHASE 3: product 180° spin & exit left, view pans right (0.72 → 1) ──
    stage.to('.stage-track', { xPercent: -50, duration: 0.28, ease: 'none' }, 0.72);
    stage.to('.stage-product', { rotationY: 180, duration: 0.28, ease: 'none' }, 0.72);
  }, { scope: containerRef, dependencies: [] });

  return (
    <div
      ref={containerRef}
      className="noise-bg min-h-screen text-slate-200 font-sans overflow-x-hidden bg-[#0c0a07]"
      style={{ position: 'relative', zIndex: 2 }}
    >
      {/* ── Floating cylindrical pill navbar ───────────────────────────────── */}
      <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
        <motion.div
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-1 pl-2.5 pr-2 py-1.5 rounded-full
                     border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-lg shadow-black/40"
        >
          <Link to="/" className="flex items-center gap-2 pr-2">
            <div className="w-6 h-6 rounded-full bg-amber-500/25 border border-amber-400/40
                            flex items-center justify-center">
              <span className="text-amber-300 font-bold text-[11px]">M</span>
            </div>
            <span className="font-semibold text-white text-sm hidden sm:inline">MeetingMetric</span>
          </Link>
          <div className="hidden md:flex items-center gap-1 px-1">
            {['Features', 'How it works'].map((item) => (
              <a key={item} href={'#' + item.toLowerCase().replace(/ /g, '-')}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-full hover:bg-white/5 transition-colors">
                {item}
              </a>
            ))}
          </div>
          <Link to="/register"
            className="ml-1 px-4 py-1.5 text-xs bg-amber-400 text-black rounded-full font-semibold
                       hover:bg-amber-300 transition-colors">
            Get started
          </Link>
        </motion.div>
      </nav>

      {/* ══ STAGE — hero → shatter → product → spin + pan to features ════════ */}
      <section id="features" className="stage relative h-screen w-full overflow-hidden">

        {/* z0: horizontal track — panel 1 (product) + panel 2 (features) */}
        <div className="stage-track absolute inset-0 z-0 flex" style={{ width: '200vw' }}>

          {/* Panel 1 — the product */}
          <div className="relative w-screen h-screen flex flex-col items-center justify-center px-6"
               style={{ perspective: '1400px' }}>
            <p className="text-xs text-amber-400 uppercase tracking-[0.25em] mb-2 text-center">The product</p>
            <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-6 text-center">
              Your meetings, fully instrumented
            </h2>
            <div className="stage-product relative w-full max-w-3xl" style={{ transformStyle: 'preserve-3d' }}>
              <div className="absolute -inset-4 bg-amber-500/20 blur-[70px] rounded-[2rem] pointer-events-none" />
              <ProductMock />
            </div>
          </div>

          {/* Panel 2 — features */}
          <div className="relative w-screen h-screen flex items-center justify-center px-6">
            <div className="w-full max-w-5xl">
              <div className="text-center mb-10">
                <p className="text-xs text-amber-400 uppercase tracking-[0.22em] mb-3">Features</p>
                <h2 className="font-heading text-3xl md:text-4xl font-bold text-white tracking-tight">
                  Everything your team needs
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {FEATURES.map((f) => (
                  <div key={f.title}
                    className="p-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] cursor-default
                               hover:border-amber-500/30 hover:bg-amber-500/5 transition-colors duration-300 group">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20
                                    flex items-center justify-center mb-4 text-amber-400
                                    group-hover:bg-amber-500/25 transition-colors">
                      {f.icon}
                    </div>
                    <h3 className="text-sm font-semibold text-white mb-1.5">{f.title}</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* z10: the mountain, built from frames that shatter */}
        <div className="absolute inset-0 z-10">
          {TILES.map((t, i) => (
            <div
              key={i}
              className="shatter-tile"
              style={{
                position: 'absolute',
                width: `${100 / COLS}%`,
                height: `${100 / ROWS}%`,
                left: `${(t.c * 100) / COLS}%`,
                top: `${(t.r * 100) / ROWS}%`,
                backgroundImage: `url(${ASSET}/warm1.jpg)`,
                backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
                backgroundPosition: `${(t.c * 100) / (COLS - 1)}% ${(t.r * 100) / (ROWS - 1)}%`,
                willChange: 'transform, opacity',
                boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.25)',
              }}
            />
          ))}
        </div>

        {/* z15: legibility overlay over the mountain (fades as it shatters) */}
        <div className="stage-overlay absolute inset-0 z-[15] pointer-events-none"
             style={{ background: 'linear-gradient(180deg, rgba(12,10,7,0.55) 0%, rgba(12,10,7,0.28) 40%, rgba(12,10,7,0.82) 82%, #0c0a07 100%)' }} />

        {/* z20: hero content overlay */}
        <div className="stage-hero absolute inset-0 z-20 flex flex-col items-center justify-center text-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.4 }}
            className="mb-6 inline-flex items-center gap-2 px-3 py-1 rounded-full
                       border border-white/15 bg-white/5 backdrop-blur-md text-xs text-amber-200"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Now with Microsoft Teams auto-ingestion
          </motion.div>

          <h1 className="font-heading font-bold text-white tracking-tight leading-[1.05] mb-6
                         text-[clamp(2.6rem,7vw,5rem)] drop-shadow-[0_2px_30px_rgba(0,0,0,0.55)]">
            <span className="block">
              <TypewriterLine text="Meeting intelligence" startDelay={0.15} charDelay={0.034} />
              <motion.span
                aria-hidden="true"
                initial={{ opacity: 1 }}
                animate={{ opacity: [1, 0, 1, 0, 1, 0, 1, 0, 0] }}
                transition={{ delay: 0.15, duration: AFTER_HEAD, times: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.85, 0.95, 1] }}
                className="inline-block w-[3px] h-[0.72em] bg-white/80 ml-1 align-middle"
              />
            </span>
            <motion.span
              initial={{ clipPath: 'inset(0 100% 0 0)' }}
              animate={{ clipPath: 'inset(0 0% 0 0)' }}
              transition={{ duration: LINE2_DUR, ease: 'linear', delay: LINE2_START }}
              className="inline-block text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-orange-400"
            >
              that works.
            </motion.span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: AFTER_HEAD, duration: 0.5 }}
            className="text-base md:text-lg text-zinc-200 max-w-lg mb-9 leading-relaxed
                       drop-shadow-[0_1px_12px_rgba(0,0,0,0.7)]"
          >
            AI-powered engagement scoring, sentiment analysis, and coaching
            for every participant. Automatically.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: AFTER_HEAD + 0.18, duration: 0.45 }}
            className="flex items-center gap-3"
          >
            <Link to="/register"
              className="px-7 py-3 bg-amber-400 text-black text-sm font-semibold rounded-full
                         hover:bg-amber-300 transition-all hover:scale-105 active:scale-95 shadow-xl shadow-amber-900/30">
              Get started free
            </Link>
            <Link to="/login"
              className="px-7 py-3 border border-white/25 text-white text-sm rounded-full
                         backdrop-blur-md bg-white/5 hover:bg-white/10 transition-all">
              Sign in →
            </Link>
          </motion.div>

          {/* scroll cue */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-300">Scroll</span>
            <div className="w-5 h-8 rounded-full border border-white/25 flex justify-center pt-1.5">
              <motion.div
                animate={{ y: [0, 7, 0], opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                className="w-1 h-1.5 rounded-full bg-white/70"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══ HOW IT WORKS — fade + type-in, with Get started merged in ════════ */}
      <section id="how-it-works" className="how-section relative z-10 py-28 px-6 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto min-h-[420px]">
          {howIn && (
            <>
              <div className="reveal-rise text-center mb-14">
                <p className="text-xs text-amber-400 uppercase tracking-[0.22em] mb-3">Get started in minutes</p>
                <h2 className="font-heading text-3xl md:text-4xl font-bold text-white tracking-tight">
                  <TypewriterLine text="How it works" startDelay={0.15} charDelay={0.055} />
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative mb-20">
                <div className="hidden md:block absolute top-6 left-[16.67%] right-[16.67%] h-px
                                bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
                {[
                  { step: '01', title: 'Connect Teams', desc: 'Link your Microsoft Teams account in one click. We handle the OAuth flow.' },
                  { step: '02', title: 'Meetings auto-sync', desc: 'Every recorded meeting is automatically ingested via the Graph API. No uploads.' },
                  { step: '03', title: 'Get insights', desc: 'AI scores every participant. Managers see team health. Employees see coaching.' },
                ].map((s, i) => (
                  <div key={s.step} style={{ animationDelay: `${0.3 + i * 0.12}s` }} className="reveal-rise text-center">
                    <div className="w-12 h-12 rounded-full border border-amber-500/30 bg-amber-500/10
                                    flex items-center justify-center mx-auto mb-4 text-sm font-bold text-amber-400">
                      {s.step}
                    </div>
                    <h3 className="text-sm font-semibold text-white mb-2">{s.title}</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>

              {/* merged Get started block (no separate pricing) */}
              <div style={{ animationDelay: '0.7s' }}
                className="reveal-rise max-w-2xl mx-auto p-12 rounded-3xl border border-white/[0.08]
                           bg-white/[0.03] relative overflow-hidden text-center">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/15 via-transparent to-orange-500/15 pointer-events-none" />
                <div className="relative">
                  <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 tracking-tight">
                    Ready to get started?
                  </h3>
                  <p className="text-zinc-400 mb-7 text-sm">Free to try. No credit card required.</p>
                  <Link to="/register"
                    className="inline-flex px-8 py-3 bg-amber-400 text-black text-sm font-semibold
                               rounded-full hover:bg-amber-300 transition-all hover:scale-105 active:scale-95">
                    Start for free →
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/[0.06] py-8 px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-zinc-600">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/30
                            flex items-center justify-center">
              <span className="text-amber-400 font-bold" style={{ fontSize: 9 }}>M</span>
            </div>
            <span className="font-medium text-zinc-500">MeetingMetric</span>
          </div>
          <span>© {new Date().getFullYear()} · AI Meeting Intelligence</span>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
