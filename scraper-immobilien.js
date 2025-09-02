    // Extract apartment data - focus on "Top Objekte" section first
    const apartments = await page.evaluate(() => {
      const results = [];
      const processedContent = new Set();
      
      console.log('=== LOOKING FOR TOP OBJEKTE SECTION ===');
      
      try {
        // Strategy 1: Find "Top Objekte" section
        let topObjekteSection = null;
        const possibleSelectors = [
          '[class*="top"]',
          '[class*="objekt"]', 
          '[class*="featured"]',
          '[class*="highlight"]',
          '[id*="top"]',
          '[data-testid*="top"]'
        ];
        
        // Look for elements containing "Top Objekte" text
        const allElements = document.querySelectorAll('*');
        Array.from(allElements).forEach(el => {
          const text = el.textContent || '';
          if (text.toLowerCase().includes('top objekt') || 
              text.toLowerCase().includes('top-objekt') ||
              text.toLowerCase().includes('empfehlung')) {
            console.log(`Found potential top section: ${el.tagName}.${el.className} - "${text.substring(0, 100)}"`);
            
            // Check if this element contains apartment data
            if (text.includes('€') && text.includes('Berlin') && text.length > 200) {
              topObjekteSection = el;
              console.log('✓ Selected as Top Objekte section');
            }
          }
        });
        
        // If found, extract from Top Objekte section only
        if (topObjekteSection) {
          console.log('=== EXTRACTING FROM TOP OBJEKTE SECTION ===');
          
          // Look for apartment containers within this section
          const sectionElements = topObjekteconst { chromium } = require('playwright');
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

    // Extract apartment data - find elements AFTER "Top Objekte" section
    const apartments = await page.evaluate(() => {
      const results = [];
      const processedContent = new Set();
      
      console.log('=== LOOKING FOR CONTENT AFTER TOP OBJEKTE SECTION ===');
      
      try {
        // Find the "Top Objekte" section first
        let topObjekteSection = null;
        const allElements = document.querySelectorAll('*');
        
        Array.from(allElements).forEach(el => {
          const text = el.textContent || '';
          const innerHTML = el.innerHTML || '';
          
          // Look for the Top Objekte header/container
          if ((text.toLowerCase().includes('top objekt') || 
               text.toLowerCase().includes('top-objekt') ||
               innerHTML.toLowerCase().includes('top objekt')) &&
              text.length < 500) { // Header sections are usually shorter
            console.log(`Found Top Objekte section: ${el.tagName}.${el.className} - "${text.substring(0, 60)}"`);
            topObjekteSection = el;
          }
        });
        
        if (!topObjekteSection) {
          console.log('Top Objekte section not found, processing all elements');
        } else {
          console.log('✓ Found Top Objekte section, will look for content after it');
        }
        
        // Collect apartment containers that come AFTER Top Objekte section
        const candidateContainers = [];
        let foundTopObjekte = false;
        
        Array.from(allElements).forEach((el, index) => {
          // Check if we've passed the Top Objekte section
          if (topObjekteSection && (el === topObjekteSection || topObjekteSection.contains(el))) {
            foundTopObjekte = true;
            console.log(`Passed Top Objekte section at element ${index}`);
            return;
          }
          
          // Only process elements that come after Top Objekte (or all if not found)
          if (!topObjekteSection || foundTopObjekte) {
            const text = el.textContent || '';
            
            // Must contain price, reasonable text length, and Berlin
            if (text.length > 100 && text.length < 1500 && 
                /\d+[,.]?\d*\s*€/.test(text) && 
                text.includes('Berlin')) {
              
              // Check if this looks like an apartment listing (not too many prices)
              const priceMatches = text.match(/(\d+[,.]?\d*)\s*€/g);
              if (priceMatches && priceMatches.length <= 3) {
                candidateContainers.push({
                  element: el,
                  text: text,
                  textLength: text.length,
                  index: index
                });
              }
            }
          }
        });
        
        console.log(`Found ${candidateContainers.length} candidate containers after Top Objekte`);
        
        // Sort by position in DOM (keep natural order) and text length
        candidateContainers.sort((a, b) => {
          // First by DOM position, then by ideal text length
          if (Math.abs(a.index - b.index) > 10) {
            return a.index - b.index;
          }
          const idealLength = 300;
          return Math.abs(a.textLength - idealLength) - Math.abs(b.textLength - idealLength);
        });
        
        // Process candidates
        candidateContainers.slice(0, 10).forEach((candidate, candidateIndex) => {
          const text = candidate.text;
          const element = candidate.element;
          
          console.log(`\nProcessing candidate ${candidateIndex + 1} (DOM index: ${candidate.index}, ${text.length} chars)`);
          console.log(`Text preview: ${text.substring(0, 120).replace(/\s+/g, ' ')}...`);
          
          // Extract price (first occurrence only)
          const priceMatch = text.match(/(\d{2,4}(?:[,.]\d{1,2})?)\s*€/);
          if (!priceMatch) {
            console.log(`  ❌ No price found`);
            return;
          }
          
          const price = priceMatch[1];
          const priceNum = parseInt(price);
          
          // Price validation (search criteria ≤450€)  
          if (priceNum < 200 || priceNum > 450) {
            console.log(`  ❌ Price out of search range: ${price}€`);
            return;
          }
          
          // Extract size and rooms
          const sizeMatch = text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m²/);
          const roomMatch = text.match(/(\d(?:[,.]\d)?)\s*[Zz]immer/);
          
          // Create unique identifier
          const sizeText = sizeMatch ? sizeMatch[1] : 'nosize';
          const roomText = roomMatch ? roomMatch[1] : 'noroom';
          const uniqueId = `${price}-${sizeText}-${roomText}`;
          
          if (processedContent.has(uniqueId)) {
            console.log(`  ⚠️  Duplicate detected: ${uniqueId}`);
            return;
          }
          
          processedContent.add(uniqueId);
          
          // Extract title - look for meaningful apartment descriptions
          let title = '';
          const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 5);
          
          // Priority patterns for apartment titles
          const titlePatterns = [
            /Günstiges.*Wohnen/i,
            /Familiengerecht/i,
            /Senioren.*Wohnung/i,
            /\d+-Zi.*Wohnung/i,
            /Wohnung.*Berlin/i,
            /\d{5}\s+Berlin/
          ];
          
          // Look for patterned titles first
          for (const pattern of titlePatterns) {
            for (const line of lines) {
              if (pattern.test(line) && line.length > 10 && line.length < 100) {
                title = line;
                break;
              }
            }
            if (title) break;
          }
          
          // Fallback to Berlin address
          if (!title) {
            for (const line of lines) {
              if (line.includes('Berlin') && line.length > 10 && line.length < 80 && 
                  !line.toLowerCase().includes('top objekt')) {
                title = line;
                break;
              }
            }
          }
          
          if (!title) {
            title = lines.find(l => l.length > 15 && l.length < 100) || `${price}€ Berlin`;
          }
          
          // Find apartment detail link
          const containerLinks = element.querySelectorAll('a[href*="/wohnen/"]');
          let bestLink = 'N/A';
          
          for (const link of containerLinks) {
            const href = link.href;
            if (/\/wohnen\/\d+/.test(href)) { // Pattern like /wohnen/9219169
              bestLink = href.startsWith('http') ? href : `https://www.immobilien.de${href}`;
              break;
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
          console.log(`     Title: ${title.substring(0, 50)}...`);
          console.log(`     Link: ${bestLink !== 'N/A' ? 'Valid' : 'Missing'}`);
        });
        
      } catch (error) {
        console.log('Error in extraction:', error.message);
      }
      
      console.log(`\n=== FINAL RESULTS: ${results.length} apartments found AFTER Top Objekte ===`);
      results.forEach((apt, i) => {
        console.log(`${i + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
        console.log(`   Title: ${apt.title}`);
        console.log(`   Link: ${apt.link !== 'N/A' ? 'Yes' : 'No'}`);
      });
      
      return results;
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
