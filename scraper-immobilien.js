const { chromium } = require('playwright');
const fs = require('fs');
name: Multi-Site Apartment Scraping
on:
  workflow_dispatch:  # Trigger manuale
  repository_dispatch:
    types: [scrape_apartments]

async function scrapeImmobilien() {
    console.log('Starting apartment scraping from immobilien.de...');
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        const url = 'https://www.immobilien.de/Wohnen/Suchergebnisse-51797.html?search._digest=true&search._filter=wohnen&search.objektart=wohnung&search.preis_bis=540&search.typ=mieten&search.umkreis=10&search.wo=Berlin';
        console.log('Processing URL:', url);

        // Navigate to page
        await page.goto(url, { waitUntil: 'networkidle' });
        console.log('Page loaded');

        // Wait for page to load
        await page.waitForSelector('body', { timeout: 30000 });
        console.log('Page body loaded');
        
        // Handle cookie banner with more selectors
        const cookieSelectors = [
            '#uc-btn-accept-banner',
            'button[data-testid="uc-accept-all-button"]',
            '.uc-btn-accept-banner',
            'button[aria-label*="akzeptieren"]',
            'button[title*="akzeptieren"]',
            '.cookie-consent button',
            '#cookie-consent-accept',
            '.gdpr-accept',
            '.consent-accept',
            '[data-cy="accept-all"]',
            '[data-testid="accept-all"]'
        ];
        
        let cookieHandled = false;
        for (const selector of cookieSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.click(selector);
                console.log(`Cookie banner accepted with selector: ${selector}`);
                await page.waitForTimeout(2000);
                cookieHandled = true;
                break;
            } catch (e) {
                // Continue to next selector
            }
        }
        
        // Alternative approach: click any button containing "akzeptieren"
        if (!cookieHandled) {
            try {
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const acceptButton = buttons.find(btn => 
                        btn.textContent.toLowerCase().includes('akzeptieren') ||
                        btn.textContent.toLowerCase().includes('alle') ||
                        btn.textContent.toLowerCase().includes('accept')
                    );
                    if (acceptButton) {
                        acceptButton.click();
                        return true;
                    }
                    return false;
                });
                console.log('Cookie banner handled via text search');
                await page.waitForTimeout(2000);
            } catch (e) {
                console.log('No cookie banner found');
            }
        }
        
        // Wait for content to load
        await page.waitForTimeout(5000);
        
        // Scroll to load more results
        await page.evaluate(() => {
            return new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const maxScrolls = 10;
                let scrollCount = 0;
                
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    scrollCount++;
                    
                    if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 800);
            });
        });
        
        await page.waitForTimeout(3000);
        console.log('Page preparation completed, extracting data...');
        
        // Extract apartment data
        const apartments = await page.evaluate(() => {
            const results = [];
            console.log('Starting apartment extraction');
            
            // Strategy 1: Find elements with specific text patterns
            const allElements = Array.from(document.querySelectorAll('*'));
            const propertyElements = [];
            
            // Look for elements containing price and size indicators
            allElements.forEach(el => {
                const text = el.textContent || '';
                const hasPrice = /\d+\s*€/.test(text);
                const hasSize = /\d+\s*m²/.test(text);
                const hasRooms = /\d+\s*(zimmer|zi\.)/i.test(text);
                
                // Element should contain price or size info and not be too nested
                if ((hasPrice || hasSize || hasRooms) && 
                    text.length > 30 && text.length < 2000 &&
                    el.children.length < 30) {
                    
                    // Avoid duplicates by checking if parent is already included
                    const hasParentInList = propertyElements.some(existing => 
                        existing.contains(el) || el.contains(existing)
                    );
                    
                    if (!hasParentInList) {
                        propertyElements.push(el);
                    }
                }
            });
            
            console.log(`Found ${propertyElements.length} potential property elements`);
            
            // Strategy 2: If no elements found, try common selectors
            if (propertyElements.length === 0) {
                const commonSelectors = [
                    '[class*="result"]',
                    '[class*="property"]',
                    '[class*="listing"]',
                    '[class*="item"]',
                    '[class*="card"]',
                    'article',
                    '[data-testid*="property"]',
                    '[data-testid*="result"]'
                ];
                
                for (const selector of commonSelectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        elements.forEach(el => {
                            const text = el.textContent || '';
                            if (text.includes('€') && text.length > 50) {
                                propertyElements.push(el);
                            }
                        });
                        if (propertyElements.length > 0) {
                            console.log(`Using selector: ${selector}, found ${propertyElements.length} elements`);
                            break;
                        }
                    }
                }
            }
            
            // Process each element
            propertyElements.forEach((element, index) => {
                try {
                    const fullText = element.textContent || '';
                    
                    // Extract price
                    let price = 'N/A';
                    const priceMatch = fullText.match(/(\d{2,4}(?:[.,]\d{2})?)\s*€/);
                    if (priceMatch) {
                        price = priceMatch[1] + ' €';
                    }
                    
                    // Extract size
                    let size = 'N/A';
                    const sizeMatch = fullText.match(/(\d{1,3}(?:[.,]\d+)?)\s*m²/);
                    if (sizeMatch) {
                        size = sizeMatch[0];
                    }
                    
                    // Extract rooms
                    let rooms = 'N/A';
                    const roomsMatch = fullText.match(/(\d+(?:[.,]\d+)?)\s*(zimmer|zi\.)/i);
                    if (roomsMatch) {
                        rooms = roomsMatch[0];
                    }
                    
                    // SKIP if this looks like a navigation/header/footer element
                    if (fullText.length < 50 || 
                        fullText.includes('Immobilien.de') ||
                        fullText.includes('Suchen') ||
                        fullText.includes('Filter') ||
                        fullText.includes('Sortieren') ||
                        fullText.includes('Cookie') ||
                        fullText.includes('Datenschutz') ||
                        fullText.includes('Impressum')) {
                        return; // Skip this element
                    }
                    
                    // Extract location
                    let location = 'N/A';
                    const locationMatch = fullText.match(/(\d{5}\s+[A-Za-züäöß\s-]+)/);
                    if (locationMatch) {
                        location = locationMatch[1].trim();
                    } else {
                        // Try to find Berlin districts
                        const berlinMatch = fullText.match(/(Berlin[\s-][A-Za-züäöß\s-]+)/);
                        if (berlinMatch) {
                            location = berlinMatch[1].trim();
                        }
                    }
                    
                    // Extract title (first meaningful line)
                    let title = 'N/A';
                    const titleEl = element.querySelector('h1, h2, h3, h4, [class*="title"], [class*="headline"]');
                    if (titleEl && titleEl.textContent.trim().length > 5) {
                        title = titleEl.textContent.trim().substring(0, 100);
                    } else {
                        const lines = fullText.split('\n').filter(line => 
                            line.trim().length > 10 && 
                            !line.includes('€') && 
                            !line.includes('m²')
                        );
                        if (lines.length > 0) {
                            title = lines[0].trim().substring(0, 100);
                        }
                    }
                    
                    // Extract link
                    let link = 'N/A';
                    const linkEl = element.querySelector('a[href]') || element.closest('a');
                    if (linkEl && linkEl.href) {
                        link = linkEl.href;
                    }
                    
                    // Validate data quality
                    const priceNum = parseFloat(price.replace(/[^\d.,]/g, '').replace(',', '.'));
                    const sizeNum = parseFloat(size.replace(/[^\d.,]/g, '').replace(',', '.'));
                    
                    // STRICT VALIDATION: Must have at least price AND size to be a real apartment
                    if (price !== 'N/A' && size !== 'N/A') {
                        // Price between 50-1000€ and size between 15-200m²
                        if ((priceNum >= 50 && priceNum <= 1000) &&
                            (sizeNum >= 15 && sizeNum <= 200)) {
                            
                            const apartment = {
                                id: `immobilien_${Date.now()}_${index}`,
                                title: title,
                                price: price,
                                size: size,
                                rooms: rooms,
                                location: location,
                                link: link,
                                description: fullText.substring(0, 300).replace(/\s+/g, ' ').trim(),
                                source: 'immobilien.de',
                                scrapedAt: new Date().toISOString(),
                                pageUrl: window.location.href
                            };
                            
                            results.push(apartment);
                            console.log(`✓ Valid apartment ${results.length}:`, {
                                price: apartment.price,
                                size: apartment.size,
                                rooms: apartment.rooms,
                                title: apartment.title.substring(0, 40) + '...'
                            });
                        } else {
                            console.log(`✗ Skipped (invalid data):`, {price: priceNum, size: sizeNum});
                        }
                    } else {
                        console.log(`✗ Skipped (missing price or size):`, {price, size});
                    }
                } catch (e) {
                    console.log(`Error processing element ${index}:`, e.message);
                }
            });
            
            console.log(`Total extracted: ${results.length} apartments`);
            return results;
        });

        await browser.close();
        
        console.log(`Extraction completed: ${apartments.length} apartments found`);
        
        // Format results for GitHub Gist
        const results = {
            success: true,
            count: apartments.length,
            timestamp: new Date().toISOString(),
            source: 'immobilien.de',
            data: apartments.map(apt => ({
                id: `immobilien_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                price: apt.price || 'N/A',
                size: apt.size || 'N/A', 
                rooms: apt.rooms || 'N/A',
                title: apt.title || 'N/A',
                link: apt.link || 'N/A',
                description: apt.fullText || apt.description || 'N/A',
                location: apt.location || 'N/A',
                source: 'immobilien.de',
                scrapedAt: new Date().toISOString()
            }))
        };
        
        fs.writeFileSync('results-immobilien.json', JSON.stringify(results, null, 2));
        console.log('Results saved to results-immobilien.json');
        
        return results;

    } catch (error) {
        await browser.close();
        console.error('Critical error:', error.message);
        
        const errorResult = {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            source: 'immobilien.de'
        };
        
        fs.writeFileSync('results-immobilien.json', JSON.stringify(errorResult, null, 2));
        throw error;
    }
}

// Run the scraper
scrapeImmobilien().then(() => {
    console.log('Immobilien.de scraping completed successfully');
}).catch(error => {
    console.error('Immobilien.de scraping failed:', error);
    process.exit(1);
});
jobs:
  scrape-all:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - run: npm install
      - run: npx playwright install chromium
      
      # Scrape Stadtundland
      - name: Scrape Stadtundland
        run: node scraper.js
      
      # Update Stadtundland Gist
      - name: Update Stadtundland Gist
        run: |
          curl -X PATCH \
            -H "Authorization: token ${{ secrets.GIST_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{\"files\":{\"apartments.json\":{\"content\":\"$(cat results.json | jq -c . | sed 's/"/\\"/g')\"}}}" \
            https://api.github.com/gists/${{ secrets.GIST_ID }}
      
      # Scrape Immobilien
      - name: Scrape Immobilien  
        run: node scraper-immobilien.js
      
      # Update Immobilien Gist
      - name: Update Immobilien Gist
        run: |
          curl -X PATCH \
            -H "Authorization: token ${{ secrets.GIST_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{\"files\":{\"apartments-immobilien.json\":{\"content\":\"$(cat results-immobilien.json | jq -c . | sed 's/"/\\"/g')\"}}}" \
            https://api.github.com/gists/${{ secrets.GIST_ID_IMMOBILIEN }}
