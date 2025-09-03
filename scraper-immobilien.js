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
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    // Handle cookies
    try {
      const cookieButton = await page.$('button[class*="cookie"]');
      if (cookieButton) {
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
    
    // Simple, direct approach - extract ALL data first, then filter
    const allData = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a[href*="/wohnen/"]');
      
      console.log(`Found ${links.length} apartment links`);
      
      links.forEach((link, index) => {
        try {
          // Get the largest reasonable parent container
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
          
          // Extract ALL information we can find
          const priceMatches = fullText.match(/(\d+(?:[,.]\d+)?)\s*€/g) || [];
          const sizeMatches = fullText.match(/(\d+(?:[,.]\d+)?)\s*m²/g) || [];
          const roomMatches = fullText.match(/(\d+(?:[,.]\d+)?)\s*Zimmer/g) || [];
          
          // Get the main price (usually the first one)
          let mainPrice = null;
          if (priceMatches.length > 0) {
            // Try to find the main rent price
            for (const priceMatch of priceMatches) {
              const price = parseFloat(priceMatch.replace(/[^\d,.]/, '').replace(',', '.'));
              if (price >= 200 && price <= 2000) { // Reasonable range
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
            hasPromotionalKeywords: fullText.includes('Premium') || fullText.includes('Highlight') || fullText.includes('Empfohlen')
          };
          
          results.push(apartment);
          
        } catch (error) {
          console.error(`Error processing link ${index}:`, error.message);
        }
