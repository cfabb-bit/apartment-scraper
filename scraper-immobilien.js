const { chromium } = require('playwright');
const fs = require('fs');

async function debugPageStructure() {
  console.log('🔍 Analizzando la struttura della pagina...');
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage'
    ]
  });
  
  const page = await browser.newPage();
  
  try {
    const url = 'https://www.immobilien.de/Wohnen/Suchergebnisse-51797.html?search._digest=true&search._filter=wohnen&search.objektart=wohnung&search.preis_bis=450&search.typ=mieten&search.umkreis=10&search.wo=city%3A6444';
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    // Handle cookies
    try {
      const cookieButton = await page.$('button[class*="cookie"], [data-testid*="accept"]');
      if (cookieButton) {
        await cookieButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('Cookie handling skipped');
    }
    
    // Scroll to load content
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(3000);
    
    // Analyze page structure
    const analysis = await page.evaluate(() => {
      const results = {
        totalLinks: 0,
        apartmentLinks: [],
        priceElements: [],
        sectionAnalysis: [],
        textContaining620: [],
        textContaining397: []
      };
      
      // Find all apartment links
      const links = document.querySelectorAll('a[href*="/wohnen/"]');
      results.totalLinks = links.length;
      
      links.forEach((link, index) => {
        if (index < 10) { // Only first 10 for brevity
          results.apartmentLinks.push({
            href: link.href,
            text: link.textContent.trim(),
            parent: link.parentElement?.tagName,
            parentClass: link.parentElement?.className
          });
        }
      });
      
      // Find all price mentions
      const allText = document.body.textContent;
      const priceMatches = allText.match(/\d+\s*€/g) || [];
      results.priceElements = [...new Set(priceMatches)].slice(0, 20);
      
      // Look for sections that might contain apartments
      const potentialContainers = [
        'div[class*="result"]',
        'div[class*="listing"]', 
        'article',
        'section',
        'div[class*="item"]',
        'div[class*="card"]'
      ];
      
      potentialContainers.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          results.sectionAnalysis.push({
            selector: selector,
            count: elements.length,
            sample: elements[0]?.textContent.substring(0, 200)
          });
        }
      });
      
      // Specifically look for text containing our problem prices
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
      );
      
      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text.includes('620') && text.includes('€')) {
          results.textContaining620.push({
            text: text.substring(0, 100),
            parent: node.parentElement?.tagName,
            parentClass: node.parentElement?.className,
            grandparent: node.parentElement?.parentElement?.tagName,
            grandparentClass: node.parentElement?.parentElement?.className
          });
        }
        if (text.includes('397') && text.includes('€')) {
          results.textContaining397.push({
            text: text.substring(0, 100),
            parent: node.parentElement?.tagName,
            parentClass: node.parentElement?.className
          });
        }
      }
      
      // Look for "Top Objekte" or similar
      const topObjekteElements = document.querySelectorAll('*');
      const topObjekteFound = [];
      
      topObjekteElements.forEach(el => {
        const text = el.textContent;
        if (text && (text.includes('Top Objekte') || text.includes('Premium') || 
                    text.includes('Highlight') || text.includes('Empfohlen'))) {
          if (text.length < 500) { // Avoid whole page content
            topObjekteFound.push({
              tagName: el.tagName,
              className: el.className,
              text: text.substring(0, 200)
            });
          }
        }
      });
      
      results.topObjekteFound = topObjekteFound;
      
      return results;
    });
    
    await browser.close();
    
    // Save detailed analysis
    fs.writeFileSync('page-analysis.json', JSON.stringify(analysis, null, 2));
    
    // Print summary
    console.log('\n📊 ANALISI COMPLETATA:');
    console.log(`🔗 Link appartamenti trovati: ${analysis.totalLinks}`);
    console.log(`💰 Prezzi trovati nella pagina: ${analysis.priceElements.join(', ')}`);
    console.log(`📋 Sezioni potenziali: ${analysis.sectionAnalysis.length}`);
    console.log(`⭐ Sezioni "Top Objekte" trovate: ${analysis.topObjekteFound.length}`);
    
    console.log('\n🔍 TESTO CONTENENTE 620€:');
    analysis.textContaining620.forEach((item, i) => {
      console.log(`${i+1}. Parent: <${item.parent} class="${item.parentClass}">`);
      console.log(`   Grandparent: <${item.grandparent} class="${item.grandparentClass}">`);
      console.log(`   Text: "${item.text}"`);
      console.log('');
    });
    
    console.log('\n🎯 TOP OBJEKTE SECTIONS:');
    analysis.topObjekteFound.forEach((item, i) => {
      console.log(`${i+1}. <${item.tagName} class="${item.className}">`);
      console.log(`   Text: "${item.text}"`);
      console.log('');
    });
    
    console.log('\n📄 Analisi completa salvata in page-analysis.json');
    
    return analysis;
    
  } catch (error) {
    await browser.close();
    console.error('Errore durante l\'analisi:', error.message);
    throw error;
  }
}

// Run the debug analysis
if (require.main === module) {
  debugPageStructure()
    .then(() => {
      console.log('\n✅ Analisi completata con successo!');
    })
    .catch(error => {
      console.error('❌ Analisi fallita:', error);
      process.exit(1);
    });
}

module.exports = debugPageStructure;
