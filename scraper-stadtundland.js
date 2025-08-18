const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeApartments() {
    console.log('Starting apartment scraping from stadtundland.de...');
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        const url = 'https://stadtundland.de/wohnungssuche?district=all&maxRate=450';
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
                console.log('=== INIZIO ESTRAZIONE - v5-ERROR-SAFE ===');
                
                const results = [];
                
                // STEP 1: Analisi base della pagina
                try {
                    const bodyText = document.body.textContent;
                    console.log(`Lunghezza testo pagina: ${bodyText.length}`);
                    console.log(`Contiene "€": ${bodyText.includes('€')}`);
                    console.log(`Contiene "m²": ${bodyText.includes('m²')}`);
                    console.log(`Contiene "Zimmer": ${bodyText.includes('Zimmer')}`);
                } catch (e) {
                    console.log(`Errore analisi pagina: ${e.message}`);
                }
                
                // STEP 2: Trova TUTTI i link
                let allValidLinks = [];
                try {
                    const allLinks = document.querySelectorAll('a[href]');
                    console.log(`Totale link nella pagina: ${allLinks.length}`);
                    
                    Array.from(allLinks).forEach((linkEl, i) => {
                        try {
                            const href = linkEl.href;
                            if (href && href.includes('/wohnungssuche/')) {
                                console.log(`Link ${i + 1}: ${href}`);
                                
                                // Verifica pattern più flessibile
                                if (href.match(/\/wohnungssuche\/\d+/) && href.includes('%2F')) {
                                    const rect = linkEl.getBoundingClientRect();
                                    allValidLinks.push({
                                        href: href,
                                        element: linkEl,
                                        position: rect.top + window.scrollY,
                                        text: linkEl.textContent ? linkEl.textContent.trim() : '',
                                        used: false
                                    });
                                    console.log(`  -> LINK VALIDO AGGIUNTO`);
                                }
                            }
                        } catch (e) {
                            console.log(`Errore processando link ${i}: ${e.message}`);
                        }
                    });
                    
                    console.log(`Link validi trovati: ${allValidLinks.length}`);
                    allValidLinks.forEach((link, i) => {
                        console.log(`${i + 1}. ${link.href} - "${link.text.substring(0, 50)}"`);
                    });
                    
                } catch (e) {
                    console.log(`Errore ricerca link: ${e.message}`);
                }
                
                // STEP 3: Trova appartamenti con approccio semplice e robusto
                const apartments = [];
                try {
                    // Strategia semplice: trova tutti gli elementi che contengono le info base
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
                                if (candidateCount <= 20) { // Limita per evitare troppi log
                                    console.log(`\nCandidato ${candidateCount} (elemento ${i}):`);
                                    console.log(`Tag: ${el.tagName}, Classe: ${el.className}`);
                                    console.log(`Testo: ${text.substring(0, 150).replace(/\n/g, ' ')}...`);
                                }
                                
                                // Estrai dati
                                const priceMatch = text.match(/(\d+[,.]?\d*)\s*€/);
                                const sizeMatch = text.match(/(\d+[,.]?\d*)\s*m²/);
                                const roomMatch = text.match(/(\d+[,.]?\d*)\s*[Zz]immer/);
                                
                                if (priceMatch && sizeMatch) {
                                    const rect = el.getBoundingClientRect();
                                    const apartment = {
                                        price: priceMatch[0],
                                        size: sizeMatch[0],
                                        rooms: roomMatch ? roomMatch[0] : 'N/A',
                                        position: rect.top + window.scrollY,
                                        container: el,
                                        title: '',
                                        fullText: text.substring(0, 300),
                                        link: null
                                    };
                                    
                                    // Estrai titolo semplice
                                    const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 5);
                                    for (const line of lines.slice(0, 5)) {
                                        if (line.length > 10 && line.length < 100 &&
                                            (line.toLowerCase().includes('berlin') || 
                                             line.includes('Str.') || 
                                             line.includes('str.') ||
                                             line.includes('Chaussee'))) {
                                            apartment.title = line;
                                            break;
                                        }
                                    }
                                    
                                    if (!apartment.title && lines.length > 0) {
                                        apartment.title = lines[0].substring(0, 80);
                                    }
                                    
                                    apartments.push(apartment);
                                    console.log(`  -> APPARTAMENTO AGGIUNTO: ${apartment.price}, ${apartment.size}`);
                                }
                            }
                        } catch (e) {
                            // Ignora errori sui singoli elementi
                        }
                    });
                    
                    console.log(`\nAppartamenti candidati trovati: ${apartments.length}`);
                    
                } catch (e) {
                    console.log(`Errore ricerca appartamenti: ${e.message}`);
                }
                
                // STEP 4: Rimuovi duplicati semplici
                const uniqueApartments = [];
                const seen = new Set();
                
                apartments.forEach((apt, i) => {
                    try {
                        const key = `${apt.price}-${apt.size}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            uniqueApartments.push(apt);
                            console.log(`Appartamento unico ${uniqueApartments.length}: ${apt.price}, ${apt.size}`);
                        } else {
                            console.log(`Duplicato rimosso: ${key}`);
                        }
                    } catch (e) {
                        console.log(`Errore rimozione duplicati: ${e.message}`);
                    }
                });
                
                // STEP 5: Associa link con logica semplice
                console.log(`\n=== ASSOCIAZIONE LINK ===`);
                console.log(`Appartamenti unici: ${uniqueApartments.length}`);
                console.log(`Link disponibili: ${allValidLinks.length}`);
                
                uniqueApartments.forEach((apartment, aptIndex) => {
                    try {
                        console.log(`\nAssociando appartamento ${aptIndex + 1}: ${apartment.price} - ${apartment.size}`);
                        console.log(`Posizione appartamento: ${apartment.position}px`);
                        
                        let bestLink = null;
                        let bestDistance = Infinity;
                        
                        // Prova prima a trovare link nel contenitore o vicino
                        allValidLinks.forEach((link, linkIndex) => {
                            if (link.used) return;
                            
                            try {
                                let score = 0;
                                
                                // Controlla se il link è contenuto nell'appartamento
                                if (apartment.container.contains(link.element)) {
                                    score = 1000000; // Priorità massima
                                    console.log(`  Link ${linkIndex + 1}: CONTENUTO DIRETTO (score: ${score})`);
                                } else {
                                    // Controlla distanza
                                    const distance = Math.abs(apartment.position - link.position);
                                    score = Math.max(0, 1000 - distance);
                                    console.log(`  Link ${linkIndex + 1}: distanza ${distance}px (score: ${score})`);
                                }
                                
                                if (score > 0 && (!bestLink || score > bestDistance)) {
                                    bestLink = link;
                                    bestDistance = score;
                                    console.log(`    -> NUOVO MIGLIOR LINK (score: ${score})`);
                                }
                                
                            } catch (e) {
                                console.log(`  Errore valutando link ${linkIndex}: ${e.message}`);
                            }
                        });
                        
                        if (bestLink) {
                            apartment.link = bestLink.href;
                            bestLink.used = true;
                            console.log(`  ✓ ASSEGNATO: ${bestLink.href}`);
                        } else {
                            console.log(`  ✗ NESSUN LINK TROVATO`);
                            
                            // Fallback: assegna primo link disponibile se esistente
                            const availableLink = allValidLinks.find(l => !l.used);
                            if (availableLink) {
                                apartment.link = availableLink.href;
                                availableLink.used = true;
                                console.log(`  📌 LINK FALLBACK ASSEGNATO: ${availableLink.href}`);
                            }
                        }
                        
                    } catch (e) {
                        console.log(`Errore associazione appartamento ${aptIndex}: ${e.message}`);
                    }
                });
                
                // STEP 6: Report finale
                console.log(`\n=== RISULTATO FINALE ===`);
                uniqueApartments.forEach((apt, i) => {
                    console.log(`${i + 1}. ${apt.price} - ${apt.size} - "${apt.title.substring(0, 50)}"`);
                    console.log(`   Link: ${apt.link || 'NESSUNO'}`);
                });
                
                console.log(`\nRiepilogo: ${uniqueApartments.length} appartamenti, ${uniqueApartments.filter(a => a.link).length} con link`);
                
                return uniqueApartments;
                
            } catch (e) {
                console.log(`ERRORE GENERALE: ${e.message}`);
                console.log(`Stack: ${e.stack}`);
                return [];
            }
        });

        await browser.close();
        
        console.log(`Trovati ${apartments.length} appartamenti`);
        
        // Format results for GitHub Gist
        const results = {
            success: true,
            count: apartments.length,
            timestamp: new Date().toISOString(),
            source: 'stadtundland.de',
            data: apartments.map(apt => ({
                id: `stadtundland_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                price: apt.price || 'N/A',
                size: apt.size || 'N/A', 
                rooms: apt.rooms || 'N/A',
                title: apt.title || 'N/A',
                link: apt.link || 'N/A',
                description: apt.fullText || 'N/A',
                source: 'stadtundland.de',
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
            source: 'stadtundland.de'
        };
        
        fs.writeFileSync('results.json', JSON.stringify(errorResult, null, 2));
        throw error;
    }
}

// Run the scraper
scrapeApartments().then(() => {
    console.log('Scraping completed successfully');
}).catch(error => {
    console.error('Scraping failed:', error);
    process.exit(1);
});
