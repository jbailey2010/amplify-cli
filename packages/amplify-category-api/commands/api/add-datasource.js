const subcommand = 'add-datasource';
const category = 'api';
const servicesMetadata = ['Relational_Datasource']

module.exports = {
    name: subcommand,
    run: async(context) => {
        // return amplify.serviceSelectionPrompt(context, category, servicesMetadata).return( (result) => {
        //     console.log(`testing`)
        // });
        try {
            console.log('testing123')
            const { amplify } = context;

            // let testClass = new RelationalDBSchemaTransformer()
            // let result = testClass.processMySQLSchemaOverJDBCWithCredentials("root", "ashy", "localhost", "testdb")

            // result.then(function(data: TemplateContext) {
            //     console.log(print(data.schemaDoc))

            //     let templateGenerator = new RelationalDBTemplateGenerator(data)
            //     //console.log(templateClass.addRelationalResolvers(templateClass.createTemplate()))
            //     let template = templateGenerator.createTemplate()
            //     template = templateGenerator.addRelationalResolvers(template)
            //     //console.log(template)
            //     console.log(templateGenerator.printCloudformationTemplate(template))
            // })
        } catch (err) {
            context.print.info(err.stack);
            context.print.error(err.message);
        }
    },
}