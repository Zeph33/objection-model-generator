require('dotenv').config();
const fs = require('fs');
const models = require('../src/dbToModel');
const controllers = require('../src/dbToControllers');
const routes = require('../src/dbToRoutes');
const ObjectionModelGenerator = require('../src/ObjectionModelGenerator');

const main = async () => {
  const connection = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || '3306',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || ''
  };
  const pkTableForce = {
    'cur_palmares': 'id_vin',
    'exploitant_complet': 'id_exploitant',
    'jury_affinite': 'id_jury',
    'palmares_all': 'id_vin',
    'personne_complet': 'id_personne_jury',
    'vin_complet': 'id_vin',
    'vin_medaille': 'id_vin',
  }
  const modelsPromise = models(process.env.DB_NAME, connection, '../db', './test/output/models', pkTableForce);
  const controllersPromise = controllers(process.env.DB_NAME, connection, '../../models/objectionsModels', '../baseController', './test/output/controllers');
  const routesPromise = routes(process.env.DB_NAME, connection, './test/output/routes/objectionRoutes.js', 'autohide', pkTableForce);
  const all = await Promise.all([modelsPromise, controllersPromise, routesPromise]);
  console.log(all);
  // using omg
  let omg = new ObjectionModelGenerator(connection, process.env.DB_NAME, '../knex');
  let ms = await omg.createModels();
  fs.writeFileSync('./test/output/models/omg.js', ms);
  process.exit();
}

main();