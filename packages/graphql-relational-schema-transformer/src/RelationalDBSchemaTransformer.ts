import {createConnection, Connection, MysqlError, FieldInfo} from 'mysql'
import { print, Kind, ObjectTypeDefinitionNode, NonNullTypeNode, DirectiveNode, NameNode,
    OperationTypeNode, FieldDefinitionNode, NamedTypeNode, InputValueDefinitionNode, ValueNode,
    OperationTypeDefinitionNode, SchemaDefinitionNode, ArgumentNode, ListValueNode, StringValueNode} from 'graphql'
import RelationalDBTemplateGenerator from './RelationalDBTemplateGenerator'
import { DocumentNode } from 'graphql'


class TableContext {
    tableTypeDefinition: ObjectTypeDefinitionNode
    createTypeDefinition: ObjectTypeDefinitionNode
    updateTypeDefinition: ObjectTypeDefinitionNode
    tableKeyField: string
    tableKeyFieldType: string
    constructor(typeDefinition: ObjectTypeDefinitionNode, createDefinition: ObjectTypeDefinitionNode,
         updateDefinition: ObjectTypeDefinitionNode, primaryKeyField: string, primaryKeyType: string) {
        this.tableTypeDefinition = typeDefinition
        this.tableKeyField = primaryKeyField
        this.createTypeDefinition = createDefinition
        this.updateTypeDefinition = updateDefinition
        this.tableKeyFieldType = primaryKeyType
    }
}

class SchemaContext {
    schemaDoc: DocumentNode
    typePrimaryKeyMap: {}
    constructor(schemaDoc: DocumentNode, typePrimaryKeyMap: {}) {
        this.schemaDoc = schemaDoc
        this.typePrimaryKeyMap  = typePrimaryKeyMap
    }
}

export class RelationalDBSchemaTransformer {
    intTypes = [`INTEGER`, `INT`, `SMALLINT`, `TINYINT`, `MEDIUMINT`, `BIGINT`, `BIT`]
    floatTypes = [`FLOAT`, `DOUBLE`, `REAL`, `REAL_AS_FLOAT`, `DOUBLE PRECISION`, `DEC`, `DECIMAL`, `FIXED`, `NUMERIC`]

    public getSchemaWithCredentials = async (dbUser: string, dbPassword: string, dbHost: string, databaseName: string): Promise<SchemaContext> => {
        const connection = createConnection({user: dbUser, password: dbPassword, host: dbHost})

        this.deleteMe(databaseName, connection)

        // Set the working db to be what the user provides
        this.setDatabase(databaseName, connection)

        this.deleteMeTables(connection)

        // Get all of the tables within the provided db
        const tableNames = await this.listTables(databaseName, connection)

        const typeContexts = new Array()
        const types = new Array()
        for (const tableName of tableNames) {
            const type = await this.describeTable(tableName, databaseName, connection)
            typeContexts.push(type)
            // Generate the 'connection' type for each table type definition
            types.push(this.getConnectionType(tableName))
            // Generate the create operation input for each table type definition
            types.push(type.createTypeDefinition)
            // Generate the default shape for the table's structure
            types.push(type.tableTypeDefinition)
            // Generate the update operation input for each table type definition
            types.push(type.updateTypeDefinition)
        }

        connection.end()

        // Generate the mutations and queries based on the table structures
        types.push(this.getMutations(typeContexts))
        types.push(this.getQueries(typeContexts))
        types.push(this.getSubscriptions(typeContexts))
        types.push(this.getSchemaType())

        const schemaCtx = new SchemaContext({kind: Kind.DOCUMENT, definitions: types}, {})
        //console.log(schemaCtx.schemaDoc)
        return schemaCtx
    }

    private getSchemaType(): SchemaDefinitionNode {
        return {
            kind: Kind.SCHEMA_DEFINITION,
            operationTypes: [
                this.getOperationTypeDefinition('query', this.getNamedType('Query')),
                this.getOperationTypeDefinition('mutation', this.getNamedType('Mutation')),
                this.getOperationTypeDefinition('subscription', this.getNamedType('Subscription'))
            ]
        }
    }

    private getMutations(types: TableContext[]): ObjectTypeDefinitionNode {
        const fields = []
        for (const typeContext of types) {
            const type = typeContext.tableTypeDefinition
            fields.push(
                this.getOperationFieldDefinition(`delete${type.name.value}`,
                    [this.getInputValueDefinition(this.getNonNullType(this.getNamedType(typeContext.tableKeyFieldType)),
                        typeContext.tableKeyField)],
                    this.getNamedType(`${type.name.value}`), null)
            )
            fields.push(
                this.getOperationFieldDefinition(`create${type.name.value}`,
                    [this.getInputValueDefinition(this.getNonNullType(this.getNamedType(`Create${type.name.value}Input`)),
                        `create${type.name.value}Input`)],
                    this.getNamedType(`${type.name.value}`), null)
            )
            fields.push(
                this.getOperationFieldDefinition(`update${type.name.value}`,
                    [this.getInputValueDefinition(this.getNonNullType(this.getNamedType(`Update${type.name.value}Input`)),
                        `update${type.name.value}Input`)],
                    this.getNamedType(`${type.name.value}`), null)
            )
        }
        return this.getTypeDefinition(fields, 'Mutation')
    }

    private getSubscriptions(types: TableContext[]): ObjectTypeDefinitionNode {
        const fields = []
        for (const typeContext of types) {
            const type = typeContext.tableTypeDefinition
            fields.push(
                this.getOperationFieldDefinition(`onCreate${type.name.value}`, [],
                    this.getNamedType(`${type.name.value}`),
                    [this.getDirectiveNode(`create${type.name.value}`)])
            )
        }
        return this.getTypeDefinition(fields, 'Subscription')
    }

    private getQueries(types: TableContext[]): ObjectTypeDefinitionNode {
        const fields = []
        for (const typeContext of types) {
            const type = typeContext.tableTypeDefinition
            fields.push(
                this.getOperationFieldDefinition(`get${type.name.value}`,
                    [this.getInputValueDefinition(this.getNonNullType(this.getNamedType(typeContext.tableKeyFieldType)),
                            typeContext.tableKeyField)],
                    this.getNamedType(`${type.name.value}`), null)
                )
            fields.push(
                this.getOperationFieldDefinition(`list${type.name.value}s`,
                    [this.getInputValueDefinition(this.getNamedType('String'), 'nextToken')],
                    this.getNamedType(`${type.name.value}Connection`), null)
                )
            }
        return this.getTypeDefinition(fields, 'Query')
    }

    private setDatabase = async (databaseName: string, connection: Connection): Promise<void> => {
        await this.executeSQL(`USE ${databaseName}`, connection)
    }

    private listTables = async (databaseName: string, connection: Connection): Promise<string[]> => {
        const results = await this.executeSQL(`SHOW TABLES`, connection)
        return results.map(result => result[`Tables_in_${databaseName}`])
    }

    private getTableForReferencedTable = async (databaseName: string,
         tableName: string, connection: Connection) : Promise<string[]> => {
        const results = await this.executeSQL
            (`SELECT TABLE_NAME FROM information_schema.key_column_usage
            WHERE referenced_table_name is not null
            AND REFERENCED_TABLE_NAME = '${tableName}';`, connection)
        return results.map(result => result[`TABLE_NAME`])
    }

    private describeTable = async (tableName: string, dbName: string, connection: Connection): Promise<TableContext> => {
        const columnDescriptions = await this.executeSQL(`DESCRIBE ${tableName}`, connection)
        // Fields in the general type (e.g. Post). Both the identifying field and any others the db dictates will be required.
        const fields = new Array()
        // Fields in the update input type (e.g. UpdatePostInput). Only the identifying field will be required, any others will be optional.
        const updateFields = new Array()
        // Field in the create input type (e.g. CreatePostInput).
        const createFields = new Array()

        // The primary key, used to help generate queries and mutations
        let primaryKey = ""
        let primaryKeyType = ""

        for (const columnDescription of columnDescriptions) {
            // If a field is the primary key, save it.
            if (columnDescription.Key == 'PRI') {
                primaryKey = columnDescription.Field
                primaryKeyType = this.getGraphQLType(columnDescription.Type)
            } else if (columnDescription.Key == 'MUL') {
                // TODO: foreign key!
            }

            // Create the basic field type shape, to be consumed by every field definition
            const baseType = this.getNamedType(this.getGraphQLType(columnDescription.Type))

            const isPrimaryKey = columnDescription.Key == 'PRI'
            const isNullable = columnDescription.Null == 'YES'

            // Generate the field for the general type and the create input type
            const type = (!isPrimaryKey && isNullable) ? baseType : this.getNonNullType(baseType)
            fields.push(this.getFieldDefinition(columnDescription.Field, type))

            createFields.push(this.getFieldDefinition(columnDescription.Field, type))

            // Update<type>Input has only the primary key as required, ignoring all other that the database requests as non-nullable
            const updateType = !isPrimaryKey ? baseType : this.getNonNullType(baseType)
            updateFields.push(this.getFieldDefinition(columnDescription.Field, updateType))
            // TODO: foreign key backwards to get nested types?`
        }

        // Add foreign key for this table
        let tablesWithRef = await this.getTableForReferencedTable(dbName, tableName, connection)
        for (const tableWithRef of tablesWithRef) {
            if (tableWithRef && tableWithRef.length > 0) {
                const baseType = this.getNamedType(`${tableWithRef}Connection`)
                fields.push(this.getFieldDefinition(`${tableWithRef}`, baseType))
            }
        }

        return new TableContext(this.getTypeDefinition(fields, tableName), this.getTypeDefinition(createFields, `Create${tableName}Input`),
                this.getTypeDefinition(updateFields, `Update${tableName}Input`), primaryKey, primaryKeyType)
    }

    private getOperationTypeDefinition(operationType: OperationTypeNode, operation: NamedTypeNode): OperationTypeDefinitionNode {
        return {
            kind: Kind.OPERATION_TYPE_DEFINITION,
            operation: operationType,
            type: operation
        }
    }

    private getNonNullType(typeNode: NamedTypeNode): NonNullTypeNode {
        return {
            kind: Kind.NON_NULL_TYPE,
            type: typeNode
        }
    }

    private getNamedType(name: string): NamedTypeNode {
        return {
            kind: Kind.NAMED_TYPE,
            name: {
                kind: Kind.NAME,
                value: name
            }
        }
    }

    private getInputValueDefinition(typeNode: NamedTypeNode | NonNullTypeNode, name: string): InputValueDefinitionNode {
        return {
            kind: Kind.INPUT_VALUE_DEFINITION,
            name: {
                kind: Kind.NAME,
                value: name
            },
            type: typeNode
        }
    }

    private getOperationFieldDefinition(name: string, args: InputValueDefinitionNode[], type: NamedTypeNode, directives: ReadonlyArray<DirectiveNode>): FieldDefinitionNode {
        return {
            kind: Kind.FIELD_DEFINITION,
            name: {
                kind: Kind.NAME,
                value: name
            },
            arguments: args,
            type: type,
            directives: directives
        }
    }

    private getFieldDefinition(fieldName: string, type: NonNullTypeNode | NamedTypeNode): FieldDefinitionNode {
        return {
            kind: Kind.FIELD_DEFINITION,
            name: {
                kind: Kind.NAME,
                value: fieldName
            },
            type
        }
    }

    private getTypeDefinition(fields: ReadonlyArray<FieldDefinitionNode>, typeName: string): ObjectTypeDefinitionNode {
        return {
            kind: Kind.OBJECT_TYPE_DEFINITION,
            name: {
                kind: Kind.NAME,
                value: typeName
            },
            fields: fields
        }
    }

    private getNameNode(name: string): NameNode {
        return {
            kind: Kind.NAME,
            value: name
        }        
    }

    private getListValueNode(values: ReadonlyArray<ValueNode>): ListValueNode {
        return {
            kind: Kind.LIST,
            values: values
        }
    }

    private getStringValueNode(value: string): StringValueNode {
        return {
            kind: Kind.STRING,
            value: value
        }
    }    

    private getDirectiveNode(mutationName: string): DirectiveNode {
        return {
            kind: Kind.DIRECTIVE,
            name: this.getNameNode('aws_subscribe'),
            arguments: [this.getArgumentNode(mutationName)]
        }
    }

    private getArgumentNode(argument: string): ArgumentNode {
        return {
            kind: Kind.ARGUMENT,
            name: this.getNameNode('mutations'),
            value: this.getListValueNode([this.getStringValueNode(argument)])
        }
    }

    private getConnectionType(tableName: string): ObjectTypeDefinitionNode {
        return this.getTypeDefinition(
            [
                this.getFieldDefinition('items', this.getNamedType(`[${tableName}]`)),
                this.getFieldDefinition('nextToken', this.getNamedType('String'))
            ],
            `${tableName}Connection`)
    }

    private deleteMe = async (databaseName: string, connection: Connection): Promise<void> => {
        await this.executeSQL(`CREATE DATABASE IF NOT EXISTS ${databaseName}`, connection)
    }

    private deleteMeTables = async (connection: Connection): Promise<void> => {
        // await this.executeSQL(`CREATE TABLE IF NOT EXISTS testTable (id INT(100), name TINYTEXT, PRIMARY KEY(id))`, connection)
        // await this.executeSQL(`CREATE TABLE IF NOT EXISTS testTable2 (id INT(100), testId INT(100), name TINYTEXT, PRIMARY KEY(id))`, connection)
        // await this.executeSQL(`CREATE TABLE IF NOT EXISTS Test1 (id INT(100), name TINYTEXT, PRIMARY KEY(id))`, connection)
        // await this.executeSQL(`CREATE TABLE IF NOT EXISTS Test2 (id INT(100), testId INT(100),
        //  name TINYTEXT, PRIMARY KEY(id), FOREIGN KEY(testId) REFERENCES Test1(id))`, connection)
        await this.executeSQL(`CREATE TABLE IF NOT EXISTS Dogs (id INT(100), name TINYTEXT, PRIMARY KEY(id))`, connection)
    }

    private executeSQL = async (sqlString: string, connection: Connection): Promise<any> => {
        return await new Promise<FieldInfo[]>((resolve, reject) => {
            connection.query(sqlString, (err: MysqlError | null, results?: any, fields?: FieldInfo[]) => {
                if (err) {
                    console.log(`Failed to execute ${sqlString}`)
                    reject(err)
                }
                resolve(results)
            })
        })
    }

    private getGraphQLType(dbType: string): string {
        const normalizedType = dbType.toUpperCase().split("(")[0]
        if (`BOOL` == normalizedType) {
            return `Boolean`
        } else if (`JSON` == normalizedType) {
            return `AWSJSON`
        } else if (`TIME` == normalizedType) {
            return `AWSTime`
        } else if (`DATE` == normalizedType) {
            return `AWSDate`
        } else if (`DATETIME` == normalizedType) {
            return `AWSDateTime`
        } else if (`TIMESTAMP` == normalizedType) {
            return `AWSTimestamp`
        } else if (this.intTypes.indexOf(normalizedType) > -1) {
            return `Int`
        } else if (this.floatTypes.indexOf(normalizedType) > -1) {
            return `Float`
        }
        return `String`
    }
}

let testClass = new RelationalDBSchemaTransformer()
let result = testClass.getSchemaWithCredentials("root", "ashy", "localhost", "testdb")

result.then(function(data: SchemaContext) {
    console.log(print(data.schemaDoc))

    let templateClass = new RelationalDBTemplateGenerator(data.schemaDoc)
    console.log(templateClass.createTemplate())
})
