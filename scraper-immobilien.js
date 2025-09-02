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
    await page.waitForTimeout(3000);
    
    // Handle cookie banner
    try {
      const cookieSelectors = [
        '[data-testid="uc-accept-all-button"]',
        'button[data-testid*="accept"]',
        'button[class*="cookie"]',
        'button[class*="accept"]'
      ];
      
      for (const selector of cookieSelectors) {
        try {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            console.log(`Clicking cookie consent: ${selector}`);
            await button.click();
            await page.waitForTimeout(2000);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
    } catch (e) {
      console.log('Cookie handling completed');
    }

    // Scroll to load content
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    await page.waitForTimeout(3000);
    console.log('Page preparation completed, extracting data...');

    // Extract apartments with strict filtering
    const apartments = await page.evaluate(() => {
      const results = [];
      const processedUrls = new Set();
      
      // First, find and mark the "Top Objekte" section to exclude it
      const topObjekteSection = document.querySelector('h2');
      let topObjekteContainer = null;
      
      if (topObjekteSection && topObjekteSection.textContent.includes('Top Objekte')) {
        // Find the container that holds the top objects
        topObjekteContainer = topObjekteSection.parentElement;
        while (topObjekteContainer && topObjekteContainer.tagName !== 'SECTION' && 
               topObjekteContainer.tagName !== 'DIV' && topObjekteContainer.className) {
          topObjekteContainer = topObjekteContainer.parentElement;
        }
        console.log('Found Top Objekte section, will exclude it');
      }
      
      // Get all apartment links
      const apartmentLinks = document.querySelectorAll('a[href*="/wohnen/"]');
      console.log(`Total apartment links found: ${apartmentLinks.length}`);
      
      apartmentLinks.forEach((link, index) => {
        try {
          const href = link.href;
          
          // Skip duplicates
          if (processedUrls.has(href)) {
            console.log(`Skipping duplicate: ${href}`);
            return;
          }
          processedUrls.add(href);
          
          // Check if this link is within the Top Objekte section
          if (topObjekteContainer && topObjekteContainer.contains(link)) {
            console.log(`Skipping link in Top Objekte section: ${href}`);
            return;
          }
          
          // Find the container that has the apartment information
          let container = link;
          let foundContainer = false;
          
          // Look up the DOM tree for a container with apartment data
          for (let i = 0; i < 8; i++) {
            container = container.parentElement;
            if (!container) break;
            
            const containerText = container.textContent || '';
            
            // Look for containers that contain price AND location info
            if (containerText.includes('€') && containerText.includes('Berlin') &&
                containerText.length > 50 && containerText.length < 2000) {
              foundContainer = true;
              break;
            }
          }
          
          if (!foundContainer || !container) {
            console.log(`No suitable container found for link: ${href}`);
            return;
          }
          
          const containerText = container.textContent || '';
          
          // Double-check: skip if container seems to be in Top Objekte area
          if (containerText.includes('Top Objekte') || 
              containerText.includes('Premium') ||
              containerText.includes('Highlight')) {
            console.log(`Skipping container with promotional content: ${href}`);
            return;
          }
          
          // Extract price using the specific structure we found
          let price = null;
          let priceText = '';
          
          // Look for price in span with class label_info (as found in debug)
          const priceSpan = container.querySelector('span.label_info');
          if (priceSpan && priceSpan.textContent.includes('€')) {
            const match = priceSpan.textContent.match(/(\d+(?:[,.]\d+)?)\s*€/);
            if (match) {
              price = parseFloat(match[1].replace(',', '.'));
              priceText = match[1] + ' €';
            }
          }
          
          // Fallback price extraction
          if (!price) {
            const pricePatterns = [
              /(\d+(?:[,.]\d+)?)\s*€\s*(?:Kaltmiete|kalt|Miete)?/i,
              /(?:Kaltmiete|Miete)[\s:]*(\d+(?:[,.]\d+)?)\s*€/i
            ];
            
            for (const pattern of pricePatterns) {
              const match = containerText.match(pattern);
              if (match) {
                price = parseFloat(match[1].replace(',', '.'));
                priceText = match[1] + ' €';
                break;
              }
            }
          }
          
          // STRICT PRICE FILTERING
          if (!price) {
            console.log(`No price found for: ${href}`);
            return;
          }
          
          if (price > 450) {
            console.log(`FILTERING OUT: Price ${price}€ exceeds limit of 450€ for ${href}`);
            return;
          }
          
          if (price < 200) {
            console.log(`FILTERING OUT: Price ${price}€ too low (suspicious) for ${href}`);
            return;
          }
          
          // Extract size and rooms
          let size = null;
          let sizeText = 'N/A';
          let rooms = null;
          let roomsText = 'N/A';
          
          // Size extraction
          const sizeMatch = containerText.match(/(\d+(?:[,.]\d+)?)\s*m²/i);
          if (sizeMatch) {
            size = parseFloat(sizeMatch[1].replace(',', '.'));
            sizeText = sizeMatch[1].replace(',', '.') + ' m²';
          }
          
          // Rooms extraction
          const roomMatch = containerText.match(/(\d+(?:[,.]\d+)?)\s*Zimmer/i);
          if (roomMatch) {
            rooms = parseFloat(roomMatch[1].replace(',', '.'));
            roomsText = roomMatch[1].replace(',', '.') + ' Zimmer';
          }
          
          // Extract title
          let title = '';
          
          // Try link text first
          const linkText = (link.textContent || '').trim();
          if (linkText && linkText.length > 5 && linkText.length < 150 && 
              !linkText.includes('€') && !linkText.includes('m²')) {
            title = linkText;
          }
          
          // Try headings in container
          if (!title) {
            const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"]');
            for (const heading of headings) {
              const headingText = (heading.textContent || '').trim();
              if (headingText && headingText.length > 5 && headingText.length < 150 &&
                  !headingText.includes('€') && !headingText.includes('m²') &&
                  !headingText.includes('Top Objekte')) {
                title = headingText;
                break;
              }
            }
          }
          
          // Extract meaningful text from container
          if (!title) {
            const lines = containerText.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0);
            
            for (const line of lines) {
              if (line.length > 10 && line.length < 150 && 
                  !line.includes('€') && !line.includes('m²') && 
                  !line.includes('Zimmer') && !line.includes('Miete') &&
                  !line.includes('Top Objekte') &&
                  (line.includes('Berlin') || line.includes('Wohnung') || 
                   line.includes('Günstiges') || line.includes('Senioren'))) {
                title = line;
                break;
              }
            }
          }
          
          // Final fallback
          if (!title) {
            const locationMatch = containerText.match(/(\d{5}\s+Berlin[^€\n]*)/);
            if (locationMatch) {
              title = locationMatch[1];
            } else {
              title = `${priceText} Apartment in Berlin`;
            }
          }
          
          title = title.replace(/\s+/g, ' ').trim().substring(0, 100);
          
          const apartment = {
            price: priceText,
            size: sizeText,
            rooms: roomsText,
            title: title,
            link: href,
            rawPrice: price,
            rawSize: size,
            rawRooms: rooms
          };
          
          results.push(apartment);
          console.log(`✓ VALID APARTMENT: ${priceText} | ${sizeText} | ${roomsText} - ${title}`);
          
        } catch (error) {
          console.error(`Error processing apartment link ${index}:`, error.message);
        }
      });
      
      // Sort by price and return
      results.sort((a, b) => a.rawPrice - b.rawPrice);
      console.log(`Final results: ${results.length} valid apartments after filtering`);
      
      return results;
    });

    await browser.close();
    
    console.log(`Successfully extracted ${apartments.length} apartments from Immobilien.de`);
    
    if (apartments.length === 0) {
      console.log('⚠️  No valid apartments found within price range 200-450€');
      console.log('This might indicate:');
      console.log('- All apartments are in the Top Objekte section (promotional)');
      console.log('- The search results are empty');
      console.log('- The price filter on the website is not working correctly');
    }
    
    // Log results
    apartments.forEach((apt, index) => {
      console.log(`${index + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
      console.log(`   Title: ${apt.title}`);
      console.log(`   Link: ${apt.link}`);
    });
    
    // Format and save results
    const results = {
      success: true,
      count: apartments.length,
      timestamp: new Date().toISOString(),
      source: 'immobilien.de',
      searchCriteria: {
        maxPrice: 450,
        minPrice: 200,
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
        description: `Apartment in Berlin - ${apt.size}, ${apt.rooms}`,
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
