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
    await page.waitForTimeout(5000);
    
    // Handle cookies
    try {
      const cookieButton = await page.$('button[class*="cookie"]');
      if (cookieButton) {
        console.log('Clicking cookie consent: button[class*="cookie"]');
        await cookieButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('Cookie handling completed');
    }
    
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(resolve => setTimeout(resolve, 2000));
    });
    
    console.log('Page preparation completed, extracting data...');
    
    // NEW APPROACH: Focus only on the detailed apartment listings (with _ref parameter)
    const apartments = await page.evaluate(() => {
      const results = [];
      
      // Strategy: Only process links that have the _ref parameter (detailed listings)
      const detailedLinks = document.querySelectorAll('a[href*="/wohnen/"][href*="_ref"]');
      console.log(`Found ${detailedLinks.length} detailed apartment listings`);
      
      detailedLinks.forEach((link, index) => {
        try {
          // Get the container with all apartment data
          let container = link;
          for (let i = 0; i < 8; i++) {
            container = container.parentElement;
            if (!container) break;
            
            const text = container.textContent || '';
            // Look for container with comprehensive apartment data
            if (text.includes('€') && text.includes('Berlin') && 
                text.includes('m²') && text.includes('Zimmer') && 
                text.length > 300) {
              break;
            }
          }
          
          if (!container) {
            console.log(`No suitable container found for link ${index}`);
            return;
          }
          
          const fullText = container.textContent.replace(/\s+/g, ' ').trim();
          console.log(`Processing apartment ${index + 1}:`);
          console.log(`Container text length: ${fullText.length}`);
          
          // Extract price - look for "Kaltmiete (netto)" pattern specifically
          let price = null;
          let priceText = '';
          
          const kaltmieteMatch = fullText.match(/(\d+(?:[,.]?\d+)?)\s*€\s*Kaltmiete\s*\(netto\)/);
          if (kaltmieteMatch) {
            price = parseFloat(kaltmieteMatch[1].replace(',', '.'));
            priceText = Math.round(price) + ' €';
            console.log(`Found Kaltmiete: ${priceText}`);
          }
          
          if (!price || price > 450) {
            console.log(`Skipping: price ${price}€ not suitable`);
            return;
          }
          
          // Extract size - look near "Wohnfläche"
          let size = null;
          let sizeText = 'N/A';
          const sizeMatch = fullText.match(/(\d+(?:[,.]?\d+)?)\s*m²\s*Wohnfläche/);
          if (sizeMatch) {
            size = parseFloat(sizeMatch[1].replace(',', '.'));
            sizeText = sizeMatch[1].replace(',', '.') + ' m²';
            console.log(`Found size: ${sizeText}`);
          }
          
          // Extract rooms - look for standalone number before "Zimmer"
          let rooms = null;
          let roomsText = 'N/A';
          const roomMatch = fullText.match(/(\d+(?:[,.]?\d+)?)\s*Zimmer(?!\s*Wohnung)/);
          if (roomMatch) {
            rooms = parseFloat(roomMatch[1].replace(',', '.'));
            roomsText = roomMatch[1].replace(',', '.') + ' Zimmer';
            console.log(`Found rooms: ${roomsText}`);
          }
          
          // Extract title from link text - clean approach
          let title = '';
          const linkText = link.textContent.replace(/\s+/g, ' ').trim();
          
          // Remove leading numbers and get the meaningful part
          const titleMatch = linkText.match(/^\d+\s+(.+?)(?:\s+Wohnung|\s+Balkon|\s+\d{5}|\s*$)/);
          if (titleMatch) {
            title = titleMatch[1].trim();
          } else {
            // Fallback: clean the whole link text
            title = linkText.replace(/^\d+\s*/, '').trim();
          }
          
          // Clean title
          title = title
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s\-()+äöüÄÖÜß!]/g, '')
            .substring(0, 60)
            .trim();
          
          if (!title || title.length < 3) {
            title = `Apartment in Berlin`;
          }
          
          // Extract location
          let location = '';
          const locationMatch = fullText.match(/(\d{5}\s+Berlin)/);
          if (locationMatch) {
            location = locationMatch[1];
          }
          
          // Build description
          let description = title;
          if (location) {
            description += ` in ${location}`;
          }
          if (size) {
            description += `, ${sizeText}`;
          }
          if (rooms) {
            description += `, ${roomsText}`;
          }
          
          const apartment = {
            price: priceText,
            size: sizeText,
            rooms: roomsText,
            title: title,
            link: link.href,
            location: location,
            description: description,
            rawPrice: price,
            rawSize: size,
            rawRooms: rooms
          };
          
          results.push(apartment);
          console.log(`✓ Added: ${priceText} | ${sizeText} | ${roomsText} - ${title}`);
          
        } catch (error) {
          console.error(`Error processing apartment ${index}:`, error.message);
        }
      });
      
      // Remove duplicates by link (base URL without parameters)
      const uniqueResults = results.filter((apt, index, self) => {
        const baseUrl = apt.link.split('?')[0];
        return index === self.findIndex(a => a.link.split('?')[0] === baseUrl);
      });
      
      console.log(`Final count after deduplication: ${uniqueResults.length}`);
      return uniqueResults.sort((a, b) => a.rawPrice - b.rawPrice);
    });
    
    await browser.close();
    
    console.log(`Successfully extracted ${apartments.length} apartments from Immobilien.de`);
    
    apartments.forEach((apt, index) => {
      console.log(`${index + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
      console.log(`   Title: ${apt.title}`);
      console.log(`   Location: ${apt.location}`);
      console.log(`   Link: ${apt.link}`);
      console.log('');
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
        description: apt.description,
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
