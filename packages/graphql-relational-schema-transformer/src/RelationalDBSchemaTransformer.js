"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var mysql_1 = require("mysql");
var graphql_1 = require("graphql");
var GraphQLType = /** @class */ (function () {
    function GraphQLType(typeName, typeFields, primary) {
        var _this = this;
        this.toGraphQLString = function () {
            // First, the literal type definition
            var typeString = "type " + _this.name + " {\n";
            for (var _i = 0, _a = _this.fields; _i < _a.length; _i++) {
                var field = _a[_i];
                typeString = typeString.concat(field.toGraphQLString(), "\n");
            }
            typeString = typeString.concat("}\n\n");
            // Second, the 'connection' type for this type
            typeString = typeString.concat("type " + _this.name + "Connection {\n");
            typeString = typeString.concat("  items: [" + _this.name + "]\n");
            typeString = typeString.concat("  nextToken: String");
            typeString = typeString.concat("}");
            return typeString;
        };
        this.name = typeName;
        this.fields = typeFields;
        this.primaryField = primary;
    }
    return GraphQLType;
}());
var GraphQLField = /** @class */ (function () {
    function GraphQLField(fieldName, fieldType, isFieldNullable) {
        var _this = this;
        this.toGraphQLString = function () {
            var fieldString = "    " + _this.name + ": " + _this.type;
            if (_this.nullable == false) {
                fieldString = fieldString.concat("!");
            }
            return fieldString;
        };
        this.name = fieldName;
        this.type = fieldType;
        this.nullable = isFieldNullable;
    }
    return GraphQLField;
}());
var RelationalDBSchemaTransformer = /** @class */ (function () {
    function RelationalDBSchemaTransformer() {
        var _this = this;
        this.intTypes = ["INTEGER", "INT", "SMALLINT", "TINYINT", "MEDIUMINT", "BIGINT", "BIT"];
        this.floatTypes = ["FLOAT", "DOUBLE", "REAL", "REAL_AS_FLOAT", "DOUBLE PRECISION", "DEC", "DECIMAL", "FIXED", "NUMERIC"];
        this.getSchemaWithCredentials = function (dbUser, dbPassword, dbHost, databaseName) { return __awaiter(_this, void 0, void 0, function () {
            var connection, tableNames, types, _i, tableNames_1, tableName, _a, _b, definitions, _c, types_1, type;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        connection = mysql_1.createConnection({ user: dbUser, password: dbPassword, host: dbHost });
                        this.deleteMe(databaseName, connection);
                        this.setDatabase(databaseName, connection);
                        this.deleteMeTables(connection);
                        return [4 /*yield*/, this.listTables(databaseName, connection)];
                    case 1:
                        tableNames = _d.sent();
                        console.log("Tables in db " + databaseName + ":");
                        console.log(tableNames);
                        types = new Array();
                        _i = 0, tableNames_1 = tableNames;
                        _d.label = 2;
                    case 2:
                        if (!(_i < tableNames_1.length)) return [3 /*break*/, 5];
                        tableName = tableNames_1[_i];
                        console.log("Looking at table " + tableName);
                        _b = (_a = types).push;
                        return [4 /*yield*/, this.describeTable(tableName, connection)];
                    case 3:
                        _b.apply(_a, [_d.sent()]);
                        _d.label = 4;
                    case 4:
                        _i++;
                        return [3 /*break*/, 2];
                    case 5:
                        connection.end();
                        definitions = [];
                        for (_c = 0, types_1 = types; _c < types_1.length; _c++) {
                            type = types_1[_c];
                            definitions.push({
                                kind: graphql_1.Kind.OBJECT_TYPE_DEFINITION,
                                name: {
                                    kind: graphql_1.Kind.NAME,
                                    value: type.name
                                },
                                fields: []
                            });
                        }
                        return [2 /*return*/, ""];
                }
            });
        }); };
        this.setDatabase = function (databaseName, connection) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.executeSQL("USE " + databaseName, connection)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); };
        this.listTables = function (databaseName, connection) { return __awaiter(_this, void 0, void 0, function () {
            var results;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.executeSQL("SHOW TABLES", connection)];
                    case 1:
                        results = _a.sent();
                        return [2 /*return*/, results.map(function (result) { return result["Tables_in_" + databaseName]; })];
                }
            });
        }); };
        this.describeTable = function (tableName, connection) { return __awaiter(_this, void 0, void 0, function () {
            var tableDescriptions, fields, _i, tableDescriptions_1, tableDescription, nullable, field;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.executeSQL("DESCRIBE " + tableName, connection)];
                    case 1:
                        tableDescriptions = _a.sent();
                        fields = new Array();
                        for (_i = 0, tableDescriptions_1 = tableDescriptions; _i < tableDescriptions_1.length; _i++) {
                            tableDescription = tableDescriptions_1[_i];
                            nullable = tableDescription.Null == 'YES';
                            field = {
                                kind: graphql_1.Kind.FIELD_DEFINITION,
                                name: {
                                    kind: graphql_1.Kind.NAME,
                                    value: tableDescription.Field
                                },
                                type: {
                                    kind: graphql_1.Kind.NAMED_TYPE,
                                    name: {
                                        kind: graphql_1.Kind.NAME,
                                        value: this.getGraphQLType(tableDescription.Type)
                                    }
                                }
                            };
                            fields.push(field);
                            // TODO: primary key backwards to get nested types?
                        }
                        console.log(fields);
                        return [2 /*return*/, new GraphQLType(tableName, fields, null)];
                }
            });
        }); };
        this.deleteMe = function (databaseName, connection) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.executeSQL("CREATE DATABASE IF NOT EXISTS " + databaseName, connection)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); };
        this.deleteMeTables = function (connection) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.executeSQL("CREATE TABLE IF NOT EXISTS testtable (id INT(100), name TINYTEXT, PRIMARY KEY(id))", connection)];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.executeSQL("CREATE TABLE IF NOT EXISTS testtable2 (id INT(100), name TINYTEXT, PRIMARY KEY(id))", connection)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); };
        this.executeSQL = function (sqlString, connection) { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log("Executing ".concat(sqlString));
                        return [4 /*yield*/, new Promise(function (resolve, reject) {
                                connection.query(sqlString, function (err, results, fields) {
                                    if (err) {
                                        reject(err);
                                    }
                                    resolve(results);
                                });
                            })];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        }); };
        this.getGraphQLType = function (dbType) {
            dbType = dbType.toUpperCase().split("(")[0];
            if ("BOOL" == dbType) {
                return "Boolean";
            }
            else if ("JSON" == dbType) {
                return "AWSJSON";
            }
            else if ("TIME" == dbType) {
                return "AWSTime";
            }
            else if ("DATE" == dbType) {
                return "AWSDate";
            }
            else if ("DATETIME" == dbType) {
                return "AWSDateTime";
            }
            else if ("TIMESTAMP" == dbType) {
                return "AWSTimestamp";
            }
            else if (_this.intTypes.indexOf(dbType) > -1) {
                return "Int";
            }
            else if (_this.floatTypes.indexOf(dbType) > -1) {
                return "Float";
            }
            return "String";
        };
    }
    return RelationalDBSchemaTransformer;
}());
exports.RelationalDBSchemaTransformer = RelationalDBSchemaTransformer;
var testClass = new RelationalDBSchemaTransformer();
testClass.getSchemaWithCredentials("root", "password", "localhost", "testdb");
