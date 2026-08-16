/**
 * /api/deepfake — Standalone Image & Video Deepfake Detection
 *
 * POST multipart/form-data with:
 *   - `image`: an image file (PNG/JPG/WEBP) for deepfake analysis
 *   - `video`: a video file (MP4/WEBM/MOV) for frame-by-frame deepfake analysis
 *
 * Video analysis: 3 fps normal pass → adaptive burst (5 fps) at ±2 sec around anomalies
 * Image analysis: runs the personally trained Xception model + GradCAM heatmap
 *
 * Returns the full CredibilityScorecard JSON (subset: image_analysis or video_analysis)
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn }                      from 'child_process';
import path                           from 'path';
import fs                             from 'fs';
import os                             from 'os';

const PYTHON_ROOT = path.resolve(process.cwd(), '..');
const PYTHON_EXE  = path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe');
const MAIN_SCRIPT = path.join(PYTHON_ROOT, 'main.py');

// ── Note: Allow large video uploads (up to 200 MB) ───────────────────────────
// Next.js App Router handles form-data streamingly. 
// Server action size limits are configured in next.config.ts.

// ── Python runner ─────────────────────────────────────────────────────────────

function runPython(args: string[], timeoutMs: number): Promise<string> {
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
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });

    setTimeout(() => {
      proc.kill();
      reject(new Error(`Analysis timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
    }, timeoutMs);
  });
}

function parseJson(stdout: string) {
  const firstBrace = stdout.indexOf('{');
  const lastBrace  = stdout.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(`Backend returned no JSON.\nstdout: ${stdout.slice(0, 400)}`);
  }
  return JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
}

function cleanupFile(p: string) {
  if (p) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Expected multipart/form-data with an image or video field.' },
      { status: 400 }
    );
  }

  let tmpFilePath = '';
  let mediaType: 'image' | 'video' = 'image';

  try {
    const formData = await req.formData();
    const imageFile = formData.get('image') as File | null;
    const videoFile = formData.get('video') as File | null;

    if (!imageFile && !videoFile) {
      return NextResponse.json(
        { error: 'Provide either an image or video file in the form data.' },
        { status: 400 }
      );
    }

    const args: string[] = [MAIN_SCRIPT, '--json'];

    if (videoFile) {
      mediaType = 'video';
      const ext   = path.extname(videoFile.name) || '.mp4';
      tmpFilePath = path.join(os.tmpdir(), `tl_deepfake_video_${Date.now()}${ext}`);

      // Write video to temp file in chunks to avoid memory pressure
      const buffer = Buffer.from(await videoFile.arrayBuffer());
      fs.writeFileSync(tmpFilePath, buffer);

      args.push('--video', tmpFilePath);

      // Video analysis timeout: 30 minutes (frame-by-frame is slow on CPU)
      const stdout    = await runPython(args, 30 * 60 * 1000);
      const scorecard = parseJson(stdout);
      return NextResponse.json(scorecard);

    } else if (imageFile) {
      mediaType = 'image';
      const ext   = path.extname(imageFile.name) || '.jpg';
      tmpFilePath = path.join(os.tmpdir(), `tl_deepfake_image_${Date.now()}${ext}`);

      const buffer = Buffer.from(await imageFile.arrayBuffer());
      fs.writeFileSync(tmpFilePath, buffer);

      args.push('--image', tmpFilePath);

      // Image analysis timeout: 5 minutes
      const stdout    = await runPython(args, 5 * 60 * 1000);
      const scorecard = parseJson(stdout);
      return NextResponse.json(scorecard);
    }

    // Should never reach here
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    console.error(`[/api/deepfake] ${mediaType} analysis error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    cleanupFile(tmpFilePath);
  }
}
