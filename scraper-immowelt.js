const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeImmowelt() {
  console.log('Starting apartment scraping from immowelt.de...');
  
  let browser = null;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    // Create page with user agent context
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'de-DE',
      extraHTTPHeaders: {
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    
    const page = await context.newPage();
    
    const url = 'https://www.immowelt.de/classified-search?distributionTypes=Rent&estateTypes=House,Apartment&locations=AD08DE8634&locationsInBuildingExcluded=Groundfloor&priceMax=450&projectTypes=Stock,Flatsharing&order=PriceDesc';
    
    console.log('Processing URL:', url);
    
    // Navigate with extended timeout
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 45000 
    });
    
    console.log('Page loaded successfully');
    
    // Handle cookie consent with multiple fallbacks
    await handleCookieConsent(page);
    
    // Wait for dynamic content to load with multiple strategies
    await waitForContent(page);
    
    console.log('Page preparation completed, extracting data...');
    
    // Extract apartments with robust error handling
    const apartments = await extractApartments(page);
    
    console.log(`Successfully extracted ${apartments.length} apartments from Immowelt.de`);
    
    // Log found apartments
    apartments.forEach((apt, index) => {
      console.log(`${index + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
      console.log(`   Title: ${apt.title}`);
      console.log(`   Link: ${apt.link}`);
    });
    
    // Prepare results in consistent format
    const results = {
      success: true,
      count: apartments.length,
      timestamp: new Date().toISOString(),
      source: 'immowelt.de',
      data: apartments.map((apt, index) => ({
        id: `immowelt_${Date.now()}_${index}`,
        price: apt.price,
        size: apt.size,
        rooms: apt.rooms,
        title: apt.title,
        link: apt.link,
        description: `${apt.title} in ${apt.location} - ${apt.size}, ${apt.rooms}`,
        source: 'immowelt.de',
        scrapedAt: new Date().toISOString()
      }))
    };
    
    // Save results
    fs.writeFileSync('results-immowelt.json', JSON.stringify(results, null, 2));
    console.log('Results saved to results-immowelt.json');
    
    return results;
    
  } catch (error) {
    console.error('Critical error during scraping:', error.message);
    console.error('Stack trace:', error.stack);
    
    const errorResult = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      source: 'immowelt.de',
      count: 0,
      data: []
    };
    
    fs.writeFileSync('results-immowelt.json', JSON.stringify(errorResult, null, 2));
    return errorResult;
    
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error closing browser:', e.message);
      }
    }
  }
}

// Handle cookie consent with multiple strategies
async function handleCookieConsent(page) {
  console.log('Handling cookie consent...');
  
  const cookieSelectors = [
    'button[id*="consent"]',
    'button[class*="consent"]', 
    'button[class*="cookie"]',
    'button[data-testid*="consent"]',
    'button[data-testid*="cookie"]',
    'button:has-text("Akzeptieren")',
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Einverstanden")',
    '#consent-accept-all',
    '.consent-accept',
    '[data-consent="accept"]'
  ];
  
  for (const selector of cookieSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 3000 });
      await page.click(selector);
      console.log(`Clicked cookie consent: ${selector}`);
      await page.waitForTimeout(2000);
      return;
    } catch (e) {
      // Continue to next selector
    }
  }
  
  console.log('No cookie banner found or already handled');
}

// Wait for content with multiple strategies  
async function waitForContent(page) {
  console.log('Waiting for content to load...');
  
  // Strategy 1: Wait for common result containers
  const resultSelectors = [
    '[data-testid="object-list"]',
    '[data-testid="search-results"]', 
    '.search-results',
    '.result-list',
    '.object-list',
    '[class*="result"]',
    '[class*="listing"]',
    '[class*="property"]'
  ];
  
  for (const selector of resultSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 8000 });
      console.log(`Found results container: ${selector}`);
      break;
    } catch (e) {
      // Continue to next selector
    }
  }
  
  // Strategy 2: Wait for network to be idle
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch (e) {
    console.log('Network idle timeout, proceeding anyway');
  }
  
  // Strategy 3: Scroll and wait
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight / 2);
  });
  await page.waitForTimeout(3000);
  
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2000);
}

// Extract apartments with robust error handling
async function extractApartments(page) {
  return await page.evaluate(() => {
    console.log('=== DEBUG: Starting apartment extraction ===');
    
    // Check page state
    console.log('Page URL:', window.location.href);
    console.log('Page title:', document.title);
    console.log('Body content length:', document.body.textContent.length);
    
    // Check for error messages in German
    const bodyText = document.body.textContent.toLowerCase();
    const errorIndicators = [
      'keine suchergebnisse',
      'keine ergebnisse', 
      'nicht gefunden',
      'fehler',
      'error',
      'loading',
      'laden'
    ];
    
    for (const indicator of errorIndicators) {
      if (bodyText.includes(indicator)) {
        console.log(`⚠️ Found indicator: ${indicator}`);
      }
    }
    
    const results = [];
    
    // Strategy 1: Look for apartment links with multiple patterns
    const linkPatterns = [
      'a[href*="/expose/"]',
      'a[href*="/classified/"]',
      'a[href*="/property/"]', 
      'a[href*="/wohnung/"]',
      'a[href*="immowelt.de/expose"]',
      'a[href*="immowelt.de/classified"]',
      'a[href*="immowelt.de/property"]'
    ];
    
    let apartmentLinks = [];
    
    for (const pattern of linkPatterns) {
      const links = document.querySelectorAll(pattern);
      console.log(`Pattern "${pattern}": ${links.length} links`);
      
      if (links.length > 0) {
        apartmentLinks = Array.from(links);
        console.log(`✅ Using pattern: ${pattern}`);
        break;
      }
    }
    
    // Strategy 2: If no specific patterns, look for all immowelt links
    if (apartmentLinks.length === 0) {
      console.log('No specific patterns found, searching all immowelt links...');
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      
      apartmentLinks = allLinks.filter(link => {
        const href = link.href.toLowerCase();
        return href.includes('immowelt.de') && 
               (href.includes('expose') || 
                href.includes('classified') || 
                href.includes('property') ||
                href.includes('wohnung'));
      });
      
      console.log(`Found ${apartmentLinks.length} immowelt apartment links`);
    }
    
    // Strategy 3: If still no links, try data attributes
    if (apartmentLinks.length === 0) {
      console.log('Trying data attributes...');
      const dataSelectors = [
        '[data-testid*="object"] a',
        '[data-testid*="property"] a',
        '[data-testid*="listing"] a',
        '[data-testid*="result"] a'
      ];
      
      for (const selector of dataSelectors) {
        const links = document.querySelectorAll(selector);
        console.log(`Data selector "${selector}": ${links.length} links`);
        if (links.length > 0) {
          apartmentLinks = Array.from(links);
          break;
        }
      }
    }
    
    // Debug: Show sample links
    console.log(`Final apartment links found: ${apartmentLinks.length}`);
    apartmentLinks.slice(0, 5).forEach((link, i) => {
      console.log(`Sample ${i + 1}: ${link.href}`);
    });
    
    if (apartmentLinks.length === 0) {
      console.log('❌ No apartment links found');
      
      // Debug: Show all available links
      const allLinks = document.querySelectorAll('a[href]');
      console.log(`Total links on page: ${allLinks.length}`);
      
      Array.from(allLinks).slice(0, 10).forEach((link, i) => {
        console.log(`All links ${i + 1}: ${link.href}`);
      });
      
      return [];
    }
    
    // Process found links
    const processedUrls = new Set();
    
    apartmentLinks.forEach(link => {
      try {
        const href = link.href;
        
        if (processedUrls.has(href)) return;
        processedUrls.add(href);
        
        // Find container with apartment data
        let container = link;
        let containerFound = false;
        
        // Try multiple parent levels
        for (let i = 0; i < 10; i++) {
          container = container.parentElement;
          if (!container) break;
          
          const text = container.textContent || '';
          
          // Look for German price indicators
          if (text.includes('€') || 
              text.includes('Euro') || 
              text.includes('Warmmiete') ||
              text.includes('Kaltmiete')) {
            
            if (text.length > 50) { // Sufficient content
              containerFound = true;
              break;
            }
          }
        }
        
        if (!containerFound || !container) {
          console.log(`No container found for: ${href}`);
          return;
        }
        
        const fullText = container.textContent.replace(/\s+/g, ' ').trim();
        
        // Extract price with German patterns
        let price = null;
        const pricePatterns = [
          /(\d{2,4})\s*€/,
          /€\s*(\d{2,4})/,
          /(\d{2,4})\s*Euro/,
          /Warmmiete:?\s*(\d{2,4})/i,
          /Kaltmiete:?\s*(\d{2,4})/i,
          /Miete:?\s*(\d{2,4})/i
        ];
        
        for (const pattern of pricePatterns) {
          const match = fullText.match(pattern);
          if (match) {
            const p = parseInt(match[1]);
            if (p >= 100 && p <= 600) { // Reasonable price range
              price = p;
              break;
            }
          }
        }
        
        if (!price) return;
        
        // Extract size with German patterns
        let size = null;
        const sizePatterns = [
          /(\d+(?:[,.]?\d+)?)\s*m²/,
          /(\d+(?:[,.]?\d+)?)\s*qm/i,
          /Wohnfläche:?\s*(\d+(?:[,.]?\d+)?)/i
        ];
        
        for (const pattern of sizePatterns) {
          const match = fullText.match(pattern);
          if (match) {
            size = parseFloat(match[1].replace(',', '.'));
            break;
          }
        }
        
        // Extract rooms with German patterns
        let rooms = null;
        const roomPatterns = [
          /(\d+(?:[,.]?\d+)?)\s*Zimmer/,
          /(\d+(?:[,.]?\d+)?)\s*Zi\b/,
          /(\d+(?:[,.]?\d+)?)\s*-?\s*Raum/i
        ];
        
        for (const pattern of roomPatterns) {
          const match = fullText.match(pattern);
          if (match) {
            rooms = parseFloat(match[1].replace(',', '.'));
            break;
          }
        }
        
        // Extract title
        let title = '';
        
        // Try multiple title sources
        const titleSources = [
          () => link.textContent?.trim(),
          () => link.getAttribute('title'),
          () => link.getAttribute('aria-label'),
          () => container.querySelector('h1, h2, h3, h4, h5, h6')?.textContent?.trim(),
          () => container.querySelector('[class*="title"], [class*="headline"]')?.textContent?.trim(),
          () => container.querySelector('img')?.getAttribute('alt')
        ];
        
        for (const getTitle of titleSources) {
          try {
            const titleCandidate = getTitle();
            if (titleCandidate && titleCandidate.length > 5 && titleCandidate.length < 150) {
              title = titleCandidate;
              break;
            }
          } catch (e) {
            // Continue to next source
          }
        }
        
        // Clean and validate title
        if (!title) {
          title = `${rooms || 'N/A'} Zimmer Wohnung - ${price}€`;
        }
        
        title = title.replace(/\s+/g, ' ').substring(0, 120).trim();
        
        // Extract location
        let location = 'Berlin';
        const locationPatterns = [
          /Berlin[,\s-]+([^,\n]{3,40})/,
          /(\d{5}\s+Berlin[^,\n]{0,30})/,
          /([A-ZÄÖÜ][a-zäöüß\-]+(?:\s+[A-ZÄÖÜ][a-zäöüß\-]+){0,2})[,\s]+Berlin/
        ];
        
        for (const pattern of locationPatterns) {
          const match = fullText.match(pattern);
          if (match) {
            location = (match[1] || match[0]).trim();
            if (location.length > 50) {
              location = location.substring(0, 50) + '...';
            }
            break;
          }
        }
        
        const apartment = {
          price: price + ' €',
          size: size ? size + ' m²' : 'N/A',
          rooms: rooms ? rooms + ' Zimmer' : 'N/A', 
          title: title,
          link: href,
          location: location
        };
        
        results.push(apartment);
        console.log(`✅ Added: ${apartment.price} - ${apartment.title.substring(0, 50)}`);
        
      } catch (error) {
        console.error('Error processing link:', error.message);
      }
    });
    
    console.log(`=== Extraction completed: ${results.length} apartments ===`);
    
    // Remove duplicates and sort
    const uniqueResults = results.filter((apt, index, self) => 
      index === self.findIndex(a => a.link === apt.link)
    );
    
    return uniqueResults.sort((a, b) => {
      const priceA = parseInt(a.price);
      const priceB = parseInt(b.price);
      return priceA - priceB;
    });
  });
}

// Main execution
if (require.main === module) {
  scrapeImmowelt()
    .then((results) => {
      if (results.success) {
        console.log('\n=== SCRAPING COMPLETED SUCCESSFULLY ===');
        console.log(`Apartments found: ${results.count}`);
        console.log(`Timestamp: ${results.timestamp}`);
      } else {
        console.log('\n=== SCRAPING FAILED ===');
        console.log(`Error: ${results.error}`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Immowelt.de scraping failed:', error);
      process.exit(1);
    });
}

module.exports = scrapeImmowelt;
