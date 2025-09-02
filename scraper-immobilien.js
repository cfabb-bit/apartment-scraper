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

    // Extract apartment data with multiple strategies
    const apartments = await page.evaluate(() => {
      const results = [];
      const found = new Set(); // Prevent duplicates with better key
      
      console.log('=== STARTING EXTRACTION ===');
      
      // Strategy 1: Look for apartment links
      try {
        const apartmentLinks = document.querySelectorAll('a[href*="/wohnen/"]');
        console.log(`Found ${apartmentLinks.length} apartment links`);
        
        apartmentLinks.forEach((link, index) => {
          try {
            // Get container element (try multiple levels)
            let container = link;
            for (let i = 0; i < 5; i++) {
              container = container.parentElement;
              if (!container) break;
              
              const text = container.textContent || '';
              if (text.length > 100 && text.includes('€') && text.includes('Berlin')) {
                break; // Found good container
              }
            }
            
            if (!container) return;
            
            const text = container.textContent || '';
            const html = container.innerHTML || '';
            
            // Extract price (more flexible patterns)
            const priceMatches = [
              text.match(/(\d{2,4}(?:[,.]\d{1,2})?)\s*€/),
              text.match(/€\s*(\d{2,4}(?:[,.]\d{1,2})?)/),
              text.match(/(\d{2,4}(?:[,.]\d{1,2})?)\s*EUR/i)
            ];
            const priceMatch = priceMatches.find(m => m !== null);
            
            // Extract size
            const sizeMatches = [
              text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m²/),
              text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*qm/i),
              text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m2/i)
            ];
            const sizeMatch = sizeMatches.find(m => m !== null);
            
            // Extract rooms
            const roomMatches = [
              text.match(/(\d(?:[,.]\d)?)\s*Zimmer/i),
              text.match(/(\d(?:[,.]\d)?)\s*Zi\b/i),
              text.match(/(\d(?:[,.]\d)?)\s*ZKB/i),
              text.match(/(\d(?:[,.]\d)?)\s*-Zimmer/i)
            ];
            const roomMatch = roomMatches.find(m => m !== null);
            
            if (priceMatch) {
              const price = priceMatch[1];
              const size = sizeMatch ? sizeMatch[1] : null;
              const rooms = roomMatch ? roomMatch[1] : null;
              
              // Create better duplicate key using price + size + text sample
              const textSample = text.substring(0, 100).replace(/\s+/g, ' ').trim();
              const duplicateKey = `${price}-${size || 'nosize'}-${textSample}`;
              
              if (!found.has(duplicateKey)) {
                found.add(duplicateKey);
                
                console.log(`Processing apartment: ${price}, ${size || 'N/A'}, ${rooms || 'N/A'}`);
                
                const apartment = {
                  price: price + ' €',
                  size: size ? size + ' m²' : 'N/A',
                  rooms: rooms ? rooms + ' Zimmer' : 'N/A',
                  title: '',
                  link: link.href.startsWith('http') ? link.href : `https://www.immobilien.de${link.href}`,
                  fullText: textSample,
                  rawPrice: price,
                  rawSize: size,
                  rawRooms: rooms
                };
                
                // Enhanced title extraction with multiple fallbacks
                const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 5);
                
                // Priority 1: Look for apartment descriptions
                for (const line of lines) {
                  if (line.length > 15 && line.length < 150) {
                    if (line.includes('Wohnung') || line.includes('Zimmer') || 
                        /\d{5}\s*Berlin/.test(line) || line.includes('Günstiges') ||
                        line.includes('Familiengerecht')) {
                      apartment.title = line;
                      break;
                    }
                  }
                }
                
                // Priority 2: Look for Berlin addresses
                if (!apartment.title) {
                  for (const line of lines) {
                    if (line.includes('Berlin') && line.length > 10 && line.length < 80) {
                      apartment.title = line;
                      break;
                    }
                  }
                }
                
                // Priority 3: Look for structured elements
                if (!apartment.title) {
                  const titleElements = container.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="heading"], [class*="name"]');
                  for (const titleEl of titleElements) {
                    const titleText = titleEl.textContent.trim();
                    if (titleText.length > 10 && titleText.length < 100) {
                      apartment.title = titleText;
                      break;
                    }
                  }
                }
                
                // Fallback
                if (!apartment.title) {
                  apartment.title = lines.find(l => l.length > 10) || 'Berlin Apartment';
                }
                
                apartment.title = apartment.title.substring(0, 100);
                
                // Only add if we have reasonable data
                const priceNum = parseInt(price);
                if (priceNum >= 200 && priceNum <= 1000) {
                  results.push(apartment);
                  console.log(`✓ Added: ${apartment.price} | ${apartment.size} | ${apartment.title.substring(0, 30)}`);
                } else {
                  console.log(`✗ Rejected price out of range: ${price}`);
                }
              }
            }
          } catch (e) {
            console.log(`Error processing link ${index}:`, e.message);
          }
        });
      } catch (error) {
        console.log('Error in Strategy 1:', error.message);
      }
      
      // Strategy 2: Only if Strategy 1 found very few results
      if (results.length < 2) {
        try {
          console.log(`Strategy 1 found only ${results.length} results, trying text-based extraction...`);
          
          const pageText = document.body.textContent || '';
          console.log(`Page text length: ${pageText.length}`);
          
          // Look for price-size pairs in text
          const textLines = pageText.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 20);
          
          for (const line of textLines.slice(0, 50)) { // Limit to first 50 lines
            const priceMatch = line.match(/(\d{2,4}(?:[,.]\d{1,2})?)\s*€/);
            const sizeMatch = line.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m²/);
            
            if (priceMatch && line.includes('Berlin')) {
              const price = priceMatch[1];
              const priceNum = parseInt(price);
              
              if (priceNum >= 200 && priceNum <= 1000) {
                const duplicateKey = `${price}-${line.substring(0, 50)}`;
                
                if (!found.has(duplicateKey)) {
                  found.add(duplicateKey);
                  
                  results.push({
                    price: price + ' €',
                    size: sizeMatch ? sizeMatch[1] + ' m²' : 'N/A',
                    rooms: 'N/A',
                    title: line.substring(0, 80),
                    link: 'N/A',
                    fullText: line.substring(0, 200),
                    rawPrice: price,
                    rawSize: sizeMatch ? sizeMatch[1] : null,
                    rawRooms: null
                  });
                  
                  console.log(`✓ Text extraction added: ${price}€`);
                  
                  if (results.length >= 10) break; // Limit results
                }
              }
            }
          }
        } catch (error) {
          console.log('Error in Strategy 2:', error.message);
        }
      } else {
        console.log(`Strategy 1 found ${results.length} results, skipping text extraction`);
      }
      
      // Strategy 3: Look for specific immobilien.de patterns
      if (results.length === 0) {
        try {
          console.log('Trying immobilien.de specific selectors...');
          
          const specificSelectors = [
            '[data-testid*="listing"]',
            '[data-testid*="result"]',
            '[class*="expose"]',
            '[class*="objekt"]',
            '.estate-item',
            '.property-item'
          ];
          
          for (const selector of specificSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              console.log(`Found ${elements.length} elements with selector: ${selector}`);
              // Process these elements similar to Strategy 1
              // ... (implementation similar to above)
              break;
            }
          }
        } catch (error) {
          console.log('Error in Strategy 3:', error.message);
        }
      }
      
      // Final deduplication and validation
      const finalResults = [];
      const seenPriceSize = new Set();
      
      results.forEach((apt, i) => {
        const key = `${apt.rawPrice}-${apt.rawSize || 'nosize'}`;
        if (!seenPriceSize.has(key)) {
          seenPriceSize.add(key);
          
          // Additional validation
          const priceNum = parseInt(apt.rawPrice);
          if (priceNum >= 200 && priceNum <= 1000 && apt.title && apt.title !== 'Berlin Apartment') {
            finalResults.push(apt);
          }
        } else {
          console.log(`Removing duplicate: ${apt.price} - ${apt.size}`);
        }
      });
      
      console.log(`=== FINAL RESULTS: ${finalResults.length} apartments ===`);
      finalResults.forEach((apt, i) => {
        console.log(`${i + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
        console.log(`   Title: ${apt.title.substring(0, 50)}...`);
        console.log(`   Link: ${apt.link !== 'N/A' ? apt.link.substring(0, 50) + '...' : 'N/A'}`);
      });
      
      return finalResults;
    });

    await browser.close();
    
    // Handle the results
    if (apartments && apartments.error) {
      throw new Error(`Page evaluation error: ${apartments.error}`);
    }
    
    const apartmentList = Array.isArray(apartments) ? apartments : [];
    console.log(`Successfully extracted ${apartmentList.length} apartments from Immobilien.de`);
    
    // Log results for debugging
    apartmentList.forEach((apt, index) => {
      console.log(`${index + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
      console.log(`   Title: ${apt.title}`);
      console.log(`   Link: ${apt.link !== 'N/A' ? apt.link : 'No direct link'}`);
    });
    
    // Format results for consistent output
    const results = {
      success: true,
      count: apartmentList.length,
      timestamp: new Date().toISOString(),
      source: 'immobilien.de',
      data: apartmentList.map((apt, index) => ({
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
