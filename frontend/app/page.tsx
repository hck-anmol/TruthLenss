'use client';
import { useState, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { CredibilityScorecard } from '@/lib/types';

const NetworkCanvas = dynamic(() => import('@/components/NetworkCanvas'), { ssr: false });
const ScorecardModal = dynamic(() => import('@/components/ScorecardModal'), { ssr: false });

// ── Inline mini progress spinner ───────────────────────────────────────────────
function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.9s linear infinite' }}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  );
}

// ── Verdict badge color ────────────────────────────────────────────────────────
function verdictStyle(verdict: string) {
  if (verdict === 'FAKE') return { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' };
  if (verdict === 'LIKELY FAKE') return { bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' };
  return { bg: '#F0FDF4', color: '#166534', border: '#BBF7D0' };
}

// ── Deepfake Upload Panel (used for both image and video) ──────────────────────

function DeepfakePanelImage() {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<CredibilityScorecard | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const analyze = async () => {
    if (!file) return;
    setStage('loading'); setError('');
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/deepfake', { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `Error ${res.status}`);
      }
      setResult(await res.json());
      setStage('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStage('error');
    }
  };

  const reset = () => { setFile(null); setStage('idle'); setResult(null); setError(''); };

  const ia = result?.image_analysis;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      {stage === 'idle' && (
        <>
          <div
            id="img-drop-zone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) setFile(f); }}
            style={{
              border: `2px dashed ${file ? '#1B3A6B' : '#D4D0C8'}`,
              borderRadius: '10px', padding: '36px 20px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
              cursor: 'pointer', background: file ? '#EEF2FA' : '#FAFAFA', transition: 'all 0.2s',
            }}
          >
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: file ? '#1B3A6B' : '#EEF2FA', display: 'flex', alignItems: 'center', justifyContent: 'center', color: file ? '#fff' : '#1B3A6B' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              {file ? (
                <>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: '#1B3A6B' }}>{file.name}</p>
                  <p style={{ fontSize: '11px', color: '#71717A', marginTop: '3px' }}>{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: '13px', fontWeight: 500, color: '#18181B' }}>Drop image or click to upload</p>
                  <p style={{ fontSize: '11px', color: '#A1A1AA', marginTop: '3px' }}>PNG, JPG, WEBP</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <button
            onClick={analyze} disabled={!file}
            style={{
              padding: '13px', fontSize: '13px', fontWeight: 600, color: '#FFFFFF',
              background: file ? '#1B3A6B' : '#94A3B8', border: 'none', borderRadius: '9px',
              cursor: file ? 'pointer' : 'not-allowed', opacity: file ? 1 : 0.55, transition: 'all 0.2s',
            }}
          >
            Detect Image Deepfake
          </button>
        </>
      )}

      {stage === 'loading' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '40px 20px' }}>
          <Spinner />
          <p style={{ fontSize: '13px', color: '#71717A', textAlign: 'center' }}>Running deepfake detection…<br/><span style={{ fontSize: '11px', color: '#A1A1AA' }}>Model: Xception + GradCAM heatmap</span></p>
        </div>
      )}

      {stage === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {ia ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#F8F7F4', borderRadius: '10px', border: '1px solid #E8E5DE' }}>
                <div>
                  <p style={{ fontSize: '11px', color: '#A1A1AA', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Authenticity Score</p>
                  <p style={{ fontSize: '28px', fontWeight: 700, color: '#18181B', lineHeight: 1.1 }}>{ia.image_authenticity_score}<span style={{ fontSize: '14px', color: '#71717A' }}>/100</span></p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '11px', color: '#A1A1AA', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Images Analyzed</p>
                  <p style={{ fontSize: '24px', fontWeight: 700, color: '#18181B' }}>{ia.total_images_analyzed}</p>
                </div>
              </div>

              {ia.results.slice(0, 3).map((r, i) => {
                const vs = verdictStyle(r.verdict);
                return (
                  <div key={i} style={{ padding: '12px 14px', background: '#FFFFFF', border: '1px solid #E8E5DE', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '12px', color: '#71717A', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Image {i + 1}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#18181B' }}>{(r.fake_probability * 100).toFixed(1)}% fake probability</span>
                      </div>
                    </div>
                    <span style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 700, background: vs.bg, color: vs.color, border: `1px solid ${vs.border}`, borderRadius: '20px', flexShrink: 0 }}>
                      {r.verdict}
                    </span>
                  </div>
                );
              })}
            </>
          ) : (
            <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px' }}>
              <p style={{ fontSize: '13px', color: '#991B1B', fontWeight: 600, marginBottom: '4px' }}>Analysis Unavailable</p>
              <p style={{ fontSize: '12px', color: '#7F1D1D' }}>Deepfake model could not be loaded or analysis failed.</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setShowModal(true)} disabled={!result} style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600, color: '#FFFFFF', background: '#1B3A6B', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
              View Report
            </button>
            <button onClick={reset} style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: 500, color: '#52525B', background: 'transparent', border: '1px solid #D4D0C8', borderRadius: '8px', cursor: 'pointer' }}>
              Analyze Another
            </button>
          </div>
        </div>
      )}

      {stage === 'error' && (
        <div style={{ textAlign: 'center', padding: '24px' }}>
          <p style={{ fontSize: '13px', color: '#991B1B', marginBottom: '12px' }}>{error}</p>
          <button onClick={reset} style={{ padding: '9px 20px', fontSize: '12px', fontWeight: 500, color: '#FFFFFF', background: '#1B3A6B', border: 'none', borderRadius: '7px', cursor: 'pointer' }}>
            Try Again
          </button>
        </div>
      )}

      {showModal && result && <ScorecardModal sc={result} onClose={() => setShowModal(false)} />}
    </div>
  );
}

function DeepfakePanelVideo() {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<CredibilityScorecard | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analyze = async () => {
    if (!file) return;
    setStage('loading'); setError(''); setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    try {
      const form = new FormData();
      form.append('video', file);
      const res = await fetch('/api/deepfake', { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `Error ${res.status}`);
      }
      setResult(await res.json());
      setStage('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStage('error');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const reset = () => { setFile(null); setStage('idle'); setResult(null); setError(''); setElapsed(0); };

  const va = result?.video_analysis;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      {stage === 'idle' && (
        <>
          <div
            id="vid-drop-zone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('video/')) setFile(f); }}
            style={{
              border: `2px dashed ${file ? '#1B3A6B' : '#D4D0C8'}`,
              borderRadius: '10px', padding: '36px 20px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
              cursor: 'pointer', background: file ? '#EEF2FA' : '#FAFAFA', transition: 'all 0.2s',
            }}
          >
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: file ? '#1B3A6B' : '#EEF2FA', display: 'flex', alignItems: 'center', justifyContent: 'center', color: file ? '#fff' : '#1B3A6B' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              {file ? (
                <>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: '#1B3A6B' }}>{file.name}</p>
                  <p style={{ fontSize: '11px', color: '#71717A', marginTop: '3px' }}>{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: '13px', fontWeight: 500, color: '#18181B' }}>Drop video or click to upload</p>
                  <p style={{ fontSize: '11px', color: '#A1A1AA', marginTop: '3px' }}>MP4, WEBM, MOV — up to 200 MB</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div style={{ padding: '12px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px' }}>
            <p style={{ fontSize: '11px', color: '#92400E', lineHeight: 1.5 }}>
              <strong>How it works:</strong> Sampled at 3 fps. On detecting an anomaly (&gt;70% fake probability), switches to 5 fps for ±2 seconds around the detection point.
            </p>
          </div>
          <button
            onClick={analyze} disabled={!file}
            style={{
              padding: '13px', fontSize: '13px', fontWeight: 600, color: '#FFFFFF',
              background: file ? '#1B3A6B' : '#94A3B8', border: 'none', borderRadius: '9px',
              cursor: file ? 'pointer' : 'not-allowed', opacity: file ? 1 : 0.55, transition: 'all 0.2s',
            }}
          >
            Analyze Video Frame-by-Frame
          </button>
        </>
      )}

      {stage === 'loading' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '40px 20px' }}>
          <Spinner />
          <p style={{ fontSize: '13px', color: '#71717A', textAlign: 'center' }}>
            Analyzing frames… <strong style={{ color: '#18181B' }}>{fmt(elapsed)}</strong>
            <br/><span style={{ fontSize: '11px', color: '#A1A1AA' }}>3 fps normal · 5 fps burst on anomalies · up to 10 min cap</span>
          </p>
          <p style={{ fontSize: '11px', color: '#A1A1AA', textAlign: 'center', maxWidth: '200px' }}>
            Keep this tab open. Large videos can take 15–30 minutes on CPU.
          </p>
        </div>
      )}

      {stage === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {va ? (
            <>
              {/* Summary row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                {[
                  { label: 'Score', value: `${va.video_authenticity_score}/100` },
                  { label: 'Frames', value: String(va.total_frames_analyzed) },
                  { label: 'Duration', value: `${va.duration_seconds.toFixed(1)}s` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ padding: '12px', background: '#F8F7F4', borderRadius: '8px', border: '1px solid #E8E5DE', textAlign: 'center' }}>
                    <p style={{ fontSize: '10px', color: '#A1A1AA', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>{label}</p>
                    <p style={{ fontSize: '16px', fontWeight: 700, color: '#18181B' }}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Verdict */}
              {(() => { const vs = verdictStyle(va.verdict); return (
                <div style={{ padding: '14px 16px', background: vs.bg, border: `1px solid ${vs.border}`, borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: vs.color }}>Overall Verdict</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: vs.color }}>{va.verdict}</span>
                </div>
              ); })()}

              {/* Anomaly seconds */}
              {va.anomaly_seconds.length > 0 && (
                <div style={{ padding: '12px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '9px' }}>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#C2410C', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Anomaly detected at seconds:
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {va.anomaly_seconds.slice(0, 12).map((s) => (
                      <span key={s} style={{ padding: '2px 8px', background: '#FFEDD5', color: '#C2410C', borderRadius: '4px', fontSize: '11px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {s}s
                      </span>
                    ))}
                    {va.anomaly_seconds.length > 12 && <span style={{ fontSize: '11px', color: '#A1A1AA' }}>+{va.anomaly_seconds.length - 12} more</span>}
                  </div>
                </div>
              )}

              {/* Top suspicious frames */}
              {va.frame_results.length > 0 && (
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>Top Suspicious Frames</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {[...va.frame_results]
                      .sort((a, b) => b.fake_probability - a.fake_probability)
                      .slice(0, 4)
                      .map((fr, i) => {
                        const vs = verdictStyle(fr.fake_probability > 0.7 ? 'LIKELY FAKE' : 'REAL');
                        return (
                          <div key={i} style={{ padding: '8px 12px', background: '#FFFFFF', border: '1px solid #E8E5DE', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span style={{ color: '#71717A' }}>Second <strong style={{ color: '#18181B' }}>{fr.second}s</strong></span>
                            <span style={{ color: vs.color, fontWeight: 700 }}>{(fr.fake_probability * 100).toFixed(1)}%</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px' }}>
              <p style={{ fontSize: '13px', color: '#991B1B', fontWeight: 600, marginBottom: '4px' }}>Analysis Unavailable</p>
              <p style={{ fontSize: '12px', color: '#7F1D1D' }}>Video deepfake model could not be loaded or analysis failed.</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setShowModal(true)} disabled={!result} style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600, color: '#FFFFFF', background: '#1B3A6B', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
              View Report
            </button>
            <button onClick={reset} style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: 500, color: '#52525B', background: 'transparent', border: '1px solid #D4D0C8', borderRadius: '8px', cursor: 'pointer' }}>
              Analyze Another
            </button>
          </div>
        </div>
      )}

      {stage === 'error' && (
        <div style={{ textAlign: 'center', padding: '24px' }}>
          <p style={{ fontSize: '13px', color: '#991B1B', marginBottom: '12px', lineHeight: 1.5 }}>{error}</p>
          <button onClick={reset} style={{ padding: '9px 20px', fontSize: '12px', fontWeight: 500, color: '#FFFFFF', background: '#1B3A6B', border: 'none', borderRadius: '7px', cursor: 'pointer' }}>
            Try Again
          </button>
        </div>
      )}

      {showModal && result && <ScorecardModal sc={result} onClose={() => setShowModal(false)} />}
    </div>
  );
}

// ── Main Landing Page ──────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .fade-up { animation: fadeUp 0.5s ease both; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        .fade-up-d1 { animation: fadeUp 0.5s 0.1s ease both; }
        .fade-up-d2 { animation: fadeUp 0.5s 0.2s ease both; }
        .fade-up-d3 { animation: fadeUp 0.5s 0.3s ease both; }
        .serif { font-family: 'Playfair Display', Georgia, serif; }
      `}</style>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,247,244,0.88)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid #E8E5DE',
        padding: '0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: '60px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: '#1B3A6B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
          </div>
          <span style={{ fontFamily: 'Playfair Display, serif', fontWeight: 700, fontSize: '18px', color: '#18181B', letterSpacing: '-0.02em' }}>
            TruthLens
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <a href="#how"      style={{ fontSize: '13px', color: '#71717A', textDecoration: 'none' }}>How it works</a>
          <a href="#features" style={{ fontSize: '13px', color: '#71717A', textDecoration: 'none' }}>Features</a>
          <a href="#deepfake" style={{ fontSize: '13px', color: '#71717A', textDecoration: 'none' }}>Deepfake Detection</a>
          <a href="https://github.com/TruthLens" target="_blank" rel="noreferrer" style={{ fontSize: '13px', color: '#71717A', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Extension
          </a>
          <Link href="/analyze" style={{
            fontSize: '13px', fontWeight: 500, color: '#FFFFFF',
            background: '#1B3A6B', padding: '7px 18px', borderRadius: '8px',
            textDecoration: 'none', letterSpacing: '-0.01em',
          }}>
            Analyze Article
          </Link>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '96px 24px 80px', background: '#F8F7F4', overflow: 'hidden', minHeight: '560px' }}>
        <NetworkCanvas />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: '620px', textAlign: 'center' }}>
          <p className="fade-up" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#1B3A6B', marginBottom: '20px' }}>
            Multi-Modal Disinformation Detection
          </p>
          <h1 className="fade-up-d1 serif" style={{ fontSize: 'clamp(52px,8vw,80px)', fontWeight: 700, color: '#18181B', lineHeight: 1.05, letterSpacing: '-0.03em', marginBottom: '20px' }}>
            TruthLens
          </h1>
          <p className="fade-up-d2" style={{ fontSize: '16px', color: '#52525B', lineHeight: 1.7, marginBottom: '36px', maxWidth: '480px', margin: '0 auto 36px' }}>
            Verify any article against 50+ live sources. Detect deepfakes in images and videos. Get an explainable credibility scorecard in minutes.
          </p>
          <div className="fade-up-d3" style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/analyze" style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '12px 28px', background: '#1B3A6B', color: '#FFFFFF',
              borderRadius: '10px', fontSize: '14px', fontWeight: 500,
              textDecoration: 'none', letterSpacing: '-0.01em',
            }}>
              Analyze an Article
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </Link>
            <a href="#deepfake" style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '12px 24px', border: '1px solid #D4D0C8', color: '#52525B',
              borderRadius: '10px', fontSize: '14px', fontWeight: 500,
              textDecoration: 'none', background: '#FFFFFF',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              Deepfake Detection
            </a>
          </div>
        </div>
      </section>

      {/* ── Capability strip ───────────────────────────────────────────────── */}
      <div style={{ background: '#F2F0EC', borderTop: '1px solid #E8E5DE', borderBottom: '1px solid #E8E5DE', padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '32px', flexWrap: 'wrap' }}>
        {[
          ['NLP Classification', 'Fact & claim extraction'],
          ['Image Deepfakes', 'Xception + GradCAM'],
          ['Video Analysis', '3 fps + adaptive burst'],
          ['Live Verification', 'Tavily web search'],
        ].map(([t, s]) => (
          <div key={t} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#18181B' }}>{t}</div>
            <div style={{ fontSize: '11px', color: '#A1A1AA', marginTop: '1px' }}>{s}</div>
          </div>
        ))}
      </div>

      {/* ── How It Works ───────────────────────────────────────────────────── */}
      <section id="how" style={{ background: '#FFFFFF', padding: '80px 24px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <h2 className="serif" style={{ fontSize: '36px', fontWeight: 700, color: '#18181B', marginBottom: '12px', letterSpacing: '-0.02em' }}>
              How it works
            </h2>
            <p style={{ fontSize: '15px', color: '#71717A', maxWidth: '400px', margin: '0 auto' }}>
              A four-stage AI pipeline that goes from raw URL to verified credibility score.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '2px' }}>
            {[
              { n: '01', t: 'Paste URL or Text',   d: 'Drop in any article link, or paste the full article text directly.' },
              { n: '02', t: 'AI Extraction',       d: 'Ollama qwen3:8b identifies context, separates relevant from irrelevant facts, and detects bias.' },
              { n: '03', t: 'Web Verification',    d: 'Tavily searches 50+ live news sources and scores corroboration from Tier-1 outlets.' },
              { n: '04', t: 'Credibility Scorecard', d: 'A weighted five-dimension score with red flags, positive signals, and PDF download.' },
            ].map(({ n, t, d }) => (
              <div key={n} style={{ padding: '28px 24px', background: '#F8F7F4', borderRadius: '2px' }}>
                <div style={{ fontFamily: 'Playfair Display, serif', fontSize: '28px', fontWeight: 700, color: '#E8E5DE', marginBottom: '10px', lineHeight: 1 }}>{n}</div>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181B', marginBottom: '8px' }}>{t}</h3>
                <p style={{ fontSize: '13px', color: '#71717A', lineHeight: 1.6 }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" style={{ background: '#F8F7F4', padding: '80px 24px', borderTop: '1px solid #E8E5DE' }}>
        <div style={{ maxWidth: '820px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <h2 className="serif" style={{ fontSize: '36px', fontWeight: 700, color: '#18181B', marginBottom: '12px', letterSpacing: '-0.02em' }}>
              What we detect
            </h2>
            <p style={{ fontSize: '15px', color: '#71717A', maxWidth: '400px', margin: '0 auto' }}>
              Built for journalists, researchers, and anyone who wants to verify what they read online.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '16px' }}>
            {[
              {
                title: 'NLP Credibility Scoring',
                desc: 'AI context-awareness separates relevant facts from off-context filler. Detects emotional language, bias, and clickbait patterns.',
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
              },
              {
                title: 'Live Source Corroboration',
                desc: 'Cross-references 50+ live web sources in real-time. Tier-1 outlets (Reuters/BBC) carry higher weight in the credibility score.',
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
              },
              {
                title: 'Ad & Clickbait Analysis',
                desc: 'Detects low-quality ad networks (Taboola, Outbrain) and excessive ad density — key signals of clickbait or monetization-driven content.',
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
              },
            ].map(({ title, desc, icon }) => (
              <div key={title} style={{ background: '#FFFFFF', border: '1px solid #E8E5DE', borderRadius: '12px', padding: '24px' }}>
                <div style={{ width: '38px', height: '38px', background: '#EEF2FA', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                  {icon}
                </div>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181B', marginBottom: '8px' }}>{title}</h3>
                <p style={{ fontSize: '13px', color: '#71717A', lineHeight: 1.65 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Deepfake Detection Section ─────────────────────────────────────── */}
      <section id="deepfake" style={{ background: '#FFFFFF', padding: '80px 24px', borderTop: '1px solid #E8E5DE' }}>
        <div style={{ maxWidth: '880px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '5px 14px', background: '#EEF2FA', border: '1px solid rgba(27,58,107,0.12)', borderRadius: '20px', marginBottom: '18px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="2.2" strokeLinecap="round"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/><path d="M8 2v16M16 6v16"/></svg>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#1B3A6B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Standalone Analysis</span>
            </div>
            <h2 className="serif" style={{ fontSize: '36px', fontWeight: 700, color: '#18181B', marginBottom: '14px', letterSpacing: '-0.02em' }}>
              Deepfake Detection
            </h2>
            <p style={{ fontSize: '15px', color: '#71717A', maxWidth: '500px', margin: '0 auto', lineHeight: 1.6 }}>
              Upload any image or video for standalone deepfake analysis. Our personally trained Xception model runs locally — no third-party APIs.
            </p>
          </div>

          {/* Two-panel grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', alignItems: 'start' }}>

            {/* Image Panel */}
            <div style={{ background: '#F8F7F4', border: '1px solid #E8E5DE', borderRadius: '16px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#EEF2FA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </div>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#18181B', marginBottom: '2px' }}>Image Analysis</h3>
                  <p style={{ fontSize: '11px', color: '#A1A1AA' }}>Xception model · GradCAM heatmap</p>
                </div>
              </div>
              <DeepfakePanelImage />
            </div>

            {/* Video Panel */}
            <div style={{ background: '#F8F7F4', border: '1px solid #E8E5DE', borderRadius: '16px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#EEF2FA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                </div>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#18181B', marginBottom: '2px' }}>Video Analysis</h3>
                  <p style={{ fontSize: '11px', color: '#A1A1AA' }}>3 fps normal · 5 fps burst on anomalies</p>
                </div>
              </div>
              <DeepfakePanelVideo />
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section style={{ background: '#1B3A6B', padding: '72px 24px', textAlign: 'center' }}>
        <h2 className="serif" style={{ fontSize: '38px', fontWeight: 700, color: '#FFFFFF', marginBottom: '14px', letterSpacing: '-0.02em' }}>
          Don&apos;t trust — verify.
        </h2>
        <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.65)', marginBottom: '32px', maxWidth: '380px', margin: '0 auto 32px' }}>
          Paste any article and get a credibility scorecard in minutes.
        </p>
        <Link href="/analyze" style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '13px 30px', background: '#FFFFFF', color: '#1B3A6B',
          borderRadius: '10px', fontSize: '14px', fontWeight: 600,
          textDecoration: 'none',
        }}>
          Start Analyzing
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </Link>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer style={{ background: '#FFFFFF', borderTop: '1px solid #E8E5DE', padding: '28px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: '#1B3A6B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
          <span style={{ fontFamily: 'Playfair Display, serif', fontSize: '15px', fontWeight: 700, color: '#18181B' }}>TruthLens</span>
        </div>
        <p style={{ fontSize: '12px', color: '#A1A1AA' }}>
          Multi-Modal Disinformation Detection · Powered by Ollama + Tavily + Xception
        </p>
      </footer>
    </div>
  );
}
