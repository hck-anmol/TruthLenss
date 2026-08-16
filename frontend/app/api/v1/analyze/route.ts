import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

// ── Python runner config ─────────────────────────────────────────────────────
const PYTHON_ROOT = path.resolve(process.cwd(), '..');
const PYTHON_EXE  = path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe');
const MAIN_SCRIPT = path.join(PYTHON_ROOT, 'main.py');


interface DimensionScore {
  name: string;
  score: number;
  weight: number;
  contribution: number;
  summary: string;
}

interface AdProfile {
  total_ad_slots: number;
  has_clickbait_ads: boolean;
  clickbait_networks_found: string[];
  ad_density: number;
}

interface CorroboratingSource {
  url: string;
  title: string;
  domain: string;
  snippet: string;
  trusted: boolean;
  tier: number;
  search_query: string;
  relevance_score: number;
}

interface CorroborationResult {
  total_sources_found: number;
  trusted_sources_count: number;
  tier1_count: number;
  tier2_count: number;
  corroboration_score: number;
  verdict_label: string;
  top_sources: CorroboratingSource[];
  search_queries_used: string[];
}

interface PythonScorecard {
  url:                string | null;
  title:              string;
  domain:             string | null;
  publisher:          string | null;
  authors:            string[];
  publish_date:       string | null;
  overall_score:      number;
  credibility_rating: string;
  verdict:            string;
  verdict_summary:    string;
  dimensions:         DimensionScore[];
  ad_profile:         AdProfile;
  article_context:    string;
  relevant_facts:     string[];
  irrelevant_facts:   string[];
  main_claims:        string[];
  emotional_phrases:  string[];
  clickbait_elements: string[];
  bias_indicators:    string[];
  misleading_patterns:string[];
  content_tone:       string;
  corroboration:      CorroborationResult;
  red_flags:          string[];
  positive_signals:   string[];
}

// ── Spawn the Python pipeline and collect stdout as raw UTF-8 ────────────────

function runPipeline(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_EXE, args, {
      cwd: PYTHON_ROOT,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    const chunks: Buffer[] = [];
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { chunks.push(d); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });

    proc.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf-8');
      if (code === 0) {
        resolve(stdout);
      } else {
        // Surface the Python error message cleanly
        const pythonError = stderr
          .split('\n')
          .filter(l => l.includes('Pipeline error') || l.includes('Error') || l.includes('error'))
          .join(' ')
          .trim();
        reject(new Error(pythonError || stderr.trim() || `Process exited with code ${code}`));
      }
    });

    // 15-minute hard timeout (Ollama can be slow on first run)
    setTimeout(() => {
      proc.kill();
      reject(new Error('Analysis timed out after 15 minutes. The AI model may be overloaded.'));
    }, 15 * 60 * 1000);
  });
}

// ── Parse raw stdout into the Python scorecard object ───────────────────────

function parseScorecard(stdout: string): PythonScorecard {
  const firstBrace = stdout.indexOf('{');
  const lastBrace  = stdout.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(
      `Backend returned no JSON. stdout preview: ${stdout.slice(0, 300)}`
    );
  }

  return JSON.parse(stdout.slice(firstBrace, lastBrace + 1)) as PythonScorecard;
}

// ── Shape the raw scorecard into the public API response ────────────────────

function buildApiResponse(sc: PythonScorecard, analyzedAt: string) {
  return {
    status:      'success',
    analyzed_at: analyzedAt,
    api_version: 'v1',

    // ── Article metadata ───────────────────────────────────────────────────
    article: {
      url:          sc.url          ?? null,
      title:        sc.title,
      domain:       sc.domain       ?? null,
      publisher:    sc.publisher    ?? null,
      authors:      sc.authors      ?? [],
      publish_date: sc.publish_date ?? null,
    },

    // ── Top-level verdict ──────────────────────────────────────────────────
    verdict: {
      label:              sc.verdict,
      overall_score:      Math.round(sc.overall_score * 10) / 10,   // 1 decimal
      credibility_rating: sc.credibility_rating,
      summary:            sc.verdict_summary,
    },

    // ── Per-dimension breakdown ────────────────────────────────────────────
    dimensions: (sc.dimensions ?? []).map(d => ({
      name:         d.name,
      score:        Math.round(d.score * 10) / 10,
      weight:       d.weight,
      weight_pct:   `${Math.round(d.weight * 100)}%`,
      contribution: Math.round(d.contribution * 10) / 10,
      summary:      d.summary ?? '',
    })),

    // ── LLM (Ollama) analysis ──────────────────────────────────────────────
    llm_analysis: {
      article_context:     sc.article_context    ?? '',
      main_claims:         sc.main_claims        ?? [],
      relevant_facts:      sc.relevant_facts     ?? [],
      irrelevant_facts:    sc.irrelevant_facts   ?? [],
      emotional_phrases:   sc.emotional_phrases  ?? [],
      clickbait_elements:  sc.clickbait_elements ?? [],
      bias_indicators:     sc.bias_indicators    ?? [],
      misleading_patterns: sc.misleading_patterns ?? [],
      content_tone:        sc.content_tone       ?? 'neutral',
    },

    // ── Tavily web corroboration ───────────────────────────────────────────
    corroboration: {
      verdict_label:         sc.corroboration?.verdict_label        ?? 'Not checked',
      corroboration_score:   sc.corroboration?.corroboration_score  ?? 0,
      total_sources_found:   sc.corroboration?.total_sources_found  ?? 0,
      trusted_sources_count: sc.corroboration?.trusted_sources_count ?? 0,
      tier1_count:           sc.corroboration?.tier1_count           ?? 0,
      tier2_count:           sc.corroboration?.tier2_count           ?? 0,
      search_queries_used:   sc.corroboration?.search_queries_used  ?? [],
      sources: (sc.corroboration?.top_sources ?? []).map(s => ({
        title:           s.title,
        url:             s.url,
        domain:          s.domain,
        snippet:         s.snippet          ?? '',
        trusted:         s.trusted,
        tier:            s.tier,
        search_query:    s.search_query     ?? '',
        relevance_score: s.relevance_score  ?? 0,
      })),
    },

    // ── Ad / monetisation profile ──────────────────────────────────────────
    ad_profile: {
      total_ad_slots:           sc.ad_profile?.total_ad_slots            ?? 0,
      has_clickbait_ads:        sc.ad_profile?.has_clickbait_ads         ?? false,
      clickbait_networks_found: sc.ad_profile?.clickbait_networks_found  ?? [],
      ad_density_per_100_words: sc.ad_profile?.ad_density               ?? 0,
    },

    // ── Credibility signals ────────────────────────────────────────────────
    signals: {
      red_flags:        sc.red_flags       ?? [],
      positive_signals: sc.positive_signals ?? [],
    },
  };
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const analyzedAt = new Date().toISOString();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({
        status: 'error',
        error: 'Invalid JSON payload in request body.'
    }, { status: 400 });
  }

  const { url, text, title } = body as {
    url?:   string;
    text?:  string;
    title?: string;
  };

  if (!url && !text) {
    return NextResponse.json(
      {
        status:      'error',
        analyzed_at: analyzedAt,
        error:       'Provide either a "url" or "text" field in the request body.',
        example: {
          url:  'https://example.com/news-article',
          text: 'Raw article body text...',
        },
      },
      { status: 400 }
    );
  }

  // Build CLI args for main.py
  const args: string[] = [MAIN_SCRIPT, '--json'];
  if (url)   args.push('--url',   url);
  if (text)  args.push('--text',  text);
  if (title) args.push('--title', title);

  try {
    const stdout    = await runPipeline(args);
    const scorecard = parseScorecard(stdout);
    const response  = buildApiResponse(scorecard, analyzedAt);

    return NextResponse.json(response, { status: 200 });

  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : 'Internal server error';

    // Make pipeline errors human-readable
    const friendly = raw
      .replace('Pipeline error: ', '')
      .replace(/\n\s+/g, ' ')
      .trim();

    return NextResponse.json(
      {
        status:      'error',
        analyzed_at: analyzedAt,
        error:       friendly,
      },
      { status: 500 }
    );
  }
}

// ── GET — API documentation ───────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    api:     'TruthLens Credibility API',
    version: 'v1',
    endpoint: 'POST /api/v1/analyze',
    description: 'Analyze any news article URL or raw text and receive a full credibility report.',
    request: {
      method:       'POST',
      content_type: 'application/json',
      body: {
        url:   'string  (required if text not provided) — Article URL to analyze',
        text:  'string  (required if url not provided)  — Raw article text',
        title: 'string  (optional)                      — Article title (for raw text mode)',
      },
    },
    response_fields: {
      status:        '"success" | "error"',
      analyzed_at:   'ISO 8601 timestamp',
      article:       'Metadata: url, title, domain, publisher, authors, publish_date',
      verdict:       'label, overall_score (0–100), credibility_rating, summary',
      dimensions:    'Per-dimension score breakdown with weights',
      llm_analysis:  'Claims, facts, emotional phrases, bias indicators, tone',
      corroboration: 'Tavily web sources with trust tier and snippets',
      ad_profile:    'Ad slots, clickbait networks, density',
      signals:       'red_flags[], positive_signals[]',
    },
    example_request: {
      url: 'https://www.thehindu.com/news/national/some-article',
    },
    example_curl: `curl -X POST http://localhost:3000/api/v1/analyze \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://www.thehindu.com/news/national/some-article"}'`,
  });
}
