const mysql = require("mysql");
const axios = require("axios");
const cheerio = require("cheerio");

// Configurar la conexión a la base de datos
const connection = mysql.createConnection({
  host: "nodemysql12.mysql.database.azure.com",
  user: "mastero",
  password: "Alejandrof15",
  database: "test",
  port: 3306,
  ssl: true
});

// Realizar la conexión a la base de datos
connection.connect((error) => {
  if (error) {
    console.error("Error al conectar a la base de datos: ", error);
  } else {
    console.log("Conexión exitosa a la base de datos");

    // Obtener los IDs de la tabla componentes
    const query = `SELECT id, url FROM componentes`;
    connection.query(query, (error, results) => {
      if (error) {
        console.error("Error al consultar la base de datos: ", error);
        // Cerrar la conexión a la base de datos en caso de error
        connection.end();
      } else {
        console.log("Número de registros obtenidos: ", results.length);

        // Iterar sobre los resultados y hacer la solicitud HTTP y actualizar la base de datos para cada registro
        results.forEach((result, index) => {
          const { id, url } = result;

          setTimeout(() => {
            axios
              .get(url)
              .then((response) => {
                const html = response.data;
                const $ = cheerio.load(html);
                const priceText = $(".priceText").text();
                const priceNumber = priceText.replace('$', '').replace(',', '');
                const nameText = $(".detailsInfo_right_title").text().replace(/'/g, "\\'"); // Reemplazar comillas simples para evitar errores SQL

                console.log(`[${index + 1}] ID: ${id}, URL: ${url}, Nombre: ${nameText}, Precio: ${priceText} (${priceNumber})`);

                // Actualizar la base de datos con los nuevos valores
                const updateQuery = `UPDATE componentes SET precio = '${priceNumber}' WHERE id = ${id}`;
                connection.query(updateQuery, (error, results) => {
                  if (error) {
                    console.error("Error al actualizar la base de datos: ", error);
                  } else {
                    console.log(`[${index + 1}] Actualización exitosa de la base de datos`);
                  }
                });
              })
              .catch((error) => {
                console.error(`[${index + 1}] Error al hacer la solicitud HTTP: ${error}`);
              });
          }, index * 100); // Retraso de 100 ms entre cada solicitud (index * 100 milisegundos)
        });

        // Cerrar la conexión a la base de datos después de 5 segundos adicionales para asegurarse de que todas las consultas se hayan completado
        setTimeout(() => {
          connection.end();
          console.log("Conexión cerrada a la base de datos");
        }, results.length * 5000 + 5000);
      }
    });
  }
});
