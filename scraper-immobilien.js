const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeImmobilien() {
  console.log('Starting Immobilien scraping...');
  
  const browser = await chromium.launch({
    headless: true
  });
  
  const page = await browser.newPage();
  
  try {
    // Navigate to the immobilien website
    await page.goto('https://www.immobilienscout24.de/Suche/de/berlin/berlin/wohnung-mieten', {
      waitUntil: 'networkidle'
    });
    
    // Wait for listings to load
    await page.waitForSelector('[data-testid="result-list-entry"]', { timeout: 10000 });
    
    // Extract apartment data
    const apartments = await page.evaluate(() => {
      const listings = document.querySelectorAll('[data-testid="result-list-entry"]');
      const results = [];
      
      listings.forEach((listing, index) => {
        try {
          const titleElement = listing.querySelector('h3 a, h2 a, .result-list-entry__brand-title a');
          const priceElement = listing.querySelector('[data-testid="price"] dd, .result-list-entry__primary-criterion dd');
          const sizeElement = listing.querySelector('[data-testid="area"] dd, .result-list-entry__primary-criterion:nth-child(2) dd');
          const roomsElement = listing.querySelector('[data-testid="rooms"] dd, .result-list-entry__primary-criterion:nth-child(3) dd');
          const linkElement = listing.querySelector('h3 a, h2 a, .result-list-entry__brand-title a');
          
          if (titleElement && priceElement) {
            const apartment = {
              id: `immobilien_${index + 1}`,
              title: titleElement.textContent?.trim() || 'N/A',
              price: priceElement.textContent?.trim() || 'N/A',
              size: sizeElement?.textContent?.trim() || 'N/A',
              rooms: roomsElement?.textContent?.trim() || 'N/A',
              link: linkElement?.href ? (linkElement.href.startsWith('http') ? linkElement.href : `https://www.immobilienscout24.de${linkElement.href}`) : 'N/A',
              source: 'ImmobilienScout24',
              scraped_at: new Date().toISOString(),
              location: 'Berlin'
            };
            
            results.push(apartment);
          }
        } catch (error) {
          console.error(`Error processing listing ${index}:`, error);
        }
      });
      
      return results;
    });
    
    console.log(`Found ${apartments.length} apartments on ImmobilienScout24`);
    
    // Add some metadata
    const results = {
      source: 'ImmobilienScout24',
      scraped_at: new Date().toISOString(),
      total_found: apartments.length,
      apartments: apartments
    };
    
    // Save results to file for the workflow to pick up
    fs.writeFileSync('results-immobilien.json', JSON.stringify(results, null, 2));
    
    console.log('Results saved to results-immobilien.json');
    
    return results;
    
  } catch (error) {
    console.error('Error during scraping:', error);
    
    // Save error info
    const errorResult = {
      source: 'ImmobilienScout24',
      scraped_at: new Date().toISOString(),
      error: error.message,
      total_found: 0,
      apartments: []
    };
    
    fs.writeFileSync('results-immobilien.json', JSON.stringify(errorResult, null, 2));
    throw error;
    
  } finally {
    await browser.close();
  }
}

// Run the scraper
scrapeImmobilien()
  .then(results => {
    console.log('Scraping completed successfully');
    console.log(`Total apartments found: ${results.total_found}`);
  })
  .catch(error => {
    console.error('Scraping failed:', error);
    process.exit(1);
  });
