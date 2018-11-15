import  ApiKey from 'cloudform-types/types/appSync/apiKey'   
import GraphQLSchema from 'cloudform-types/types/appSync/graphQlSchema' 
import GraphQLApi from 'cloudform-types/types/appSync/graphQlApi'
import Parameter from 'cloudform-types/types/parameter'
import { ResourceConstants, ModelResourceIDs } from 'graphql-transformer-common'
import { print} from 'graphql'
import { DocumentNode } from 'graphql'


import { Fn, StringParameter, Refs, NumberParameter, Condition } from 'cloudform'
import Template from 'cloudform-types/types/template';
import Output from 'cloudform-types/types/output';

export default class RelationalDBTemplateGenerator {

    document: DocumentNode

    constructor(schemaDoc: DocumentNode) {
        this.document = schemaDoc
    }

    public createTemplate(): Template{
        const schemaString = print(document)

        // TODO: make this Cognito auth                
        const template =  {
            Parameters: this.makeParameters(),
            Resources: {
                [ResourceConstants.RESOURCES.APIKeyLogicalID]: this.makeAPIKey(),
                [ResourceConstants.RESOURCES.GraphQLAPILogicalID]: this.makeAPISchema(schemaString),
                [ResourceConstants.RESOURCES.AuthCognitoUserPoolJSClientLogicalID]: this.makeGraphQLApi(),
            },
            Outputs: {
                [ResourceConstants.OUTPUTS.GraphQLAPIApiKeyOutput]: this.makeAPIKeyOutput(),
                [ResourceConstants.OUTPUTS.GraphQLAPIEndpointOutput]: this.makeGraphQLApiEndpointOutput(),
                [ResourceConstants.OUTPUTS.GraphQLAPIIdOutput]: this.makeGraphQLApiIdOutput()
            }
        }

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
}