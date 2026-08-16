'use client';
import { useState, useRef } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { CredibilityScorecard } from '@/lib/types';

const LoadingSteps   = dynamic(() => import('@/components/LoadingSteps'),   { ssr: false });
const ScorecardModal = dynamic(() => import('@/components/ScorecardModal'), { ssr: false });

// Modes available in the article analysis page:
//  url   → article URL (text + images analyzed)
//  text  → raw article text (text analyzed)
//  image → upload an image for standalone deepfake detection
// NOTE: Video tab is removed — video deepfake is on the main page's dedicated section.
type ArticleAnalysisMode = 'url' | 'text' | 'image';

export default function AnalyzePage() {
  const [mode, setMode]         = useState<ArticleAnalysisMode>('url');
  const [url, setUrl]           = useState('');
  const [text, setText]         = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [stage, setStage]       = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [step, setStep]         = useState(1);
  const [sc, setSc]             = useState<CredibilityScorecard | null>(null);
  const [error, setError]       = useState('');
  const [show, setShow]         = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSubmit =
    mode === 'url'   ? url.trim() !== '' :
    mode === 'text'  ? text.trim().length > 50 :
    mode === 'image' ? imageFile !== null :
    false;

  const submit = async () => {
    setError(''); setStage('loading'); setStep(1);
    // Advance step counter every ~80 seconds to show progress
    const tmr = setInterval(() => setStep((s) => Math.min(s + 1, 3)), 80000);

    try {
      let res: Response;

      if (mode === 'image' && imageFile) {
        // Standalone image deepfake → /api/deepfake
        const form = new FormData();
        form.append('image', imageFile);
        res = await fetch('/api/deepfake', { method: 'POST', body: form });
      } else {
        // URL / text → /api/analyze as JSON
        const body: Record<string, string> = {};
        if (mode === 'url')  body.url  = url;
        if (mode === 'text') body.text = text;
        res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      clearInterval(tmr);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown server error.' }));
        throw new Error(err.error || `Error ${res.status}`);
      }

      setSc(await res.json());
      setStep(4);
      setStage('done');
      setShow(true);
    } catch (e: unknown) {
      clearInterval(tmr);
      setStage('error');
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const reset = () => {
    setStage('idle'); setStep(1); setSc(null);
    setShow(false); setError(''); setImageFile(null);
  };

  // ── SVG Icons ──────────────────────────────────────────────────────────────
  const IconUrl = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
  const IconTxt = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>;
  const IconImg = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;

  const tabs: { id: ArticleAnalysisMode; l: string; i: ReactNode }[] = [
    { id: 'url',   l: 'Article URL',  i: IconUrl },
    { id: 'text',  l: 'Raw Text',     i: IconTxt },
    { id: 'image', l: 'Image Check',  i: IconImg },
  ];

  const modeLabel = mode === 'image' ? 'Analyze Image' : 'Analyze Article';
  const modeDesc = {
    url:   'Paste an article URL to extract text, verify claims across 50+ live sources, and scan images for deepfakes.',
    text:  'Paste the full article text. AI will extract claims, detect bias, and cross-reference with live sources.',
    image: 'Upload an image for standalone deepfake detection using our personally trained Xception model + GradCAM.',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#F8F7F4', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Navbar ─────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,247,244,0.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid #E8E5DE', padding: '0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: '#1B3A6B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
          <span style={{ fontFamily: 'Playfair Display, serif', fontWeight: 700, fontSize: '18px', color: '#18181B', letterSpacing: '-0.02em' }}>
            TruthLens
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/#deepfake" style={{
            fontSize: '12px', fontWeight: 500, color: '#52525B',
            padding: '6px 14px', borderRadius: '6px', border: '1px solid #D4D0C8',
            textDecoration: 'none', background: '#FFFFFF',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            Video Deepfake
          </Link>
          {sc && (
            <button onClick={() => setShow(true)} style={{
              fontSize: '12px', fontWeight: 500, color: '#1B3A6B', background: '#EEF2FA',
              padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(27,58,107,0.1)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              View Report <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          )}
        </div>
      </nav>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 24px' }}>
        <div style={{ width: '100%', maxWidth: '600px' }}>

          {stage === 'idle' && (
            <div className="fade-up">
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <h1 className="serif" style={{ fontSize: '32px', fontWeight: 700, color: '#18181B', marginBottom: '8px', letterSpacing: '-0.02em' }}>
                  Verify Content
                </h1>
                <p style={{ fontSize: '14px', color: '#71717A', lineHeight: 1.6, maxWidth: '420px', margin: '0 auto' }}>
                  {modeDesc[mode]}
                </p>
              </div>

              {/* Card */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E8E5DE', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 32px rgba(0,0,0,0.03)' }}>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #E8E5DE' }}>
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      id={`tab-${t.id}`}
                      onClick={() => setMode(t.id)}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                        padding: '15px 12px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                        border: 'none', background: mode === t.id ? '#FAFAFA' : '#FFFFFF',
                        borderBottom: mode === t.id ? '2px solid #1B3A6B' : '2px solid transparent',
                        color: mode === t.id ? '#1B3A6B' : '#71717A',
                        transition: 'all 0.18s',
                      }}
                    >
                      {t.i} {t.l}
                    </button>
                  ))}
                </div>

                {/* Input area */}
                <div style={{ padding: '24px' }}>

                  {/* URL Mode */}
                  {mode === 'url' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                        Article URL
                      </label>
                      <input
                        id="url-input"
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
                        placeholder="https://example.com/article..."
                        style={{
                          width: '100%', padding: '13px 16px', fontSize: '14px', color: '#18181B',
                          background: '#F8F7F4', border: '1px solid #E8E5DE', borderRadius: '8px',
                          outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#1B3A6B'}
                        onBlur={(e) => e.target.style.borderColor = '#E8E5DE'}
                      />
                      <p style={{ fontSize: '11px', color: '#A1A1AA', marginTop: '10px', lineHeight: 1.5 }}>
                        Analyzes text + article images. MSN/Yahoo/Google News redirects may fail — use the original article URL.
                      </p>
                    </div>
                  )}

                  {/* Text Mode */}
                  {mode === 'text' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                        Raw Article Text
                      </label>
                      <textarea
                        id="text-input"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={8}
                        placeholder="Paste the full article text here (minimum 50 characters)..."
                        style={{
                          width: '100%', padding: '13px 16px', fontSize: '14px', color: '#18181B',
                          background: '#F8F7F4', border: '1px solid #E8E5DE', borderRadius: '8px',
                          outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#1B3A6B'}
                        onBlur={(e) => e.target.style.borderColor = '#E8E5DE'}
                      />
                      <p style={{ fontSize: '11px', color: '#A1A1AA', marginTop: '6px' }}>
                        {text.length} characters {text.length < 50 && text.length > 0 && <span style={{ color: '#D97706' }}>— need at least 50</span>}
                      </p>
                    </div>
                  )}

                  {/* Image Mode */}
                  {mode === 'image' && (
                    <div
                      id="image-drop-zone"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files[0];
                        if (f && f.type.startsWith('image/')) setImageFile(f);
                      }}
                      style={{
                        border: `2px dashed ${imageFile ? '#1B3A6B' : '#D4D0C8'}`,
                        borderRadius: '10px', padding: '40px 20px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px',
                        cursor: 'pointer',
                        background: imageFile ? '#EEF2FA' : '#FAFAFA',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{
                        width: '52px', height: '52px', borderRadius: '14px',
                        background: imageFile ? '#1B3A6B' : '#EEF2FA',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: imageFile ? '#fff' : '#1B3A6B', flexShrink: 0,
                      }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        {imageFile ? (
                          <>
                            <p style={{ fontSize: '14px', fontWeight: 600, color: '#1B3A6B', marginBottom: '4px' }}>{imageFile.name}</p>
                            <p style={{ fontSize: '12px', color: '#71717A' }}>
                              {(imageFile.size / 1024 / 1024).toFixed(1)} MB — Ready to analyze
                            </p>
                          </>
                        ) : (
                          <>
                            <p style={{ fontSize: '14px', fontWeight: 500, color: '#18181B', marginBottom: '4px' }}>Drop image or click to upload</p>
                            <p style={{ fontSize: '12px', color: '#A1A1AA' }}>PNG, JPG, WEBP — Screenshots, news photos, infographics</p>
                          </>
                        )}
                      </div>
                      <input
                        ref={fileRef}
                        id="image-file-input"
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  )}
                </div>

                {/* Submit */}
                <div style={{ padding: '0 24px 24px' }}>
                  <button
                    id="submit-btn"
                    onClick={submit}
                    disabled={!canSubmit}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      padding: '14px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF',
                      background: canSubmit ? '#1B3A6B' : '#94A3B8',
                      border: 'none', borderRadius: '9px',
                      cursor: canSubmit ? 'pointer' : 'not-allowed',
                      opacity: canSubmit ? 1 : 0.6,
                      transition: 'all 0.2s',
                    }}
                  >
                    {modeLabel}
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  </button>
                  <p style={{ textAlign: 'center', fontSize: '11px', color: '#A1A1AA', marginTop: '12px', lineHeight: 1.5 }}>
                    {mode === 'image'
                      ? 'Image analysis takes ~1 minute. Model runs locally.'
                      : 'Article analysis takes 2–10 minutes due to local AI + live web search.'}
                    <br/>Please keep this tab open.
                  </p>
                </div>
              </div>

              {/* Tip box */}
              <div style={{
                marginTop: '20px', padding: '14px 18px',
                background: 'rgba(27,58,107,0.04)', border: '1px solid rgba(27,58,107,0.1)',
                borderRadius: '10px', display: 'flex', alignItems: 'flex-start', gap: '10px',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: '2px' }}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                <p style={{ fontSize: '12px', color: '#52525B', lineHeight: 1.55, margin: 0 }}>
                  <strong>Video Deepfake Detection</strong> is available on the{' '}
                  <Link href="/#deepfake" style={{ color: '#1B3A6B', textDecoration: 'underline' }}>home page</Link>.
                  Upload a video for frame-by-frame analysis at 3 fps with adaptive burst sampling at anomalies.
                </p>
              </div>
            </div>
          )}

          {stage === 'loading' && (
            <div className="fade-up" style={{ background: '#FFFFFF', border: '1px solid #E8E5DE', borderRadius: '14px', padding: '40px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'center', marginBottom: '32px' }}>
                {mode === 'image' ? 'Running Deepfake Detection' : 'Analyzing Article'}
              </p>
              <LoadingSteps step={step} />
            </div>
          )}

          {stage === 'error' && (
            <div className="fade-up" style={{ background: '#FFFFFF', border: '1px solid #E8E5DE', borderRadius: '14px', padding: '40px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
              <div style={{ width: '52px', height: '52px', borderRadius: '26px', background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#991B1B' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#18181B', marginBottom: '8px' }}>Analysis Failed</h3>
              <p style={{ fontSize: '13px', color: '#71717A', marginBottom: '24px', lineHeight: 1.6 }}>{error}</p>
              <button onClick={reset} style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 500, color: '#FFFFFF', background: '#1B3A6B', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                Try Again
              </button>
            </div>
          )}

          {stage === 'done' && !show && sc && (
            <div className="fade-up" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '14px', color: '#71717A', marginBottom: '20px' }}>
                Analysis complete for <strong style={{ color: '#18181B' }}>{sc.domain || 'your content'}</strong>
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button onClick={() => setShow(true)} style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 500, color: '#FFFFFF', background: '#1B3A6B', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
                  View Scorecard
                </button>
                <button onClick={reset} style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 500, color: '#52525B', background: 'transparent', border: '1px solid #D4D0C8', borderRadius: '8px', cursor: 'pointer' }}>
                  Analyze Another
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Scorecard modal */}
      {show && sc && <ScorecardModal sc={sc} onClose={() => setShow(false)} />}
    </div>
  );
}
