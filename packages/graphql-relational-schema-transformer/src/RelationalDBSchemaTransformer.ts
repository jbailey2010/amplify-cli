import {createConnection, Connection, MysqlError, FieldInfo} from 'mysql'
import { print, Kind, ObjectTypeDefinitionNode, NonNullTypeNode, DirectiveNode, NameNode,
    OperationTypeNode, FieldDefinitionNode, NamedTypeNode, InputValueDefinitionNode, ValueNode,
    OperationTypeDefinitionNode, SchemaDefinitionNode, ArgumentNode, ListValueNode, StringValueNode} from 'graphql'
import RelationalDBTemplateGenerator from './RelationalDBTemplateGenerator'
import { DocumentNode } from 'graphql'

/**
 * This class is used to transition all of the columns and key metadata from a table for use
 * in generating appropriate GraphQL schema structures. It will track type definitions for 
 * the base table, update mutation inputs, create mutation inputs, and primary key metadata.
 */
class TableContext {
    tableTypeDefinition: ObjectTypeDefinitionNode
    createTypeDefinition: ObjectTypeDefinitionNode
    updateTypeDefinition: ObjectTypeDefinitionNode
    // Table primary key metadata, to help properly key queries and mutations.
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

export class RelationalDBSchemaTransformer {
    intTypes = [`INTEGER`, `INT`, `SMALLINT`, `TINYINT`, `MEDIUMINT`, `BIGINT`, `BIT`]
    floatTypes = [`FLOAT`, `DOUBLE`, `REAL`, `REAL_AS_FLOAT`, `DOUBLE PRECISION`, `DEC`, `DECIMAL`, `FIXED`, `NUMERIC`]

    public getSchemaWithCredentials = async (dbUser: string, dbPassword: string, dbHost: string, databaseName: string): Promise<DocumentNode> => {
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
            // types.push(this.getTypeDefinition(type.tableTypeDefinition.fields, `Create${tableName}Input`))
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

        const schemaDoc = print({kind: Kind.DOCUMENT, definitions: types})

        //console.log(schemaDoc)
        return {kind: Kind.DOCUMENT, definitions: types}
    }

    /**
     * Creates a schema type definition node, including operations for each of query, mutation, and subscriptions.
     * 
     * @returns a basic schema definition node.
     */
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

    /**
     * Generates the basic mutation operations, given the provided table contexts. This will
     * create a create, delete, and update operation for each table.
     * 
     * @param types the table contexts from which the mutations are to be generated.
     * @returns the type definition for mutations, including a create, delete, and update for each table.
     */
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

    /**
     * Generates the basic subscription operations, given the provided table contexts. This will
     * create an onCreate subscription for each table.
     * 
     * @param types the table contexts from which the subscriptions are to be generated.
     * @returns the type definition for subscriptions, including an onCreate for each table.
     */
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

    /**
     * Generates the basic query operations, given the provided table contexts. This will
     * create a get and list operation for each table.
     * 
     * @param types the table contexts from which the queries are to be generated.
     * @returns the type definition for queries, including a get and list for each table.
     */
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

    /**
     * Sets the connection to use the provided database name during future interactions.
     * 
     * @param databaseName the name of the database to use.
     * @param connection the connection to use to talk to the database.
     */
    private setDatabase = async (databaseName: string, connection: Connection): Promise<void> => {
        await this.executeSQL(`USE ${databaseName}`, connection)
    }

    /**
     * Gets a list of all the table names in the provided database.
     * 
     * @param databaseName the name of the database to get tables from.
     * @param connection the connection to use to talk to the database.
     * @returns a list of tablenames inside the database.
     */
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

    /**
     * For the provided table, this will create a table context. That context holds definitions for
     * the base table type, the create input type, and the update input type (e.g. Post, CreatePostInput, and UpdatePostInput, respectively),
     * as well as the table primary key structure for proper operation definition.
     * 
     * Create inputs will only differ from the base table type in that any nested types will not be present. Update table
     * inputs will differ in that the only required field will be the primary key/identifier, as all fields don't have to
     * be updated. Instead, it assumes the proper ones were provided on create.
     * 
     * @param tableName the name of the table to be translated into a GraphQL type.
     * @param dbName the name of the database to be referenced for tables/nested types.
     * @param connection the SQL connection to be used to interact with the db.
     * @returns a promise of a table context structure.
     */
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

    /**
     * Creates an operation type definition (subscription, query, mutation) for the schema.
     * 
     * @param operationType the type node defining the operation type.
     * @param operation  the named type node defining the operation type.
     */
    private getOperationTypeDefinition(operationType: OperationTypeNode, operation: NamedTypeNode): OperationTypeDefinitionNode {
        return {
            kind: Kind.OPERATION_TYPE_DEFINITION,
            operation: operationType,
            type: operation
        }
    }

    /**
     * Creates a non-null type, which is a node wrapped around another type that simply defines it is non-nullable.
     * 
     * @param typeNode the type to be marked as non-nullable.
     * @returns a non-null wrapper around the provided type.
     */
    private getNonNullType(typeNode: NamedTypeNode): NonNullTypeNode {
        return {
            kind: Kind.NON_NULL_TYPE,
            type: typeNode
        }
    }

    /**
     * Creates a named type for the schema.
     * 
     * @param name the name of the type.
     * @returns a named type with the provided name.
     */
    private getNamedType(name: string): NamedTypeNode {
        return {
            kind: Kind.NAMED_TYPE,
            name: {
                kind: Kind.NAME,
                value: name
            }
        }
    }

    /**
     * Creates an input value definition for the schema.
     * 
     * @param typeNode the type of the input node.
     * @param name the name of the input.
     * @returns an input value definition node with the provided type and name.
     */
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

    /**
     * Creates an operation field definition for the schema.
     * 
     * @param name the name of the operation.
     * @param args the arguments for the operation.
     * @param type the type of the operation.
     * @param directives the directives (if any) applied to this field. In this context, only subscriptions will have this.
     * @returns an operation field definition with the provided name, args, type, and optionally directives.
     */
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

    /**
     * Creates a field definition node for the schema.
     * 
     * @param fieldName the name of the field to be created.
     * @param type the type of the field to be created.
     * @returns a field definition node with the provided name and type.
     */
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

    /**
     * Creates a type definition node for the schema.
     * 
     * @param fields the field set to be included in the type.
     * @param typeName the name of the type.
     * @returns a type definition node defined by the provided fields and name.
     */
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

    /**
     * Creates a name node for the schema.
     * 
     * @param name the name of the name node.
     * @returns the name node defined by the provided name.
     */
    private getNameNode(name: string): NameNode {
        return {
            kind: Kind.NAME,
            value: name
        }        
    }

    /**
     * Creates a list value node for the schema.
     * 
     * @param values the list of values to be in the list node.
     * @returns a list value node containing the provided values.
     */
    private getListValueNode(values: ReadonlyArray<ValueNode>): ListValueNode {
        return {
            kind: Kind.LIST,
            values: values
        }
    }

    /**
     * Creates a simple string value node for the schema.
     * 
     * @param value the value to be set in the string value node.
     * @returns a fleshed-out string value node.
     */
    private getStringValueNode(value: string): StringValueNode {
        return {
            kind: Kind.STRING,
            value: value
        }
    }    

    /**
     * Creates a directive node for a subscription in the schema.
     * 
     * @param mutationName the name of the mutation the subscription directive is for.
     * @returns a directive node defining the subscription.
     */
    private getDirectiveNode(mutationName: string): DirectiveNode {
        return {
            kind: Kind.DIRECTIVE,
            name: this.getNameNode('aws_subscribe'),
            arguments: [this.getArgumentNode(mutationName)]
        }
    }

    /**
     * Creates an argument node for a subscription directive within the schema.
     * 
     * @param argument the argument string.
     * @returns the argument node.
     */
    private getArgumentNode(argument: string): ArgumentNode {
        return {
            kind: Kind.ARGUMENT,
            name: this.getNameNode('mutations'),
            value: this.getListValueNode([this.getStringValueNode(argument)])
        }
    }

    /**
     * Creates a GraphQL connection type for a given GraphQL type, corresponding to a SQL table name.
     * 
     * @param tableName the name of the SQL table (and GraphQL type).
     * @returns a type definition node defining the connection type for the provided type name.
     */
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
        await this.executeSQL(`CREATE TABLE IF NOT EXISTS testTable (id INT(100), name TINYTEXT, PRIMARY KEY(id))`, connection)
        await this.executeSQL(`CREATE TABLE IF NOT EXISTS testTable2 (id INT(100), testId INT(100), name TINYTEXT, PRIMARY KEY(id))`, connection)
        await this.executeSQL(`CREATE TABLE IF NOT EXISTS Test1 (id INT(100), name TINYTEXT, PRIMARY KEY(id))`, connection)
        await this.executeSQL(`CREATE TABLE IF NOT EXISTS Test2 (id INT(100), testId INT(100), name TINYTEXT, PRIMARY KEY(id), FOREIGN KEY(testId) REFERENCES Test1(id))`, connection)
    }
    
    /**
     * Executes the provided SQL statement.
     * 
     * @returns a promise with the execution response.
     */
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

    /**
     * Given the DB type for a column, make a best effort to select the appropriate GraphQL type for
     * the corresponding field.
     * 
     * @param dbType the SQL column type.
     * @returns the GraphQL field type.
     */
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

result.then(function(data: DocumentNode) {
    console.log(print(data))

    let templateClass = new RelationalDBTemplateGenerator(data)
    console.log(templateClass.createTemplate())
})
