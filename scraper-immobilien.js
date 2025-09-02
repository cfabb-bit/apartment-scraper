const { chromium } = require('playwright');
const fs = require('fs');

async function debugScraper() {
  console.log('Starting debug scraper...');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  // FIX: Replace setUserAgent with setExtraHTTPHeaders
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });
  
  try {
    console.log('Navigating to ImmobilienScout24...');
    
    await page.goto('https://www.immobilienscout24.de/Suche/de/berlin/berlin/wohnung-mieten', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log('Page loaded successfully');
    
    // Wait for page to fully load
    await page.waitForTimeout(5000);
    
    // Check page title
    const title = await page.title();
    console.log('Page title:', title);
    
    // Check if we got redirected or blocked
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
    console.log('Screenshot saved as debug-screenshot.png');
    
    // Get page content to see what we're dealing with
    const bodyText = await page.evaluate(() => {
      return {
        title: document.title,
        bodyLength: document.body.innerText.length,
        bodyPreview: document.body.innerText.substring(0, 1000),
        hasResults: document.body.innerText.includes('Ergebnis') || document.body.innerText.includes('Wohnung'),
        allSelectors: Array.from(document.querySelectorAll('*')).slice(0, 100).map(el => el.tagName + (el.className ? '.' + el.className.split(' ').join('.') : '') + (el.id ? '#' + el.id : '')).filter(sel => sel.includes('result') || sel.includes('list') || sel.includes('entry') || sel.includes('apartment'))
      };
    });
    
    console.log('=== PAGE DEBUG INFO ===');
    console.log('Title:', bodyText.title);
    console.log('Body length:', bodyText.bodyLength);
    console.log('Has apartment results:', bodyText.hasResults);
    console.log('Body preview:', bodyText.bodyPreview);
    console.log('Relevant selectors found:', bodyText.allSelectors);
    
    // Check for common blocking indicators
    const blockingIndicators = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return {
        hasBot: text.includes('bot') || text.includes('robot'),
        hasCaptcha: text.includes('captcha') || text.includes('challenge'),
        hasBlocked: text.includes('blocked') || text.includes('access denied'),
        hasError: text.includes('error') || text.includes('fehler'),
        hasCookies: text.includes('cookie') || text.includes('datenschutz'),
        hasGeoblock: text.includes('location') || text.includes('region')
      };
    });
    
    console.log('=== BLOCKING INDICATORS ===');
    console.log('Bot detection:', blockingIndicators.hasBot);
    console.log('Captcha:', blockingIndicators.hasCaptcha);
    console.log('Blocked:', blockingIndicators.hasBlocked);
    console.log('Error page:', blockingIndicators.hasError);
    console.log('Cookie consent:', blockingIndicators.hasCookies);
    console.log('Geo-blocking:', blockingIndicators.hasGeoblock);
    
    // Try to find ANY elements that might contain listings
    const elementCounts = await page.evaluate(() => {
      return {
        articles: document.querySelectorAll('article').length,
        divs: document.querySelectorAll('div[class*="result"], div[class*="list"], div[class*="entry"]').length,
        listings: document.querySelectorAll('[class*="listing"], [class*="apartment"], [class*="result"]').length,
        links: document.querySelectorAll('a[href*="expose"]').length,
        dataTestIds: document.querySelectorAll('[data-testid]').length,
        dataIds: document.querySelectorAll('[data-id]').length
      };
    });
    
    console.log('=== ELEMENT COUNTS ===');
    console.log('Articles:', elementCounts.articles);
    console.log('Result/List divs:', elementCounts.divs);
    console.log('Listing elements:', elementCounts.listings);
    console.log('Expose links:', elementCounts.links);
    console.log('Data-testid elements:', elementCounts.dataTestIds);
    console.log('Data-id elements:', elementCounts.dataIds);
    
    // Get all data-testid values to see what's available
    const testIds = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid')).filter(Boolean);
    });
    
    console.log('=== AVAILABLE DATA-TESTIDS ===');
    console.log(testIds.slice(0, 20)); // Show first 20
    
    // Check if there's a cookie banner or other overlay
    const overlays = await page.evaluate(() => {
      const overlaySelectors = [
        '[class*="cookie"]',
        '[class*="consent"]',
        '[class*="banner"]',
        '[class*="modal"]',
        '[class*="overlay"]',
        '[class*="popup"]'
      ];
      
      return overlaySelectors.map(sel => ({
        selector: sel,
        count: document.querySelectorAll(sel).length,
        visible: document.querySelectorAll(sel + ':not([style*="display: none"])').length
      }));
    });
    
    console.log('=== POTENTIAL OVERLAYS ===');
    overlays.forEach(overlay => {
      if (overlay.count > 0) {
        console.log(`${overlay.selector}: ${overlay.count} total, ${overlay.visible} visible`);
      }
    });
    
    // Try to click away cookie banner if present
    try {
      const cookieButton = await page.$('[class*="cookie"] button, [class*="consent"] button, button[class*="accept"]');
      if (cookieButton) {
        console.log('Found cookie consent button, clicking...');
        await cookieButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('No cookie banner found or could not click');
    }
    
    // Save debug info to file
    const debugInfo = {
      timestamp: new Date().toISOString(),
      url: currentUrl,
      title: title,
      pageInfo: bodyText,
      blockingIndicators,
      elementCounts,
      testIds,
      overlays
    };
    
    fs.writeFileSync('debug-info.json', JSON.stringify(debugInfo, null, 2));
    console.log('Debug info saved to debug-info.json');
    
    // Return debug info for GitHub Actions
    const results = {
      success: true,
      count: 0, // This is debug mode, no actual apartments
      timestamp: new Date().toISOString(),
      source: 'immobilienscout24.de',
      debug: true,
      data: []
    };
    
    fs.writeFileSync('results-immobilien.json', JSON.stringify(results, null, 2));
    console.log('Debug results saved to results-immobilien.json');
    
    return results;
    
  } catch (error) {
    console.error('Debug error:', error);
    
    // Save error result
    const errorResult = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      source: 'immobilienscout24.de',
      debug: true
    };
    
    fs.writeFileSync('results-immobilien.json', JSON.stringify(errorResult, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the debug scraper
debugScraper()
  .then(() => {
    console.log('Debug completed');
  })
  .catch(error => {
    console.error('Debug failed:', error);
    process.exit(1);
  });
