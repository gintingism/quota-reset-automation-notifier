/**
 * Scrapes gemini.google.com/usage supporting both Indonesian and English UI.
 */

const POLL_INTERVAL_MS = 300;
const SCRAPE_TIMEOUT_MS = 10000;

function scrapePageData() {
  const cleanText = (document.body.innerText || '').replace(/\s+/g, ' ');

  const dailyMatch = cleanText.match(
    /(?:Current usage|Penggunaan saat ini).*?(\d+)\s*%\s*(?:used|digunakan)/i,
  );
  const dailyResetMatch = cleanText.match(
    /(?:Resets at|Direset pukul)\s*([0-9.:]+\s*(?:AM|PM)?)/i,
  );
  const weeklyMatch = cleanText.match(
    /(?:Weekly limit|Batas mingguan).*?(\d+)\s*%\s*(?:used|digunakan)/i,
  );
  const weeklyResetMatch = cleanText.match(
    /(?:Resets\s*|Direset pada\s*)([A-Za-z0-9.,:\s]+?(?:AM|PM|\d{2}[.:]\d{2}))/i,
  );

  if (dailyMatch || weeklyMatch) {
    return {
      dailyUsed: dailyMatch ? parseInt(dailyMatch[1], 10) : 0,
      dailyReset: dailyResetMatch ? dailyResetMatch[1].trim() : 'Unknown',
      weeklyUsed: weeklyMatch ? parseInt(weeklyMatch[1], 10) : 0,
      weeklyReset: weeklyResetMatch ? weeklyResetMatch[1].trim() : 'Unknown',
      lastUpdated: new Date().toISOString(),
    };
  }
  return null;
}

const checkInterval = setInterval(() => {
  const data = scrapePageData();
  if (data) {
    clearInterval(checkInterval);
    chrome.runtime.sendMessage({ action: 'SYNC_COMPLETE', data });
  }
}, POLL_INTERVAL_MS);

setTimeout(() => {
  clearInterval(checkInterval);
  chrome.runtime.sendMessage({ action: 'SYNC_FAILED' });
}, SCRAPE_TIMEOUT_MS);
