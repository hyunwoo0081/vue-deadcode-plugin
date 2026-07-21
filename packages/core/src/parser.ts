import fs from 'fs';
import { parse as parseVue, compileTemplate } from '@vue/compiler-sfc';

export interface ParsedFile {
  filePath: string;
  isVue: boolean;
  scriptContent: string;
  scriptLang: 'ts' | 'js';
  templateTags: string[];
  hasDynamicComponents: boolean;
}

export function parseFile(filePath: string): ParsedFile {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.vue')) {
    const { descriptor } = parseVue(content, { filename: filePath });
    
    let scriptContent = '';
    let scriptLang: 'ts' | 'js' = 'js';

    if (descriptor.scriptSetup) {
      scriptContent += descriptor.scriptSetup.content;
      if (descriptor.scriptSetup.lang === 'ts') {
        scriptLang = 'ts';
      }
    }
    
    if (descriptor.script) {
      scriptContent += '\n' + descriptor.script.content;
      if (descriptor.script.lang === 'ts') {
        scriptLang = 'ts';
      }
    }

    const templateTags: string[] = [];
    let hasDynamicComponents = false;

    if (descriptor.template) {
      try {
        const result = compileTemplate({
          source: descriptor.template.content,
          filename: filePath,
          id: filePath
        });
        const ast = result.ast;
        if (ast) {
          walkTemplate(ast, (node) => {
            if (node.type === 1) { // Element Node
              const tag = node.tag;
              if (tag === 'component') {
                const isProp = getIsPropValue(node);
                if (isProp) {
                  if (isProp.isStatic) {
                    templateTags.push(isProp.value);
                  } else {
                    hasDynamicComponents = true;
                  }
                } else {
                  hasDynamicComponents = true;
                }
              } else {
                templateTags.push(tag);
              }

              // Extract identifiers from attributes and directives
              if (node.props) {
                for (const prop of node.props) {
                  if (prop.exp && prop.exp.content) {
                    templateTags.push(...extractIdentifiers(prop.exp.content));
                  }
                }
              }
            } else if (node.type === 5) { // Interpolation Node
              if (node.content && node.content.content) {
                templateTags.push(...extractIdentifiers(node.content.content));
              }
            }
          });
        }
      } catch (err) {
        // Ignore template parsing error or output basic log in verbose modes
      }
    }

    return {
      filePath,
      isVue: true,
      scriptContent,
      scriptLang,
      templateTags: Array.from(new Set(templateTags)),
      hasDynamicComponents
    };
  } else {
    const isTs = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
    return {
      filePath,
      isVue: false,
      scriptContent: content,
      scriptLang: isTs ? 'ts' : 'js',
      templateTags: [],
      hasDynamicComponents: false
    };
  }
}

function extractIdentifiers(code: string): string[] {
  const identifierRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
  const matches = code.match(identifierRegex);
  return matches ? matches : [];
}

function walkTemplate(node: any, callback: (node: any) => void) {
  callback(node);
  if (node.children) {
    for (const child of node.children) {
      walkTemplate(child, callback);
    }
  }
}

function getIsPropValue(node: any): { value: string; isStatic: boolean } | null {
  if (node.props) {
    for (const prop of node.props) {
      if (prop.type === 6 && prop.name === 'is') { // Attribute
        return { value: prop.value?.content || '', isStatic: true };
      }
      if (prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === 'is') { // Directive v-bind:is
        const exp = prop.exp?.content || '';
        // Check if exp is a string literal (e.g. 'MyButton' or "MyButton")
        const isStringLiteral = /^(['"`])(.*)\1$/.test(exp);
        if (isStringLiteral) {
          const content = exp.slice(1, -1);
          return { value: content, isStatic: true };
        }
        return { value: exp, isStatic: false };
      }
    }
  }
  return null;
}
