/**
 * InstaConvert - Chrome Extension Popup Controller
 */

import { extractShortcode, fetchPostImageUrls, fetchImageBlob } from '../lib/extractor.js';
import { createInstagramPdf } from '../lib/pdf_builder.js';

// DOM Elements
const postUrlInput    = document.getElementById('post-url');
const convertBtn      = document.getElementById('convert-btn');
const clearBtn        = document.getElementById('clear-btn');
const detectedBanner  = document.getElementById('detected-banner');
const useDetectedBtn  = document.getElementById('use-detected-btn');
const tabStatusBadge  = document.getElementById('tab-status-badge');

const inputSection    = document.getElementById('input-section');
const loadingSection  = document.getElementById('loading-section');
const successSection  = document.getElementById('success-section');
const errorSection    = document.getElementById('error-section');

const loadingTitle    = document.getElementById('loading-title');
const downloadBtn     = document.getElementById('download-btn');
const successDesc     = document.getElementById('success-desc');
const errorMessage    = document.getElementById('error-message');
const resetBtn        = document.getElementById('reset-btn');
const retryBtn        = document.getElementById('retry-btn');

const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');

const ls1 = document.getElementById('ls-1');
const ls2 = document.getElementById('ls-2');
const ls3 = document.getElementById('ls-3');

// State
let generatedPdfBlob = null;
let currentShortcode = '';
let activeTabPostUrl = '';

// ── Initialize Active Tab Detection ──────────────────────────────────────────
async function initActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('instagram.com')) {
      const code = extractShortcode(tab.url);
      if (code) {
        activeTabPostUrl = tab.url;
        detectedBanner.classList.remove('hidden');
        tabStatusBadge.textContent = 'Post Found';
        tabStatusBadge.style.color = '#34d399';
        tabStatusBadge.style.borderColor = 'rgba(52, 211, 153, 0.4)';
        // Pre-fill input
        postUrlInput.value = tab.url;
        clearBtn.classList.add('visible');
      }
    }
  } catch (err) {
    console.debug('Active tab query ignored:', err);
  }
}

useDetectedBtn.addEventListener('click', () => {
  if (activeTabPostUrl) {
    postUrlInput.value = activeTabPostUrl;
    clearBtn.classList.add('visible');
    convertBtn.click();
  }
});

// ── Input Interactions ───────────────────────────────────────────────────────
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

// ── Navigation & Steps ───────────────────────────────────────────────────────
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

function setStep(n) {
  [step1, step2, step3].forEach((s, idx) => {
    s.classList.remove('active', 'done');
    if (idx + 1 < n)  s.classList.add('done');
    if (idx + 1 === n) s.classList.add('active');
  });
}

function setLoadStep(activeIdx) {
  [ls1, ls2, ls3].forEach((el, idx) => {
    el.classList.remove('active', 'done');
    if (idx + 1 < activeIdx) el.classList.add('done');
    if (idx + 1 === activeIdx) el.classList.add('active');
  });
}

// ── Main Conversion Flow ─────────────────────────────────────────────────────
convertBtn.addEventListener('click', async () => {
  const url = postUrlInput.value.trim();

  if (!url) {
    postUrlInput.focus();
    return;
  }

  const shortcode = extractShortcode(url);
  if (!shortcode) {
    showError('Please enter a valid Instagram post or reel link.');
    return;
  }

  currentShortcode = shortcode;
  setStep(2);
  showSection('loading');
  setLoadStep(1);
  loadingTitle.textContent = 'Fetching post media…';

  try {
    // 1. Extract image URLs
    const imageUrls = await fetchPostImageUrls(shortcode);
    if (!imageUrls || imageUrls.length === 0) {
      throw new Error('No images could be extracted from this post.');
    }

    // 2. Download Image Blobs
    setLoadStep(2);
    loadingTitle.textContent = `Downloading ${imageUrls.length} image${imageUrls.length > 1 ? 's' : ''}…`;

    const imageBlobs = [];
    for (let i = 0; i < imageUrls.length; i++) {
      loadingTitle.textContent = `Downloading image ${i + 1} of ${imageUrls.length}…`;
      const blob = await fetchImageBlob(imageUrls[i]);
      imageBlobs.push(blob);
    }

    // 3. Render into PDF
    setLoadStep(3);
    loadingTitle.textContent = 'Composing PDF…';

    const pdfBlob = await createInstagramPdf(imageBlobs, shortcode, (curr, total, msg) => {
      loadingTitle.textContent = msg;
    });

    generatedPdfBlob = pdfBlob;

    // Finish
    [ls1, ls2, ls3].forEach(el => {
      el.classList.remove('active');
      el.classList.add('done');
    });

    await new Promise(r => setTimeout(r, 300));

    setStep(3);
    successDesc.textContent = `${imageBlobs.length} page${imageBlobs.length > 1 ? 's' : ''} converted into A4 PDF.`;
    showSection('success');

  } catch (err) {
    console.error('Conversion failed:', err);
    showError(err.message || 'Failed to convert Instagram post.');
  }
});

// ── Download Action ──────────────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
  if (!generatedPdfBlob) return;

  const filename = `instagram_${currentShortcode || 'post'}.pdf`;
  const blobUrl = URL.createObjectURL(generatedPdfBlob);

  if (chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({
      url: blobUrl,
      filename,
      saveAs: true,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        fallbackDownload(blobUrl, filename);
      }
    });
  } else {
    fallbackDownload(blobUrl, filename);
  }
});

function fallbackDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Reset & Retry ────────────────────────────────────────────────────────────
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
  postUrlInput.focus();
});

function showError(msg) {
  setStep(1);
  errorMessage.textContent = msg;
  showSection('error');
}

// Start active tab detection on open
initActiveTab();
