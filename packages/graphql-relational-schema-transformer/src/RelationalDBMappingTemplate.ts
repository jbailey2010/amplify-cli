// Mapping Template for Relational DB
import {
    obj, ref, Expression, ReferenceNode, StringNode,
    IntNode, FloatNode, str, ObjectNode, compoundExpression,
    set, list, forEach, ifElse, qref, iff, raw,
    CompoundExpressionNode,
    ListNode
} from './ast';

export default class RelationalDBMappingTemplate {
    public static rdsQuery({statements}: {
        statements: ListNode
    }): ObjectNode {
        return obj({
            version: str('2018-05-29'),
            statements: statements
        })
    }
}