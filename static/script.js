/**
 * Instagram → PDF Converter — Frontend Logic
 */

// ── DOM References ──────────────────────────────────────────────────────────
const postUrlInput  = document.getElementById('post-url');
const convertBtn    = document.getElementById('convert-btn');
const clearBtn      = document.getElementById('clear-btn');
const inputSection  = document.getElementById('input-section');
const loadingSection= document.getElementById('loading-section');
const successSection= document.getElementById('success-section');
const errorSection  = document.getElementById('error-section');
const downloadBtn   = document.getElementById('download-btn');
const errorMessage  = document.getElementById('error-message');
const resetBtn      = document.getElementById('reset-btn');
const retryBtn      = document.getElementById('retry-btn');

const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');
const ls1   = document.getElementById('ls-1');
const ls2   = document.getElementById('ls-2');
const ls3   = document.getElementById('ls-3');

// ── State ───────────────────────────────────────────────────────────────────
let lastUrl = '';

// ── Input Interactivity ─────────────────────────────────────────────────────
postUrlInput.addEventListener('input', () => {
  clearBtn.classList.toggle('visible', postUrlInput.value.length > 0);
});

clearBtn.addEventListener('click', () => {
  postUrlInput.value = '';
  clearBtn.classList.remove('visible');
  postUrlInput.focus();
});

postUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') convertBtn.click();
});

// ── Show / Hide Sections ────────────────────────────────────────────────────
function showSection(name) {
  inputSection.classList.add('hidden');
  loadingSection.classList.add('hidden');
  successSection.classList.add('hidden');
  errorSection.classList.add('hidden');

  if (name === 'input')   inputSection.classList.remove('hidden');
  if (name === 'loading') loadingSection.classList.remove('hidden');
  if (name === 'success') successSection.classList.remove('hidden');
  if (name === 'error')   errorSection.classList.remove('hidden');
}

// ── Step Indicator ──────────────────────────────────────────────────────────
function setStep(n) {
  [step1, step2, step3].forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i + 1 < n)  s.classList.add('done');
    if (i + 1 === n) s.classList.add('active');
  });
}

// ── Loading animation ───────────────────────────────────────────────────────
let loadingTimers = [];
function startLoadingAnimation() {
  [ls1, ls2, ls3].forEach(el => el.classList.remove('active', 'done'));

  const delays = [0, 1800, 3500];
  const steps  = [ls1, ls2, ls3];

  steps.forEach((el, i) => {
    const t = setTimeout(() => {
      steps.forEach((s, j) => {
        if (j < i) s.classList.add('done'), s.classList.remove('active');
      });
      el.classList.add('active');
    }, delays[i]);
    loadingTimers.push(t);
  });
}
function stopLoadingAnimation() {
  loadingTimers.forEach(clearTimeout);
  loadingTimers = [];
}

// ── Main Convert Flow ────────────────────────────────────────────────────────
convertBtn.addEventListener('click', async () => {
  const url = postUrlInput.value.trim();

  if (!url) {
    postUrlInput.focus();
    postUrlInput.style.borderColor = 'rgba(248,113,113,0.7)';
    setTimeout(() => { postUrlInput.style.borderColor = ''; }, 1500);
    return;
  }

  if (!url.includes('instagram.com')) {
    showError('Please paste a valid Instagram post URL.\nExample: https://www.instagram.com/p/SHORTCODE/');
    return;
  }

  lastUrl = url;
  setStep(2);
  showSection('loading');
  startLoadingAnimation();

  try {
    const response = await fetch('/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    stopLoadingAnimation();
    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || 'Conversion failed. Please try again.');
    }

    // Mark all loading steps as done
    [ls1, ls2, ls3].forEach(el => {
      el.classList.remove('active');
      el.classList.add('done');
    });

    // Small delay for UX
    await sleep(400);

    setStep(3);
    downloadBtn.href = `/download/${encodeURIComponent(data.pdf_filename)}`;
    downloadBtn.setAttribute('download', data.pdf_filename);
    showSection('success');

  } catch (err) {
    stopLoadingAnimation();
    showError(err.message || 'An unexpected error occurred.');
  }
});

// ── Reset / Retry ────────────────────────────────────────────────────────────
function resetToInput() {
  setStep(1);
  showSection('input');
  postUrlInput.value = '';
  clearBtn.classList.remove('visible');
  postUrlInput.focus();
}

resetBtn.addEventListener('click', resetToInput);

retryBtn.addEventListener('click', () => {
  setStep(1);
  showSection('input');
  // Keep the URL in the input for easy retry
  postUrlInput.value = lastUrl;
  clearBtn.classList.toggle('visible', lastUrl.length > 0);
  postUrlInput.focus();
});

// ── Error helper ─────────────────────────────────────────────────────────────
function showError(msg) {
  setStep(1);
  errorMessage.textContent = msg;
  showSection('error');
}

// ── Utility ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Paste from clipboard shortcut ────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'v' && document.activeElement !== postUrlInput) {
    postUrlInput.focus();
  }
});

// ── Inject SVG defs for spinner gradient ─────────────────────────────────────
(function injectSVGDefs() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `
    <defs>
      <linearGradient id="spinnerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7"/>
        <stop offset="100%" stop-color="#ec4899"/>
      </linearGradient>
    </defs>`;
  document.body.prepend(svg);
})();
