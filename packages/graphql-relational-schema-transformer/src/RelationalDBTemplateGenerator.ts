import  ApiKey from 'cloudform-types/types/appSync/apiKey'
import GraphQLSchema from 'cloudform-types/types/appSync/graphQlSchema'
import GraphQLApi from 'cloudform-types/types/appSync/graphQlApi'
import Role, { Policy } from 'cloudform-types/types/iam/role'
import { ResourceConstants, ModelResourceIDs, graphqlName, toUpper, plurality } from 'graphql-transformer-common'
import { print} from 'graphql'
import { DocumentNode } from 'graphql'
import DataSource from 'cloudform-types/types/appSync/dataSource'
import Resolver from 'cloudform-types/types/appSync/resolver'
import RelationalDBMappingTemplate from './RelationalDBMappingTemplate'

import { Fn, StringParameter, Refs, NumberParameter, Condition } from 'cloudform'
import Template from 'cloudform-types/types/template';
import Output from 'cloudform-types/types/output';
import { obj, set, str, list, forEach, ref, compoundExpression } from './ast';
import Resource from 'cloudform-types/types/apiGateway/resource';

export default class RelationalDBTemplateGenerator {

    document: DocumentNode

    typePrimaryKeyMap = {
        'testTable': 'id',
        'testTable2': 'id',
        'Test1': 'id',
        'Test2': 'id'
    };

    constructor(schemaDoc: DocumentNode) {
        this.document = schemaDoc
    }

    public createTemplate(): Template {
        const schemaString = print(this.document)

        // TODO: make this Cognito auth
        const template =  {
            AWSTemplateFormatVersion: "2010-09-09",
            Parameters: this.makeParameters(),
            Resources: {
                [ResourceConstants.RESOURCES.APIKeyLogicalID]: this.makeAPIKey(),
                [ResourceConstants.RESOURCES.GraphQLAPILogicalID]: this.makeAPISchema(schemaString),
                [ResourceConstants.RESOURCES.AuthCognitoUserPoolJSClientLogicalID]: this.makeGraphQLApi(),
                ['RelationalDatabaseAccessRole']: this.makeIAMDataSourceRole(),
                //TODO: use ModelResourceIds to provide the IAM service role
                ['RelationalDatabaseDataSource']: this.makeRelationalDataSource('placeholder')
            },
            Outputs: {
                [ResourceConstants.OUTPUTS.GraphQLAPIApiKeyOutput]: this.makeAPIKeyOutput(),
                [ResourceConstants.OUTPUTS.GraphQLAPIEndpointOutput]: this.makeGraphQLApiEndpointOutput(),
                [ResourceConstants.OUTPUTS.GraphQLAPIIdOutput]: this.makeGraphQLApiIdOutput()
            }
        }
        template.Resources = { ...template.Resources, ...this.makeRelationalResolvers()}
        return template
    }

    private makeParameters() {
        return {
            [ResourceConstants.PARAMETERS.AppSyncApiName]: new StringParameter({
                Description: 'The name of the AppSync API',
                Default: 'My AppSync API'
            })
        }

    }

    private makeGraphQLApiIdOutput(): Output {
        return {
            Value: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            Export: {
                Name: Fn.Join(':', [Refs.StackName, "AppSyncApiId"])
            }
        }
    }

    private makeGraphQLApiEndpointOutput(): Output {
        return {
            Value: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'GraphQLUrl'),
            Export: {
                Name: Fn.Join(':', [Refs.StackName, "AppSyncApiEndpoint"])
            }
        }
    }

    private makeGraphQLApi(): GraphQLApi {
        return new GraphQLApi({
            Name: Fn.Ref(ResourceConstants.PARAMETERS.AppSyncApiName),
            AuthenticationType: "API_KEY"
        })
    }

    private makeAPISchema(schemaString: string): GraphQLSchema {
        return new GraphQLSchema({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            Definition: schemaString
        })
    }

    private makeAPIKeyOutput(): Output {
        return {
            Value: Fn.GetAtt(ResourceConstants.RESOURCES.APIKeyLogicalID, 'ApiKey'),
            Export: {
                Name: Fn.Join(':', [Refs.StackName, "AppSyncApiKey"])
            }
        }
    }

    private makeAPIKey(): ApiKey {
        return new ApiKey ({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            Description: 'AWS AppSync Api key for your relational database GraphQL API'
        })
    }

    private makeIAMDataSourceRole(): Role {
        return new Role({
            AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: {
                    Effect: 'Allow',
                    Principal: {
                        Service: 'appsync.amazonaws.com'
                    },
                    Action: {
                        'sts': 'AssumeRole'
                    }
                }
            },
            Policies: [new Policy ({
                PolicyName: 'RelationalDatabaseAccessPolicy',
                PolicyDocument: {
                    Version: '2012-10-17',
                    Statement: {
                        Effect: 'Allow',
                        // TODO: Further Scope Down the Permissions once identified
                        Action: {
                            'rds': '*',
                            'rds-data': '*',
                            'secretsmanager': '*'
                        },
                        Resource: '*'
                    }
                }
            })]
        })
    }

    private makeRelationalResolvers() : {[key: string] : Resource} {
        let resources = {}
        // Iterate over each type and generate CRUDL Resolvers
        Object.keys(this.typePrimaryKeyMap).forEach(element => {
            console.log(element)
            // Generate the Resolvers and add them to the resources list
            resources = {
                ...resources,
                ...{[element + 'CreateResolver']: this.makeCreateRelationalResolver(element)},
                ...{[element + 'GetResolver']: this.makeGetRelationalResolver(element)},
                ...{[element + 'UpdateResolver']: this.makeUpdateRelationalResolver(element)},
                ...{[element + 'DeleteResolver']: this.makeDeleteRelationalResolver(element)},
                ...{[element + 'ListResolver']: this.makeListRelationalResolver(element)}
            }
        });
        return resources
    }

    private makeCreateRelationalResolver(type: string,
            mutationTypeName: string = 'Mutation') {
        const fieldName = graphqlName('create' + toUpper(type))
        let sql = `INSERT INTO ${type} $colStr VALUES $valStr`

        let resolver = new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: Fn.GetAtt('RDSDataSource', 'DataSourceName'),
            TypeName: mutationTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print(
                compoundExpression([
                    set(ref('cols'), list([])),
                    set(ref('vals'), list([])),
                    forEach(
                        ref('entry'),
                        ref(`$ctx.args.create${toUpper(type)}Input.keySet()`),
                        [
                            set(ref('discard'), ref(`$cols.add($entry)`)),
                            set(ref('discard'), ref(`vals.add($entry, "$ctx.args.create${toUpper(type)}Input[$entry]")`))
                        ]
                    ),
                    set(ref('valStr'), ref('vals.toString().replace("[","(").replace("]",")"')),
                    set(ref('colStr'), ref('cols.toString().replace("[","(").replace("]",")"')),
                    RelationalDBMappingTemplate.rdsQuery({
                        statements: list([str(sql)])
                    })
                ])
            ),
            ResponseMappingTemplate: print(
                ref('$utils.toJson($utils.rds.toJsonObject($ctx.result)[0])')
            )
        })

        return resolver
    }

    /**
     * Create a resolver that retrieves data for a type from RDS provided the id
     *
     * @param type
     * @param apiId
     * @param dataSourceName
     * @param fieldNameOverride
     * @param queryTypeName
     */
    private makeGetRelationalResolver(type: string, queryTypeName: string = 'Query') {
        const fieldName = graphqlName('get' + toUpper(type))
        const sql = `SELECT * FROM ${type} WHERE ${this.typePrimaryKeyMap[type]}=$ctx.args.${this.typePrimaryKeyMap[type]}`

        let resolver = new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: Fn.GetAtt('RDSDataSource', 'DataSourceName'),
            FieldName: fieldName,
            TypeName: queryTypeName,
            RequestMappingTemplate: print(
                compoundExpression([
                    RelationalDBMappingTemplate.rdsQuery({
                        statements: list([str(sql)])
                    })
                ])
            ),
            ResponseMappingTemplate: print(
                ref('$utils.toJson($utils.rds.toJsonObject($ctx.result)[0][0])')
            )
        })

        return resolver
    }

    private makeUpdateRelationalResolver(type: string, mutationTypeName: string = 'Mutation') {
        const fieldName = graphqlName('update' + toUpper(type))
        const updateSql =
            `UPDATE ${type} SET $update WHERE ${this.typePrimaryKeyMap[type]}=$ctx.args.update${toUpper(type)}Input.${this.typePrimaryKeyMap[type]}`
        const selectSql =
            `SELECT * FROM ${type} WHERE ${this.typePrimaryKeyMap[type]}=$ctx.args.update${toUpper(type)}Input.${this.typePrimaryKeyMap[type]}`

        return new Resolver ({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: Fn.GetAtt('RDSDataSource', 'DataSourceName'),
            TypeName: mutationTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print(
                compoundExpression([
                    set(ref('updateList'), obj({})),
                    forEach(
                        ref('entry'),
                        ref(`$ctx.args.update${toUpper(type)}Input.keySet()`),
                        [
                            set(ref('discard'), ref(`updateList.put($entry, "$ctx.args.update${toUpper(type)}Input[$entry]")`))
                        ]
                    ),
                    set(ref('update'), ref(`updateList.toString().replace("{","").replace("}","")`)),
                    RelationalDBMappingTemplate.rdsQuery({
                        statements: list([str(updateSql), str(selectSql)])
                    })
                ])
            ),
            ResponseMappingTemplate: print(
                ref('$utils.toJson($utils.rds.toJsonObject($ctx.result)[1][0])')
            )
        })
    }

    private makeDeleteRelationalResolver(type: string, mutationTypeName: string = 'Mutation') {
        const fieldName = graphqlName('delete' + toUpper(type))
        const selectSql = `SELECT * FROM ${type} WHERE ${this.typePrimaryKeyMap[type]}=$ctx.args.${this.typePrimaryKeyMap[type]}`
        const deleteSql = `DELETE FROM ${type} WHERE ${this.typePrimaryKeyMap[type]}=$ctx.args.${this.typePrimaryKeyMap[type]}`

        let resolver = new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: Fn.GetAtt('RDSDataSource', 'DataSourceName'),
            TypeName: mutationTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print(
                compoundExpression([
                    RelationalDBMappingTemplate.rdsQuery({
                        statements: list([str(selectSql), str(deleteSql)])
                    })
                ])
            ),
            ResponseMappingTemplate: print(
                ref('$utils.toJson($utils.rds.toJsonObject($ctx.result)[0][0])')
            )
        })

        return resolver
    }

    private makeListRelationalResolver(type: string, queryTypeName: string = 'Query') {
        const fieldName = graphqlName('list' + plurality(toUpper(type)))
        const sql = `SELECT * FROM ${type}`

        let resolver = new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: Fn.GetAtt('RDSDataSource', 'DataSourceName'),
            TypeName: queryTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print(
                RelationalDBMappingTemplate.rdsQuery({
                    statements: list([str(sql)])
                })
            ),
            ResponseMappingTemplate: print(
                ref('$utils.toJson($utils.rds.toJsonObject($ctx.result)[0])')
            )
        })

        return resolver
    }

    private makeRelationalDataSource(iamRoleLogicalID: string): DataSource {
        return new DataSource({
            Type: 'RELATIONAL_DATABASE',
            Name: 'AppSyncRelationalTransform-DataSource',
            Description: 'RDS Resource Provisioned for AppSync via RelationalDBSchemaTransformer',
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            ServiceRoleArn: Fn.GetAtt(iamRoleLogicalID, 'Arn'),
            RelationalDatabaseConfig: {
                RelationalDatabaseSourceType: 'RDS_HTTP_ENDPOINT',
                // TODO: Grab these values from the Context
                RdsHttpEndpointConfig: {
                    AwsRegion: '',
                    DbClusterIdentifier: '',
                    DatabaseName: '',
                    Schema: '',
                    AwsSecretStoreArn: ''
                }
            }
        })
    }
}
