const { Model } = require('objection');
const Knex = require('knex');
const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');
const pluralize = require('pluralize');

module.exports = async (dbName, dbConnection, knexInstance, outputModelFile) => {
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

  const dataTypes = (type) => {
    /* 
     * Possible types in database
     * ================
     * varchar    bigint    longtext
     * datetime    int    tinyint
     * decimal    double    tinytext
     * text    timestamp    date
     * mediumtext    float    smallint
     * char    enum    blob
     * longblob    set 
     * 
     * Types available in json schema
     * string    number    object
     * array    boolean    null
     * integer    any
     * 
     */
    switch (type) {
      case 'varchar':
      case 'longtext':
      case 'tinytext':
      case 'text':
      case 'mediumtext':
      case 'char':
      case 'enum':
        return 'string';
      case 'date':
        return 'date';
      case 'datetime':
        return 'date-time';
      case 'bigint':
      case 'int':
      case 'tinyint':
      case 'smallint':
        return 'integer';
      case 'timestamp':
        return 'timestamp';
      case 'decimal':
      case 'double':
      case 'float':
        return 'number';
      default:
        return 'any';
    }
  };

  const searchFilter = (word) => {
    switch (word) {
      case 'old_password':
      case 'password':
      case 'token':
        return false
      default:
        return true;
    }
  };

  const singularize = (word) => {
    let words = word.toLowerCase().split(/[_\- ]/);
    return words.map(w => pluralize.singular(w)).join('-');
  };
  const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
  const camelCase = (word) => word.toLowerCase()
    .replace(/[-_]([a-z0-9])/g, g => g[1].toUpperCase());

  let templateModelHeader = fs.readFileSync(path.join(__dirname, 'templates/modelHeaderTemplate.mustache'), 'UTF-8');
  let templateModel = fs.readFileSync(path.join(__dirname, 'templates/modelFile.mustache'), 'UTF-8')
  let templateModelBase = fs.readFileSync(path.join(__dirname, 'templates/modelBase.mustache'), 'UTF-8')

  let modelsBase = Mustache.render(templateModelBase, {
    dbFile: knexInstance
  })
  fs.writeFileSync(outputModelFile + '/baseModel.js', modelsBase);

  let tables = await TableModel.query().where('table_schema', '=', DB).eager('[columns.[constrain]]');
  let modelsName = [];  
  tables.forEach(table => {
    let modelName = singularize(table.TABLE_NAME);
    modelName = camelCase(modelName) + 'Model';
    // modelName = capitalize(modelName);
    let constrains = [];
    let requireds = [];
    let searches = [];
    let idList = table.columns.filter(col => {
      return col.COLUMN_KEY == 'PRI'
    })
    if (idList.length == 0) {
      idList = table.columns.filter(col => {
        return col.COLUMN_KEY == 'UNI'
      })
    }
    let idColumn = ''
    if (idList.length == 1) {
      idColumn = "'" + idList[0].COLUMN_NAME +"'"
    } else if (idList.length > 1) {
      idColumn = '[' + idList.reduce((list, col) => {
        return list + "'" + col.COLUMN_NAME + "',"
      }, '') + ']'
    }
    let data = {
      idColumn,
      modelName: modelName,
      tableName: table.TABLE_NAME,
      properties: table.columns.map(column => {
        if (column.constrain) {
          constrains.push(column.constrain);
        }
        if (column.EXTRA === 'auto_increment') {
          column.IS_NULLABLE = 'YES'
        }
        if (column.IS_NULLABLE === 'NO' && !column.COLUMN_DEFAULT ) {
          requireds.push(column.COLUMN_NAME);
        }
        let type = dataTypes(column.DATA_TYPE);
        let format = null
        if (type === 'string' && searchFilter(column.COLUMN_NAME)) {
          searches.push(column.COLUMN_NAME);
        }
        if (type === 'date' || type === 'date-time') {
          format = type
          type = 'string'
        }
        let coldef = {
          name: column.COLUMN_NAME,
          type: column.IS_NULLABLE === 'NO' ? `'${type}'` : `['${type}', 'null']`,
          format,
          enum: column.DATA_TYPE === 'enum' ? column.COLUMN_TYPE.substring(5, column.COLUMN_TYPE.length -1) : null
        }
        // if (format) coldef.format = format
        // if (column.DATA_TYPE === 'enum') coldef.enum = column.TYPE
        return coldef
      }),
      requireds,
      searches,
      relations: constrains.map(column => {
        let targetTableName = singularize(column.REFERENCED_TABLE_NAME);
        targetTableName = camelCase(targetTableName);
        return {
          name: targetTableName,
          column: column.COLUMN_NAME,
          targetModel: capitalize(targetTableName) + 'Model',
          targetTableName: column.REFERENCED_TABLE_NAME,
          targetColumn: column.REFERENCED_COLUMN_NAME
        }
      })
    }
    let models = Mustache.render(templateModel, data)
    fs.writeFileSync(outputModelFile + '/objection/' + modelName + '.js', models);    
    modelsName.push({
      class: modelName,
    })
  });
  let modelsHeader = Mustache.render(templateModelHeader, { modelsName });
  fs.writeFileSync(outputModelFile + '/objectionsModels.js', modelsHeader);
  return true;
}