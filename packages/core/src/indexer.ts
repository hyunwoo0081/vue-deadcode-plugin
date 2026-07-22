import ts from 'typescript';
import { FileIndex, ImportInfo, ExportInfo, LocalReference, NodeType } from './types.js';

export function indexSource(filePath: string, scriptContent: string, templateTags: string[]): FileIndex {
  const sourceFile = ts.createSourceFile(filePath, scriptContent, ts.ScriptTarget.Latest, true);

  const imports: ImportInfo[] = [];
  const exports: ExportInfo[] = [];
  const localReferences: LocalReference[] = [];
  const fileLevelReferences: string[] = [];

  const topLevelSymbols = new Set<string>();

  // Helper to normalize names for Vue component matching (Pascal/kebab/camel)
  const normalizeName = (name: string): string => {
    return name.replace(/[-_]/g, '').toLowerCase();
  };

  // Step 1: Collect all top-level symbols defined or imported
  function collectTopLevelSymbols(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      const importedSymbols: ImportInfo['importedSymbols'] = [];

      if (node.importClause) {
        if (node.importClause.name) {
          const localName = node.importClause.name.text;
          topLevelSymbols.add(localName);
          importedSymbols.push({ localName, isDefault: true });
        }
        if (node.importClause.namedBindings) {
          const nb = node.importClause.namedBindings;
          if (ts.isNamespaceImport(nb)) {
            const localName = nb.name.text;
            topLevelSymbols.add(localName);
            importedSymbols.push({ localName, isNamespace: true });
          } else if (ts.isNamedImports(nb)) {
            for (const el of nb.elements) {
              const localName = el.name.text;
              const propertyName = el.propertyName?.text;
              topLevelSymbols.add(localName);
              importedSymbols.push({ localName, propertyName });
            }
          }
        }
      }

      imports.push({ moduleSpecifier, importedSymbols });
    } else if (ts.isFunctionDeclaration(node)) {
      if (node.name) {
        topLevelSymbols.add(node.name.text);
      } else {
        topLevelSymbols.add('default');
      }
    } else if (ts.isClassDeclaration(node)) {
      if (node.name) {
        topLevelSymbols.add(node.name.text);
      } else {
        topLevelSymbols.add('default');
      }
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      topLevelSymbols.add(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const names = collectNamesFromBinding(decl.name);
        for (const name of names) {
          topLevelSymbols.add(name);
        }
      }
    }
  }

  sourceFile.statements.forEach(collectTopLevelSymbols);

  // Step 2: Extract exports
  sourceFile.statements.forEach(node => {
    const isExported = (ts.getCombinedModifierFlags(node as any) & ts.ModifierFlags.Export) !== 0;

    if (ts.isExportDeclaration(node)) {
      // e.g. export { x } from 'y'; or export * from 'y';
      const moduleSpecifier = node.moduleSpecifier ? (node.moduleSpecifier as ts.StringLiteral).text : undefined;
      if (moduleSpecifier) {
        if (node.exportClause) {
          if (ts.isNamedExports(node.exportClause)) {
            for (const el of node.exportClause.elements) {
              const exportName = el.name.text;
              const reExportSymbol = el.propertyName?.text ?? exportName;
              exports.push({
                name: exportName,
                kind: 'variable',
                line: getLineNumber(el, sourceFile),
                isReExport: true,
                reExportModule: moduleSpecifier,
                reExportSymbol: reExportSymbol
              });
            }
          }
        } else {
          // export * from 'y'
          exports.push({
            name: '*',
            kind: 'variable',
            line: getLineNumber(node, sourceFile),
            isReExport: true,
            reExportModule: moduleSpecifier
          });
        }
      } else {
        // export { x, y as z }; (from local symbols)
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            const exportName = el.name.text;
            const localName = el.propertyName?.text ?? exportName;
            exports.push({
              name: exportName,
              kind: 'variable',
              line: getLineNumber(el, sourceFile),
              isReExport: false
            });
            // Link local symbol to the export symbol
            localReferences.push({ fromSymbol: exportName, toSymbol: localName });
          }
        }
      }
    } else if (ts.isExportAssignment(node)) {
      // export default expr;
      exports.push({
        name: 'default',
        kind: 'variable', // default kind fallback
        line: getLineNumber(node, sourceFile)
      });
      // Try to find if the default export references an identifier
      if (ts.isIdentifier(node.expression)) {
        localReferences.push({ fromSymbol: 'default', toSymbol: node.expression.text });
      } else {
        // Walk default export expression to find references
        const refs = collectReferencedSymbols(node.expression, topLevelSymbols);
        for (const ref of refs) {
          localReferences.push({ fromSymbol: 'default', toSymbol: ref });
        }
      }
    } else if (isExported) {
      if (ts.isFunctionDeclaration(node)) {
        const name = node.name?.text ?? 'default';
        exports.push({
          name,
          kind: 'function',
          line: getLineNumber(node, sourceFile)
        });
      } else if (ts.isClassDeclaration(node)) {
        const name = node.name?.text ?? 'default';
        exports.push({
          name,
          kind: 'component',
          line: getLineNumber(node, sourceFile)
        });
      } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        exports.push({
          name: node.name.text,
          kind: 'type',
          line: getLineNumber(node, sourceFile)
        });
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          const names = collectNamesFromBinding(decl.name);
          for (const name of names) {
            exports.push({
              name,
              kind: 'variable',
              line: getLineNumber(decl, sourceFile)
            });
          }
        }
      }
    }
  });

  // Step 3: Find local references within declarations
  sourceFile.statements.forEach(node => {
    if (ts.isFunctionDeclaration(node)) {
      const fromSymbol = node.name?.text ?? 'default';
      const refs = collectReferencedSymbols(node, topLevelSymbols);
      for (const toSymbol of refs) {
        if (fromSymbol !== toSymbol) {
          localReferences.push({ fromSymbol, toSymbol });
        }
      }
    } else if (ts.isClassDeclaration(node)) {
      const fromSymbol = node.name?.text ?? 'default';
      const refs = collectReferencedSymbols(node, topLevelSymbols);
      for (const toSymbol of refs) {
        if (fromSymbol !== toSymbol) {
          localReferences.push({ fromSymbol, toSymbol });
        }
      }
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const names = collectNamesFromBinding(decl.name);
        const refs = collectReferencedSymbols(decl, topLevelSymbols);
        for (const fromSymbol of names) {
          for (const toSymbol of refs) {
            if (fromSymbol !== toSymbol) {
              localReferences.push({ fromSymbol, toSymbol });
            }
          }
        }
      }
    } else if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
      // Global file level statements (e.g. top-level function calls, expressions)
      const refs = collectReferencedSymbols(node, topLevelSymbols);
      for (const toSymbol of refs) {
        fileLevelReferences.push(toSymbol);
      }
    }
  });

  // Step 4: Map Vue template tag references to top-level symbols (components)
  if (templateTags.length > 0) {
    const normalizedTags = templateTags.map(normalizeName);
    for (const sym of topLevelSymbols) {
      const normSym = normalizeName(sym);
      if (normalizedTags.includes(normSym)) {
        // File scope references the symbol
        fileLevelReferences.push(sym);
      }
    }
  }

  const declaredProps: string[] = [];
  const declaredEmits: string[] = [];

  function findPropsAndEmits(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name === 'defineProps') {
          // 1. Analyze type arguments: defineProps<{ msg: string }>()
          if (node.typeArguments && node.typeArguments.length > 0) {
            const typeArg = node.typeArguments[0];
            if (ts.isTypeLiteralNode(typeArg)) {
              for (const member of typeArg.members) {
                if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
                  declaredProps.push(member.name.text);
                }
              }
            } else if (ts.isTypeReferenceNode(typeArg)) {
              const typeName = ts.isIdentifier(typeArg.typeName) ? typeArg.typeName.text : '';
              if (typeName) {
                const resolvedProps = resolvePropsFromTypeName(sourceFile, typeName);
                declaredProps.push(...resolvedProps);
              }
            }
          }
          // 2. Analyze arguments: defineProps({ msg: String })
          if (node.arguments && node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (ts.isObjectLiteralExpression(firstArg)) {
              for (const prop of firstArg.properties) {
                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                  declaredProps.push(prop.name.text);
                }
              }
            }
          }
        } else if (name === 'defineEmits') {
          // 1. Analyze type arguments: defineEmits<{ (e: 'change'): void }>()
          if (node.typeArguments && node.typeArguments.length > 0) {
            const typeArg = node.typeArguments[0];
            if (ts.isTypeLiteralNode(typeArg)) {
              for (const member of typeArg.members) {
                if (ts.isCallSignatureDeclaration(member)) {
                  if (member.parameters && member.parameters.length > 0) {
                    const firstParam = member.parameters[0];
                    if (firstParam.type && ts.isLiteralTypeNode(firstParam.type)) {
                      if (ts.isStringLiteral(firstParam.type.literal)) {
                        declaredEmits.push(firstParam.type.literal.text);
                      }
                    }
                  }
                } else if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
                  declaredEmits.push(member.name.text);
                }
              }
            } else if (ts.isTypeReferenceNode(typeArg)) {
              const typeName = ts.isIdentifier(typeArg.typeName) ? typeArg.typeName.text : '';
              if (typeName) {
                const resolvedEmits = resolveEmitsFromTypeName(sourceFile, typeName);
                declaredEmits.push(...resolvedEmits);
              }
            }
          }
          // 2. Analyze arguments: defineEmits(['change'])
          if (node.arguments && node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (ts.isArrayLiteralExpression(firstArg)) {
              for (const el of firstArg.elements) {
                if (ts.isStringLiteral(el)) {
                  declaredEmits.push(el.text);
                }
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, findPropsAndEmits);
  }

  // Traverse the AST to find defineProps and defineEmits
  findPropsAndEmits(sourceFile);

  if (filePath.endsWith('.vue')) {
    if (!exports.some(e => e.name === 'default')) {
      exports.push({
        name: 'default',
        kind: 'component',
        line: 1
      });
    }
  }

  return {
    filePath,
    imports,
    exports,
    localReferences,
    fileLevelReferences,
    declaredProps: filePath.endsWith('.vue') ? Array.from(new Set(declaredProps)) : undefined,
    declaredEmits: filePath.endsWith('.vue') ? Array.from(new Set(declaredEmits)) : undefined
  };
}

function resolvePropsFromTypeName(sourceFile: ts.SourceFile, typeName: string): string[] {
  const props: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName) {
      for (const member of statement.members) {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
          props.push(member.name.text);
        }
      }
    } else if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName) {
      if (ts.isTypeLiteralNode(statement.type)) {
        for (const member of statement.type.members) {
          if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
            props.push(member.name.text);
          }
        }
      }
    }
  }
  return props;
}

function resolveEmitsFromTypeName(sourceFile: ts.SourceFile, typeName: string): string[] {
  const emits: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName) {
      for (const member of statement.members) {
        if (ts.isCallSignatureDeclaration(member)) {
          if (member.parameters && member.parameters.length > 0) {
            const firstParam = member.parameters[0];
            if (firstParam.type && ts.isLiteralTypeNode(firstParam.type)) {
              if (ts.isStringLiteral(firstParam.type.literal)) {
                emits.push(firstParam.type.literal.text);
              }
            }
          }
        } else if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
          emits.push(member.name.text);
        }
      }
    } else if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName) {
      if (ts.isTypeLiteralNode(statement.type)) {
        for (const member of statement.type.members) {
          if (ts.isCallSignatureDeclaration(member)) {
            if (member.parameters && member.parameters.length > 0) {
              const firstParam = member.parameters[0];
              if (firstParam.type && ts.isLiteralTypeNode(firstParam.type)) {
                if (ts.isStringLiteral(firstParam.type.literal)) {
                  emits.push(firstParam.type.literal.text);
                }
              }
            }
          } else if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
            emits.push(member.name.text);
          }
        }
      }
    }
  }
  return emits;
}

function collectNamesFromBinding(nameNode: ts.BindingName): string[] {
  if (ts.isIdentifier(nameNode)) {
    return [nameNode.text];
  }
  const names: string[] = [];
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const element of nameNode.elements) {
      if (ts.isOmittedExpression(element)) continue;
      names.push(...collectNamesFromBinding(element.name));
    }
  }
  return names;
}

function getLineNumber(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isActualReference(n: ts.Identifier): boolean {
  const parent = n.parent;
  if (!parent) return true;

  if (ts.isPropertyAccessExpression(parent) && parent.name === n) {
    return false; // obj.prop -> prop is not a direct reference
  }
  if (ts.isPropertyAssignment(parent) && parent.name === n) {
    return false; // { prop: val } -> prop is not a direct reference
  }
  if (ts.isBindingElement(parent) && parent.propertyName === n) {
    return false; // { prop: val } in binding -> prop is not a direct reference
  }
  if (
    (ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
    parent.name === n
  ) {
    return false;
  }
  return true;
}

function collectReferencedSymbols(node: ts.Node, topLevelSymbols: Set<string>): Set<string> {
  const refs = new Set<string>();

  function visit(n: ts.Node) {
    if (ts.isIdentifier(n)) {
      const text = n.text;
      if (topLevelSymbols.has(text)) {
        if (isActualReference(n)) {
          refs.add(text);
        }
      }
    }
    ts.forEachChild(n, visit);
  }

  // Restrict scanning to body/initializer/members
  if (ts.isFunctionDeclaration(node)) {
    if (node.body) visit(node.body);
  } else if (ts.isVariableDeclaration(node)) {
    if (node.initializer) visit(node.initializer);
  } else if (ts.isClassDeclaration(node)) {
    node.members.forEach(visit);
  } else {
    ts.forEachChild(node, visit);
  }

  return refs;
}
