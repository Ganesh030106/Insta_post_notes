/**
 * InstaConvert - Instagram In-Page Content Script
 * 1. Responds to popup extraction requests from inside the first-party Instagram origin.
 * 2. Injects a "Save as PDF" action button on Instagram post action bars.
 */

const BUTTON_CLASS = 'instaconvert-action-btn';
const DOC_ID_WEB_INFO = '27128499623469141';
const IG_APP_ID = '936619743392459';

/**
 * Handle extraction requested by popup/background from first-party page context
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_POST_IMAGES' && message.shortcode) {
    executeGraphQLInPage(message.shortcode)
      .then((urls) => sendResponse({ success: true, urls }))
      .catch((err) => {
        console.warn('[InstaConvert Content] GraphQL in-page error:', err);
        // Fallback: Try DOM scraping
        const domUrls = scrapeDomImages();
        if (domUrls && domUrls.length > 0) {
          sendResponse({ success: true, urls: domUrls });
        } else {
          sendResponse({ success: false, error: err.message });
        }
      });
    return true; // Keep message channel open for async response
  }
});

/**
 * Execute GraphQL query inside the Instagram page context using document.cookie.
 */
async function executeGraphQLInPage(shortcode) {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  const csrfToken = match ? match[1] : '';

  const body = new URLSearchParams({
    doc_id: DOC_ID_WEB_INFO,
    variables: JSON.stringify({
      shortcode: shortcode,
      __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
    }),
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-ig-app-id': IG_APP_ID,
    'x-requested-with': 'XMLHttpRequest',
  };

  if (csrfToken) {
    headers['x-csrftoken'] = csrfToken;
  }

  const response = await fetch('https://www.instagram.com/graphql/query', {
    method: 'POST',
    headers,
    body: body.toString(),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`In-page query HTTP ${response.status}`);
  }

  const data = await response.json();
  const webInfo = data?.data?.xdt_api__v1__media__shortcode__web_info;
  const items = webInfo?.items || data?.items || [];

  if (!items || items.length === 0) {
    throw new Error('No items found');
  }

  const item = items[0];
  const urls = [];

  // Carousel
  if (item.carousel_media && Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
    for (const slide of item.carousel_media) {
      const candidates = slide.image_versions2?.candidates;
      if (candidates && candidates.length > 0) {
        urls.push(candidates[0].url);
      } else if (slide.display_url) {
        urls.push(slide.display_url);
      }
    }
    return urls;
  }

  // Single media
  if (item.image_versions2?.candidates?.length > 0) {
    urls.push(item.image_versions2.candidates[0].url);
    return urls;
  }

  if (item.display_url) {
    urls.push(item.display_url);
    return urls;
  }

  return urls;
}

/**
 * Fallback: Scrape visible images from the active article in the DOM
 */
function scrapeDomImages() {
  const images = [];
  const article = document.querySelector('article');
  if (article) {
    const imgElements = article.querySelectorAll('ul li img, div[role="presentation"] img');
    imgElements.forEach((img) => {
      if (img.src && !img.src.includes('profile_pic') && !images.includes(img.src)) {
        images.push(img.src);
      }
    });
  }
  return images;
}

/**
 * In-Page Button Injection
 */
function injectSavePdfButton() {
  const articles = document.querySelectorAll('article');
  articles.forEach((article) => {
    if (article.querySelector(`.${BUTTON_CLASS}`)) return;

    const bookmarkButton = article.querySelector('svg[aria-label*="Save"], svg[aria-label*="Bookmark"]')?.closest('div[role="button"], button') 
      || article.querySelector('section span button');

    if (!bookmarkButton) return;
    const parentContainer = bookmarkButton.parentElement;
    if (!parentContainer) return;

    const btn = document.createElement('button');
    btn.className = BUTTON_CLASS;
    btn.setAttribute('title', 'InstaConvert: Export as PDF');
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="12" y1="18" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <polyline points="9 15 12 18 15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span>PDF</span>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const postLink = article.querySelector('a[href*="/p/"], a[href*="/reel/"]')?.href || window.location.href;
      navigator.clipboard?.writeText(postLink).catch(() => {});

      btn.classList.add('active');
      const originalText = btn.querySelector('span').textContent;
      btn.querySelector('span').textContent = 'Copied!';

      setTimeout(() => {
        btn.classList.remove('active');
        btn.querySelector('span').textContent = originalText;
      }, 1500);
    });

    parentContainer.appendChild(btn);
  });
}

// Observe dynamic DOM changes for SPA navigation
const observer = new MutationObserver(() => {
  injectSavePdfButton();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

setTimeout(injectSavePdfButton, 1500);
