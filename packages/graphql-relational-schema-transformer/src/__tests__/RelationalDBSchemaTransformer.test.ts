import { RelationalDBSchemaTransformer } from '../RelationalDBSchemaTransformer';

const dummyTransformer = new RelationalDBSchemaTransformer()

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