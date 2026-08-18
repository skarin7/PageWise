/**
 * Options / first-run setup page.
 * Lets the user pre-download models instead of hitting the ~23MB (search)
 * or ~300MB (generation) download on their first real question.
 */

import { EmbeddingService } from '../../core/EmbeddingService';

function setStatus(elId: string, text: string, kind: 'idle' | 'done' | 'error' = 'idle'): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = `status-line${kind !== 'idle' ? ' ' + kind : ''}`;
}

function setProgress(trackId: string, fillId: string, percent: number): void {
  const track = document.getElementById(trackId);
  const fill = document.getElementById(fillId) as HTMLDivElement | null;
  if (!track || !fill) return;
  track.classList.add('active');
  fill.style.width = `${percent}%`;
  if (percent >= 100) {
    setTimeout(() => track.classList.remove('active'), 600);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const searchBtn = document.getElementById('download-search-btn') as HTMLButtonElement;
  const genBtn = document.getElementById('download-gen-btn') as HTMLButtonElement;
  const skipGenBtn = document.getElementById('skip-gen-btn') as HTMLButtonElement;

  searchBtn.addEventListener('click', async () => {
    searchBtn.disabled = true;
    setStatus('search-status', 'Downloading…');

    try {
      const embedder = EmbeddingService.getInstance();
      await embedder.init((percent) => {
        setStatus('search-status', `Downloading… ${percent}%`);
        setProgress('search-progress-track', 'search-progress-fill', percent);
      });
      setStatus('search-status', '✓ Ready — cached for every page', 'done');
      searchBtn.textContent = 'Downloaded';
    } catch (error) {
      setStatus('search-status', `Failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      searchBtn.disabled = false;
    }
  });

  genBtn.addEventListener('click', () => {
    genBtn.disabled = true;
    skipGenBtn.disabled = true;
    setStatus('gen-status', 'Downloading…');

    const progressListener = (message: any) => {
      if (message?.type === 'MODEL_DOWNLOAD_PROGRESS' && message.model === 'generation') {
        setStatus('gen-status', `Downloading… ${message.percent}%`);
        setProgress('gen-progress-track', 'gen-progress-fill', message.percent);
      }
    };
    chrome.runtime.onMessage.addListener(progressListener);

    chrome.runtime.sendMessage({ type: 'DOWNLOAD_GENERATION_MODEL' }, (response) => {
      chrome.runtime.onMessage.removeListener(progressListener);
      if (chrome.runtime.lastError || !response?.success) {
        setStatus('gen-status', `Failed: ${response?.error || chrome.runtime.lastError?.message || 'unknown error'}`, 'error');
        genBtn.disabled = false;
        skipGenBtn.disabled = false;
        return;
      }
      setStatus('gen-status', '✓ Ready — cached for offline answers', 'done');
      genBtn.textContent = 'Downloaded';
      skipGenBtn.style.display = 'none';
    });
  });

  skipGenBtn.addEventListener('click', () => {
    setStatus('gen-status', 'Skipped — will download on first use of Transformers.js');
    genBtn.disabled = true;
    skipGenBtn.disabled = true;
  });
});
