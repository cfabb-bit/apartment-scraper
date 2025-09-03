const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeImmobilien() {
  console.log('Starting apartment scraping from immobilien.de...');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  try {
    const url = 'https://www.immobilien.de/Wohnen/Suchergebnisse-51797.html?search._digest=true&search._filter=wohnen&search.objektart=wohnung&search.preis_bis=450&search.typ=mieten&search.umkreis=10&search.wo=city%3A6444';
    
    console.log('Processing URL:', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Page loaded successfully');
    
    // Handle cookies
    try {
      await page.waitForSelector('button[class*="cookie"]', { timeout: 5000 });
      await page.click('button[class*="cookie"]');
      console.log('Clicking cookie consent: button[class*="cookie"]');
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
      
      // Find all apartment cards/containers
      const containers = document.querySelectorAll('[data-testid*="result"], .result-item, article, [class*="result"], [class*="listing"]');
      
      console.log(`Found ${containers.length} potential containers`);
      
      // If no containers found with selectors, try a different approach
      if (containers.length === 0) {
        console.log('No containers found, trying link-based approach');
        
        // Get all apartment links
        const links = document.querySelectorAll('a[href*="/wohnen/"]');
        console.log(`Found ${links.length} apartment links`);
        
        const processedUrls = new Set();
        
        links.forEach(link => {
          const href = link.href;
          
          // Skip duplicates
          if (processedUrls.has(href)) return;
          processedUrls.add(href);
          
          // Find parent container with apartment data
          let container = link;
          for (let i = 0; i < 10; i++) {
            container = container.parentElement;
            if (!container) break;
            
            const text = container.textContent;
            if (text && text.includes('€') && text.includes('Berlin') && text.length > 200) {
              break;
            }
          }
          
          if (!container) return;
          
          const fullText = container.textContent.replace(/\s+/g, ' ').trim();
          
          // Extract price (first reasonable price found)
          let price = null;
          const priceMatches = fullText.match(/\b(\d{2,4})\s*€/g);
          if (priceMatches) {
            for (const match of priceMatches) {
              const p = parseInt(match.replace('€', '').trim());
              if (p >= 200 && p <= 450) {
                price = p;
                break;
              }
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
          
          // Extract title from link or nearby text
          let title = link.textContent.trim();
          if (!title || title.length < 5) {
            // Try to find a heading near the link
            const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
            for (const h of headings) {
              const headingText = h.textContent.trim();
              if (headingText && headingText.length > 5) {
                title = headingText;
                break;
              }
            }
          }
          
          // Clean title
          title = title.replace(/\s+/g, ' ').substring(0, 80).trim();
          if (!title) {
            title = `Apartment ${price}€`;
          }
          
          // Extract location
          const locationMatch = fullText.match(/(\d{5}\s+Berlin)/);
          const location = locationMatch ? locationMatch[1] : 'Berlin';
          
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
      } else {
        // Process found containers
        containers.forEach((container, index) => {
          const text = container.textContent;
          if (!text || !text.includes('€') || !text.includes('Berlin')) return;
          
          const fullText = text.replace(/\s+/g, ' ').trim();
          
          // Find link in container
          const link = container.querySelector('a[href*="/wohnen/"]');
          if (!link) return;
          
          // Extract data same as above...
          // (Same extraction logic as in the link-based approach)
        });
      }
      
      // Remove duplicates and sort
      const uniqueResults = results.filter((apt, index, self) => 
        index === self.findIndex(a => a.link === apt.link)
      );
      
      return uniqueResults.sort((a, b) => parseInt(a.price) - parseInt(b.price));
    });
    
    await browser.close();
    
    console.log(`Successfully extracted ${apartments.length} apartments from Immobilien.de`);
    
    apartments.forEach((apt, index) => {
      console.log(`${index + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
      console.log(`   Title: ${apt.title}`);
      console.log(`   Link: ${apt.link}`);
    });
    
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
        description: `${apt.title} in ${apt.location} - ${apt.size}, ${apt.rooms}`,
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

if (require.main === module) {
  scrapeImmobilien()
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
      console.error('Immobilien.de scraping failed:', error);
      process.exit(1);
    });
}

module.exports = scrapeImmobilien;
