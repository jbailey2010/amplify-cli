import { Kind, ObjectTypeDefinitionNode, OperationTypeNode, NamedTypeNode, 
    OperationTypeDefinitionNode, SchemaDefinitionNode, InputObjectTypeDefinitionNode, 
    DocumentNode} from 'graphql'
import { getNamedType, getOperationFieldDefinition, getNonNullType, getInputValueDefinition,
    getTypeDefinition, getFieldDefinition, getDirectiveNode, getOperationTypeDefinition } from './RelationalDBSchemaTransformerUtils'
import { IRelationalDBReader } from './IRelationalDBReader'
import { MySQLRelationalDBReader } from './MySQLRelationalDBReader'
import {RelationalDBParsingException} from './RelationalDBParsingException'
import { rejects } from 'assert';

/**
 * This class is used to transition all of the columns and key metadata from a table for use
 * in generating appropriate GraphQL schema structures. It will track type definitions for 
 * the base table, update mutation inputs, create mutation inputs, and primary key metadata.
 */
export class TableContext {
    tableTypeDefinition: ObjectTypeDefinitionNode
    createTypeDefinition: InputObjectTypeDefinitionNode
    updateTypeDefinition: InputObjectTypeDefinitionNode
    // Table primary key metadata, to help properly key queries and mutations.
    tableKeyField: string
    tableKeyFieldType: string
    constructor(typeDefinition: ObjectTypeDefinitionNode, createDefinition: InputObjectTypeDefinitionNode,
         updateDefinition: InputObjectTypeDefinitionNode, primaryKeyField: string, primaryKeyType: string) {
        this.tableTypeDefinition = typeDefinition
        this.tableKeyField = primaryKeyField
        this.createTypeDefinition = createDefinition
        this.updateTypeDefinition = updateDefinition
        this.tableKeyFieldType = primaryKeyType
    }
}

export class RelationalDBSchemaTransformer {
    
    mySQLReader: IRelationalDBReader

    public processMySQLSchemaOverJDBCWithCredentials = async (dbUser: string, dbPassword: string, 
        dbHost: string, databaseName: string): Promise<DocumentNode> => {
        this.mySQLReader = new MySQLRelationalDBReader(dbUser, dbPassword, dbHost)

        // Set the working db to be what the user provides
        try {
            await this.mySQLReader.begin(databaseName)
        } catch (err) {
            console.log('begin failed')
            throw new RelationalDBParsingException(`Failed to set database to ${databaseName}`, err.stack)
        }

        // Get all of the tables within the provided db
        let tableNames = null
        try {
            tableNames = await this.mySQLReader.listTables(databaseName)
        } catch (err) {
            throw new RelationalDBParsingException(`Failed to list tables in ${databaseName}`, err.stack)
        }
        

        const typeContexts = new Array()
        const types = new Array()
        for (const tableName of tableNames) {
            let type = null
            try {
                type = await this.mySQLReader.describeTable(tableName)
            } catch (err) {
                throw new RelationalDBParsingException(`Failed to describe table ${tableName}`, err.stack)
            } 
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

        this.mySQLReader.end()

        // Generate the mutations and queries based on the table structures
        types.push(this.getMutations(typeContexts))
        types.push(this.getQueries(typeContexts))
        types.push(this.getSubscriptions(typeContexts))
        types.push(this.getSchemaType())

        return {kind: Kind.DOCUMENT, definitions: types}
    }

    /**
     * Creates a schema type definition node, including operations for each of query, mutation, and subscriptions.
     * 
     * @returns a basic schema definition node.
     */
    getSchemaType(): SchemaDefinitionNode {
        return {
            kind: Kind.SCHEMA_DEFINITION,
            operationTypes: [
                getOperationTypeDefinition('query', getNamedType('Query')),
                getOperationTypeDefinition('mutation', getNamedType('Mutation')),
                getOperationTypeDefinition('subscription', getNamedType('Subscription'))
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
                getOperationFieldDefinition(`delete${type.name.value}`,
                    [getInputValueDefinition(getNonNullType(getNamedType(typeContext.tableKeyFieldType)),
                        typeContext.tableKeyField)],
                    getNamedType(`${type.name.value}`), null)
            )
            fields.push(
                getOperationFieldDefinition(`create${type.name.value}`,
                    [getInputValueDefinition(getNonNullType(getNamedType(`Create${type.name.value}Input`)),
                        `create${type.name.value}Input`)],
                    getNamedType(`${type.name.value}`), null)
            )
            fields.push(
                getOperationFieldDefinition(`update${type.name.value}`,
                    [getInputValueDefinition(getNonNullType(getNamedType(`Update${type.name.value}Input`)),
                        `update${type.name.value}Input`)],
                    getNamedType(`${type.name.value}`), null)
            )
        }
        return getTypeDefinition(fields, 'Mutation')
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
                getOperationFieldDefinition(`onCreate${type.name.value}`, [],
                    getNamedType(`${type.name.value}`),
                    [getDirectiveNode(`create${type.name.value}`)])
            )
        }
        return getTypeDefinition(fields, 'Subscription')
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
                getOperationFieldDefinition(`get${type.name.value}`,
                    [getInputValueDefinition(getNonNullType(getNamedType(typeContext.tableKeyFieldType)),
                            typeContext.tableKeyField)],
                    getNamedType(`${type.name.value}`), null)
                )
            fields.push(
                getOperationFieldDefinition(`list${type.name.value}s`,
                    [getInputValueDefinition(getNamedType('String'), 'nextToken')],
                    getNamedType(`${type.name.value}Connection`), null)
                )
            }
        return getTypeDefinition(fields, 'Query')
    }

    /**
     * Creates a GraphQL connection type for a given GraphQL type, corresponding to a SQL table name.
     * 
     * @param tableName the name of the SQL table (and GraphQL type).
     * @returns a type definition node defining the connection type for the provided type name.
     */
    getConnectionType(tableName: string): ObjectTypeDefinitionNode {
        return getTypeDefinition(
            [
                getFieldDefinition('items', getNamedType(`[${tableName}]`)),
                getFieldDefinition('nextToken', getNamedType('String'))
            ],
            `${tableName}Connection`)
    }
}

let testClass = new RelationalDBSchemaTransformer()
let result = testClass.processMySQLSchemaOverJDBCWithCredentials("root", "password", "localhost", "testdb").catch((err) => {
    console.log('Caught error overall ' + err.stack)
})