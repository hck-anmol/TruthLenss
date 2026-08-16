import { NextRequest, NextResponse } from 'next/server';
import { spawn }                      from 'child_process';
import path                           from 'path';
import fs                             from 'fs';
import os                             from 'os';


const PYTHON_ROOT = path.resolve(process.cwd(), '..');
const PYTHON_EXE  = path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe');
const MAIN_SCRIPT = path.join(PYTHON_ROOT, 'main.py');






function runPython(args: string[], timeoutMs = 15 * 60 * 1000): Promise<string> {
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
    throw new Error(`Backend returned no JSON.\nstdout: ${stdout.slice(0, 300)}`);
  }
  return JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
}

function cleanupFile(p: string) {
  if (p) {
    try { fs.unlinkSync(p); } catch {  }
  }
}



export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    let tmpImagePath = '';
    try {
      const formData = await req.formData();
      const imgFile  = formData.get('image') as File | null;
      const url      = formData.get('url')   as string | null;
      const text     = formData.get('text')  as string | null;

      if (!imgFile && !url && !text) {
        return NextResponse.json(
          { error: 'Provide an image file, url, or text.' },
          { status: 400 }
        );
      }

      const args: string[] = [MAIN_SCRIPT, '--json'];


            if (imgFile) {
        const ext    = path.extname(imgFile.name) || '.jpg';
        tmpImagePath = path.join(os.tmpdir(), `tl_image_${Date.now()}${ext}`);
        const buffer = Buffer.from(await imgFile.arrayBuffer());
        fs.writeFileSync(tmpImagePath, buffer);
        args.push('--image', tmpImagePath);
      }

      if (url)  args.push('--url',  url);
      if (text) args.push('--text', text);

      const stdout    = await runPython(args, 15 * 60 * 1000);
      const scorecard = parseJson(stdout);
      return NextResponse.json(scorecard);

    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      return NextResponse.json({ error: message }, { status: 500 });
    } finally {
      cleanupFile(tmpImagePath);
    }
  }


    try {
    const body        = await req.json();
    const { url, text } = body;

    if (!url && !text) {
      return NextResponse.json({ error: 'Provide either a url or text field.' }, { status: 400 });
    }

    const args: string[] = [MAIN_SCRIPT, '--json'];
    if (url)  args.push('--url',  url);
    if (text) args.push('--text', text);

    const stdout    = await runPython(args, 15 * 60 * 1000);
    const scorecard = parseJson(stdout);
    return NextResponse.json(scorecard);

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
