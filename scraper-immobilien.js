const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeImmobilien() {
  console.log('Starting apartment scraping from immobilien.de...');
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    const url = 'https://www.immobilien.de/Wohnen/Suchergebnisse-51797.html?search._digest=true&search._filter=wohnen&search.objektart=wohnung&search.preis_bis=450&search.typ=mieten&search.umkreis=10&search.wo=city%3A6444';
    console.log('Processing URL:', url);

    // Navigate with retry mechanism
    let pageLoaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Navigation attempt ${attempt}/3`);
        await page.goto(url, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });
        pageLoaded = true;
        break;
      } catch (error) {
        console.log(`Navigation attempt ${attempt} failed:`, error.message);
        if (attempt === 3) throw error;
        await page.waitForTimeout(5000);
      }
    }

    if (!pageLoaded) {
      throw new Error('Failed to load page after 3 attempts');
    }

    console.log('Page loaded successfully');

    // Wait for content to load
    await page.waitForTimeout(3000);
    
    // Handle cookie banner more aggressively
    try {
      const cookieSelectors = [
        '[data-testid="uc-accept-all-button"]',
        '[data-testid="accept-all"]',
        'button[data-testid*="accept"]',
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[class*="cookie"]',
        '[class*="cookie"] button',
        '#cookie-banner button',
        '.cookie-consent button',
        '[data-cy*="accept"]'
      ];
      
      let cookieHandled = false;
      for (const selector of cookieSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            console.log(`Clicking cookie consent: ${selector}`);
            await button.click();
            await page.waitForTimeout(2000);
            cookieHandled = true;
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (!cookieHandled) {
        console.log('No cookie banner found or could not handle');
      }
    } catch (e) {
      console.log('Cookie handling error:', e.message);
    }

    // Wait for search results to load and scroll to trigger any lazy loading
    await page.waitForSelector('a[href*="/wohnen/"]', { timeout: 15000 });
    
    // Scroll gradually to load all content
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Wait for content to settle after scrolling
    await page.waitForTimeout(3000);

    console.log('Page preparation completed, extracting data...');

    // Debug: Check for promotional sections
    await page.evaluate(() => {
      const topObjekte = document.querySelector('*[class*="top"], *[class*="premium"], *[class*="highlight"]');
      if (topObjekte) {
        console.log('Found promotional section:', topObjekte.className);
      }
      
      const textNodes = document.evaluate("//text()[contains(., 'Top Objekte') or contains(., 'Premium')]", 
        document, null, XPathResult.ANY_TYPE, null);
      let node = textNodes.iterateNext();
      while (node) {
        console.log('Found promotional text:', node.textContent.trim());
        node = textNodes.iterateNext();
      }
    });

    // Extract apartment data with improved selectors, skipping promotional sections
    const apartments = await page.evaluate(() => {
      const results = [];
      const processedUrls = new Set();
      
      // First, identify and skip promotional sections like "Top Objekte"
      const skipSections = [
        '[class*="top-objekt"]',
        '[class*="premium"]',
        '[class*="featured"]',
        '[class*="highlight"]',
        '[data-testid*="top"]',
        '[data-testid*="premium"]',
        '[data-testid*="featured"]'
      ];
      
      const sectionsToSkip = new Set();
      skipSections.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          sectionsToSkip.add(el);
          // Also add parent containers that might contain the promotional section
          let parent = el.parentElement;
          for (let i = 0; i < 3; i++) {
            if (parent && parent.textContent && 
                (parent.textContent.includes('Top Objekte') || 
                 parent.textContent.includes('Premium') ||
                 parent.textContent.includes('Highlight'))) {
              sectionsToSkip.add(parent);
            }
            parent = parent.parentElement;
            if (!parent) break;
          }
        });
      });
      
      // Also skip sections based on text content
      const allSections = document.querySelectorAll('div, section, article');
      allSections.forEach(section => {
        const text = section.textContent || '';
        if (text.includes('Top Objekte') || text.includes('Premium-Objekte') || 
            text.includes('Empfohlene Objekte') || text.includes('Highlight')) {
          // Only skip if this is a relatively small section (likely promotional)
          if (text.length < 2000) {
            sectionsToSkip.add(section);
          }
        }
      });
      
      console.log(`Identified ${sectionsToSkip.size} promotional sections to skip`);
      
      // Look for more specific selectors for apartment listings
      const selectors = [
        '[data-testid*="result"]',
        '[data-cy*="result"]',
        '.result-list-entry',
        '.search-result',
        '[class*="result"]',
        '[class*="listing"]'
      ];
      
      let containers = [];
      for (const selector of selectors) {
        const foundContainers = document.querySelectorAll(selector);
        // Filter out containers that are within promotional sections
        const filteredContainers = Array.from(foundContainers).filter(container => {
          for (const skipSection of sectionsToSkip) {
            if (skipSection.contains(container)) {
              return false;
            }
          }
          return true;
        });
        
        if (filteredContainers.length > 0) {
          containers = filteredContainers;
          console.log(`Found ${foundContainers.length} total containers, ${containers.length} after filtering promotional content using selector: ${selector}`);
          break;
        }
      }
      
      // Fallback: find containers by looking for apartment links and their parent elements
      if (containers.length === 0) {
        const apartmentLinks = document.querySelectorAll('a[href*="/wohnen/"]');
        const parentContainers = new Set();
        
        apartmentLinks.forEach(link => {
          // Skip links that are in promotional sections
          let isInPromoSection = false;
          for (const skipSection of sectionsToSkip) {
            if (skipSection.contains(link)) {
              isInPromoSection = true;
              break;
            }
          }
          
          if (isInPromoSection) {
            console.log(`Skipping link in promotional section: ${link.href}`);
            return;
          }
          
          let parent = link.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!parent) break;
            const text = parent.textContent || '';
            // Look for containers that likely contain full apartment data
            if (text.includes('€') && text.includes('Berlin') && 
                text.length > 100 && text.length < 2000) {
              parentContainers.add(parent);
              break;
            }
            parent = parent.parentElement;
          }
        });
        
        containers = Array.from(parentContainers);
        console.log(`Fallback: Found ${containers.length} containers after filtering promotional content`);
      }
      
      // Additional filtering: look for containers that seem to be part of search results
      containers = Array.from(containers).filter(container => {
        const text = container.textContent || '';
        
        // Skip if container seems to be promotional
        if (text.includes('Top Objekte') || text.includes('Premium') ||
            text.includes('Empfohlen') || text.includes('Highlight') ||
            text.includes('Anzeige') || text.includes('Sponsored')) {
          console.log('Skipping promotional container');
          return false;
        }
        
        // Skip containers that seem too large (might be page sections)
        if (text.length > 3000) {
          return false;
        }
        
        // Must contain basic apartment info
        return text.includes('€') && text.includes('Berlin');
      });
      
      containers.forEach((container, index) => {
        try {
          const text = container.textContent || '';
          
          // Find apartment link within this container
          const link = container.querySelector('a[href*="/wohnen/"]');
          if (!link || !link.href) return;
          
          const href = link.href;
          
          // Skip duplicates
          if (processedUrls.has(href)) return;
          processedUrls.add(href);
          
          // Extract price - be more flexible with patterns
          let price = null;
          let priceText = '';
          
          const pricePatterns = [
            /(\d+(?:[,.]\d+)?)\s*€\s*(?:Kaltmiete|kalt|Miete)?/i,
            /(?:Kaltmiete|Miete)[\s:]*(\d+(?:[,.]\d+)?)\s*€/i,
            /(\d+(?:[,.]\d+)?)\s*€/
          ];
          
          for (const pattern of pricePatterns) {
            const match = text.match(pattern);
            if (match) {
              price = parseFloat(match[1].replace(',', '.'));
              priceText = match[1] + ' €';
              break;
            }
          }
          
          // Skip if no price found or price is outside reasonable range
          if (!price || price < 150 || price > 450) {
            console.log(`Skipping item ${index}: price ${price} outside range 150-450 (might be promotional)`);
            return;
          }
          
          // Additional check: skip if this seems like a promoted listing
          const containerText = container.textContent || '';
          if (containerText.includes('Top Objekt') || containerText.includes('Premium') ||
              containerText.includes('Empfohlen') || containerText.includes('Highlight') ||
              containerText.includes('Anzeige') || containerText.includes('Sponsored')) {
            console.log(`Skipping promotional listing: ${price}€`);
            return;
          }
          
          // Extract size
          let size = null;
          let sizeText = 'N/A';
          const sizePatterns = [
            /(\d+(?:[,.]\d+)?)\s*m²\s*(?:Wohnfläche)?/i,
            /(?:Wohnfläche|Fläche)[\s:]*(\d+(?:[,.]\d+)?)\s*m²/i
          ];
          
          for (const pattern of sizePatterns) {
            const match = text.match(pattern);
            if (match) {
              size = parseFloat(match[1].replace(',', '.'));
              sizeText = match[1].replace(',', '.') + ' m²';
              break;
            }
          }
          
          // Extract rooms
          let rooms = null;
          let roomsText = 'N/A';
          const roomPatterns = [
            /(\d+(?:[,.]\d+)?)\s*Zimmer/i,
            /(?:Anzahl\s+)?Zimmer[\s:]*(\d+(?:[,.]\d+)?)/i
          ];
          
          for (const pattern of roomPatterns) {
            const match = text.match(pattern);
            if (match) {
              rooms = parseFloat(match[1].replace(',', '.'));
              roomsText = match[1].replace(',', '.') + ' Zimmer';
              break;
            }
          }
          
          // Extract title - improved logic
          let title = '';
          
          // First try to get title from link text or nearby headings
          const linkText = (link.textContent || '').trim();
          if (linkText && linkText.length > 5 && linkText.length < 100 && 
              !linkText.includes('€') && !linkText.includes('m²')) {
            title = linkText;
          }
          
          // Try heading elements within container
          if (!title) {
            const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="heading"]');
            for (const heading of headings) {
              const headingText = (heading.textContent || '').trim();
              if (headingText && headingText.length > 5 && headingText.length < 100 &&
                  !headingText.includes('€') && !headingText.includes('m²')) {
                title = headingText;
                break;
              }
            }
          }
          
          // Fallback: extract descriptive text from container
          if (!title) {
            const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0);
            
            for (const line of lines) {
              if (line.length > 10 && line.length < 150 && 
                  !line.includes('€') && !line.includes('m²') && 
                  !line.includes('Zimmer') && !line.includes('Miete') &&
                  (line.includes('Berlin') || line.includes('Wohnung') || 
                   line.includes('Günstiges') || line.includes('Senioren') ||
                   line.includes('Neubau') || line.includes('zentral'))) {
                title = line;
                break;
              }
            }
          }
          
          // Final fallback
          if (!title) {
            // Look for postal code + Berlin pattern
            const locationMatch = text.match(/(\d{5}\s+Berlin[^€\n]*)/);
            if (locationMatch) {
              title = locationMatch[1];
            } else {
              title = `${priceText} Apartment in Berlin`;
            }
          }
          
          // Clean up title
          title = title.replace(/\s+/g, ' ').trim().substring(0, 100);
          
          const apartment = {
            price: priceText,
            size: sizeText,
            rooms: roomsText,
            title: title,
            link: href,
            rawPrice: price,
            rawSize: size,
            rawRooms: rooms,
            containerText: text.substring(0, 300).replace(/\s+/g, ' ').trim()
          };
          
          results.push(apartment);
          console.log(`Extracted: ${priceText} | ${sizeText} | ${roomsText} - ${title}`);
          
        } catch (error) {
          console.error(`Error processing container ${index}:`, error.message);
        }
      });
      
      // Remove duplicates by link and sort by price
      const uniqueResults = results.filter((apt, index, self) => 
        index === self.findIndex(a => a.link === apt.link)
      );
      
      uniqueResults.sort((a, b) => a.rawPrice - b.rawPrice);
      
      return uniqueResults;
    });

    await browser.close();
    
    console.log(`Successfully extracted ${apartments.length} apartments from Immobilien.de`);
    
    if (apartments.length === 0) {
      console.log('No apartments found - this might indicate:');
      console.log('1. The search criteria are too restrictive');
      console.log('2. The website structure has changed');
      console.log('3. Anti-bot measures are blocking the scraper');
      console.log('4. The search URL parameters are incorrect');
    }
    
    // Log results for debugging
    apartments.forEach((apt, index) => {
      console.log(`${index + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
      console.log(`   Title: ${apt.title}`);
      console.log(`   Link: ${apt.link}`);
    });
    
    // Format results for consistent output
    const results = {
      success: true,
      count: apartments.length,
      timestamp: new Date().toISOString(),
      source: 'immobilien.de',
      searchCriteria: {
        maxPrice: 450,
        location: 'Berlin',
        radius: '10km',
        type: 'rent'
      },
      data: apartments.map((apt, index) => ({
        id: `immobilien_${Date.now()}_${index}`,
        price: apt.price,
        size: apt.size,
        rooms: apt.rooms,
        title: apt.title,
        link: apt.link,
        description: apt.containerText || 'No description available',
        source: 'immobilien.de',
        scrapedAt: new Date().toISOString(),
        rawData: {
          price: apt.rawPrice,
          size: apt.rawSize,
          rooms: apt.rawRooms
        }
      }))
    };
    
    fs.writeFileSync('results-immobilien.json', JSON.stringify(results, null, 2));
    console.log('Results saved to results-immobilien.json');
    
    return results;

  } catch (error) {
    await browser.close();
    console.error('Critical error during scraping:', error.message);
    console.error('Stack trace:', error.stack);
    
    const errorResult = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      source: 'immobilien.de',
      count: 0,
      data: []
    };
    
    fs.writeFileSync('results-immobilien.json', JSON.stringify(errorResult, null, 2));
    return errorResult;
  }
}

// Run the scraper
if (require.main === module) {
  scrapeImmobilien()
    .then((results) => {
      if (results.success) {
        console.log(`\n=== SCRAPING COMPLETED SUCCESSFULLY ===`);
        console.log(`Apartments found: ${results.count}`);
        console.log(`Timestamp: ${results.timestamp}`);
      } else {
        console.log(`\n=== SCRAPING FAILED ===`);
        console.log(`Error: ${results.error}`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Immobilien.de scraping failed:', error);
      process.exit(1);
    });
}

module.exports = scrapeImmobilien;
