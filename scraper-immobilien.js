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
          waitUntil: 'domcontentloaded',
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

    // Wait for content and handle potential overlays
    await page.waitForTimeout(5000);
    
    // Try to dismiss cookie banner if present
    try {
      const cookieSelectors = [
        'button[data-testid*="accept"]',
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[class*="cookie"]',
        '[class*="cookie"] button',
        '#cookie-banner button'
      ];
      
      for (const selector of cookieSelectors) {
        const button = await page.$(selector);
        if (button) {
          console.log(`Clicking cookie consent: ${selector}`);
          await button.click();
          await page.waitForTimeout(2000);
          break;
        }
      }
    } catch (e) {
      console.log('No cookie banner found or unable to click');
    }

    // Scroll to load dynamic content
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(2000);
    
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(3000);

    console.log('Page preparation completed, extracting data...');

    // Extract apartment data using link-based approach
    const apartments = await page.evaluate(() => {
      const results = [];
      const processedUrls = new Set();
      
      // Find all apartment links first - these are the unique identifiers
      const apartmentLinks = document.querySelectorAll('a[href*="/wohnen/"]');
      
      apartmentLinks.forEach(link => {
        const href = link.href;
        
        // Only process links that match apartment detail pattern
        if (/\/wohnen\/\d+/.test(href) && !processedUrls.has(href)) {
          processedUrls.add(href);
          
          // Find the containing element that has the apartment data
          let container = link;
          let found = false;
          
          // Look up the DOM tree to find a container with price and apartment data
          for (let i = 0; i < 10; i++) {
            container = container.parentElement;
            if (!container) break;
            
            const text = container.textContent || '';
            
            // Must contain price, size info, and be reasonably sized
            if (text.includes('€') && text.includes('m²') && 
                text.includes('Berlin') && text.length > 200 && text.length < 2000) {
              found = true;
              break;
            }
          }
          
          if (!found || !container) {
            return; // Skip if no proper container found
          }
          
          const text = container.textContent || '';
          
          // Extract apartment data using precise patterns based on page structure
          
          // Price extraction - look for "XXX € Kaltmiete" or just "XXX €"
          const pricePattern = /(\d+(?:[,.]\d+)?)\s*€(?:\s*Kaltmiete)?/;
          const priceMatch = text.match(pricePattern);
          
          if (!priceMatch) return;
          
          const price = priceMatch[1].replace(',', '.');
          const priceNum = parseFloat(price);
          
          // Validate price is within search criteria
          if (priceNum < 200 || priceNum > 450) return;
          
          // Size extraction - look for "XX,XX m² Wohnfläche" pattern
          const sizePattern = /(\d+(?:[,.]\d+)?)\s*m²(?:\s*Wohnfläche)?/;
          const sizeMatch = text.match(sizePattern);
          
          // Room extraction - look for "X Zimmer" pattern
          const roomPattern = /(\d+(?:[,.]\d+)?)\s*Zimmer/;
          const roomMatch = text.match(roomPattern);
          
          // Extract title - look for apartment description before the location
          let title = '';
          
          // Split text into lines and look for descriptive titles
          const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0);
          
          for (const line of lines) {
            // Look for characteristic apartment titles
            if (line.length > 10 && line.length < 150 && 
                !line.includes('€') && !line.includes('m²') && 
                !line.includes('Zimmer') && !line.includes('Wohnung mieten')) {
              
              if (line.includes('Günstiges') || line.includes('Familiengerecht') ||
                  line.includes('Senioren') || line.includes('Neubau') ||
                  line.includes('Erstbezug') || line.includes('Balkon') ||
                  line.includes('zentral') || line.includes('modern')) {
                title = line;
                break;
              }
              
              // If no descriptive title, look for location
              if (!title && /\d{5}\s+Berlin/.test(line)) {
                title = line;
              }
            }
          }
          
          // Fallback title
          if (!title) {
            title = `${price}€ Apartment in Berlin`;
          }
          
          // Create apartment object
          const apartment = {
            price: price + ' €',
            size: sizeMatch ? sizeMatch[1].replace(',', '.') + ' m²' : 'N/A',
            rooms: roomMatch ? roomMatch[1].replace(',', '.') + ' Zimmer' : 'N/A',
            title: title.substring(0, 100),
            link: href,
            fullText: text.substring(0, 300).replace(/\s+/g, ' ').trim(),
            rawPrice: price,
            rawSize: sizeMatch ? sizeMatch[1].replace(',', '.') : null,
            rawRooms: roomMatch ? roomMatch[1].replace(',', '.') : null
          };
          
          results.push(apartment);
        }
      });
      
      // Sort by price to have consistent order
      results.sort((a, b) => parseFloat(a.rawPrice) - parseFloat(b.rawPrice));
      
      return results;
    });

    await browser.close();
    
    console.log(`Successfully extracted ${apartments.length} apartments from Immobilien.de`);
    
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
      data: apartments.map((apt, index) => ({
        id: `immobilien_${Date.now()}_${index}`,
        price: apt.price,
        size: apt.size,
        rooms: apt.rooms,
        title: apt.title,
        link: apt.link,
        description: apt.fullText || 'No description available',
        source: 'immobilien.de',
        scrapedAt: new Date().toISOString()
      }))
    };
    
    fs.writeFileSync('results-immobilien.json', JSON.stringify(results, null, 2));
    console.log('Results saved to results-immobilien.json');
    
    return results;

  } catch (error) {
    await browser.close();
    console.error('Critical error during scraping:', error.message);
    
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
