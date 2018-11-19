import  ApiKey from 'cloudform-types/types/appSync/apiKey'
import GraphQLSchema from 'cloudform-types/types/appSync/graphQlSchema'
import GraphQLApi from 'cloudform-types/types/appSync/graphQlApi'
import Parameter from 'cloudform-types/types/parameter'
import Role, { Policy } from 'cloudform-types/types/iam/role'
import { ResourceConstants, ModelResourceIDs, graphqlName, toUpper, plurality } from 'graphql-transformer-common'
import { print} from 'graphql'
import { DocumentNode } from 'graphql'
import DataSource from 'cloudform-types/types/appSync/dataSource'
import Resolver from 'cloudform-types/types/appSync/resolver'
import { printBlock, compoundExpression, ref } from 'graphql-mapping-template'
import RelationalDBMappingTemplate from './RelationalDBMappingTemplate'


import { Fn, StringParameter, Refs, NumberParameter, Condition } from 'cloudform'
import Template from 'cloudform-types/types/template';
import Output from 'cloudform-types/types/output';
import { obj } from './ast';
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
        template.Resources = { ...template.Resources, ...this.makeGetRelationalResolvers()}
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

    public makeIAMDataSourceRole(): Role {
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

    // aws rds-data execute-sql
    // --db-cluster-or-instance-arn "%s"
    // --schema "mysql"
    // --aws-secret-store-arn "%s"
    // --region %s
    // --no-verify-ssl
    // --endpoint-url %s
    // --sql-statements "CREATE DATABASE TESTDB"
    // --database "TESTDB"

    public makeGetRelationalResolvers() : {[key: string] : Resource} {
        let resources = {}
        // Iterate over each type and generate a Get Resolver
        Object.keys(this.typePrimaryKeyMap).forEach(element => {
            // TODO: determine if we need field name overrides
            const resource = {[element]: this.makeGetRelationalResolver(element)}
            resources = { ...resources, ...resource}
        });
        return resources
    }

    public makeCreateRelationalResolver(type: string, dataSourceName: string,
            mutationTypeName: string = 'Mutation') {
        const fieldName = graphqlName('create' + toUpper(type))
        return new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: dataSourceName,
            TypeName: mutationTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print({}),
            ResponseMappingTemplate: print({})
        })
    }

    /**
     * Create a resolver that retrieves a type from RDS provided the id
     *
     * @param type
     * @param apiId
     * @param dataSourceName
     * @param fieldNameOverride
     * @param queryTypeName
     */
    public makeGetRelationalResolver(type: string, queryTypeName: string = 'Query') {
        const fieldName = graphqlName('get' + toUpper(type))
        let baseSql = 'SELECT * FROM TABLE WHERE PRIMARY_KEY=PRIMARY_KEY_VALUE'
        const finalSql = baseSql.replace('TABLE', type).replace('PRIMARY_KEY', this.typePrimaryKeyMap[type])

        let resolver = new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: Fn.GetAtt('RDSDataSource', 'DataSourceName'),
            TypeName: queryTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print(
                RelationalDBMappingTemplate.executeSql({
                    // TODO: use ctx.args.id to replace PRIMARY_KEY_VALUE in finalSql
                    sqlStatements: finalSql,
                    // TODO: change the below to use cfn attributes
                    dbClusterOrInstanceArn: obj({
                        dbClusterArn: ref('$ctx.args.dbClusterArn')
                    }),
                    awsSecretStoreArn: obj({
                        awsSecretStoreArn: ref('$ctx.args.awsSecretStoreArn')
                    }),
                    database: obj({
                        database: ref('$ctx.args.database')
                    })
                })
            ),
            ResponseMappingTemplate: print(
                ref('util.toJson($context.result)')
            )
        })

        return resolver
    }

    public makeUpdateRelationalResolver(type: string, dataSourceName: string,
        fieldNameOverride: string, mutationTypeName: string = 'Mutation') {
        const fieldName = fieldNameOverride ? fieldNameOverride : graphqlName('update' + toUpper(type))
        return new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: dataSourceName,
            TypeName: mutationTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print({}),
            ResponseMappingTemplate: print({})
        })
    }

    public makeDeleteRelationalResolver(type: string, dataSourceName: string,
        fieldNameOverride: string, mutationTypeName: string = 'Mutation') {
        const fieldName = fieldNameOverride ? fieldNameOverride : graphqlName('delete' + toUpper(type))
        return new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: dataSourceName,
            TypeName: mutationTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print({}),
            ResponseMappingTemplate: print({})
        })
    }

    public makeListRelationalResolver(type: string, dataSourceName: string,
        fieldNameOverride: string, queryTypeName: string = 'Query') {
        const fieldName = fieldNameOverride ? fieldNameOverride : graphqlName('list' + plurality(toUpper(type)))
        const defaultLimit = 10

        return new Resolver({
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            DataSourceName: dataSourceName,
            TypeName: queryTypeName,
            FieldName: fieldName,
            RequestMappingTemplate: print({}),
            ResponseMappingTemplate: print({})
        })
    }

    public makeRelationalDataSource(iamRoleLogicalID: string): DataSource {
        // TODO: Fix the placeholder values with actual ones
        return new DataSource({
            Type: 'RELATIONAL_DATABASE',
            Name: 'AppSyncRelationalTransform-DataSource',
            Description: 'RDS Resource Provisioned for AppSync via RelationalDBSchemaTransformer',
            ApiId: Fn.GetAtt(ResourceConstants.RESOURCES.GraphQLAPILogicalID, 'ApiId'),
            ServiceRoleArn: Fn.GetAtt(iamRoleLogicalID, 'Arn'),
            // TODO: Uncomment and fill once the changes are available in latest cloudform
            // RelationalDatabaseDataSourceConfig: {
            //     RelationalDatabaseDataSourceType: 'RDS_HTTP_ENDPOINT',
            //     RdsHttpEndpointConfig: {
            //         AwsRegion: '',
            //         DbClusterIdentifier: '',
            //         DatabaseName: '',
            //         Schema: '',
            //         AwsSecretStoreArn: ''
            //     }
            // }
        })
    }
}
