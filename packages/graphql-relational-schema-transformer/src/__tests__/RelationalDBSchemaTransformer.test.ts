jest.mock('mysql')

import {createConnection, Connection, MysqlError, FieldInfo} from 'mysql'
import { RelationalDBSchemaTransformer, TableContext } from '../RelationalDBSchemaTransformer';
import { Kind, DocumentNode, print } from 'graphql'

const dummyTransformer = new RelationalDBSchemaTransformer()

const testDBUser = 'testUsername'
const testDBPassword = 'testPassword'
const testDBHost = 'testHost'
const testDBName = 'testdb'
const tableAName = 'a'
const tableBName = 'b'
const tableCName = 'c'
const tableDName = 'd'

const MockConnection = jest.fn<Connection>(() => ({
    end: jest.fn(),
    query: jest.fn(function (sqlString: string, queryCallback: (err: MysqlError | null, results?: any, fields?: FieldInfo[]) => void) {
        let results = null
        // TODO: show tables and getting foreign keys are technically slightly inaccurate as a test. The
        // library returns 'RowDataPacket { ... }', however this will still test the parsing that we care about.
        if (sqlString == `SHOW TABLES`) {
            // For list tables, return a set of four table names
            results = [ { Tables_in_testdb: tableAName },
            { Tables_in_testdb: tableBName },
            { Tables_in_testdb: tableCName },
            { Tables_in_testdb: tableDName } ]
        } else if (sqlString == `USE ${testDBName}`) {
            // If it's the use db, we don't need a response
            results = ''
        } else if (sqlString.indexOf(`AND REFERENCED_TABLE_NAME = '${tableBName}'`) > -1) {
            // For foreign key lookup on table b, we return table a
            results = [ { TABLE_NAME: tableAName } ]
        } else if (sqlString.indexOf(`SELECT TABLE_NAME FROM information_schema.key_column_usage`) > -1) {
            // On other foreign key lookups, return an empty array
            results = []
        } else if (sqlString == `DESCRIBE ${tableBName}`) {
            results = [ {
                Field: 'id',
                Type: 'int',
                Null: 'NO',
                Key: 'PRI',
                Default: null,
                Extra: '' },
              {
                Field: 'aId',
                Type: 'int',
                Null: 'YES',
                Key: 'MUL',
                Default: null,
                Extra: '' },
              {
                Field: 'name',
                Type: 'varchar(100)',
                Null: 'YES',
                Key: '',
                Default: null,
                Extra: '' } ]
        } else if (sqlString == `DESCRIBE ${tableAName}` || `DESCRIBE ${tableCName}` || sqlString == `DESCRIBE ${tableDName}`) {
            results = [ {
                Field: 'id',
                Type: 'int',
                Null: 'NO',
                Key: 'PRI',
                Default: null,
                Extra: '' },
              {
                Field: 'name',
                Type: 'varchar(100)',
                Null: 'YES',
                Key: '',
                Default: null,
                Extra: '' } ]
        }
        queryCallback(null, results, null)
    }),
}))

test('Test schema generation end to end', async() => {
    const mockConnection = new MockConnection()
    createConnection.mockReturnValue(mockConnection)
    const schemaDoc = await dummyTransformer.getSchemaWithCredentials(testDBUser, testDBPassword,  testDBHost, testDBName)

    expect(mockConnection.query).toHaveBeenCalledWith(`USE ${testDBName}`, expect.any(Function))
    expect(mockConnection.query).toHaveBeenCalledWith(`SHOW TABLES`, expect.any(Function))
    expect(mockConnection.query).toHaveBeenCalledWith(`DESCRIBE ${tableAName}`, expect.any(Function))
    expect(mockConnection.query).toHaveBeenCalledWith(`DESCRIBE ${tableBName}`, expect.any(Function))
    expect(mockConnection.query).toHaveBeenCalledWith(`DESCRIBE ${tableCName}`, expect.any(Function))
    expect(mockConnection.query).toHaveBeenCalledWith(`DESCRIBE ${tableDName}`, expect.any(Function))
    expect(schemaDoc).toBeDefined()
    expect(schemaDoc.kind).toBe(Kind.DOCUMENT)
    // 4 tables * (base, update input, connecton, and create input) + schema, queries, mutations, and subs
    // (4 * 4) + 4 = 20
    expect(schemaDoc.definitions.length).toBe(20) 
    const schemaString = print(schemaDoc)
    expect(schemaString).toBeDefined()
    console.log(schemaString)
})

test('Test describe table', async () => {
    const connection = new MockConnection()
    describeTableTestCommon(tableAName, 2, false, await dummyTransformer.describeTable(tableAName, testDBName, connection))    
    describeTableTestCommon(tableBName, 3, true, await dummyTransformer.describeTable(tableBName, testDBName, connection))    
    describeTableTestCommon(tableCName, 2, false, await dummyTransformer.describeTable(tableCName, testDBName, connection))    
    describeTableTestCommon(tableDName, 2, false, await dummyTransformer.describeTable(tableDName, testDBName, connection))    
})

function describeTableTestCommon(tableName: string, fieldLength: number, isForeignKey: boolean, tableContext: TableContext) {
    expect(tableContext.tableKeyField).toEqual('id')
    expect(tableContext.tableKeyFieldType).toEqual('Int')
    expect(tableContext.createTypeDefinition).toBeDefined()
    expect(tableContext.updateTypeDefinition).toBeDefined()
    expect(tableContext.tableTypeDefinition).toBeDefined()
    expect(tableContext.tableTypeDefinition.kind).toEqual(Kind.OBJECT_TYPE_DEFINITION)
    expect(tableContext.updateTypeDefinition.kind).toEqual(Kind.OBJECT_TYPE_DEFINITION)
    expect(tableContext.createTypeDefinition.kind).toEqual(Kind.OBJECT_TYPE_DEFINITION)
    expect(tableContext.tableTypeDefinition.name.value).toEqual(tableName)
    expect(tableContext.tableTypeDefinition.name.kind).toEqual(Kind.NAME)
    expect(tableContext.updateTypeDefinition.name.value).toEqual(`Update${tableName}Input`)
    expect(tableContext.updateTypeDefinition.name.kind).toEqual(Kind.NAME)
    expect(tableContext.createTypeDefinition.name.value).toEqual(`Create${tableName}Input`)
    expect(tableContext.createTypeDefinition.name.kind).toEqual(Kind.NAME)
    /**
     * If it's a table with a foreign key constraint, the base type will have one additional element
     * for the nested type. e.g. if type Posts had fields of id/int, content/string, and author/string
     * but comments had a foreign key constraint on it, then it would look like this (whereas the 
     * create and update inputs would not have the additional field):
     * type Post {
     *   id: Int!
     *   author: String!
     *   content: String!
     *   comments: CommentConnection
     * }
    */ 
    expect(tableContext.tableTypeDefinition.fields.length).toEqual(isForeignKey ? fieldLength+1 : fieldLength)
    expect(tableContext.updateTypeDefinition.fields.length).toEqual(fieldLength)
    expect(tableContext.createTypeDefinition.fields.length).toEqual(fieldLength)
}

test('Test list tables', async () => {
    const connection = new MockConnection()
    const tableNames = await dummyTransformer.listTables(testDBName, connection)
    expect(connection.query).toHaveBeenCalledWith(`SHOW TABLES`, expect.any(Function))
    expect(tableNames.length).toBe(4)
    expect(tableNames.indexOf(tableAName) > -1).toBe(true)
    expect(tableNames.indexOf(tableBName) > -1).toBe(true)
    expect(tableNames.indexOf(tableCName) > -1).toBe(true)
    expect(tableNames.indexOf(tableDName) > -1).toBe(true)
})

test('Test set database', () => {
    const mockConnection = new MockConnection()
    dummyTransformer.setDatabase(testDBName, mockConnection)
    expect(mockConnection.query).toHaveBeenCalled()
    expect(mockConnection.query).toHaveBeenCalledWith(`USE ${testDBName}`, expect.any(Function))
})

test('Test lookup foreign key', async () => {
    const mockConnection = new MockConnection()
    const aKeys = await dummyTransformer.getTableForReferencedTable(tableAName, mockConnection)
    const bKeys = await dummyTransformer.getTableForReferencedTable(tableBName, mockConnection)
    const cKeys = await dummyTransformer.getTableForReferencedTable(tableCName, mockConnection)
    const dKeys = await dummyTransformer.getTableForReferencedTable(tableDName, mockConnection)
    expect(aKeys).toBeDefined()
    expect(bKeys).toBeDefined()
    expect(cKeys).toBeDefined()
    expect(dKeys).toBeDefined()
    expect(aKeys.length).toBe(0)
    expect(bKeys.length).toBe(1)
    expect(cKeys.length).toBe(0)
    expect(dKeys.length).toBe(0)
    expect(bKeys[0]).toBe(tableAName)

})

test('Test schema type node creation', () => {
    const schemaNode = dummyTransformer.getSchemaType()
    expect(schemaNode.kind).toEqual(Kind.SCHEMA_DEFINITION)
    expect(schemaNode.operationTypes.length).toEqual(3)
})

test('Test operation type node creation', () => {
    const operationType = 'query'
    const namedNode = dummyTransformer.getNamedType('Query')
    const operationTypeNode = dummyTransformer.getOperationTypeDefinition(operationType, namedNode)
    expect(operationTypeNode.kind).toEqual(Kind.OPERATION_TYPE_DEFINITION)
    expect(operationTypeNode.operation).toEqual(operationType)
    expect(operationTypeNode.type).toEqual(namedNode)
})

test('Test non null type node creation', () => {
    const namedTypeNode = dummyTransformer.getNamedType('test name')
    const nonNullNamedTypeNode = dummyTransformer.getNonNullType(namedTypeNode)
    expect(nonNullNamedTypeNode.kind).toEqual(Kind.NON_NULL_TYPE)
    expect(nonNullNamedTypeNode.type).toEqual(namedTypeNode)
})

test('Test named type node creation', () => {
    const name = 'test name'
    const namedTypeNode = dummyTransformer.getNamedType(name)
    expect(namedTypeNode.kind).toEqual(Kind.NAMED_TYPE)
    expect(namedTypeNode.name.value).toEqual(name)
})

test('Test input value definition node creation', () => {
    const name = 'input name'
    const nameNode = dummyTransformer.getNamedType('type name')
    const inputDefinitionNode = dummyTransformer.getInputValueDefinition(nameNode, name)
    expect(inputDefinitionNode.kind).toEqual(Kind.INPUT_VALUE_DEFINITION)
    expect(inputDefinitionNode.type).toEqual(nameNode)
    expect(inputDefinitionNode.name.value).toEqual(name)
})

test('Test operation field definition node creation', () => {
    const name = 'field name'
    const args = [
        dummyTransformer.getInputValueDefinition(null, 'test name')
    ]
    const namedNode = dummyTransformer.getNamedType('test name')
    const operationFieldDefinitionNode = dummyTransformer.getOperationFieldDefinition(name, args, namedNode, null)
    expect(operationFieldDefinitionNode.kind).toEqual(Kind.FIELD_DEFINITION)
    expect(operationFieldDefinitionNode.type).toEqual(namedNode)
    expect(operationFieldDefinitionNode.arguments).toEqual(args)

})

test('Test field definition node creation', () => {
    const fieldName = 'field name'
    const namedNode = dummyTransformer.getNamedType('type name')
    const fieldDefinitionNode = dummyTransformer.getFieldDefinition(fieldName, namedNode)
    expect(fieldDefinitionNode.kind).toEqual(Kind.FIELD_DEFINITION)
    expect(fieldDefinitionNode.type).toEqual(namedNode)
    expect(fieldDefinitionNode.name.value).toEqual(fieldName)
})

test('Test type definition node creation', () => {
    const fieldList = [
        dummyTransformer.getFieldDefinition('field name', null)
    ]
    const typeName = 'type name'
    const typeDefinitionNode = dummyTransformer.getTypeDefinition(fieldList, typeName)
    expect(typeDefinitionNode.kind).toEqual(Kind.OBJECT_TYPE_DEFINITION)
    expect(typeDefinitionNode.name.value).toEqual(typeName)
    expect(typeDefinitionNode.fields).toEqual(fieldList)
})

test('Test name node creaton', () => {
    const name = 'name string'
    const nameNode = dummyTransformer.getNameNode(name)
    expect(nameNode.kind).toEqual(Kind.NAME)
    expect(nameNode.value).toEqual(name)
})

test('Test list value node creation', () => {
    const valueList = [
        dummyTransformer.getStringValueNode('string a'),
        dummyTransformer.getStringValueNode('string b')
    ]
    const listValueNode = dummyTransformer.getListValueNode(valueList)
    expect(listValueNode.kind).toEqual(Kind.LIST)
    expect(listValueNode.values).toEqual(valueList)
})

test('Test string value node creation', () => {
    const stringValue = 'string value'
    const stringValueNode = dummyTransformer.getStringValueNode(stringValue)
    expect(stringValueNode.kind).toEqual(Kind.STRING)
    expect(stringValueNode.value).toEqual(stringValue)
})

test('Test directive node creation', () => {
    const directiveNode = dummyTransformer.getDirectiveNode('directive name')
    expect(directiveNode.kind).toEqual(Kind.DIRECTIVE)
    expect(directiveNode.name).toBeDefined()
    expect(directiveNode.arguments.length).toEqual(1)

})

test('Test argument node creation', () => {
    const argumentNode = dummyTransformer.getArgumentNode('argument name')
    expect(argumentNode.kind).toEqual(Kind.ARGUMENT)
    expect(argumentNode.name).toBeDefined()
    expect(argumentNode.value).toBeDefined()
    expect(argumentNode.value.kind).toEqual(Kind.LIST)
})

test('Test connection type shape', () => {
    const testType = 'type name'
    const connectionType = dummyTransformer.getConnectionType(testType)
    expect(connectionType.fields.length).toEqual(2)
    expect(connectionType.name.value).toEqual(`${testType}Connection`)
})

test('Test type conversion to AWSDateTime', () => {
    expect(dummyTransformer.getGraphQLType('datetime')).toEqual('AWSDateTime')
})

test('Test type conversion to AWSDate', () => {
    expect(dummyTransformer.getGraphQLType('date')).toEqual('AWSDate')
})

test('Test type conversion to AWSTime', () => {
    expect(dummyTransformer.getGraphQLType('time')).toEqual('AWSTime')
})

test('Test type conversion to AWSTimestamp', () => {
    expect(dummyTransformer.getGraphQLType('timestamp')).toEqual('AWSTimestamp')
})

test('Test type conversion to AWSJSON', () => {
    expect(dummyTransformer.getGraphQLType('jSoN')).toEqual('AWSJSON')
})

test('Test type conversion to Boolean', () => {
    expect(dummyTransformer.getGraphQLType('BOOl')).toEqual('Boolean')
})

test('Test type conversion to Int', () => {
    expect(dummyTransformer.getGraphQLType('Int')).toEqual('Int')
    expect(dummyTransformer.getGraphQLType('Int(100)')).toEqual('Int')
    expect(dummyTransformer.getGraphQLType('inteGER')).toEqual('Int')
    expect(dummyTransformer.getGraphQLType('SmaLLInT')).toEqual('Int')
    expect(dummyTransformer.getGraphQLType('TINYint')).toEqual('Int')
    expect(dummyTransformer.getGraphQLType('mediumInt')).toEqual('Int')
    expect(dummyTransformer.getGraphQLType('BIGINT')).toEqual('Int')
    expect(dummyTransformer.getGraphQLType('BIT')).toEqual('Int')
})

test('Test type conversion to Float', () => {
    expect(dummyTransformer.getGraphQLType('FloAT')).toEqual('Float')
    expect(dummyTransformer.getGraphQLType('DOUBle')).toEqual('Float')
    expect(dummyTransformer.getGraphQLType('REAL')).toEqual('Float')
    expect(dummyTransformer.getGraphQLType('REAL_as_FLOAT')).toEqual('Float')
    expect(dummyTransformer.getGraphQLType('DOUBLE precision')).toEqual('Float')
    expect(dummyTransformer.getGraphQLType('DEC')).toEqual('Float')
    expect(dummyTransformer.getGraphQLType('DeciMAL')).toEqual('Float')
    expect(dummyTransformer.getGraphQLType('FIXED')).toEqual('Float')
    expect(dummyTransformer.getGraphQLType('Numeric')).toEqual('Float')
})

test('Test type conversion defaults to String', () => {
    expect(dummyTransformer.getGraphQLType('gibberish random stuff')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('timesta')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('boo')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('jso')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('tim')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('ate')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('atetime')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('Inte')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('Bigin')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('DECI')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('floatt')).toEqual('String')
    expect(dummyTransformer.getGraphQLType('FIXE')).toEqual('String')
})

jest.requireActual('mysql')