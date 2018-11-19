// Mapping Template for Relational DB
import {
    obj, ref, Expression, ReferenceNode, StringNode,
    IntNode, FloatNode, str, ObjectNode, compoundExpression,
    set, list, forEach, ifElse, qref, iff, raw,
    CompoundExpressionNode
} from './ast';

// aws rds-data execute-sql
    // --db-cluster-or-instance-arn "%s"
    // --schema "mysql"
    // --aws-secret-store-arn "%s"
    // --region %s
    // --no-verify-ssl
    // --endpoint-url %s
    // --sql-statements "CREATE DATABASE TESTDB"
    // --database "TESTDB"

export default class RelationalDBMappingTemplate {
    public static executeSql({sqlStatements, dbClusterOrInstanceArn, awsSecretStoreArn, database}: {
        sqlStatements : string,
        dbClusterOrInstanceArn : ObjectNode,
        awsSecretStoreArn: ObjectNode,
        database: ObjectNode
    }): ObjectNode {
        return obj({
            version: str('2018-08-01'),
            operation: str('ExecuteSql'),
            schema: str('mysql'),
            dbClusterOrInstanceArn,
            awsSecretStoreArn,
            database,
            sqlStatements: str(sqlStatements)
        })
    }
}