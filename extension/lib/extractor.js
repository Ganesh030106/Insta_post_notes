/**
 * Instagram Media Extractor (Manifest V3)
 * Full carousel extraction engine utilizing native page scripting & declarativeNetRequest.
 */

const DOC_ID_WEB_INFO = '27128499623469141';
const IG_APP_ID = '936619743392459';

/**
 * Extract shortcode from an Instagram URL.
 * Handles /p/, /reel/, /tv/ and profile-prefixed URLs.
 * @param {string} url
 * @returns {string|null}
 */
export function extractShortcode(url) {
  if (!url) return null;
  const patterns = [
    /instagram\.com(?:\/[^/?#]+)?\/p\/([A-Za-z0-9_-]+)/,
    /instagram\.com(?:\/[^/?#]+)?\/reel\/([A-Za-z0-9_-]+)/,
    /instagram\.com(?:\/[^/?#]+)?\/tv\/([A-Za-z0-9_-]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Retrieve CSRF token from Chrome's cookie store for instagram.com.
 * @returns {Promise<string>}
 */
export async function getCsrfToken() {
  try {
    if (typeof chrome !== 'undefined' && chrome.cookies?.get) {
      const cookie = await chrome.cookies.get({ url: 'https://www.instagram.com', name: 'csrftoken' });
      if (cookie?.value) {
        return cookie.value;
      }
    }
  } catch (err) {
    console.debug('Error reading csrftoken from cookie store:', err);
  }

  try {
    await fetch('https://www.instagram.com/', { credentials: 'include' });
    if (typeof chrome !== 'undefined' && chrome.cookies?.get) {
      const cookie = await chrome.cookies.get({ url: 'https://www.instagram.com', name: 'csrftoken' });
      if (cookie?.value) {
        return cookie.value;
      }
    }
  } catch (err) {
    console.debug('Instagram ping failed:', err);
  }

  return '';
}

/**
 * Method 1: Execute query directly inside the active Instagram tab.
 * This runs with first-party origin, native cookies, and 0% chance of 403.
 * @param {string} shortcode
 * @returns {Promise<string[]|null>}
 */
async function fetchViaActiveTabScripting(shortcode) {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.scripting?.executeScript) {
      return null;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url || !tab.url.includes('instagram.com')) {
      return null;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (targetShortcode, docId, appId) => {
        // 1. Get CSRF token from document.cookie
        const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        const csrf = match ? match[1] : '';

        // 2. Query official GraphQL endpoint
        const body = new URLSearchParams({
          doc_id: docId,
          variables: JSON.stringify({
            shortcode: targetShortcode,
            __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
          }),
        });

        const headers = {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-ig-app-id': appId,
          'x-requested-with': 'XMLHttpRequest',
        };
        if (csrf) headers['x-csrftoken'] = csrf;

        const res = await fetch('https://www.instagram.com/graphql/query', {
          method: 'POST',
          headers,
          body: body.toString(),
          credentials: 'include',
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        const webInfo = json?.data?.xdt_api__v1__media__shortcode__web_info;
        const items = webInfo?.items || json?.items || [];

        if (!items || items.length === 0) throw new Error('No items');
        const item = items[0];
        const urls = [];

        // Carousel items
        if (item.carousel_media && Array.isArray(item.carousel_media)) {
          for (const slide of item.carousel_media) {
            const candidates = slide.image_versions2?.candidates;
            if (candidates && candidates.length > 0) {
              urls.push(candidates[0].url);
            } else if (slide.display_url) {
              urls.push(slide.display_url);
            }
          }
          if (urls.length > 0) return urls;
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
      },
      args: [shortcode, DOC_ID_WEB_INFO, IG_APP_ID],
    });

    if (results && results[0]?.result && results[0].result.length > 0) {
      return results[0].result;
    }
  } catch (err) {
    console.debug('Active tab scripting query failed:', err);
  }
  return null;
}

/**
 * Method 2: GraphQL Query from Extension Popup (with declarativeNetRequest Origin rewrite)
 * @param {string} shortcode
 * @returns {Promise<string[]>}
 */
async function fetchViaGraphQL(shortcode) {
  const csrfToken = await getCsrfToken();

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
    throw new Error(`GraphQL query responded with HTTP ${response.status}`);
  }

  const data = await response.json();
  const webInfo = data?.data?.xdt_api__v1__media__shortcode__web_info;
  const items = webInfo?.items || data?.items || [];

  if (!items || items.length === 0) {
    throw new Error('No items returned for this shortcode.');
  }

  return parsePostItems(items[0]);
}

/**
 * Parse an Instagram post item object and extract all image URLs.
 * @param {object} item
 * @returns {string[]}
 */
function parsePostItems(item) {
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
 * Method 3: Active Tab Content Script Message
 * @param {string} shortcode
 * @returns {Promise<string[]|null>}
 */
async function fetchViaContentMessage(shortcode) {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url || !tab.url.includes('instagram.com')) {
      return null;
    }

    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tab.id,
        { type: 'EXTRACT_POST_IMAGES', shortcode },
        (res) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(res);
          }
        }
      );
    });

    if (response && response.success && response.urls && response.urls.length > 0) {
      return response.urls;
    }
  } catch (err) {
    console.debug('Content message extraction failed:', err);
  }
  return null;
}

/**
 * Main coordinator function to fetch all post image URLs.
 * @param {string} shortcode
 * @returns {Promise<string[]>}
 */
export async function fetchPostImageUrls(shortcode) {
  // Method 1: In-Page Scripting (Native page context, 100% reliable when browsing IG)
  try {
    const tabUrls = await fetchViaActiveTabScripting(shortcode);
    if (tabUrls && tabUrls.length > 0) {
      console.log(`[InstaConvert] Extracted ${tabUrls.length} page(s) via Active Tab Scripting`);
      return tabUrls;
    }
  } catch (err) {
    console.warn('[InstaConvert] Tab scripting attempt failed:', err);
  }

  // Method 2: GraphQL Query with DNR header rewriting
  try {
    const urls = await fetchViaGraphQL(shortcode);
    if (urls && urls.length > 0) {
      console.log(`[InstaConvert] Extracted ${urls.length} page(s) via GraphQL (DNR)`);
      return urls;
    }
  } catch (err) {
    console.warn('[InstaConvert] GraphQL extraction error:', err);
  }

  // Method 3: Content script message
  try {
    const msgUrls = await fetchViaContentMessage(shortcode);
    if (msgUrls && msgUrls.length > 0) {
      console.log(`[InstaConvert] Extracted ${msgUrls.length} page(s) via Content Message`);
      return msgUrls;
    }
  } catch (err) {
    console.warn('[InstaConvert] Content message attempt failed:', err);
  }

  throw new Error(
    'Unable to extract all post pages. Please make sure the post is public and you are logged into Instagram in this browser.'
  );
}

/**
 * Fetch an image URL and convert it to a Blob.
 * @param {string} url
 * @returns {Promise<Blob>}
 */
export async function fetchImageBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image (HTTP ${response.status})`);
  }
  return await response.blob();
}

/**
 * Convert Blob to Data URL.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Get natural width and height from an image Data URL.
 * @param {string} dataUrl
 * @returns {Promise<{width: number, height: number}>}
 */
export function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('Failed to decode image data'));
    img.src = dataUrl;
  });
}
