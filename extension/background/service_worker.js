/**
 * InstaConvert - Background Service Worker (Manifest V3)
 * Configures declarativeNetRequest rules to ensure origin & referer headers
 * match Instagram's first-party requirements.
 */

const DNR_RULE_ID = 101;

async function setupDNRRules() {
  try {
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_RULE_ID],
        addRules: [
          {
            id: DNR_RULE_ID,
            priority: 2,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                {
                  header: 'origin',
                  operation: 'set',
                  value: 'https://www.instagram.com',
                },
                {
                  header: 'referer',
                  operation: 'set',
                  value: 'https://www.instagram.com/',
                },
              ],
            },
            condition: {
              urlFilter: '||instagram.com/graphql/query',
              resourceTypes: ['xmlhttprequest'],
            },
          },
        ],
      });
      console.log('[InstaConvert] Dynamic DNR rules applied.');
    }
  } catch (err) {
    console.debug('Dynamic DNR rules setup:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupDNRRules();
});

chrome.runtime.onStartup.addListener(() => {
  setupDNRRules();
});

// Message listener for content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'PONG' });
  }
  return true;
});
