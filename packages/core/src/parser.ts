import fs from 'fs';
import { parse as parseVue, compileTemplate } from '@vue/compiler-sfc';
import { ChildComponentUsage } from './types.js';

export interface ParsedFile {
  filePath: string;
  isVue: boolean;
  scriptContent: string;
  scriptLang: 'ts' | 'js';
  templateTags: string[];
  hasDynamicComponents: boolean;
  declaredSlots?: string[];
  childUsages?: ChildComponentUsage[];
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
    const declaredSlots: string[] = [];
    const childUsages: ChildComponentUsage[] = [];
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

              // Extract slot declarations
              if (tag === 'slot') {
                let slotName = 'default';
                if (node.props) {
                  for (const prop of node.props) {
                    if (prop.type === 6 && prop.name === 'name') {
                      slotName = prop.value?.content || 'default';
                    } else if (prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === 'name') {
                      const exp = prop.exp?.content || 'default';
                      const isStringLiteral = /^(['"`])(.*)\1$/.test(exp);
                      if (isStringLiteral) {
                        slotName = exp.slice(1, -1);
                      } else {
                        slotName = exp;
                      }
                    }
                  }
                }
                declaredSlots.push(slotName);
              }

              // Collect child component usages
              const passedProps: string[] = [];
              const subscribedEvents: string[] = [];
              const filledSlots: string[] = [];
              let hasDynamicProps = false;
              let hasDynamicEvents = false;

              if (node.props) {
                for (const prop of node.props) {
                  if (prop.type === 7) { // Directives
                    if (prop.name === 'bind') {
                      if (prop.arg && prop.arg.type === 4) {
                        passedProps.push(prop.arg.content);
                      } else {
                        hasDynamicProps = true;
                      }
                    } else if (prop.name === 'on') {
                      if (prop.arg && prop.arg.type === 4) {
                        subscribedEvents.push(prop.arg.content);
                      } else {
                        hasDynamicEvents = true;
                      }
                    } else if (prop.name === 'slot') {
                      if (prop.arg && prop.arg.type === 4) {
                        filledSlots.push(prop.arg.content);
                      } else {
                        filledSlots.push('default');
                      }
                    }
                  } else if (prop.type === 6) { // Attributes
                    if (prop.name !== 'name' || tag !== 'slot') {
                      passedProps.push(prop.name);
                    }
                  }
                }
              }

              // Examine child elements for slot fills (e.g. <template v-slot:header>)
              if (node.children && node.children.length > 0) {
                let hasImplicitDefaultSlot = false;
                for (const child of node.children) {
                  if (child.type === 1) {
                    if (child.tag === 'template') {
                      let templateSlotName: string | null = null;
                      if (child.props) {
                        for (const prop of child.props) {
                          if (prop.type === 7 && prop.name === 'slot') {
                            templateSlotName = prop.arg && prop.arg.type === 4 ? prop.arg.content : 'default';
                            break;
                          }
                        }
                      }
                      if (templateSlotName) {
                        filledSlots.push(templateSlotName);
                      } else {
                        hasImplicitDefaultSlot = true;
                      }
                    } else {
                      hasImplicitDefaultSlot = true;
                    }
                  } else if (child.type === 2 || child.type === 5) {
                    const textContent = child.content?.content || child.content || '';
                    if (textContent.trim()) {
                      hasImplicitDefaultSlot = true;
                    }
                  }
                }
                if (hasImplicitDefaultSlot) {
                  filledSlots.push('default');
                }
              }

              childUsages.push({
                componentName: tag,
                passedProps,
                subscribedEvents,
                filledSlots: Array.from(new Set(filledSlots)),
                hasDynamicProps,
                hasDynamicEvents
              });

              // Extract identifiers from attributes and directives for graph reachability
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
      hasDynamicComponents,
      declaredSlots: Array.from(new Set(declaredSlots)),
      childUsages
    };
  } else {
    const isTs = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
    return {
      filePath,
      isVue: false,
      scriptContent: content,
      scriptLang: isTs ? 'ts' : 'js',
      templateTags: [],
      hasDynamicComponents: false,
      declaredSlots: [],
      childUsages: []
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
