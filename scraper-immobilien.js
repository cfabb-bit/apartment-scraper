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

    // Extract apartment data with single strategy focused on unique containers
    const apartments = await page.evaluate(() => {
      const results = [];
      const processedContent = new Set();
      
      console.log('=== STARTING EXTRACTION WITH CONTAINER-FIRST APPROACH ===');
      
      try {
        // Find all potential apartment containers first
        const allElements = document.querySelectorAll('*');
        const candidateContainers = [];
        
        Array.from(allElements).forEach(el => {
          const text = el.textContent || '';
          
          // Must contain price, reasonable text length, and Berlin
          if (text.length > 50 && text.length < 2000 && 
              /\d+[,.]?\d*\s*€/.test(text) && 
              text.includes('Berlin')) {
            
            // Check if this is likely a unique apartment container
            const priceMatches = text.match(/(\d+[,.]?\d*)\s*€/g);
            if (priceMatches && priceMatches.length <= 3) { // Avoid elements with too many prices
              candidateContainers.push({
                element: el,
                text: text,
                textLength: text.length
              });
            }
          }
        });
        
        console.log(`Found ${candidateContainers.length} candidate containers`);
        
        // Sort by text length (apartment containers usually have moderate length)
        candidateContainers.sort((a, b) => {
          const idealLength = 400; // Sweet spot for apartment descriptions
          return Math.abs(a.textLength - idealLength) - Math.abs(b.textLength - idealLength);
        });
        
        // Process top candidates
        candidateContainers.slice(0, 20).forEach((candidate, index) => {
          const text = candidate.text;
          const element = candidate.element;
          
          console.log(`\nProcessing container ${index + 1} (${text.length} chars)`);
          console.log(`Text preview: ${text.substring(0, 100).replace(/\s+/g, ' ')}...`);
          
          // Extract price (first occurrence only)
          const priceMatch = text.match(/(\d{2,4}(?:[,.]\d{1,2})?)\s*€/);
          if (!priceMatch) return;
          
          const price = priceMatch[1];
          const priceNum = parseInt(price);
          
          // Price validation
          if (priceNum < 200 || priceNum > 1000) {
            console.log(`  ❌ Price out of range: ${price}€`);
            return;
          }
          
          // Extract size and rooms
          const sizeMatch = text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m²/);
          const roomMatch = text.match(/(\d(?:[,.]\d)?)\s*[Zz]immer/);
          
          // Create unique identifier for this apartment
          const uniqueId = `${price}-${sizeMatch ? sizeMatch[1] : 'nosize'}-${text.substring(0, 50).replace(/[^\w]/g, '')}`;
          
          if (processedContent.has(uniqueId)) {
            console.log(`  ⚠️  Duplicate detected: ${price}€`);
            return;
          }
          
          processedContent.add(uniqueId);
          
          // Extract title - prioritize meaningful content
          let title = '';
          const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 5);
          
          // Look for descriptive titles
          for (const line of lines) {
            if (line.length > 15 && line.length < 120) {
              if (line.includes('Günstiges') || line.includes('Familiengerecht') ||
                  line.includes('Wohnung') || line.includes('Senioren') ||
                  line.includes('Zimmer-Wohnung') || line.includes('Chaussee') ||
                  line.includes('Str.')) {
                title = line;
                break;
              }
            }
          }
          
          // Fallback to Berlin address
          if (!title) {
            for (const line of lines) {
              if (line.includes('Berlin') && line.length > 10 && line.length < 80) {
                title = line;
                break;
              }
            }
          }
          
          if (!title) {
            title = lines.find(l => l.length > 10 && l.length < 100) || 'Berlin Apartment';
          }
          
          // Find best link for this container
          const containerLinks = element.querySelectorAll('a[href*="/wohnen/"]');
          let bestLink = 'N/A';
          
          if (containerLinks.length > 0) {
            // Prefer links that look like apartment details
            for (const link of containerLinks) {
              const href = link.href;
              if (href.includes('/wohnen/') && !href.includes('search') && !href.includes('filter')) {
                bestLink = href.startsWith('http') ? href : `https://www.immobilien.de${href}`;
                break;
              }
            }
          }
          
          const apartment = {
            price: price + ' €',
            size: sizeMatch ? sizeMatch[1] + ' m²' : 'N/A',
            rooms: roomMatch ? roomMatch[1] + ' Zimmer' : 'N/A',
            title: title.substring(0, 100),
            link: bestLink,
            fullText: text.substring(0, 200).replace(/\s+/g, ' ').trim(),
            rawPrice: price,
            rawSize: sizeMatch ? sizeMatch[1] : null,
            rawRooms: roomMatch ? roomMatch[1] : null
          };
          
          results.push(apartment);
          console.log(`  ✅ Added: ${apartment.price} | ${apartment.size} | ${apartment.rooms}`);
          console.log(`     Title: ${title.substring(0, 40)}...`);
          console.log(`     Link: ${bestLink !== 'N/A' ? bestLink.substring(0, 50) + '...' : 'N/A'}`);
        });
        
      } catch (error) {
        console.log('Error in extraction:', error.message);
      }
      
      // Final validation and cleanup
      const validResults = results.filter(apt => {
        const priceNum = parseInt(apt.rawPrice);
        return priceNum >= 200 && priceNum <= 1000 && apt.title && apt.title.length > 5;
      });
      
      console.log(`\n=== FINAL RESULTS: ${validResults.length} unique apartments ===`);
      validResults.forEach((apt, i) => {
        console.log(`${i + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
        console.log(`   Title: ${apt.title}`);
        console.log(`   Link: ${apt.link !== 'N/A' ? 'Valid' : 'N/A'}`);
      });
      
      return validResults;
    });
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
