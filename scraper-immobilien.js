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
          
          // Get main price - IMPROVED LOGIC to find the actual rent price
          let mainPrice = null;
          if (priceMatches.length > 0) {
            // Strategy 1: Look for price near "Kaltmiete" text
            const kaltmieteMatch = fullText.match(/(\d+(?:[,.]?\d+)?)\s*€\s*.*?(?:Kaltmiete|kalt)/i);
            if (kaltmieteMatch) {
              const price = parseFloat(kaltmieteMatch[1].replace(',', '.'));
              if (price >= 150 && price <= 600) {
                mainPrice = price;
                console.log(`Found Kaltmiete price: ${price}€`);
              }
            }
            
            // Strategy 2: If no Kaltmiete found, take the lowest reasonable price
            if (!mainPrice) {
              const validPrices = [];
              for (const priceMatch of priceMatches) {
                const price = parseFloat(priceMatch.replace(/[^\d,.]/, '').replace(',', '.'));
                if (price >= 200 && price <= 600) { // Reasonable apartment price range
                  validPrices.push(price);
                }
              }
              
              if (validPrices.length > 0) {
                // Take the lowest price (most likely to be base rent)
                mainPrice = Math.min(...validPrices);
                console.log(`Selected lowest valid price: ${mainPrice}€ from [${validPrices.join(', ')}]`);
              }
            }
            
            // Strategy 3: Fallback to first reasonable price
            if (!mainPrice) {
              for (const priceMatch of priceMatches) {
                const price = parseFloat(priceMatch.replace(/[^\d,.]/, '').replace(',', '.'));
                if (price >= 200 && price <= 600) {
                  mainPrice = price;
                  console.log(`Fallback to first reasonable price: ${price}€`);
                  break;
                }
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
    
          // Convert to final format with flexible data cleaning
    const finalApartments = nonPromotional.map((apt, index) => {
      const price = apt.mainPrice + ' €';
      const size = apt.allSizes.length > 0 ? apt.allSizes[0].replace(',', '.') : 'N/A';
      const rooms = apt.allRooms.length > 0 ? apt.allRooms[0].replace(',', '.') : 'N/A';
      
      // Flexible title extraction - focus on cleaning, not content filtering
      let title = '';
      
      // First try: clean the link text (most reliable source)
      if (apt.linkText && apt.linkText.trim()) {
        title = apt.linkText
          .replace(/^\d+\s*/, '')           // Remove leading numbers only
          .replace(/[\n\r\t]/g, ' ')        // Replace line breaks with spaces
          .replace(/\s+/g, ' ')             // Multiple spaces to single
          .trim();
      }
      
      // Second try: if link text is too short, look for the first meaningful text chunk
      if (!title || title.length < 10) {
        const textChunks = apt.containerText
          .replace(/[\n\r\t]/g, ' ')        // Clean line breaks
          .replace(/\s+/g, ' ')             // Clean spaces
          .split(' ')
          .filter(chunk => chunk.length > 0);
        
        // Find the first chunk that looks like a title (not a number, price, or single word)
        let titleStart = -1;
        for (let i = 0; i < textChunks.length; i++) {
          const chunk = textChunks[i];
          // Skip numbers, prices, single characters
          if (!/^\d+$/.test(chunk) && !chunk.includes('€') && chunk.length > 2) {
            titleStart = i;
            break;
          }
        }
        
        if (titleStart >= 0) {
          // Take up to 8 words from the title start
          title = textChunks.slice(titleStart, titleStart + 8).join(' ');
        }
      }
      
      // Fallback: location-based title
      if (!title || title.length < 5) {
        const locationMatch = apt.containerText.match(/(\d{5}\s*Berlin)/);
        if (locationMatch) {
          title = locationMatch[1];
        } else {
          title = `Apartment ${price}`;
        }
      }
      
      // Final title cleaning - keep all content, just clean formatting
      title = title
        .substring(0, 100)                  // Reasonable length limit
        .replace(/[\n\r\t]/g, ' ')          // Clean line breaks
        .replace(/\s+/g, ' ')               // Clean spaces
        .trim();
      
      // Flexible description - extract first meaningful sentences
      let description = apt.containerText
        .replace(/[\n\r\t]/g, ' ')          // Clean line breaks
        .replace(/\s+/g, ' ')               // Clean spaces
        .trim();
      
      // Try to find sentence boundaries and take first meaningful content
      const sentences = description.split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 15)         // Reasonable sentence length
        .filter(s => !s.match(/^\d+$/));    // Not just numbers
      
      if (sentences.length > 0) {
        description = sentences[0];
      }
      
      // Limit description length
      description = description.substring(0, 200).trim();
      
      // Ensure we have some description
      if (!description || description.length < 10) {
        description = `${title} - ${size}, ${rooms} in Berlin`;
      }
      
      return {
        id: `immobilien_${Date.now()}_${index}`,
        price: price,
        size: size,
        rooms: rooms,
        title: title,
        link: apt.link,
        description: description,
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
