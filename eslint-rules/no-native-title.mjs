function memberName(member) {
  if (member.computed) {
    return member.property.type === 'Literal' ? member.property.value : undefined;
  }

  return member.property.type === 'Identifier' ? member.property.name : undefined;
}

function literalValue(node) {
  if (node?.type === 'Literal') {
    return node.value;
  }

  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }

  return undefined;
}

export const noNativeTitle = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require the renderer to use Flyoff tooltips instead of native browser titles.',
    },
    messages: {
      nativeTitle: 'Use data-flyoff-tooltip and an accessible name instead of the native title tooltip.',
    },
    schema: [],
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        if (
          node.left.type === 'MemberExpression' &&
          memberName(node.left) === 'title'
        ) {
          context.report({ messageId: 'nativeTitle', node });
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          memberName(node.callee) === 'setAttribute' &&
          String(literalValue(node.arguments[0])).toLowerCase() === 'title'
        ) {
          context.report({ messageId: 'nativeTitle', node });
        }
      },
      JSXAttribute(node) {
        if (
          node.name.type !== 'JSXIdentifier' ||
          node.name.name !== 'title' ||
          node.parent.type !== 'JSXOpeningElement' ||
          node.parent.name.type !== 'JSXIdentifier' ||
          node.parent.name.name[0] !== node.parent.name.name[0]?.toLowerCase()
        ) {
          return;
        }

        context.report({ messageId: 'nativeTitle', node });
      },
    };
  },
};
