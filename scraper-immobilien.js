const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeImmobilien() {
  console.log('Starting apartment scraping from immobilien.de...');
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  // Set headers for immobilien.de
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  });
  
  try {
    // URL corretto per immobilien.de
    const url = 'https://www.immobilien.de/Wohnen/Suchergebnisse-51797.html?search._digest=true&search._filter=wohnen&search.objektart=wohnung&search.preis_bis=450&search.typ=mieten&search.umkreis=10&search.wo=city%3A6444';
    console.log('Processing:', url);

    // Navigate to page
    await page.goto(url, { waitUntil: 'networkidle' });
    console.log('Page loaded');

    // Wait for page load
    await page.waitForTimeout(8000);
    
    // Scroll to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(3000);
    
    console.log('Page preparation completed, extracting data...');

    // Extract apartment data
    const apartments = await page.evaluate(() => {
      try {
        console.log('=== INIZIO ESTRAZIONE IMMOBILIEN.DE ===');
        
        const results = [];
        
        // Analisi base della pagina
        try {
          const bodyText = document.body.textContent;
          console.log(`Lunghezza testo pagina: ${bodyText.length}`);
          console.log(`Contiene "€": ${bodyText.includes('€')}`);
          console.log(`Contiene "m²": ${bodyText.includes('m²')}`);
          console.log(`Contiene "Zimmer": ${bodyText.includes('Zimmer')}`);
        } catch (e) {
          console.log(`Errore analisi pagina: ${e.message}`);
        }
        
        // Cerca selettori comuni per immobilien.de
        const possibleSelectors = [
          '[data-testid*="result"]',
          '[class*="result"]',
          '[class*="listing"]',
          '[class*="expose"]',
          '[class*="item"]',
          '.property',
          '.apartment',
          '.listing-item',
          'article'
        ];
        
        let foundElements = [];
        possibleSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            console.log(`Selector "${selector}": ${elements.length} elementi`);
            foundElements = foundElements.concat(Array.from(elements));
          }
        });
        
        console.log(`Totale elementi candidati: ${foundElements.length}`);
        
        // Se non troviamo elementi con selettori specifici, cerca tutto
        if (foundElements.length === 0) {
          console.log('Nessun elemento trovato con selettori specifici, ricerca generale...');
          const allElements = document.querySelectorAll('*');
          Array.from(allElements).forEach((el, i) => {
            const text = el.textContent;
            if (!text || text.length < 50 || text.length > 2000) return;
            
            // Deve avere prezzo e dimensione
            const hasPrice = /\d+[,.]?\d*\s*€/.test(text);
            const hasSize = /\d+[,.]?\d*\s*m²/.test(text);
            
            if (hasPrice && hasSize) {
              foundElements.push(el);
              if (foundElements.length <= 10) {
                console.log(`Elemento trovato ${foundElements.length}: ${text.substring(0, 100)}...`);
              }
            }
          });
        }
        
        console.log(`Elementi finali da processare: ${foundElements.length}`);
        
        // Processa gli elementi trovati
        foundElements.forEach((el, i) => {
          try {
            const text = el.textContent;
            if (!text) return;
            
            // Estrai informazioni
            const priceMatch = text.match(/(\d+[,.]?\d*)\s*€/);
            const sizeMatch = text.match(/(\d+[,.]?\d*)\s*m²/);
            const roomMatch = text.match(/(\d+[,.]?\d*)\s*[Zz]immer/) || text.match(/(\d+)\s*[Zz]i/);
            
            if (priceMatch && sizeMatch) {
              const apartment = {
                price: priceMatch[0],
                size: sizeMatch[0],
                rooms: roomMatch ? roomMatch[0] : 'N/A',
                title: '',
                fullText: text.substring(0, 300),
                link: null
              };
              
              // Cerca titolo/indirizzo
              const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 5);
              for (const line of lines.slice(0, 5)) {
                if (line.length > 15 && line.length < 100 &&
                    (line.toLowerCase().includes('berlin') || 
                     line.includes('Str.') || 
                     line.includes('str.') ||
                     line.includes('Chaussee') ||
                     line.includes('Platz') ||
                     line.includes('Weg'))) {
                  apartment.title = line;
                  break;
                }
              }
              
              if (!apartment.title && lines.length > 0) {
                apartment.title = lines[0].substring(0, 80);
              }
              
              // Cerca link
              const links = el.querySelectorAll('a[href]');
              for (const link of links) {
                const href = link.href;
                if (href && (href.includes('expose') || href.includes('detail') || href.includes('objekt'))) {
                  apartment.link = href;
                  break;
                }
              }
              
              results.push(apartment);
              console.log(`Appartamento ${results.length}: ${apartment.price}, ${apartment.size}, "${apartment.title.substring(0, 30)}"`);
            }
          } catch (e) {
            // Ignora errori sui singoli elementi
          }
        });
        
        // Rimuovi duplicati
        const unique = [];
        const seen = new Set();
        results.forEach(apt => {
          const key = `${apt.price}-${apt.size}`;
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(apt);
          }
        });
        
        console.log(`=== RISULTATO FINALE ===`);
        console.log(`Appartamenti trovati: ${unique.length}`);
        unique.forEach((apt, i) => {
          console.log(`${i + 1}. ${apt.price} - ${apt.size} - "${apt.title.substring(0, 40)}"`);
          console.log(`   Link: ${apt.link || 'NESSUNO'}`);
        });
        
        return unique;
        
      } catch (e) {
        console.log(`ERRORE GENERALE: ${e.message}`);
        return [];
      }
    });

    await browser.close();
    
    console.log(`Trovati ${apartments.length} appartamenti da Immobilien.de`);
    
    // Format results
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
        description: apt.fullText || 'N/A',
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
