const { Model } = require('objection');
const Knex = require('knex');
const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');
const pluralize = require('pluralize');

module.exports = async (dbName, dbConnection, fileNameRoutes, activeField = 'status', pkTableForce={}) => {
  const DB = dbName;
  // Initialize knex.
  const knex = Knex({
    client: 'mysql',
    connection: { ...dbConnection, database: 'information_schema' }
  });
  knex.on('query', data => {
    console.log('======== on query ==========');
    let i = 0;
    let sql = data.sql.replace(/\?/g, k => {
      return '"' + data.bindings[i++] + '"';
    });
    console.log(sql);
  });
  Model.knex(knex);

  class KeyColumnUsage extends Model {
    static get tableName() {
      return 'KEY_COLUMN_USAGE';
    }
  }

  class ColumnModel extends Model {
    static get tableName() {
      return 'COLUMNS';
    }
    static get relationMappings() {
      return {
        constrain: {
          relation: Model.BelongsToOneRelation,
          modelClass: KeyColumnUsage,
          filter: query => query.where('TABLE_SCHEMA', DB).whereNotNull('REFERENCED_COLUMN_NAME'),
          join: {
            from: ['COLUMNS.COLUMN_NAME', 'COLUMNS.TABLE_NAME'],
            to: ['KEY_COLUMN_USAGE.COLUMN_NAME', 'KEY_COLUMN_USAGE.TABLE_NAME']
          }
        }
      };
    }
  }

  class TableModel extends Model {
    static get tableName() {
      return 'TABLES';
    }
    static get relationMappings() {
      return {
        columns: {
          relation: Model.HasManyRelation,
          modelClass: ColumnModel,
          filter: query => query.where('TABLE_SCHEMA', DB),
          join: {
            from: 'TABLES.TABLE_NAME',
            to: 'COLUMNS.TABLE_NAME'
          }
        }
      };
    }
  }

  const slugging = (word) => {
    let words = word.toLowerCase().split(/[_\- ]/);
    // TODO: mejorar remplazo de caracteres, ver functions en dbl-components
    return words.join('-');
  };
  const singularize = (word) => {
    let words = word.toLowerCase().split(/[_\- ]/)
    return words.map(w => pluralize.singular(w)).join('-')
  }
  const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
  const camelCase = (word) => word.toLowerCase()
    .replace(/[-_]([a-z0-9])/g, g => g[1].toUpperCase());

  let templateRoutes = fs.readFileSync(path.join(__dirname, 'templates/routesTemplate.mustache'), 'UTF-8');
  let tableslist = await TableModel.query().where('table_schema', '=', DB).eager('[columns.[constrain]]');
  let tables = [];
  activeField = activeField.toLowerCase()
  tableslist.forEach(table => {
    let name = singularize(table.TABLE_NAME);
    if (name.startsWith('-')) return;
    // const nameSnake = pluralize.singular(capitalize(camelCase(name)));
    let idList = table.columns.filter(col => {
      return col.COLUMN_KEY == 'PRI'
    })
    if (idList.length == 0) {
      idList = table.columns.filter(col => {
        return col.COLUMN_KEY == 'UNI'
      })
    }
    let typeView = idList.length == 0

    if (pkTableForce.hasOwnProperty(table.TABLE_NAME)) {
      idList = Array.isArray(pkTableForce[table.TABLE_NAME])  ? pkTableForce[table.TABLE_NAME] : [pkTableForce[table.TABLE_NAME]];
    }
    let idRoute = false
    if (idList.length == 1) {
      idRoute = '/:ID'
    } else if (idList.length > 1) {
      idRoute = idList.reduce((list, col, idx) => {
        return list + "/:ID" + (idx==0 ? '' : idx)
      }, '')
    }

    const controllerName = camelCase(name) + 'Controller';
    const routesGet = [{ route: `/${name}`, controller: `${controllerName}.get` }]
    const columns = table.columns.map((c) => c.COLUMN_NAME.toLowerCase())
    console.log(columns)
    if (columns.includes(activeField)) {
      routesGet.push({ route: `/${name}/active`, controller: `${controllerName}.getActive` })
    }
    idRoute && routesGet.push({ route: `/${name}${idRoute}`, controller: `${controllerName}.getByID` })
    const types = [
      {
        type: 'get',
        routes: routesGet,
      }
    ]
    idRoute && !typeView && types.push(
      {
        type: 'post',
        routes: [
          {
            route: `/${name}`,
            controller: `${controllerName}.set`
          },
        ]
      },      
      {
        type: 'put',
        routes: [
          {
            route: `/${name}${idRoute}`,
            controller: `${controllerName}.update`
          },
        ]
      },
      {
        type: 'delete',
        routes: [
          {
            route: `/${name}${idRoute}`,
            controller: `${controllerName}.delete`
          },
        ]
      }
    )
    tables.push({
      table: table.TABLE_NAME,
      name,
      types
    })
  })
//  routes.sort((a, b) => (a.route < b.route ? -1 : (a.route > b.route ? 1 : 0)));
  let rendered = Mustache.render(templateRoutes, {
    tables
  });
  fs.writeFileSync(fileNameRoutes, rendered);
}