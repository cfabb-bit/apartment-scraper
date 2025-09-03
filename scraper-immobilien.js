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
    
    // Scroll to load content
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(resolve => setTimeout(resolve, 2000));
    });
    
    console.log('Page preparation completed, extracting data...');
    
    // Extract ALL data first, then filter
    const allData = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a[href*="/wohnen/"]');
      
      console.log(`Found ${links.length} apartment links`);
      
      links.forEach((link, index) => {
        try {
          // Get parent container
          let container = link;
          for (let i = 0; i < 6; i++) {
            container = container.parentElement;
            if (!container) break;
            
            const text = container.textContent || '';
            if (text.includes('€') && text.includes('Berlin') && text.length > 100) {
              break;
            }
          }
          
          if (!container) return;
          
          const fullText = container.textContent || '';
          
          // Extract information
          const priceMatches = fullText.match(/(\d+(?:[,.]\d+)?)\s*€/g) || [];
          const sizeMatches = fullText.match(/(\d+(?:[,.]\d+)?)\s*m²/g) || [];
          const roomMatches = fullText.match(/(\d+(?:[,.]\d+)?)\s*Zimmer/g) || [];
          
          // Get main price
          let mainPrice = null;
          if (priceMatches.length > 0) {
            for (const priceMatch of priceMatches) {
              const price = parseFloat(priceMatch.replace(/[^\d,.]/, '').replace(',', '.'));
              if (price >= 200 && price <= 2000) {
                mainPrice = price;
                break;
              }
            }
          }
          
          const apartment = {
            index: index,
            link: link.href,
            linkText: link.textContent?.trim() || '',
            mainPrice: mainPrice,
            allPrices: priceMatches,
            allSizes: sizeMatches,
            allRooms: roomMatches,
            containerText: fullText.substring(0, 500),
            inTopObjekte: fullText.includes('Top Objekte'),
            hasPromotional: fullText.includes('Premium') || fullText.includes('Highlight')
          };
          
          results.push(apartment);
          
        } catch (error) {
          console.error(`Error processing link ${index}:`, error.message);
        }
      });
      
      return results;
    });
    
    await browser.close();
    
    // Debug output
    console.log('\n=== RAW DATA ANALYSIS ===');
    console.log(`Total links processed: ${allData.length}`);
    
    allData.forEach((apt, i) => {
      console.log(`${i+1}. Link: ${apt.link}`);
      console.log(`   Prices found: ${apt.allPrices.join(', ')}`);
      console.log(`   Main price: ${apt.mainPrice}€`);
      console.log(`   In Top Objekte: ${apt.inTopObjekte}`);
      console.log(`   Link text: ${apt.linkText}`);
      console.log('');
    });
    
    // Filter step by step
    console.log('\n=== FILTERING PROCESS ===');
    
    const uniqueApartments = allData.filter((apt, index, self) => 
      index === self.findIndex(a => a.link === apt.link)
    );
    console.log(`After removing duplicates: ${uniqueApartments.length}`);
    
    const withValidPrice = uniqueApartments.filter(apt => apt.mainPrice !== null);
    console.log(`After requiring valid price: ${withValidPrice.length}`);
    
    const withinPriceRange = withValidPrice.filter(apt => {
      const valid = apt.mainPrice <= 450 && apt.mainPrice >= 150;
      if (!valid) {
        console.log(`FILTERED OUT - Price ${apt.mainPrice}€ outside range: ${apt.link}`);
      }
      return valid;
    });
    console.log(`After price filtering (150-450€): ${withinPriceRange.length}`);
    
    const nonPromotional = withinPriceRange.filter(apt => {
      if (apt.inTopObjekte) {
        console.log(`FILTERED OUT - In Top Objekte section: ${apt.link}`);
        return false;
      }
      return true;
    });
    console.log(`After removing Top Objekte: ${nonPromotional.length}`);
    
    // Convert to final format
    const finalApartments = nonPromotional.map((apt, index) => {
      const price = apt.mainPrice + ' €';
      const size = apt.allSizes.length > 0 ? apt.allSizes[0].replace(',', '.') : 'N/A';
      const rooms = apt.allRooms.length > 0 ? apt.allRooms[0].replace(',', '.') : 'N/A';
      
      let title = apt.linkText;
      if (!title || title.length < 5) {
        const locationMatch = apt.containerText.match(/(\d{5}\s+Berlin[^€\n]*)/);
        if (locationMatch) {
          title = locationMatch[1];
        } else {
          title = `${price} Apartment in Berlin`;
        }
      }
      
      title = title.substring(0, 100).trim();
      
      return {
        id: `immobilien_${Date.now()}_${index}`,
        price: price,
        size: size,
        rooms: rooms,
        title: title,
        link: apt.link,
        description: apt.containerText.substring(0, 200).replace(/\s+/g, ' ').trim(),
        source: 'immobilien.de',
        scrapedAt: new Date().toISOString()
      };
    });
    
    console.log('\n=== FINAL RESULTS ===');
    finalApartments.forEach((apt, index) => {
      console.log(`${index + 1}. ${apt.price} | ${apt.size} | ${apt.rooms}`);
      console.log(`   Title: ${apt.title}`);
      console.log(`   Link: ${apt.link}`);
    });
    
    // Save results
    const results = {
      success: true,
      count: finalApartments.length,
      timestamp: new Date().toISOString(),
      source: 'immobilien.de',
      data: finalApartments
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
