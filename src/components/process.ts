import { spawn } from 'node:child_process';

export async function runProcess(command: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, { cwd, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch { /* The process may have exited between timeout and signal. */ }
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 250);
    };
    const timer = setTimeout(() => stop(new Error(`Analysis process timed out after ${timeoutMs}ms`)), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stop(new Error('Analysis output exceeds the 2 MB limit'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 2_000_000) stop(new Error('Analysis error output exceeds the 2 MB limit'));
    });
    child.on('error', (error) => { failure = error; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) { clearTimeout(killTimer); kill('SIGKILL'); }
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Analysis process exited ${code}: ${stderr.slice(0,1000)}`));
      else resolve({ stdout, stderr });
    });
  });
}
