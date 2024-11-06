require('dotenv').config();
const mysql = require("mysql");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require('puppeteer');
const { Cluster } = require('puppeteer-cluster');

// Configurar la conexión a la base de datos
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: process.env.DB_SSL === 'true'
});

// Convertir query a Promise
const queryAsync = (connection, sql, values) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, values, (error, results) => {
      if (error) reject(error);
      else resolve(results);
    });
  });
};

// Funciones de scraping específicas por tienda
const scrapingMethods = {
  Cyberpuerta: async (url) => {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const priceText = $(".priceText").text().trim();
    return priceText.replace('$', '').replace(',', '');
  },
  
  Pcel: async (url) => {
    let browser = null;
    
    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet') {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      await page.goto(url, { 
        waitUntil: 'networkidle0', 
        timeout: 5000 
      });
      
      await page.waitForSelector('div.vatprice_top strong');
      
      const priceText = await page.$eval('div.vatprice_top strong', el => el.textContent.trim());
      const price = priceText.replace(/[$,]/g, '').split('.')[0];
      
      return price;
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
  
  Aliexpress: async (url) => {
    let browser = null;
    
    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      await page.goto(url, { 
        waitUntil: 'networkidle0', 
        timeout: 5000 
      });
      
      await page.waitForSelector('.price--currentPriceText--V8_y_b5', { timeout: 5000 });
      const priceText = await page.$eval('.price--currentPriceText--V8_y_b5', el => el.textContent.trim());
      const price = priceText.replace(/[MX$,\s]/g, '').split('.')[0];
      
      return price;
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
  
  Amazon: async (url) => {
    let browser = null;
    
    try {
      browser = await puppeteer.launch({
        headless: "new",
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });
      
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Interceptar recursos innecesarios
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });
      
      await page.goto(url, { 
        waitUntil: 'networkidle0', 
        timeout: 10000 
      });
      
      // Esperar a que aparezca al menos uno de los selectores de precio
      const priceSelectors = [
        '.reinventPricePriceToPayMargin .a-price-whole',
        '.priceToPay .a-price-whole',
        '.a-price[data-a-color="base"] .a-price-whole',
        '#corePriceDisplay_desktop_feature_div .a-price-whole',
        '.a-price.aok-align-center .a-price-whole'
      ];
      
      // Intentar encontrar los precios
      const prices = await page.evaluate((selectors) => {
        const results = [];
        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            if (el && el.textContent) {
              results.push(el.textContent.trim());
            }
          });
        }
        return results;
      }, priceSelectors);
      
      // Procesar los precios encontrados
      for (const priceText of prices) {
        const price = priceText.replace(/[,$\.]/g, '');
        if (price && !isNaN(price) && price.length > 2) {
          return price;
        }
      }
      
      throw new Error('Precio no encontrado');
      
    } catch (error) {
      console.error(`Error en Amazon scraping: ${error.message}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
};

// Actualizar la función de normalización de tiendas
const normalizarNombreTienda = (tienda) => {
  const tiendaNormalizada = tienda.toLowerCase();
  
  const mapeoTiendas = {
    'pcel': 'Pcel',
    'PCEL': 'Pcel',
    'cyberpuerta': 'Cyberpuerta',
    'aliexpress': 'Aliexpress',
    'amazon': 'Amazon',
    'amazon.com.mx': 'Amazon',
    'amazon.mx': 'Amazon'
  };

  return mapeoTiendas[tiendaNormalizada] || tienda;
};

// Función para procesar tiendas que usan Axios (como Cyberpuerta)
async function procesarConAxios(items, tienda, conn) {
  const batchSize = 5; // Procesar en lotes pequeños
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const promises = batch.map(async (componente) => {
      try {
        const price = await scrapingMethods[tienda](componente.url);
        
        if (price && !isNaN(price)) {
          const updateQuery = 'UPDATE componentes SET precio = ? WHERE id = ?';
          await queryAsync(conn, updateQuery, [price, componente.id]);
          console.log(`[${componente.id}] ID: ${componente.id} (${tienda}) actualizado. Precio: ${price}`);
        }
      } catch (error) {
        console.error(`Error procesando componente ${componente.id}:`, error.message);
      }
    });
    
    await Promise.all(promises);
    // Pequeña pausa entre lotes para evitar sobrecarga
    await new Promise(r => setTimeout(r, 1000));
  }
}

// Función para procesar tiendas que usan Puppeteer
async function procesarConCluster(items, tienda, conn) {
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: tienda === 'Amazon' ? 2 : 3,
    puppeteerOptions: {
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    },
    timeout: tienda === 'Amazon' ? 30000 : 15000
  });

  await cluster.task(async ({ page, data: componente }) => {
    try {
      const price = await scrapingMethods[tienda](componente.url);
      
      if (price && !isNaN(price)) {
        const updateQuery = 'UPDATE componentes SET precio = ? WHERE id = ?';
        await queryAsync(conn, updateQuery, [price, componente.id]);
        console.log(`[${componente.id}] ID: ${componente.id} (${tienda}) actualizado. Precio: ${price}`);
      }
    } catch (error) {
      console.error(`Error procesando componente ${componente.id}:`, error.message);
    }
  });

  for (const item of items) {
    await cluster.queue(item);
  }

  await cluster.idle();
  await cluster.close();
}

// Función principal actualizarPrecios
async function actualizarPrecios(conn) {
  try {
    const query = 'SELECT id, url, tienda, precio FROM componentes';
    const componentes = await queryAsync(conn, query);
    console.log("Número de registros obtenidos: ", componentes.length);

    const componentesPorTienda = componentes.reduce((acc, comp) => {
      const tiendaNormalizada = normalizarNombreTienda(comp.tienda);
      if (!acc[tiendaNormalizada]) acc[tiendaNormalizada] = [];
      acc[tiendaNormalizada].push({...comp, tienda: tiendaNormalizada});
      return acc;
    }, {});

    for (const [tienda, items] of Object.entries(componentesPorTienda)) {
      console.log(`Procesando tienda: ${tienda} (${items.length} items)`);
      
      if (['Pcel', 'Aliexpress', 'Amazon'].includes(tienda)) {
        await procesarConCluster(items, tienda, conn);
      } else if (tienda === 'Cyberpuerta') {
        await procesarConAxios(items, tienda, conn);
      }
    }
  } catch (error) {
    console.error("Error en el proceso principal:", error);
  }
}

// Iniciar el proceso
connection.connect(async (error) => {
  if (error) {
    console.error("Error al conectar a la base de datos:", error);
    return;
  }
  console.log("Conexión exitosa a la base de datos");
  await actualizarPrecios(connection);
});
