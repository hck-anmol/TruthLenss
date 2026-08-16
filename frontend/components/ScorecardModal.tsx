'use client';
import { useRef, useEffect, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { CredibilityScorecard, ImageAnalysisResult } from '@/lib/types';

const PropagationGraph = dynamic(
  () => import('@/components/PropagationGraph'),
  { ssr: false }
);

interface Props {
  sc: CredibilityScorecard;
  onClose: () => void;
}

function verdictStyle(v: string) {
  if (v === 'REAL')        return { pill: '#166534', bg: '#F0FDF4', border: '#BBF7D0', label: 'Credible' };
  if (v === 'LIKELY REAL') return { pill: '#92400E', bg: '#FFFBEB', border: '#FDE68A', label: 'Mostly Credible' };
  if (v === 'LIKELY FAKE') return { pill: '#9A3412', bg: '#FFF7ED', border: '#FDBA74', label: 'Low Credibility' };
  return                          { pill: '#991B1B', bg: '#FEF2F2', border: '#FECACA', label: 'Not Credible' };
}

function scoreColor(s: number) {
  if (s >= 70) return '#166534';
  if (s >= 45) return '#92400E';
  return '#991B1B';
}

function DimBar({ name, score, weight, summary }: { name: string; score: number; weight: number; summary: string }) {
  const c = scoreColor(score);
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: '#18181B' }}>{name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#A1A1AA' }}>{Math.round(weight * 100)}% weight</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: c, minWidth: '28px', textAlign: 'right' }}>{score.toFixed(0)}</span>
        </div>
      </div>
      <div style={{ background: '#F0EDE6', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
        <div
          className="bar-grow"
          style={{ width: `${score}%`, height: '100%', background: c, borderRadius: '4px' }}
        />
      </div>
      {summary && (
        <p style={{ fontSize: '11px', color: '#71717A', marginTop: '3px', lineHeight: '1.4' }}>{summary}</p>
      )}
    </div>
  );
}

export default function ScorecardModal({ sc, onClose }: Props) {
  const hasVideo = !!sc.video_analysis;
  const isVideoOnly = !sc.url && sc.title === 'Uploaded Video File';
  const overlayRef       = useRef<HTMLDivElement>(null);
  const panelRef         = useRef<HTMLDivElement>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const { pill, bg, border, label } = verdictStyle(sc.verdict);
  const c = scoreColor(sc.overall_score);

  
  const [pdfGraphImage, setPdfGraphImage] = useState<string | null>(null);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  const fullscreen = () => {
    if (!document.fullscreenElement) panelRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  const downloadPDF = async () => {
    if (!panelRef.current) return;

    
    const graphCanvas  = graphContainerRef.current?.querySelector('canvas');
    const snapshotUrl  = graphCanvas ? graphCanvas.toDataURL('image/png') : null;

    
    setPdfGraphImage(snapshotUrl);

    
    
    
    const bodyEl = panelRef.current.querySelector<HTMLElement>('[data-pdf-body]');
    let savedMaxH = '';
    let savedOverflow = '';
    if (bodyEl) {
      savedMaxH    = bodyEl.style.maxHeight;
      savedOverflow = bodyEl.style.overflowY;
      bodyEl.style.maxHeight  = 'none';
      bodyEl.style.overflowY  = 'visible';
    }

    
    const savedPanelMaxH  = panelRef.current.style.maxHeight;
    const savedPanelOverflow = panelRef.current.style.overflow;
    
    panelRef.current.style.maxHeight = 'none';
    panelRef.current.style.overflow  = 'visible';
    
    
    
    const hadModalIn = panelRef.current.classList.contains('modal-in');
    if (hadModalIn) {
      panelRef.current.classList.remove('modal-in');
    }
    panelRef.current.style.setProperty('opacity', '1', 'important');
    panelRef.current.style.setProperty('transform', 'none', 'important');
    panelRef.current.style.setProperty('animation', 'none', 'important');

    
    await new Promise<void>(r => setTimeout(r, 250));

    
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF }                = await import('jspdf');

    const canvas = await html2canvas(panelRef.current, {
      scale: 3,                     
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 0,
      
      windowWidth:  panelRef.current.scrollWidth,
      windowHeight: panelRef.current.scrollHeight,
      ignoreElements: el => el.tagName === 'CANVAS',
    });

    
    panelRef.current.style.maxHeight = savedPanelMaxH;
    panelRef.current.style.overflow  = savedPanelOverflow;
    
    panelRef.current.style.removeProperty('opacity');
    panelRef.current.style.removeProperty('transform');
    panelRef.current.style.removeProperty('animation');
    if (hadModalIn) {
      panelRef.current.classList.add('modal-in');
    }
    
    if (bodyEl) {
      bodyEl.style.maxHeight  = savedMaxH;
      bodyEl.style.overflowY  = savedOverflow;
    }
    setPdfGraphImage(null);

    
    const pdf    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW  = pdf.internal.pageSize.getWidth();   
    const pageH  = pdf.internal.pageSize.getHeight();  

    
    const mmPerPx = pageW / canvas.width;
    const totalH  = canvas.height * mmPerPx;           

    
    const pages = Math.ceil(totalH / pageH);

    for (let p = 0; p < pages; p++) {
      if (p > 0) pdf.addPage();

      
      const srcY = (p * pageH) / mmPerPx;             
      const srcH = Math.min(pageH / mmPerPx, canvas.height - srcY);

      
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width  = canvas.width;
      pageCanvas.height = Math.ceil(srcH);
      const pCtx = pageCanvas.getContext('2d')!;
      
      
      pCtx.fillStyle = '#ffffff';
      pCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pCtx.drawImage(canvas, 0, -srcY);

      const imgData = pageCanvas.toDataURL('image/png');
      const destH   = srcH * mmPerPx;

      pdf.addImage(imgData, 'PNG', 0, 0, pageW, destH);
    }

    pdf.save(`TruthLens_${sc.domain || 'report'}.pdf`);
  };


  return (
    <div
      ref={overlayRef}
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(24,24,27,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        ref={panelRef}
        className="modal-in"
        style={{
          width: '100%', maxWidth: '640px', maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          background: '#FFFFFF',
          border: '1px solid #E8E5DE',
          borderRadius: '16px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.14)',
          overflow: 'hidden',
        }}
      >
        {}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #F0EDE6',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: '#1B3A6B', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
            </div>
            <div>
              <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: '15px', fontWeight: 700, color: '#18181B', lineHeight: 1.2 }}>
                Credibility Scorecard
              </h2>
              <p style={{ fontSize: '11px', color: '#A1A1AA', marginTop: '1px' }}>
                {sc.domain || 'TruthLens Analysis'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={fullscreen} title="Fullscreen" style={{
              width: '32px', height: '32px', border: '1px solid #E8E5DE',
              borderRadius: '7px', background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717A',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </button>
            <button onClick={onClose} title="Close" style={{
              width: '32px', height: '32px', border: '1px solid #E8E5DE',
              borderRadius: '7px', background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717A',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {}
        <div data-pdf-body style={{ overflowY: 'auto', flex: 1, padding: '20px' }}>

          {}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#18181B', lineHeight: 1.4, marginBottom: '6px' }}>
              {sc.title}
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '12px', color: '#71717A' }}>
              {sc.authors?.length > 0 && <span>By {sc.authors.join(', ')}</span>}
              {sc.publish_date && (
                <span>{new Date(sc.publish_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              )}
              {sc.url && (
                <a href={sc.url} target="_blank" rel="noreferrer" style={{ color: '#1B3A6B', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                  View original →
                </a>
              )}
            </div>
          </div>

          {}
          <div style={{
            display: 'flex', gap: '20px', alignItems: 'center',
            background: '#F8F7F4', borderRadius: '12px', padding: '20px', marginBottom: '20px',
          }}>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: '52px', fontWeight: 700, fontFamily: 'Playfair Display, serif', color: c, lineHeight: 1 }}>
                {sc.overall_score.toFixed(0)}
              </div>
              <div style={{ fontSize: '12px', color: '#A1A1AA', marginTop: '4px' }}>out of 100</div>
            </div>
            <div style={{ width: '1px', height: '64px', background: '#E8E5DE', flexShrink: 0 }} />
            <div>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 10px', borderRadius: '20px',
                background: bg, border: `1px solid ${border}`,
                color: pill, fontSize: '12px', fontWeight: 600, marginBottom: '8px',
              }}>
                {sc.verdict}
                <span style={{ fontWeight: 400, opacity: 0.75 }}>— {label}</span>
              </span>
              <p style={{ fontSize: '13px', color: '#52525B', lineHeight: 1.55 }}>{sc.verdict_summary}</p>
            </div>
          </div>

          {}
          {sc.article_context && (
            <div style={{
              background: '#F0EEF7', border: '1px solid #DDD8F0', borderRadius: '10px',
              padding: '14px 16px', marginBottom: '20px',
            }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#4A3F8A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                Article Context
              </p>
              <p style={{ fontSize: '13px', color: '#2D2B45', lineHeight: 1.6 }}>{sc.article_context}</p>
            </div>
          )}

          {}
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>
              Dimension Breakdown
            </p>
            {sc.dimensions.map((d) => (
              <DimBar key={d.name} name={d.name} score={d.score} weight={d.weight} summary={d.summary} />
            ))}
          </div>

          {}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            {sc.red_flags?.length > 0 && (
              <div style={{
                background: '#FEF2F2', border: '1px solid #FECACA',
                borderRadius: '10px', padding: '14px',
              }}>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#991B1B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                  Red Flags
                </p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {sc.red_flags.slice(0, 5).map((f, i) => (
                    <li key={i} style={{ fontSize: '12px', color: '#3F1214', lineHeight: 1.4, display: 'flex', gap: '6px' }}>
                      <span style={{ color: '#991B1B', flexShrink: 0 }}>—</span>{f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sc.positive_signals?.length > 0 && (
              <div style={{
                background: '#F0FDF4', border: '1px solid #BBF7D0',
                borderRadius: '10px', padding: '14px',
              }}>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                  Positive Signals
                </p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {sc.positive_signals.slice(0, 5).map((s, i) => (
                    <li key={i} style={{ fontSize: '12px', color: '#14532D', lineHeight: 1.4, display: 'flex', gap: '6px' }}>
                      <span style={{ color: '#166534', flexShrink: 0 }}>+</span>{s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {}
          {sc.image_analysis && sc.image_analysis.results.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>
                Image Forensics
              </p>
              
              <div style={{ background: '#F8F7F4', borderRadius: '10px', padding: '12px 14px', display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '13px', color: '#52525B', marginBottom: '14px' }}>
                <span><strong style={{ color: '#18181B' }}>{sc.image_analysis.total_images_analyzed}</strong> images analyzed</span>
                <span><strong style={{ color: '#18181B' }}>{sc.image_analysis.fake_images_detected}</strong> fake detected</span>
                <span>Authenticity score: <strong style={{ color: scoreColor(sc.image_analysis.image_authenticity_score) }}>{sc.image_analysis.image_authenticity_score.toFixed(0)}</strong> / 100</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
                {sc.image_analysis.results.map((r, i) => {
                  const isFake = r.verdict === 'FAKE';
                  const pbg = isFake ? '#FEF2F2' : '#F0FDF4';
                  const pborder = isFake ? '#FECACA' : '#BBF7D0';
                  const ptext = isFake ? '#991B1B' : '#166534';
                  return (
                    <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E8E5DE', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#F8F7F4' }}>
                        <img src={r.gradcam_base64} alt="GradCAM" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', top: '8px', right: '8px', padding: '4px 8px', borderRadius: '20px', background: pbg, border: `1px solid ${pborder}`, color: ptext, fontSize: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: ptext }} />
                          {r.verdict}
                        </div>
                      </div>
                      <div style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#18181B' }}>Fake Probability</span>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: isFake ? '#991B1B' : '#166534' }}>{(r.fake_probability * 100).toFixed(1)}%</span>
                        </div>
                        <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: '#71717A', textDecoration: 'none', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.url}
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {}
          {sc.video_analysis && sc.video_analysis.total_frames_analyzed > 0 && (() => {
            const va = sc.video_analysis;
            const verdictColor = va.verdict === 'FAKE' ? '#991B1B' : va.verdict === 'LIKELY FAKE' ? '#92400E' : '#166534';
            const verdictBg    = va.verdict === 'FAKE' ? '#FEF2F2'  : va.verdict === 'LIKELY FAKE' ? '#FFFBEB'  : '#F0FDF4';

            
            const secondMap: Record<number, { maxProb: number; isBurst: boolean }> = {};
            for (const fr of va.frame_results) {
              const cur = secondMap[fr.second];
              secondMap[fr.second] = {
                maxProb: cur ? Math.max(cur.maxProb, fr.fake_probability) : fr.fake_probability,
                isBurst: fr.is_anomaly_burst,
              };
            }
            const seconds = Object.keys(secondMap).map(Number).sort((a, b) => a - b);

            return (
              <div style={{ marginBottom: '20px' }}>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>
                  Video Forensics
                </p>

                {}
                <div style={{ background: '#F8F7F4', borderRadius: '10px', padding: '12px 14px', display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '13px', color: '#52525B', marginBottom: '14px' }}>
                  <span><strong style={{ color: '#18181B' }}>{va.duration_seconds.toFixed(1)}s</strong> duration</span>
                  <span><strong style={{ color: '#18181B' }}>{va.total_frames_analyzed}</strong> frames analyzed</span>
                  <span><strong style={{ color: '#18181B' }}>{va.fake_frame_count}</strong> fake frames</span>
                  <span><strong style={{ color: '#18181B' }}>{va.anomaly_seconds.length}</strong> anomaly burst(s)</span>
                  <span>
                    Authenticity:&nbsp;
                    <strong style={{ color: scoreColor(va.video_authenticity_score) }}>
                      {va.video_authenticity_score.toFixed(0)}
                    </strong> / 100
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: '12px', background: verdictBg, color: verdictColor, fontWeight: 600, fontSize: '12px' }}>
                    {va.verdict}
                  </span>
                </div>

                {}
                {seconds.length > 0 && (
                  <div>
                    <p style={{ fontSize: '11px', color: '#A1A1AA', marginBottom: '8px' }}>
                      Frame timeline — each bar = 1 second &nbsp;
                      <span style={{ color: '#166534' }}>■ Real</span> &nbsp;
                      <span style={{ color: '#D97706' }}>■ Burst</span> &nbsp;
                      <span style={{ color: '#991B1B' }}>■ Fake</span>
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                      {seconds.map((s) => {
                        const { maxProb, isBurst } = secondMap[s];
                        const isFake  = maxProb > 0.70;
                        const barColor = isFake ? '#EF4444' : isBurst ? '#F59E0B' : '#22C55E';
                        const height   = 8 + Math.round(maxProb * 24);
                        return (
                          <div
                            key={s}
                            title={`s=${s} | max fake: ${(maxProb * 100).toFixed(1)}%${isBurst ? ' | burst' : ''}`}
                            style={{
                              width: '6px',
                              height: `${height}px`,
                              borderRadius: '2px',
                              background: barColor,
                              opacity: 0.85,
                              cursor: 'default',
                              transition: 'opacity 0.15s',
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {}
                <div style={{ marginTop: '14px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#71717A', marginBottom: '5px' }}>
                    <span>Max fake probability</span>
                    <strong style={{ color: verdictColor }}>{(va.max_fake_probability * 100).toFixed(1)}%</strong>
                  </div>
                  <div style={{ height: '6px', background: '#E8E5DE', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${va.max_fake_probability * 100}%`,
                      background: va.max_fake_probability > 0.70 ? '#EF4444' : va.max_fake_probability > 0.40 ? '#F59E0B' : '#22C55E',
                      borderRadius: '3px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>

                {}
                {va.frame_results.some(r => r.gradcam_base64) && (
                  <div style={{ marginTop: '20px' }}>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                      Deepfake Frame Heatmaps
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                      {va.frame_results.filter(r => r.gradcam_base64).map((r, i) => (
                        <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E8E5DE', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#F8F7F4' }}>
                            <img src={r.gradcam_base64!} alt={`Frame at ${r.second}s`} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                          <div style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', fontWeight: 500, color: '#18181B' }}>0:{r.second.toString().padStart(2, '0')} (f{r.frame_index})</span>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#991B1B' }}>{(r.fake_probability * 100).toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {sc.relevant_facts?.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                Relevant Facts Extracted ({sc.relevant_facts.length})
              </p>
              <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sc.relevant_facts.slice(0, 6).map((f, i) => (
                  <li key={i} style={{ display: 'flex', gap: '10px', fontSize: '13px', color: '#18181B', lineHeight: 1.5 }}>
                    <span style={{ color: '#1B3A6B', fontWeight: 600, flexShrink: 0, minWidth: '18px' }}>{i + 1}.</span>
                    {f}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {}
          {sc.irrelevant_facts?.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                Off-Context / Irrelevant Facts ({sc.irrelevant_facts.length})
              </p>
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '12px 14px' }}>
                {sc.irrelevant_facts.slice(0, 4).map((f, i) => (
                  <p key={i} style={{ fontSize: '12px', color: '#78350F', lineHeight: 1.5, marginBottom: i < sc.irrelevant_facts.length - 1 ? '5px' : 0 }}>
                    ⚠ {f}
                  </p>
                ))}
              </div>
            </div>
          )}

          {}
          {sc.ad_profile?.total_ad_slots > 0 && (
            <div style={{ marginBottom: '4px' }}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                Ad Profile
              </p>
              <div style={{ background: '#F8F7F4', borderRadius: '10px', padding: '12px 14px', display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '13px', color: '#52525B' }}>
                <span><strong style={{ color: '#18181B' }}>{sc.ad_profile.total_ad_slots}</strong> ad slots</span>
                <span><strong style={{ color: '#18181B' }}>{sc.ad_profile.ad_density.toFixed(1)}</strong> per 100 words</span>
                {sc.ad_profile.has_clickbait_ads && (
                  <span style={{ color: '#991B1B', fontWeight: 500 }}>
                    ⚠ Clickbait networks: {sc.ad_profile.clickbait_networks_found.join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {}
          {!isVideoOnly && (
            <div ref={graphContainerRef}>
              {pdfGraphImage ? (
                
                <div style={{ marginTop: '20px' }}>
                  <p style={{
                    fontSize: '11px', fontWeight: 600, color: '#A1A1AA',
                    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px',
                  }}>
                    Source Verification Network
                  </p>
                  <img
                    src={pdfGraphImage}
                    alt="Source Verification Network"
                    style={{ width: '100%', borderRadius: '12px', display: 'block', marginBottom: '20px' }}
                  />
                  
                  {}
                  {sc.corroboration?.top_sources && sc.corroboration.top_sources.length > 0 && (
                    <div>
                      <p style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                        Corroborating Articles Evaluated
                      </p>
                      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {sc.corroboration.top_sources.slice(0, 15).map((s, i) => (
                          <li key={i} style={{ 
                            fontSize: '11px', lineHeight: 1.4, padding: '10px', 
                            background: '#F8F7F4', borderRadius: '8px', border: '1px solid #E8E5DE' 
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ 
                                display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
                                background: s.trusted ? '#22c55e' : '#ef4444' 
                              }} />
                              <strong style={{ color: '#18181B', fontSize: '12px' }}>{s.domain}</strong>
                              <span style={{ color: s.trusted ? '#166534' : '#991B1B', fontWeight: 600 }}>
                                {s.trusted ? 'Credible' : 'Unverified'}
                              </span>
                            </div>
                            <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#1B3A6B', textDecoration: 'underline', wordBreak: 'break-all' }}>
                              {s.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                
                <PropagationGraph sc={sc} />
              )}
            </div>
          )}
        </div>

        {}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px', borderTop: '1px solid #F0EDE6', flexShrink: 0,
          background: '#FAFAFA',
        }}>
          <p style={{ fontSize: '11px', color: '#A1A1AA' }}>
            TruthLens · qwen3:8b + Tavily
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px', fontSize: '13px', fontWeight: 500,
                color: '#52525B', background: 'transparent',
                border: '1px solid #E8E5DE', borderRadius: '8px', cursor: 'pointer',
              }}
            >
              Close
            </button>
            <button
              onClick={downloadPDF}
              style={{
                padding: '8px 16px', fontSize: '13px', fontWeight: 500,
                color: '#FFFFFF', background: '#1B3A6B',
                border: '1px solid transparent', borderRadius: '8px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
