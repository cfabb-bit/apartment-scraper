const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeImmowelt() {
  console.log('Starting apartment scraping from immowelt.de...');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  try {
    const url = 'https://www.immowelt.de/classified-search?distributionTypes=Rent&estateTypes=House,Apartment&locations=AD08DE8634&locationsInBuildingExcluded=Groundfloor&priceMax=450&projectTypes=Stock,Flatsharing&order=PriceDesc';
    
    console.log('Processing URL:', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Page loaded successfully');
    
    // Handle cookies
    try {
      await page.waitForSelector('button[class*="cookie"], button[id*="consent"], button[class*="accept"]', { timeout: 5000 });
      await page.click('button[class*="cookie"], button[id*="consent"], button[class*="accept"]');
      console.log('Clicked cookie consent button');
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log('No cookie banner or already handled');
    }
    
    // Wait and scroll
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    
    console.log('Page preparation completed, extracting data...');
    
    const apartments = await page.evaluate(() => {
      const results = [];
      
      // Debug: Stampa tutte le possibili strutture
      console.log('=== DEBUG: Analyzing page structure ===');
      
      // Test vari selettori per i link
      const linkSelectors = [
        'a[href*="/expose/"]',
        'a[href*="immowelt"]',
        'a[href*="/classified/"]', 
        'a[href*="/property/"]',
        '[data-testid*="property"] a',
        '[data-testid*="object"] a',
        '.property-item a',
        '.result-item a',
        '.listitem a',
        '.estate-object a'
      ];
      
      let links = [];
      for (const selector of linkSelectors) {
        const found = Array.from(document.querySelectorAll(selector));
        console.log(`Selector "${selector}": ${found.length} links`);
        if (found.length > 0) {
          links = found;
          console.log(`Using selector: ${selector}`);
          break;
        }
      }
      
      // Se ancora nessun link, prova un approccio più generale
      if (links.length === 0) {
        console.log('No specific links found, trying all links...');
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        console.log(`Total links on page: ${allLinks.length}`);
        
        // Filtra per URL che sembrano appartamenti
        links = allLinks.filter(link => {
          const href = link.href.toLowerCase();
          return href.includes('immowelt') && 
                 (href.includes('expose') || 
                  href.includes('property') || 
                  href.includes('classified') ||
                  href.includes('wohnung') ||
                  href.includes('apartment'));
        });
        console.log(`Filtered apartment-like links: ${links.length}`);
        
        // Mostra alcuni esempi
        links.slice(0, 5).forEach((link, i) => {
          console.log(`Example ${i + 1}: ${link.href}`);
        });
      }
      
      console.log(`Final links to process: ${links.length}`);
      
      const processedUrls = new Set();
      
      foundLinks.forEach(link => {
        const href = link.href;
        
        // Only process immowelt expose links
        if (!href.includes('/expose/') && !href.includes('immowelt.de')) return;
        
        // Skip duplicates
        if (processedUrls.has(href)) return;
        processedUrls.add(href);
        
        // Find parent container with apartment data
        let container = link;
        for (let i = 0; i < 8; i++) {
          container = container.parentElement;
          if (!container) break;
          
          const text = container.textContent;
          if (text && text.includes('€') && text.length > 100) {
            break;
          }
        }
        
        if (!container) return;
        
        const fullText = container.textContent.replace(/\s+/g, ' ').trim();
        
        // Extract price
        let price = null;
        const priceMatches = fullText.match(/(\d{2,4})\s*€|€\s*(\d{2,4})|(\d{2,4})\s*EUR/g);
        if (priceMatches) {
          for (const match of priceMatches) {
            const p = parseInt(match.replace(/[€EUR\s]/g, ''));
            if (p >= 200 && p <= 500) {
              price = p;
              break;
            }
          }
        }
        
        if (!price) {
          // Try different price pattern
          const altPriceMatch = fullText.match(/Warmmiete:?\s*(\d{2,4})/i);
          if (altPriceMatch) {
            price = parseInt(altPriceMatch[1]);
          }
        }
        
        if (!price) return;
        
        // Extract size
        let size = null;
        const sizeMatch = fullText.match(/(\d+(?:[,.]?\d+)?)\s*m²/);
        if (sizeMatch) {
          size = parseFloat(sizeMatch[1].replace(',', '.'));
        }
        
        // Extract rooms
        let rooms = null;
        const roomMatch = fullText.match(/(\d+(?:[,.]?\d+)?)\s*Zimmer/);
        if (roomMatch) {
          rooms = parseFloat(roomMatch[1].replace(',', '.'));
        }
        
        // Extract title from link or nearby elements
        let title = '';
        
        // Try link text first
        if (link.textContent && link.textContent.trim().length > 5) {
          title = link.textContent.trim();
        }
        
        // Try nearby headings
        if (!title || title.length < 10) {
          const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="headline"]');
          for (const h of headings) {
            const headingText = h.textContent.trim();
            if (headingText && headingText.length > 5 && headingText.length < 100) {
              title = headingText;
              break;
            }
          }
        }
        
        // Try alt/title attributes
        if (!title || title.length < 10) {
          const img = container.querySelector('img[alt], img[title]');
          if (img && (img.alt || img.title)) {
            title = img.alt || img.title;
          }
        }
        
        // Clean and validate title
        title = title.replace(/\s+/g, ' ').substring(0, 100).trim();
        if (!title || title.length < 5) {
          title = `Wohnung ${price}€`;
        }
        
        // Extract location/address
        let location = 'Berlin';
        const locationPatterns = [
          /Berlin[,\s]+([^,\n]{5,30})/,
          /(\d{5}\s+Berlin[^,\n]{0,20})/,
          /([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*),?\s+Berlin/
        ];
        
        for (const pattern of locationPatterns) {
          const locationMatch = fullText.match(pattern);
          if (locationMatch) {
            location = locationMatch[1] || locationMatch[0];
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
        console.log(`Added: ${apartment.price} - ${apartment.title}`);
      });
      
      // Remove duplicates and sort
      const uniqueResults = results.filter((apt, index, self) => 
        index === self.findIndex(a => a.link === apt.link)
      );
      
      return uniqueResults.sort((a, b) => parseInt(a.price) - parseInt(b.price));
    });
    
    await browser.close();
    
    console.log(`Successfully extracted ${apartments.length} apartments from Immowelt.de`);
    
    apartments.forEach((apt, index) => {
      console.log(`${index + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
      console.log(`   Title: ${apt.title}`);
      console.log(`   Link: ${apt.link}`);
    });
    
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
    
    fs.writeFileSync('results-immowelt.json', JSON.stringify(results, null, 2));
    console.log('Results saved to results-immowelt.json');
    
    return results;
    
  } catch (error) {
    await browser.close();
    console.error('Critical error during scraping:', error.message);
    
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
  }
}

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
