const CALLABLE_EXPRESSION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

function collectModuleEntries(programBody) {
  const entries = [];
  for (const [index, statement] of programBody.entries()) {
    const declaration = unwrapExport(statement);
    if (!declaration) continue;

    if (declaration.type === 'FunctionDeclaration' && declaration.id) {
      entries.push({
        definitionNode: declaration,
        fnNode: declaration,
        index,
        name: declaration.id.name,
      });
    } else if (declaration.type === 'VariableDeclaration') {
      entries.push(...collectCallableDeclarators(declaration, index));
    }
  }
  return entries;
}

function collectCallableDeclarators(variableDeclaration, index) {
  const entries = [];
  for (const declarator of variableDeclaration.declarations) {
    if (
      declarator.id.type === 'Identifier' &&
      declarator.init &&
      CALLABLE_EXPRESSION_TYPES.has(declarator.init.type)
    ) {
      entries.push({
        definitionNode: declarator,
        fnNode: declarator.init,
        index,
        name: declarator.id.name,
      });
    }
  }
  return entries;
}

function unwrapExport(statement) {
  if (
    statement.type === 'ExportDefaultDeclaration' ||
    statement.type === 'ExportNamedDeclaration'
  ) {
    return statement.declaration;
  }
  return statement;
}

function collectClassEntries(classBody) {
  const entries = [];
  for (const [index, member] of classBody.body.entries()) {
    if (
      member.type === 'MethodDefinition' &&
      (member.kind === 'method' || member.kind === 'constructor') &&
      member.key.type === 'Identifier'
    ) {
      entries.push({ definitionNode: member, fnNode: member.value, index, name: member.key.name });
    }
  }
  return entries;
}

function isThisMemberCall(callee) {
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'ThisExpression' &&
    callee.property.type === 'Identifier'
  );
}

// A CallExpression's callee identifier is only a same-scope reference to one of our
// entries if scope analysis resolves it that way — matching by name alone would wrongly
// flag a shadowed local (a parameter or nested const) that happens to share a name with a
// sibling top-level declaration.
function resolveIdentifierVariable(sourceCode, identifierNode) {
  let scope = sourceCode.getScope(identifierNode);
  while (scope) {
    const reference = scope.references.find((candidate) => candidate.identifier === identifierNode);
    if (reference) return reference.resolved;
    scope = scope.upper;
  }
}

function reportViolations(context, entries, edges) {
  if (entries.length === 0) return;
  const sccOf = computeSccByNode(entries, edges);
  const callersByCallee = new Map();

  for (const edge of edges) {
    if (sccOf.get(edge.from) === sccOf.get(edge.to)) continue;
    if (edge.from.index > edge.to.index) {
      if (!callersByCallee.has(edge.to)) callersByCallee.set(edge.to, new Set());
      callersByCallee.get(edge.to).add(edge.from.name);
    }
  }

  for (const [callee, callerNames] of callersByCallee) {
    const callers = [...callerNames];
    context.report({
      data: {
        callee: callee.name,
        callers: callers.join(', '),
        verb: callers.length === 1 ? 'calls' : 'call',
      },
      messageId: 'outOfOrder',
      node: reportNodeFor(callee),
    });
  }
}

// Tarjan's SCC over each container's call graph. Self- and mutual recursion have no valid
// linear order, so an edge whose endpoints share an SCC is exempt rather than unsatisfiable.
function computeSccByNode(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) adjacency.get(edge.from).push(edge.to);

  let indexCounter = 0;
  let sccCounter = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlink = new Map();
  const sccOf = new Map();

  function strongConnect(v) {
    indices.set(v, indexCounter);
    lowlink.set(v, indexCounter);
    indexCounter += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v)) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const currentScc = sccCounter;
      sccCounter += 1;
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        sccOf.set(w, currentScc);
      } while (w !== v);
    }
  }

  for (const node of nodes) {
    if (!indices.has(node)) strongConnect(node);
  }
  return sccOf;
}

function reportNodeFor(entry) {
  return entry.definitionNode.id ?? entry.definitionNode.key ?? entry.definitionNode;
}

export default {
  create(context) {
    const sourceCode = context.sourceCode;
    const moduleEntries = collectModuleEntries(sourceCode.ast.body);
    const moduleByDefinitionNode = new Map(
      moduleEntries.map((entry) => [entry.definitionNode, entry]),
    );
    const moduleEdges = [];

    const classStack = [];
    const classContainers = [];
    const callableStack = [];

    return {
      ':function'(node) {
        const moduleEntry = moduleEntries.find((entry) => entry.fnNode === node);
        if (moduleEntry) {
          callableStack.push({ entry: moduleEntry, kind: 'module' });
          return;
        }

        const currentClass = classStack.at(-1);
        const classEntry = currentClass?.byFnNode.get(node);
        if (classEntry) {
          callableStack.push({ container: currentClass, entry: classEntry, kind: 'class' });
        }
      },

      ':function:exit'(node) {
        if (callableStack.at(-1)?.entry.fnNode === node) callableStack.pop();
      },
      CallExpression(node) {
        const top = callableStack.at(-1);
        if (!top) return;

        if (top.kind === 'module' && node.callee.type === 'Identifier') {
          const variable = resolveIdentifierVariable(sourceCode, node.callee);
          const definitionNode = variable?.defs[0]?.node;
          const target = definitionNode && moduleByDefinitionNode.get(definitionNode);
          if (target && target !== top.entry) moduleEdges.push({ from: top.entry, to: target });
          return;
        }

        if (top.kind === 'class' && isThisMemberCall(node.callee)) {
          const target = top.container.byName.get(node.callee.property.name);
          if (target && target !== top.entry) {
            top.container.edges.push({ from: top.entry, to: target });
          }
        }
      },

      ClassBody(node) {
        const entries = collectClassEntries(node);
        const container = {
          byFnNode: new Map(entries.map((entry) => [entry.fnNode, entry])),
          byName: new Map(entries.map((entry) => [entry.name, entry])),
          edges: [],
          entries,
        };
        classContainers.push(container);
        classStack.push(container);
      },
      'ClassBody:exit'() {
        classStack.pop();
      },

      'Program:exit'() {
        reportViolations(context, moduleEntries, moduleEdges);
        for (const container of classContainers) {
          reportViolations(context, container.entries, container.edges);
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        'Enforce newspaper order: a function/method must be declared before the sibling functions/methods it calls.',
    },
    messages: {
      outOfOrder:
        "'{{callee}}' is declared above {{callers}}, which {{verb}} it. Newspaper order requires callers to appear before their callees — move '{{callee}}' below its caller(s), or move the caller(s) above it.",
    },
    schema: [],
    type: 'suggestion',
  },
};
