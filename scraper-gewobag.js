const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeApartments() {
    console.log('Starting apartment scraping from gewobag.de...');
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        const url = 'https://www.gewobag.de/fuer-mietinteressentinnen/mietangebote/?objekttyp%5B%5D=wohnung&gesamtmiete_von=&gesamtmiete_bis=450&gesamtflaeche_von=&gesamtflaeche_bis=&zimmer_von=&zimmer_bis=&sort-by=';
        console.log('Processing:', url);

        // Navigate to page with longer timeout
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        console.log('Page loaded');

        // Accept cookies if present
        try {
            await page.click('[data-testid="cookie-accept"]', { timeout: 3000 });
            console.log('Cookies accepted');
        } catch (e) {
            console.log('No cookie banner found or already accepted');
        }

        // Try alternative cookie selectors
        try {
            await page.click('button:has-text("Akzeptieren")', { timeout: 2000 });
            console.log('Cookie button clicked');
        } catch (e) {
            console.log('No alternative cookie button');
        }

        // Wait longer for dynamic content
        await page.waitForTimeout(8000);
        
        // Take screenshot for debugging
        await page.screenshot({ path: 'gewobag-debug.png', fullPage: true });
        console.log('Screenshot saved for debugging');
        
        // Wait longer and scroll multiple times
        await page.waitForTimeout(3000);
        
        // Scroll in steps to trigger all lazy loading
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(2000);
        }
        
        console.log('Page preparation completed, extracting data...');

        // Extract apartment data
        const apartments = await page.evaluate(() => {
            try {
                console.log('=== INIZIO ESTRAZIONE GEWOBAG ===');
                
                const results = [];
                
                // STEP 1: Analisi completa della pagina
                try {
                    const bodyText = document.body.textContent;
                    console.log(`Lunghezza testo pagina: ${bodyText.length}`);
                    console.log(`Contiene "€": ${bodyText.includes('€')}`);
                    console.log(`Contiene "m²": ${bodyText.includes('m²')}`);
                    console.log(`Contiene "Zimmer": ${bodyText.includes('Zimmer')}`);
                    console.log(`Contiene "miete": ${bodyText.toLowerCase().includes('miete')}`);
                    
                    // Verifica se ci sono messaggi tipo "keine Angebote"
                    console.log(`Contiene "keine": ${bodyText.toLowerCase().includes('keine')}`);
                    console.log(`Contiene "nicht verfügbar": ${bodyText.toLowerCase().includes('nicht verfügbar')}`);
                    
                    // Debug: mostra parte del contenuto
                    console.log('\n--- SAMPLE DEL CONTENUTO PAGINA ---');
                    console.log(bodyText.substring(0, 500));
                    console.log('\n--- FINE SAMPLE ---');
                    
                } catch (e) {
                    console.log(`Errore analisi pagina: ${e.message}`);
                }
                
                // STEP 2: Cerca strutture specifiche di Gewobag
                const gewobagSelectors = [
                    '.object-list-item',
                    '.offer-item', 
                    '.property-item',
                    '.apartment-item',
                    '.listing-item',
                    '[class*="object"]',
                    '[class*="angebot"]',
                    '[class*="wohnung"]',
                    '[class*="listing"]',
                    '[class*="property"]',
                    '[class*="apartment"]',
                    'article',
                    '.card',
                    '[data-testid*="object"]',
                    '[data-testid*="listing"]'
                ];
                
                let foundItems = [];
                for (const selector of gewobagSelectors) {
                    const items = document.querySelectorAll(selector);
                    if (items.length > 0) {
                        console.log(`Trovati ${items.length} elementi con selector: ${selector}`);
                        foundItems = Array.from(items);
                        break;
                    }
                }
                
                if (foundItems.length === 0) {
                    console.log('Nessun contenitore specifico trovato, uso approccio generico...');
                    
                    // Approccio generico: cerca elementi con prezzo e metratura
                    const allElements = document.querySelectorAll('*');
                    console.log(`Totale elementi nella pagina: ${allElements.length}`);
                    
                    let candidateCount = 0;
                    Array.from(allElements).forEach((el, i) => {
                        try {
                            const text = el.textContent;
                            if (!text || text.length < 20 || text.length > 2000) return;
                            
                            // Deve avere almeno prezzo e metratura
                            const hasPrice = /\d+[,.]?\d*\s*€/.test(text);
                            const hasSize = /\d+[,.]?\d*\s*m²/.test(text);
                            
                            if (hasPrice && hasSize) {
                                candidateCount++;
                                if (candidateCount <= 20) {
                                    console.log(`\nCandidato ${candidateCount} (elemento ${i}):`);
                                    console.log(`Tag: ${el.tagName}, Classe: ${el.className}`);
                                    console.log(`Testo: ${text.substring(0, 150).replace(/\n/g, ' ')}...`);
                                }
                                
                                // Estrai dati
                                const priceMatch = text.match(/(\d+[,.]?\d*)\s*€/);
                                const sizeMatch = text.match(/(\d+[,.]?\d*)\s*m²/);
                                const roomMatch = text.match(/(\d+[,.]?\d*)\s*[Zz]immer/);
                                
                                if (priceMatch && sizeMatch) {
                                    const apartment = {
                                        price: priceMatch[0],
                                        size: sizeMatch[0],
                                        rooms: roomMatch ? roomMatch[0] : 'N/A',
                                        container: el,
                                        title: '',
                                        fullText: text.substring(0, 300),
                                        link: null
                                    };
                                    
                                    // Estrai titolo/indirizzo
                                    const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 5);
                                    for (const line of lines.slice(0, 5)) {
                                        if (line.length > 10 && line.length < 100 &&
                                            (line.toLowerCase().includes('berlin') || 
                                             line.includes('Str.') || 
                                             line.includes('str.') ||
                                             line.includes('straße') ||
                                             line.includes('Straße') ||
                                             line.includes('platz') ||
                                             line.includes('Platz'))) {
                                            apartment.title = line;
                                            break;
                                        }
                                    }
                                    
                                    if (!apartment.title && lines.length > 0) {
                                        apartment.title = lines[0].substring(0, 80);
                                    }
                                    
                                    results.push(apartment);
                                    console.log(`  -> APPARTAMENTO AGGIUNTO: ${apartment.price}, ${apartment.size}`);
                                }
                            }
                        } catch (e) {
                            // Ignora errori sui singoli elementi
                        }
                    });
                } else {
                    // Processa elementi trovati con selettori specifici
                    console.log(`Processando ${foundItems.length} elementi trovati...`);
                    
                    foundItems.forEach((item, i) => {
                        try {
                            const text = item.textContent || '';
                            
                            // Estrai dati base
                            const priceMatch = text.match(/(\d+[,.]?\d*)\s*€/);
                            const sizeMatch = text.match(/(\d+[,.]?\d*)\s*m²/);
                            const roomMatch = text.match(/(\d+[,.]?\d*)\s*[Zz]immer/);
                            
                            if (priceMatch && sizeMatch) {
                                const apartment = {
                                    price: priceMatch[0],
                                    size: sizeMatch[0],
                                    rooms: roomMatch ? roomMatch[0] : 'N/A',
                                    container: item,
                                    title: '',
                                    fullText: text.substring(0, 300),
                                    link: null
                                };
                                
                                // Cerca titolo/indirizzo
                                const titleSelectors = ['h1', 'h2', 'h3', 'h4', '.title', '.address', '.location'];
                                for (const sel of titleSelectors) {
                                    const titleEl = item.querySelector(sel);
                                    if (titleEl && titleEl.textContent.trim()) {
                                        apartment.title = titleEl.textContent.trim().substring(0, 80);
                                        break;
                                    }
                                }
                                
                                if (!apartment.title) {
                                    const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 5);
                                    apartment.title = lines[0] ? lines[0].substring(0, 80) : 'N/A';
                                }
                                
                                results.push(apartment);
                                console.log(`Appartamento ${i + 1}: ${apartment.price}, ${apartment.size}, "${apartment.title}"`);
                            }
                        } catch (e) {
                            console.log(`Errore processando elemento ${i}: ${e.message}`);
                        }
                    });
                }
                
                console.log(`\nAppartamenti trovati: ${results.length}`);
                
                // STEP 3: Rimuovi duplicati
                const uniqueApartments = [];
                const seen = new Set();
                
                results.forEach((apt) => {
                    const key = `${apt.price}-${apt.size}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueApartments.push(apt);
                    }
                });
                
                // STEP 4: Cerca link per ogni appartamento
                console.log(`\n=== RICERCA LINK ===`);
                
                // Trova tutti i link validi nella pagina
                const allLinks = document.querySelectorAll('a[href]');
                const validLinks = [];
                
                Array.from(allLinks).forEach((linkEl) => {
                    const href = linkEl.href;
                    if (href && (href.includes('gewobag.de') || href.includes('/objekt/') || href.includes('/detail/'))) {
                        validLinks.push({
                            href: href,
                            element: linkEl,
                            text: linkEl.textContent ? linkEl.textContent.trim() : ''
                        });
                    }
                });
                
                console.log(`Link validi trovati: ${validLinks.length}`);
                
                // Associa link agli appartamenti
                uniqueApartments.forEach((apartment, aptIndex) => {
                    try {
                        // Cerca link nel contenitore dell'appartamento
                        const containerLinks = apartment.container.querySelectorAll('a[href]');
                        
                        for (const link of containerLinks) {
                            const href = link.href;
                            if (href && (href.includes('gewobag.de') || href.includes('/objekt/') || href.includes('/detail/'))) {
                                apartment.link = href;
                                console.log(`Appartamento ${aptIndex + 1}: link trovato nel contenitore - ${href}`);
                                break;
                            }
                        }
                        
                        // Se non trovato, usa primo link disponibile come fallback
                        if (!apartment.link && validLinks.length > aptIndex) {
                            apartment.link = validLinks[aptIndex].href;
                            console.log(`Appartamento ${aptIndex + 1}: link fallback assegnato - ${apartment.link}`);
                        }
                        
                    } catch (e) {
                        console.log(`Errore associazione link appartamento ${aptIndex}: ${e.message}`);
                    }
                });
                
                // STEP 5: Report finale
                console.log(`\n=== RISULTATO FINALE GEWOBAG ===`);
                uniqueApartments.forEach((apt, i) => {
                    console.log(`${i + 1}. ${apt.price} - ${apt.size} - "${apt.title}"`);
                    console.log(`   Link: ${apt.link || 'NESSUNO'}`);
                });
                
                console.log(`\nRiepilogo: ${uniqueApartments.length} appartamenti unici`);
                
                return uniqueApartments;
                
            } catch (e) {
                console.log(`ERRORE GENERALE GEWOBAG: ${e.message}`);
                console.log(`Stack: ${e.stack}`);
                return [];
            }
        });

        await browser.close();
        
        console.log(`Trovati ${apartments.length} appartamenti da Gewobag`);
        
        // Format results for GitHub Gist
        const results = {
            success: true,
            count: apartments.length,
            timestamp: new Date().toISOString(),
            source: 'gewobag.de',
            data: apartments.map(apt => ({
                id: `gewobag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                price: apt.price || 'N/A',
                size: apt.size || 'N/A', 
                rooms: apt.rooms || 'N/A',
                title: apt.title || 'N/A',
                link: apt.link || 'N/A',
                description: apt.fullText || 'N/A',
                source: 'gewobag.de',
                scrapedAt: new Date().toISOString()
            }))
        };
        
        fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
        console.log('Results saved to results.json');
        
        return results;

    } catch (error) {
        await browser.close();
        console.error('Critical error:', error.message);
        
        const errorResult = {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            source: 'gewobag.de'
        };
        
        fs.writeFileSync('results.json', JSON.stringify(errorResult, null, 2));
        throw error;
    }
}

// Run the scraper
scrapeApartments().then(() => {
    console.log('Gewobag scraping completed successfully');
}).catch(error => {
    console.error('Gewobag scraping failed:', error);
    process.exit(1);
});
