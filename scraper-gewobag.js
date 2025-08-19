const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeApartments() {
    console.log('Starting apartment scraping from gewobag.de...');
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        const url = 'https://www.gewobag.de/fuer-mietinteressentinnen/mietangebote/?objekttyp%5B%5D=wohnung&gesamtmiete_von=&gesamtmiete_bis=450&gesamtflaeche_von=&gesamtflaeche_bis=&zimmer_von=&zimmer_bis=&sort-by=';
        console.log('Processing:', url);

        // Navigate to page
        await page.goto(url, { waitUntil: 'networkidle' });
        console.log('Page loaded');

        // Wait for page load - use same timing as stadtundland
        await page.waitForTimeout(8000);
        
        // Scroll to trigger lazy loading - same as stadtundland
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(3000);
        
        console.log('Page preparation completed, extracting data...');

        // Extract apartment data - use stadtundland approach
        const apartments = await page.evaluate(() => {
            try {
                console.log('=== INIZIO ESTRAZIONE GEWOBAG - v6-STADTUNDLAND-STYLE ===');
                
                const results = [];
                
                // STEP 1: Analisi base della pagina - same as stadtundland
                try {
                    const bodyText = document.body.textContent;
                    console.log(`Lunghezza testo pagina: ${bodyText.length}`);
                    console.log(`Contiene "€": ${bodyText.includes('€')}`);
                    console.log(`Contiene "m²": ${bodyText.includes('m²')}`);
                    console.log(`Contiene "Zimmer": ${bodyText.includes('Zimmer')}`);
                } catch (e) {
                    console.log(`Errore analisi pagina: ${e.message}`);
                }
                
                // STEP 2: Trova TUTTI i link - improved detection
                let allValidLinks = [];
                try {
                    const allLinks = document.querySelectorAll('a[href]');
                    console.log(`Totale link nella pagina: ${allLinks.length}`);
                    
                    Array.from(allLinks).forEach((linkEl, i) => {
                        try {
                            const href = linkEl.href;
                            if (href) {
                                console.log(`Link ${i + 1}: ${href}`);
                                
                                // Check for apartment detail patterns - more specific for Gewobag
                                if ((href.includes('gewobag.de') && 
                                    (href.includes('objekt') || 
                                     href.includes('detail') || 
                                     href.includes('wohnung') ||
                                     href.includes('expose') ||
                                     href.includes('immobilie'))) ||
                                    // Also check for relative paths that might be apartment links
                                    (href.includes('/') && 
                                     !href.includes('objekttyp') && 
                                     !href.includes('gesamtmiete') &&
                                     !href.includes('sort-by') &&
                                     href !== window.location.href)) {
                                    
                                    const rect = linkEl.getBoundingClientRect();
                                    allValidLinks.push({
                                        href: href,
                                        element: linkEl,
                                        position: rect.top + window.scrollY,
                                        text: linkEl.textContent ? linkEl.textContent.trim() : '',
                                        used: false
                                    });
                                    console.log(`  -> LINK VALIDO AGGIUNTO: ${href}`);
                                    console.log(`  -> Testo link: "${linkEl.textContent ? linkEl.textContent.trim().substring(0, 50) : 'N/A'}"`);
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
                
                // STEP 3: Trova appartamenti con approccio stadtundland
                const apartments = [];
                try {
                    // Same strategy as stadtundland: find all elements with price and size
                    const allElements = document.querySelectorAll('*');
                    console.log(`Totale elementi nella pagina: ${allElements.length}`);
                    
                    let candidateCount = 0;
                    Array.from(allElements).forEach((el, i) => {
                        try {
                            const text = el.textContent;
                            if (!text || text.length < 20 || text.length > 2000) return;
                            
                            // Must have at least price and size - same logic as stadtundland
                            const hasPrice = /\d+[,.]?\d*\s*€/.test(text);
                            const hasSize = /\d+[,.]?\d*\s*m²/.test(text);
                            
                            if (hasPrice && hasSize) {
                                candidateCount++;
                                if (candidateCount <= 20) { // Limit logs like stadtundland
                                    console.log(`\nCandidato ${candidateCount} (elemento ${i}):`);
                                    console.log(`Tag: ${el.tagName}, Classe: ${el.className}`);
                                    console.log(`Testo: ${text.substring(0, 150).replace(/\n/g, ' ')}...`);
                                }
                                
                                // Extract data - same patterns as stadtundland
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
                                    
                                    // Extract title - same logic as stadtundland
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
                            // Ignore errors on individual elements like stadtundland
                        }
                    });
                    
                    console.log(`\nAppartamenti candidati trovati: ${apartments.length}`);
                    
                } catch (e) {
                    console.log(`Errore ricerca appartamenti: ${e.message}`);
                }
                
                // STEP 4: Remove duplicates - same as stadtundland
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
                
                // STEP 5: Associate links - enhanced logic
                console.log(`\n=== ASSOCIAZIONE LINK AVANZATA ===`);
                console.log(`Appartamenti unici: ${uniqueApartments.length}`);
                console.log(`Link disponibili: ${allValidLinks.length}`);
                
                uniqueApartments.forEach((apartment, aptIndex) => {
                    try {
                        console.log(`\nAssociando appartamento ${aptIndex + 1}: ${apartment.price} - ${apartment.size}`);
                        console.log(`Posizione appartamento: ${apartment.position}px`);
                        console.log(`Titolo appartamento: "${apartment.title}"`);
                        
                        let bestLink = null;
                        let bestScore = 0;
                        
                        // Strategy 1: Look for links within the apartment container
                        const containerLinks = apartment.container.querySelectorAll('a[href]');
                        console.log(`  Links nel contenitore: ${containerLinks.length}`);
                        
                        Array.from(containerLinks).forEach((linkEl, linkIndex) => {
                            const href = linkEl.href;
                            const linkText = linkEl.textContent ? linkEl.textContent.trim() : '';
                            
                            console.log(`    Link contenitore ${linkIndex + 1}: ${href}`);
                            console.log(`    Testo: "${linkText.substring(0, 30)}"`);
                            
                            // Score the link based on various factors
                            let score = 0;
                            
                            // Higher score for apartment-specific URLs
                            if (href.includes('objekt') || href.includes('detail') || href.includes('expose')) {
                                score += 1000;
                            }
                            
                            // Higher score for links that look like detail links
                            if (linkText.toLowerCase().includes('detail') || 
                                linkText.toLowerCase().includes('mehr') ||
                                linkText.toLowerCase().includes('info') ||
                                linkText.toLowerCase().includes('ansehen')) {
                                score += 500;
                            }
                            
                            // Lower score for obviously wrong links
                            if (href.includes('objekttyp') || href.includes('sort-by') || href === window.location.href) {
                                score = 0;
                            }
                            
                            // Check if it's a different URL than the search page
                            if (href !== window.location.href && !href.includes('objekttyp%5B%5D=wohnung')) {
                                score += 100;
                            }
                            
                            console.log(`      Score: ${score}`);
                            
                            if (score > bestScore) {
                                bestLink = { href, element: linkEl, score };
                                bestScore = score;
                                console.log(`      -> NUOVO MIGLIOR LINK CONTENITORE (score: ${score})`);
                            }
                        });
                        
                        // Strategy 2: If no good link in container, check nearby links
                        if (!bestLink || bestScore < 100) {
                            console.log(`  Nessun link valido nel contenitore, controllo links vicini...`);
                            
                            allValidLinks.forEach((link, linkIndex) => {
                                if (link.used) return;
                                
                                try {
                                    let score = 0;
                                    
                                    // Check if apartment title matches link text or URL
                                    if (apartment.title && link.text) {
                                        const titleWords = apartment.title.toLowerCase().split(/\s+/);
                                        const linkWords = link.text.toLowerCase().split(/\s+/);
                                        const commonWords = titleWords.filter(word => 
                                            word.length > 3 && linkWords.some(lw => lw.includes(word) || word.includes(lw))
                                        );
                                        
                                        if (commonWords.length > 0) {
                                            score += commonWords.length * 200;
                                            console.log(`    Link ${linkIndex + 1}: parole comuni con titolo: ${commonWords.join(', ')} (score: +${commonWords.length * 200})`);
                                        }
                                    }
                                    
                                    // Distance-based scoring
                                    const distance = Math.abs(apartment.position - link.position);
                                    const distanceScore = Math.max(0, 200 - distance / 10);
                                    score += distanceScore;
                                    
                                    console.log(`    Link ${linkIndex + 1}: distanza ${distance}px (score: +${distanceScore.toFixed(0)})`);
                                    console.log(`    Score totale: ${score}`);
                                    
                                    if (score > bestScore) {
                                        bestLink = { href: link.href, element: link.element, score };
                                        bestScore = score;
                                        console.log(`      -> NUOVO MIGLIOR LINK GLOBALE (score: ${score})`);
                                    }
                                    
                                } catch (e) {
                                    console.log(`    Errore valutando link ${linkIndex}: ${e.message}`);
                                }
                            });
                        }
                        
                        // Assign the best link found
                        if (bestLink && bestScore > 50) {  // Minimum threshold
                            apartment.link = bestLink.href;
                            
                            // Mark link as used if it's from allValidLinks
                            const usedLink = allValidLinks.find(l => l.href === bestLink.href);
                            if (usedLink) {
                                usedLink.used = true;
                            }
                            
                            console.log(`  ✅ ASSEGNATO (score: ${bestScore}): ${bestLink.href}`);
                        } else {
                            console.log(`  ❌ NESSUN LINK VALIDO TROVATO (miglior score: ${bestScore})`);
                            apartment.link = null;
                        }
                        
                    } catch (e) {
                        console.log(`Errore associazione appartamento ${aptIndex}: ${e.message}`);
                    }
                });
                
                // STEP 6: Final report - same as stadtundland
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
