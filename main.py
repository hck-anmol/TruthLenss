"""
main.py — Article Credibility & Fake News Detection CLI

Usage:
  python main.py --url  "https://some-article.com"
  python main.py --text "Raw article text..."  --title "Article Title"
  python main.py --url  "https://..." --json
"""

import sys
import io

# ── Force UTF-8 output so non-ASCII characters (₹, é, ñ, etc.) never crash
# the process on Windows where the default codepage is cp1252.
# Primary fix (Python 3.7+): use reconfigure
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
# Fallback for older Python: wrap with TextIOWrapper
elif sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json
import argparse
import logging

from src.schemas.article_schema import ArticleInput
from src.pipeline.article_pipeline import ArticlePipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)


SEP  = "=" * 72
SEP2 = "-" * 72

VERDICT_LABEL = {
    "REAL":        "[ REAL ]",
    "LIKELY REAL": "[ LIKELY REAL ]",
    "LIKELY FAKE": "[ LIKELY FAKE ]",
    "FAKE":        "[ FAKE ]",
}


def print_scorecard(sc):
    v = sc.corroboration

    print(f"\n{SEP}")
    print("   ARTICLE CREDIBILITY & FAKE NEWS DETECTION REPORT")
    print(SEP)
    print(f"  Title     : {sc.title}")
    print(f"  URL       : {sc.url or 'N/A'}")
    print(f"  Domain    : {sc.domain or 'N/A'}")
    print(f"  Publisher : {sc.publisher or 'N/A'}")
    print(f"  Authors   : {', '.join(sc.authors) or 'N/A'}")
    print(f"  Published : {sc.publish_date or 'N/A'}")

    print(f"\n{SEP}")
    verdict_display = VERDICT_LABEL.get(sc.verdict, sc.verdict)
    print(f"  VERDICT   : {verdict_display}")
    print(f"  SCORE     : {sc.overall_score:.1f} / 100   [ {sc.credibility_rating} ]")
    print(f"  SUMMARY   : {sc.verdict_summary}")

    # ── Dimension breakdown ───────────────────────────────────────────────
    print(f"\n{SEP}")
    print("  DIMENSION BREAKDOWN")
    print(SEP2)
    print(f"  {'DIMENSION':<20} {'SCORE':>6}   {'WEIGHT':>6}   {'CONTRIB':>7}   SUMMARY")
    print(SEP2)
    for d in sc.dimensions:
        bar = "#" * int(d.score / 5) + "-" * (20 - int(d.score / 5))
        print(f"  {d.name:<20} {d.score:>5.1f}   {d.weight*100:>5.0f}%   {d.contribution:>6.1f}   [{bar}]")
        if d.summary:
            print(f"  {'':20}   {d.summary[:55]}")

    # ── Ad Profile ────────────────────────────────────────────────────────
    print(f"\n{SEP}")
    print("  AD PROFILE  (Raw HTML analysis)")
    print(SEP2)
    print(f"  Total Ads Found   : {sc.ad_profile.total_ad_slots}")
    if sc.ad_profile.total_ad_slots > 0:
        print(f"  Ad Density        : {sc.ad_profile.ad_density:.1f} ads per 100 words")
        if sc.ad_profile.has_clickbait_ads:
            networks = ", ".join(sc.ad_profile.clickbait_networks_found)
            print(f"  Clickbait Networks: [DETECTED] {networks}  (Red Flag)")
        else:
            print(f"  Clickbait Networks: None detected")

    # ── Ollama extraction results ─────────────────────────────────────────
    print(f"\n{SEP}")
    print("  OLLAMA ANALYSIS  (qwen3:8b — context-aware extraction)")
    print(SEP2)
    print(f"  Content Tone      : {sc.content_tone}")

    if sc.article_context:
        print(f"\n  Article Context   :")
        print(f"    {sc.article_context[:120]}")

    if sc.relevant_facts:
        print(f"\n  Relevant Facts    : {len(sc.relevant_facts)} (directly related to article context)")
        for f in sc.relevant_facts[:5]:
            print(f"    [+] {f[:80]}")

    if sc.irrelevant_facts:
        print(f"\n  Irrelevant Facts  : {len(sc.irrelevant_facts)} [RED FLAG — off-context padding detected]")
        for f in sc.irrelevant_facts[:4]:
            print(f"    [!] {f[:80]}")

    if sc.main_claims:
        print(f"\n  Main Claims       : {len(sc.main_claims)}")
        for c in sc.main_claims[:3]:
            print(f"    - {c[:80]}")

    if sc.clickbait_elements:
        print(f"\n  Clickbait Signals : {', '.join(sc.clickbait_elements[:3])}")
    if sc.emotional_phrases:
        print(f"  Emotional Phrases : {', '.join(sc.emotional_phrases[:4])}")
    if sc.bias_indicators:
        print(f"  Bias Indicators   : {', '.join(sc.bias_indicators[:3])}")
    if sc.misleading_patterns:
        print(f"  Misleading Signs  : {', '.join(sc.misleading_patterns[:3])}")


    # ── Corroboration results ─────────────────────────────────────────────
    print(f"\n{SEP}")
    print("  WEB CORROBORATION  (Tavily live search results)")
    print(SEP2)
    print(f"  Verdict           : {v.verdict_label}")
    print(f"  Total Sources     : {v.total_sources_found}")
    print(f"  Trusted Sources   : {v.trusted_sources_count}  (Tier-1: {v.tier1_count} | Tier-2: {v.tier2_count})")
    print(f"  Corroboration     : {v.corroboration_score:.3f} / 1.000")
    print(f"  Queries Used      : {len(v.search_queries_used)}")

    if v.top_sources:
        trusted_only = [s for s in v.top_sources if s.trusted]
        others = [s for s in v.top_sources if not s.trusted]

        if trusted_only:
            print(f"\n  Trusted Sources Corroborating ({len(trusted_only)} found):")
            for s in trusted_only[:15]:
                tier_tag = f"T{s.tier}" if s.trusted else "--"
                print(f"    [{tier_tag}] {s.domain:<30} {s.title[:45]}")

        if others:
            print(f"\n  Other Sources ({len(others)} found — not in trusted list):")
            for s in others[:10]:
                print(f"    [--] {s.domain:<30} {s.title[:45]}")

    # ── Red flags & positive signals ──────────────────────────────────────
    print(f"\n{SEP}")
    print("  SIGNALS")
    print(SEP2)
    if sc.red_flags:
        print("  RED FLAGS:")
        for flag in sc.red_flags:
            print(f"    [!] {flag}")
    else:
        print("  RED FLAGS    : None detected")

    if sc.positive_signals:
        print("\n  POSITIVE SIGNALS:")
        for sig in sc.positive_signals:
            print(f"    [+] {sig}")
    else:
        print("  POSITIVE SIG : None detected")

    # ── Image forensics ──────────────────────────────────────────────────
    if sc.image_analysis:
        ia = sc.image_analysis
        print(f"\n{SEP}")
        print("  IMAGE FORENSICS  (Deepfake detection — Xception + GradCAM)")
        print(SEP2)
        print(f"  Images Analyzed  : {ia.total_images_analyzed}")
        print(f"  Fake Detected    : {ia.fake_images_detected}")
        print(f"  Authenticity     : {ia.image_authenticity_score:.1f} / 100")

        if ia.results:
            print(f"\n  Per-Image Results:")
            for r in ia.results:
                tag = "FAKE" if r.verdict == "FAKE" else "REAL"
                pct = f"{r.fake_probability * 100:.1f}%"
                # Truncate long URLs
                url_display = r.url if len(r.url) <= 60 else r.url[:57] + "..."
                print(f"    [{tag:4s} {pct:>5s}] {url_display}")

        if ia.flagged_images:
            print(f"\n  Flagged (>60% fake probability):")
            for url in ia.flagged_images:
                url_display = url if len(url) <= 60 else url[:57] + "..."
                print(f"    [!!] {url_display}")

    print(f"\n{SEP}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Article Credibility & Fake News Detection — powered by Ollama + Tavily"
    )
    parser.add_argument("--url",   type=str, help="URL of the article to analyse")
    parser.add_argument("--text",  type=str, help="Raw text of the article")
    parser.add_argument("--title", type=str, help="Article title (for raw text mode)")
    parser.add_argument("--publisher", type=str, help="Publisher/domain name (optional)")
    parser.add_argument("--json",  action="store_true", help="Output full JSON report")
    parser.add_argument("--verbose", action="store_true", help="Show detailed pipeline logs")

    args = parser.parse_args()

    if not args.url and not args.text:
        print("Error: provide --url or --text", file=sys.stderr)
        parser.print_help()
        sys.exit(1)

    if not args.verbose:
        logging.getLogger().setLevel(logging.WARNING)
    else:
        logging.getLogger().setLevel(logging.INFO)

    # In --json mode stdout must be pure JSON — send progress to stderr instead
    _out = sys.stderr if args.json else sys.stdout
    print("\nAnalyzing article...", file=_out)
    print("  Step 1/5 — Extracting article text and images...", file=_out)

    article_input = ArticleInput(
        url=args.url,
        raw_text=args.text,
        title=args.title,
        publisher=args.publisher,
    )

    pipeline = ArticlePipeline()

    try:
        scorecard = pipeline.run(article_input)
    except Exception as e:
        print(f"\nPipeline error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        # Flush the text layer first so buffered prints don't interleave with binary write
        sys.stdout.flush()
        # Write raw UTF-8 bytes directly to stdout's binary buffer.
        # This bypasses Windows cp1252 entirely and avoids UnicodeEncodeError
        # for characters like ₹ (\u20b9), em-dashes, etc.
        json_bytes = scorecard.model_dump_json(indent=2).encode('utf-8')
        sys.stdout.buffer.write(json_bytes)
        sys.stdout.buffer.write(b'\n')
        sys.stdout.buffer.flush()
    else:
        print_scorecard(scorecard)


if __name__ == "__main__":
    main()
